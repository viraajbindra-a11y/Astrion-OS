/*
 * Astrion v2.0 — PCI configuration space (mechanism #1)
 *
 * See pci.h for why mechanism #1 and not ECAM.
 *
 * The enumeration below is the brute-force one: 256 buses x 32 slots x 8
 * functions, every combination probed. A recursive walk that follows
 * PCI-to-PCI bridges is more elegant and finds exactly the same devices on
 * every machine Astrion will ever boot on, because a bridge's secondary bus
 * number is one of the buses the brute-force loop already visits. 65,536
 * config reads at ~1us each is well under a second, once, at boot — and the
 * brute-force version cannot get lost in a bridge misconfiguration, which the
 * recursive one can.
 *
 * The one real subtlety is the multifunction check. Probing function 1..7 of
 * a device that is not multifunction is not merely wasteful: some real
 * chipsets alias every function onto function 0, so a single-function device
 * appears eight times and the table fills with phantoms. Bit 7 of the header
 * type byte is the authority on this, and it is checked before any function
 * past 0 is touched.
 */

#include <stdint.h>
#include "pci.h"

#define CFG_ADDR 0xCF8u
#define CFG_DATA 0xCFCu

static inline void outl_(uint16_t port, uint32_t val) {
    __asm__ volatile("outl %0, %1" : : "a"(val), "Nd"(port));
}
static inline uint32_t inl_(uint16_t port) {
    uint32_t v; __asm__ volatile("inl %1, %0" : "=a"(v) : "Nd"(port)); return v;
}

/* Bit 31 enables the config cycle; bits 30..24 are reserved and must be 0.
 * The low two bits of `off` are dropped on purpose — the hardware ignores
 * them, and letting an unaligned offset through would silently return the
 * dword containing it, which reads as a wildly wrong field rather than as an
 * error. */
static uint32_t cfg_addr(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off) {
    return 0x80000000u | ((uint32_t)bus << 16) | ((uint32_t)(slot & 0x1F) << 11)
         | ((uint32_t)(fn & 0x07) << 8) | (uint32_t)(off & 0xFC);
}

uint32_t pci_cfg_read32(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off) {
    outl_(CFG_ADDR, cfg_addr(bus, slot, fn, off));
    return inl_(CFG_DATA);
}

uint16_t pci_cfg_read16(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off) {
    uint32_t d = pci_cfg_read32(bus, slot, fn, off);
    return (uint16_t)((d >> ((off & 2) * 8)) & 0xFFFFu);
}

void pci_cfg_write32(uint8_t bus, uint8_t slot, uint8_t fn, uint8_t off,
                     uint32_t val) {
    outl_(CFG_ADDR, cfg_addr(bus, slot, fn, off));
    outl_(CFG_DATA, val);
}

/* Fixed table, no kmalloc. 64 is far more than any machine Astrion targets
 * shows (QEMU's default q35/i440fx profiles present under a dozen), and a
 * fixed array cannot leak, cannot fragment the heap at boot, and cannot fail
 * at the one moment there is nothing to fall back on. Overflow stops
 * recording rather than growing, and says so. */
#define PCI_MAX 64
static struct pci_dev g_dev[PCI_MAX];
static int g_n;
static int g_overflow;

int pci_count(void) { return g_n; }

const struct pci_dev *pci_at(int i) {
    return (i >= 0 && i < g_n) ? &g_dev[i] : 0;
}

static void record(uint8_t bus, uint8_t slot, uint8_t fn, uint32_t id) {
    if (g_n >= PCI_MAX) { g_overflow = 1; return; }
    struct pci_dev *d = &g_dev[g_n++];
    d->bus = bus; d->slot = slot; d->fn = fn;
    d->vendor = (uint16_t)(id & 0xFFFFu);
    d->device = (uint16_t)(id >> 16);

    uint32_t cls = pci_cfg_read32(bus, slot, fn, 0x08);
    d->revision = (uint8_t)(cls & 0xFFu);
    d->prog_if  = (uint8_t)((cls >> 8)  & 0xFFu);
    d->subclass = (uint8_t)((cls >> 16) & 0xFFu);
    d->class_   = (uint8_t)((cls >> 24) & 0xFFu);
    d->irq_line = (uint8_t)(pci_cfg_read32(bus, slot, fn, 0x3C) & 0xFFu);
}

int pci_scan(void) {
    g_n = 0; g_overflow = 0;
    for (int bus = 0; bus < 256; bus++) {
        for (int slot = 0; slot < 32; slot++) {
            uint32_t id0 = pci_cfg_read32((uint8_t)bus, (uint8_t)slot, 0, 0x00);
            /* 0xFFFF vendor is how an empty slot answers: nothing drives the
             * bus, so the pull-ups win and every bit reads as 1. */
            if ((id0 & 0xFFFFu) == 0xFFFFu) continue;
            record((uint8_t)bus, (uint8_t)slot, 0, id0);

            uint8_t hdr = (uint8_t)((pci_cfg_read32((uint8_t)bus, (uint8_t)slot,
                                                    0, 0x0C) >> 16) & 0xFFu);
            if (!(hdr & 0x80)) continue;      /* single-function: do NOT probe 1..7 */

            for (int fn = 1; fn < 8; fn++) {
                uint32_t id = pci_cfg_read32((uint8_t)bus, (uint8_t)slot,
                                             (uint8_t)fn, 0x00);
                if ((id & 0xFFFFu) == 0xFFFFu) continue;
                record((uint8_t)bus, (uint8_t)slot, (uint8_t)fn, id);
            }
        }
    }
    return g_n;
}

const struct pci_dev *pci_find(uint16_t vendor, uint16_t device) {
    for (int i = 0; i < g_n; i++)
        if (g_dev[i].vendor == vendor && g_dev[i].device == device)
            return &g_dev[i];
    return 0;
}

const struct pci_dev *pci_find_class(uint8_t class_, uint8_t subclass) {
    for (int i = 0; i < g_n; i++)
        if (g_dev[i].class_ == class_ && g_dev[i].subclass == subclass)
            return &g_dev[i];
    return 0;
}

int pci_bar_is_io(const struct pci_dev *d, int idx) {
    if (!d || idx < 0 || idx > 5) return 0;
    return (pci_cfg_read32(d->bus, d->slot, d->fn,
                           (uint8_t)(0x10 + idx * 4)) & 1u) != 0;
}

uint64_t pci_bar(const struct pci_dev *d, int idx) {
    if (!d || idx < 0 || idx > 5) return 0;
    uint32_t lo = pci_cfg_read32(d->bus, d->slot, d->fn,
                                 (uint8_t)(0x10 + idx * 4));
    if (lo & 1u)                            /* I/O space: bit 0 set, bits 1.. */
        return (uint64_t)(lo & ~0x3u);

    /* Memory BAR. Bits [2:1] carry the type; 0b10 means the address is 64 bits
     * wide and the NEXT BAR slot holds its high half. Ignoring that reads the
     * high dword as if it were a separate 32-bit BAR, which is how a device
     * mapped above 4 GiB ends up looking like two nonsense devices. */
    uint64_t base = (uint64_t)(lo & ~0xFu);
    if (((lo >> 1) & 3u) == 2u && idx < 5) {
        uint32_t hi = pci_cfg_read32(d->bus, d->slot, d->fn,
                                     (uint8_t)(0x10 + (idx + 1) * 4));
        base |= (uint64_t)hi << 32;
    }
    return base;
}

void pci_enable_bus_master(const struct pci_dev *d) {
    if (!d) return;
    uint32_t cmd = pci_cfg_read32(d->bus, d->slot, d->fn, 0x04);
    /* bit 0 I/O space, bit 1 memory space, bit 2 bus master. Memory and bus
     * master are both required for a DMA device; I/O is set too because it
     * costs nothing and some cards expose a register window there. */
    pci_cfg_write32(d->bus, d->slot, d->fn, 0x04, cmd | 0x7u);
}

const char *pci_class_name(uint8_t class_, uint8_t subclass) {
    switch (class_) {
    case 0x01:
        if (subclass == 0x01) return "IDE controller";
        if (subclass == 0x06) return "SATA controller";
        if (subclass == 0x08) return "NVMe controller";
        return "storage controller";
    case 0x02: return "network controller";
    case 0x03: return "display controller";
    case 0x04: return "multimedia device";
    case 0x06:
        if (subclass == 0x00) return "host bridge";
        if (subclass == 0x01) return "ISA bridge";
        if (subclass == 0x04) return "PCI bridge";
        return "bridge";
    case 0x0C:
        if (subclass == 0x03) return "USB controller";
        return "serial bus controller";
    default: break;
    }
    /* Not "unknown device 0x%02x" — a class we have not named is not a fault,
     * and a scary label in the shell invites a bug report about a working
     * machine. */
    return "device";
}
