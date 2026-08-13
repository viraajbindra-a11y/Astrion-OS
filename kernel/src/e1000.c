/*
 * Astrion v2.0 — Intel 82540EM (e1000) driver. See e1000.h for why this card
 * and why polled.
 *
 * Layout of what follows: register names, the two descriptor formats, ring
 * setup, then send and receive. The comments are heaviest around the four
 * places this is easy to get wrong and impossible to debug afterwards:
 *
 *   1. bus mastering, without which the card never reads the ring at all;
 *   2. the tail pointers, which are off-by-one in opposite directions for RX
 *      and TX and are the reason a "correct" driver receives nothing;
 *   3. the MAC, which must be rejected when it reads back as zeroes or ones;
 *   4. every spin, all of which are bounded, because a driver that hangs the
 *      kernel on a card that did not answer is worse than one that gives up.
 */

#include <stdint.h>
#include "e1000.h"
#include "pci.h"
#include "pmm.h"
#include "net_frame.h"
#include "mmio.h"

/* ─── registers (byte offsets into BAR0) ─── */
#define E_CTRL      0x0000
#define E_STATUS    0x0008
#define E_EERD      0x0014
#define E_ICR       0x00C0
#define E_IMC       0x00D8
#define E_RCTL      0x0100
#define E_TCTL      0x0400
#define E_TIPG      0x0410
#define E_RDBAL     0x2800
#define E_RDBAH     0x2804
#define E_RDLEN     0x2808
#define E_RDH       0x2810
#define E_RDT       0x2818
#define E_TDBAL     0x3800
#define E_TDBAH     0x3804
#define E_TDLEN     0x3808
#define E_TDH       0x3810
#define E_TDT       0x3818
#define E_MTA       0x5200      /* 128 dwords of multicast filter */
#define E_RAL0      0x5400
#define E_RAH0      0x5404

#define CTRL_SLU    (1u << 6)   /* set link up      */
#define CTRL_ASDE   (1u << 5)   /* auto-speed detect */
#define CTRL_RST    (1u << 26)

#define STATUS_LU   (1u << 1)   /* link up */

#define RCTL_EN     (1u << 1)
#define RCTL_UPE    (1u << 3)   /* unicast promiscuous  */
#define RCTL_MPE    (1u << 4)   /* multicast promiscuous */
#define RCTL_BAM    (1u << 15)  /* accept broadcast     */
#define RCTL_SECRC  (1u << 26)  /* strip the 4-byte CRC */

#define TCTL_EN     (1u << 1)
#define TCTL_PSP    (1u << 3)   /* pad short packets to 60 bytes */

#define TXD_CMD_EOP  (1u << 0)
#define TXD_CMD_IFCS (1u << 1)  /* have the card append the CRC */
#define TXD_CMD_RS   (1u << 3)  /* report status - sets DD when done */
#define TXD_STA_DD   (1u << 0)

#define RXD_STA_DD   (1u << 0)
#define RXD_STA_EOP  (1u << 1)

#define RAH_AV      (1u << 31)  /* this receive address is valid */

/* Ring sizes. Both must make the ring length a multiple of 128 bytes, which
 * the datasheet requires and the card enforces by silently misbehaving:
 * 32 * 16 = 512 and 8 * 16 = 128. Small on purpose — this moves ARP and DHCP
 * today, and a bigger ring would only hide a tail-pointer bug for longer. */
#define NRX 32
#define NTX 8
#define RXBUF 2048              /* matches RCTL BSIZE=00 (2048 bytes) */

/* Legacy descriptor formats, 16 bytes each, exactly as the card reads them.
 * packed because the card does not care what the compiler would prefer. */
struct rx_desc {
    uint64_t addr;
    uint16_t length;
    uint16_t csum;
    uint8_t  status;
    uint8_t  errors;
    uint16_t special;
} __attribute__((packed));

struct tx_desc {
    uint64_t addr;
    uint16_t length;
    uint8_t  cso;
    uint8_t  cmd;
    uint8_t  status;
    uint8_t  css;
    uint16_t special;
} __attribute__((packed));

static volatile uint8_t *g_mmio;
static struct rx_desc *g_rx;
static struct tx_desc *g_tx;
static uint64_t g_rxbuf[NRX];
static uint64_t g_txbuf[NTX];
static uint32_t g_rx_next;              /* the descriptor WE will read next */
static uint32_t g_tx_next;
static uint8_t  g_mac[6];
static int      g_present;
static uint32_t g_tx_n, g_rx_n, g_rx_drop;
static int      g_uncached;

/* MMIO. volatile because every one of these has a side effect on the card and
 * the compiler must not merge, reorder or elide any of them. */
static void wr(uint32_t off, uint32_t v) {
    *(volatile uint32_t *)(g_mmio + off) = v;
}
static uint32_t rd(uint32_t off) {
    return *(volatile uint32_t *)(g_mmio + off);
}

/* A bounded busy-wait. Every spin in this file goes through here, so none of
 * them can hang the kernel on a card that stopped answering — a driver that
 * wedges the machine on absent hardware is worse than one that gives up and
 * says so, because the second can be diagnosed from the boot log. */
static void spin(uint32_t loops) {
    for (uint32_t i = 0; i < loops; i++) __asm__ volatile("pause");
}

/* The MAC the card presents in its receive-address registers. On real hardware
 * the card loads these from its EEPROM at power-on; QEMU writes them at reset.
 * Either way this is the portable place to read it, and it avoids the EEPROM
 * bit-banging that differs across every chip in this family.
 *
 * Returns 0 when what came back cannot be a real address. That check is not
 * defensive padding: a card that failed its EEPROM load presents all zeroes,
 * and a card that is not answering MMIO at all reads back as all ones. Both
 * produce a driver that reports success and frames that every switch on the
 * network silently discards. */
static int read_mac(void) {
    uint32_t lo = rd(E_RAL0), hi = rd(E_RAH0);
    if (!(hi & RAH_AV)) return 0;              /* card says it is not valid */
    g_mac[0] = (uint8_t)(lo      );
    g_mac[1] = (uint8_t)(lo >>  8);
    g_mac[2] = (uint8_t)(lo >> 16);
    g_mac[3] = (uint8_t)(lo >> 24);
    g_mac[4] = (uint8_t)(hi      );
    g_mac[5] = (uint8_t)(hi >>  8);
    return !nf_mac_is_zero(g_mac) && !nf_mac_is_bcast(g_mac);
}

int e1000_init(void) {
    g_present = 0;

    const struct pci_dev *d = pci_find_class(0x02, 0x00);
    if (!d) return 0;

    uint64_t bar = pci_bar(d, 0);
    if (!bar || pci_bar_is_io(d, 0)) return 0;     /* need the memory window */
    g_mmio = (volatile uint8_t *)(uintptr_t)bar;   /* low 4 GiB is identity-mapped */

    /* Device registers must not be cached. boot/multiboot2.S maps everything
     * low as cacheable huge pages because everything it was mapping was RAM,
     * and this window is not RAM: a cached read can return a status the card
     * has already changed, and a write can sit in a write-back buffer while
     * the card waits for a command that never arrives.
     *
     * QEMU will never show the difference — emulated device memory is trapped
     * on every access regardless of the page tables — so this is a correctness
     * fix that cannot be tested by its effect on the machine it was written
     * on. That is precisely why it is done now rather than when something
     * breaks: the machine it breaks on belongs to somebody else.
     *
     * A failure here is NOT fatal. Firmware usually marks the PCI hole
     * uncacheable through the MTRRs, and the CPU takes the more conservative
     * of the two types, so the driver still works — it just works because of
     * someone else's decision instead of ours. Worth a line in the log, not a
     * refusal to run. */
    /* The last clause is a CONTROL, and it is the only reason the other two
     * mean anything. mmio_is_uncached(bar) coming back true is equally
     * satisfied by a function that returns true for every address ever passed
     * to it — so ask it about ordinary RAM at 1 MiB, which is mapped, is not
     * a device, and must still be cached. Only a walker that can tell those
     * two apart is reporting anything at all. */
    g_uncached = mmio_map_uncached(bar, 0x20000) &&
                 mmio_is_uncached(bar) &&
                 !mmio_is_uncached(0x100000);

    /* Bus mastering FIRST, before anything is asked of the card.
     *
     * Without it the card is allowed to answer register reads and forbidden to
     * touch memory, so every descriptor ring is set up perfectly and never
     * read. The symptom is that transmit spins forever on a done bit that
     * cannot be set, from a driver where nothing is wrong. */
    pci_enable_bus_master(d);

    /* Reset, then wait for the card to clear the bit itself. */
    wr(E_CTRL, rd(E_CTRL) | CTRL_RST);
    for (int i = 0; i < 1000 && (rd(E_CTRL) & CTRL_RST); i++) spin(1000);
    if (rd(E_CTRL) & CTRL_RST) return 0;           /* never came back */

    /* Mask every interrupt and clear anything pending. This is a polled
     * driver; an unmasked line on a shared IRQ would fire into a handler that
     * does not exist. Reading ICR is what acknowledges. */
    wr(E_IMC, 0xFFFFFFFFu);
    (void)rd(E_ICR);

    if (!read_mac()) return 0;

    /* Link up + auto-speed. */
    wr(E_CTRL, rd(E_CTRL) | CTRL_SLU | CTRL_ASDE);

    /* Empty the multicast filter. It comes up undefined on some chips, and a
     * stale entry means the card accepts groups nothing asked for. */
    for (int i = 0; i < 128; i++) wr(E_MTA + i * 4, 0);

    /* ─── receive ring ───
     * One 4 KiB frame for the descriptors (32 * 16 = 512 bytes, so it fits
     * with room to spare and is 4 KiB aligned, which more than satisfies the
     * 16-byte requirement), and one frame per 2048-byte buffer. A frame per
     * buffer wastes half of each, and it guarantees no buffer straddles a
     * page — which costs nothing here and removes a whole class of question. */
    uint64_t rxring = pmm_alloc();
    if (!rxring) return 0;
    g_rx = (struct rx_desc *)(uintptr_t)rxring;
    for (int i = 0; i < NRX; i++) {
        g_rxbuf[i] = pmm_alloc();
        if (!g_rxbuf[i]) return 0;
        g_rx[i].addr   = g_rxbuf[i];
        g_rx[i].status = 0;
    }
    wr(E_RDBAL, (uint32_t)(rxring & 0xFFFFFFFFu));
    wr(E_RDBAH, (uint32_t)(rxring >> 32));
    wr(E_RDLEN, NRX * 16);
    wr(E_RDH, 0);
    /* RX tail is the last descriptor the card MAY write, so it points one
     * short of the head after a full lap: NRX-1, not NRX. Setting it to NRX
     * makes head == tail, which the card reads as "the ring is full, there is
     * nowhere to put anything" — and it receives exactly nothing, forever,
     * from a ring that looks correct in every register dump. */
    wr(E_RDT, NRX - 1);
    g_rx_next = 0;
    wr(E_RCTL, RCTL_EN | RCTL_BAM | RCTL_SECRC | RCTL_UPE | RCTL_MPE);

    /* ─── transmit ring ─── */
    uint64_t txring = pmm_alloc();
    if (!txring) return 0;
    g_tx = (struct tx_desc *)(uintptr_t)txring;
    for (int i = 0; i < NTX; i++) {
        g_txbuf[i] = pmm_alloc();
        if (!g_txbuf[i]) return 0;
        g_tx[i].addr   = g_txbuf[i];
        g_tx[i].cmd    = 0;
        /* DD set on every descriptor up front means "this one is free". The
         * card sets it when it finishes a descriptor, so an all-zero ring
         * would read as "every descriptor is still in flight" before a single
         * packet had been sent. */
        g_tx[i].status = TXD_STA_DD;
    }
    wr(E_TDBAL, (uint32_t)(txring & 0xFFFFFFFFu));
    wr(E_TDBAH, (uint32_t)(txring >> 32));
    wr(E_TDLEN, NTX * 16);
    wr(E_TDH, 0);
    /* TX tail is where the NEXT descriptor will go, so head == tail means
     * "nothing queued" — the opposite convention to RX, on the same card, two
     * registers apart. */
    wr(E_TDT, 0);
    g_tx_next = 0;
    /* Collision threshold 15, collision distance 64: the half-duplex values
     * from the datasheet. Meaningless on a full-duplex link and harmless, and
     * writing something sane beats leaving them at whatever reset left. */
    wr(E_TCTL, TCTL_EN | TCTL_PSP | (15u << 4) | (64u << 12));
    wr(E_TIPG, 10u | (8u << 10) | (6u << 20));   /* IEEE 802.3 inter-packet gap */

    g_present = 1;
    g_tx_n = g_rx_n = g_rx_drop = 0;
    return 1;
}

int e1000_present(void) { return g_present; }
const uint8_t *e1000_mac(void) { return g_mac; }
uint32_t e1000_tx_count(void) { return g_tx_n; }
uint32_t e1000_rx_count(void) { return g_rx_n; }
uint32_t e1000_rx_dropped(void) { return g_rx_drop; }
int e1000_mmio_uncached(void) { return g_uncached; }

int e1000_link_up(void) {
    return g_present && (rd(E_STATUS) & STATUS_LU) != 0;
}

int e1000_send(const void *frame, uint16_t len) {
    /* 1518 is the largest valid Ethernet frame without jumbo frames or a VLAN
     * tag, and nothing here uses either. The buffer behind this is a whole 4
     * KiB page, so a longer frame would not overrun anything — it would go on
     * the wire and be discarded by the first switch that saw it, which is a
     * harder failure to find than a refusal here. */
    if (!g_present || !frame || len == 0 || len > 1518) return 0;

    uint32_t i = g_tx_next;
    /* Wait for this descriptor to be free. Bounded: a card that stops
     * completing descriptors must not take the kernel with it. */
    for (int t = 0; t < 10000 && !(g_tx[i].status & TXD_STA_DD); t++) spin(100);
    if (!(g_tx[i].status & TXD_STA_DD)) return 0;

    uint8_t *buf = (uint8_t *)(uintptr_t)g_txbuf[i];
    const uint8_t *src = (const uint8_t *)frame;
    for (uint16_t k = 0; k < len; k++) buf[k] = src[k];

    g_tx[i].length = len;
    g_tx[i].cso    = 0;
    g_tx[i].css    = 0;
    g_tx[i].special = 0;
    g_tx[i].status = 0;                       /* the card will set DD */
    g_tx[i].cmd    = TXD_CMD_EOP | TXD_CMD_IFCS | TXD_CMD_RS;

    g_tx_next = (i + 1) % NTX;
    wr(E_TDT, g_tx_next);                     /* hand it over */

    for (int t = 0; t < 10000 && !(g_tx[i].status & TXD_STA_DD); t++) spin(100);
    if (!(g_tx[i].status & TXD_STA_DD)) return 0;

    g_tx_n++;
    return 1;
}

int e1000_recv(void *out, int cap) {
    if (!g_present || !out || cap <= 0) return 0;

    uint32_t i = g_rx_next;
    if (!(g_rx[i].status & RXD_STA_DD)) return 0;      /* nothing waiting */

    int len = (int)g_rx[i].length;
    int taken = 0;

    /* A frame the caller's buffer cannot hold is DROPPED, not truncated. A
     * truncated frame is a wrong frame that looks like a real one, and the
     * counter is what makes the difference visible afterwards — "nothing
     * arrived" and "something arrived and we threw it away" are the same
     * silence from out here and have nothing else in common. */
    if (len > 0 && len <= cap && (g_rx[i].status & RXD_STA_EOP)) {
        const uint8_t *src = (const uint8_t *)(uintptr_t)g_rxbuf[i];
        uint8_t *dst = (uint8_t *)out;
        for (int k = 0; k < len; k++) dst[k] = src[k];
        taken = len;
        g_rx_n++;
    } else {
        g_rx_drop++;
    }

    /* Hand the descriptor back and advance the tail to it. The tail always
     * trails our read position by one for the same reason it started at
     * NRX-1: it names the last slot the card may fill, and letting it reach
     * the head would tell the card the ring is full. */
    g_rx[i].status = 0;
    g_rx_next = (i + 1) % NRX;
    wr(E_RDT, i);

    return taken;
}
