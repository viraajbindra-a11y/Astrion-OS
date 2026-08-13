/*
 * Table-driven gate for Ethernet/ARP frame construction and parsing.
 *
 * Exists because a byte-order slip or a wrong offset makes a frame that looks
 * entirely reasonable in a debugger and is silently dropped by every machine
 * on the wire. The symptom is "nothing happens", produced by a working card
 * and a driver doing exactly what it was told, and chasing it through a NIC
 * costs hours. Chasing it against known-good byte sequences costs milliseconds.
 *
 * The expected bytes below are not what the code produces — they are what RFC
 * 826 and a packet capture say an ARP request looks like, written down first.
 * A test whose expectations were read off the implementation proves only that
 * the implementation is self-consistent.
 *
 * Every acceptance row has a REJECTION row beside it: a frame that differs in
 * exactly one field and must NOT be accepted. Those are the ones that matter.
 * A parser that returns 1 unconditionally passes every acceptance test ever
 * written, and on a real network — where the card is in promiscuous mode and
 * the wire is full of other people's ARP traffic — it resolves the gateway to
 * a stranger's MAC and sends every packet to the wrong machine.
 */
#include <stdio.h>
#include <string.h>
#include "net_frame.h"

static int failures;

static void hexdump(const char *label, const uint8_t *p, int n)
{
    printf("        %s", label);
    for (int i = 0; i < n; i++) printf(" %02x", p[i]);
    printf("\n");
}

static void bytes_are(const uint8_t *got, const uint8_t *want, int n,
                      const char *why)
{
    if (memcmp(got, want, (size_t)n) != 0) {
        printf("  FAIL %s\n", why);
        hexdump("got  ", got, n);
        hexdump("want ", want, n);
        failures++;
    }
}

static void eq_int(long got, long want, const char *why)
{
    if (got != want) {
        printf("  FAIL %s: got %ld, expected %ld\n", why, got, want);
        failures++;
    }
}

static void accepts(int got, int want, const char *why)
{
    if (got != want) {
        printf("  FAIL %s: parser said %d, expected %d\n", why, got, want);
        failures++;
    }
}

/* Our side, and the machine we are asking about. Matches QEMU's user-mode
 * network exactly, because that is what the live gate boots against:
 * 10.0.2.15 is the guest, 10.0.2.2 is the gateway. */
static const uint8_t OUR_MAC[6] = { 0x52, 0x54, 0x00, 0x12, 0x34, 0x56 };
static const uint8_t GW_MAC[6]  = { 0x52, 0x55, 0x0a, 0x00, 0x02, 0x02 };

/* Build a well-formed ARP reply from GW_MAC, so each rejection row can break
 * exactly one field of a frame that is otherwise known good. Without this
 * baseline a rejection row proves nothing — a parser could be refusing it for
 * some other reason entirely. */
static void make_reply(uint8_t *f)
{
    nf_eth_build(f, OUR_MAC, GW_MAC, ETH_P_ARP);
    uint8_t *a = f + ETH_HDR_LEN;
    nf_put16(a + 0, ARP_HTYPE_ETH);
    nf_put16(a + 2, ETH_P_IPV4);
    a[4] = 6; a[5] = 4;
    nf_put16(a + 6, ARP_OP_REPLY);
    nf_copy(a + 8, GW_MAC, 6);
    nf_put32(a + 14, nf_ip(10, 0, 2, 2));       /* sender: the gateway     */
    nf_copy(a + 18, OUR_MAC, 6);
    nf_put32(a + 24, nf_ip(10, 0, 2, 15));      /* target: us              */
}

int main(void)
{
    printf("net frame gate - Ethernet + ARP, byte for byte\n\n");

    /* ═══ 1. Big-endian put/get. The primitive everything rests on. ═══ */
    {
        uint8_t b[4];
        nf_put16(b, 0x0806);
        eq_int(b[0], 0x08, "put16 writes the HIGH byte first");
        eq_int(b[1], 0x06, "put16 writes the low byte second");
        nf_put32(b, 0x0A00020F);
        eq_int(b[0], 0x0A, "put32 byte 0 is the most significant");
        eq_int(b[3], 0x0F, "put32 byte 3 is the least significant");
        eq_int(nf_get16(b), 0x0A00, "get16 round-trips the first two");
        eq_int((long)nf_get32(b), 0x0A00020FL, "get32 round-trips all four");
    }

    /* An x86 struct-and-cast would have produced 0x06 0x08 here. That is the
     * bug this whole file exists to make impossible, so it gets its own row. */
    {
        uint8_t b[2];
        nf_put16(b, ETH_P_ARP);
        eq_int(b[0] == 0x08 && b[1] == 0x06, 1,
               "ethertype 0x0806 on the wire is 08 06, NOT 06 08");
    }

    /* ═══ 2. The Ethernet header. ═══ */
    {
        uint8_t f[64] = {0};
        int n = nf_eth_build(f, GW_MAC, OUR_MAC, ETH_P_IPV4);
        eq_int(n, 14, "an Ethernet header is 14 bytes");
        static const uint8_t want[14] = {
            0x52,0x55,0x0a,0x00,0x02,0x02,     /* destination first          */
            0x52,0x54,0x00,0x12,0x34,0x56,     /* then source                */
            0x08,0x00,                         /* then ethertype, big-endian */
        };
        bytes_are(f, want, 14, "destination comes FIRST, then source");
        eq_int(nf_eth_type(f), ETH_P_IPV4, "eth_type reads it back");
    }

    /* ═══ 3. An ARP request, byte for byte against RFC 826. ═══
     *
     * This is the frame Astrion actually puts on the wire to find the gateway.
     * Written from the RFC, not from the code. */
    {
        uint8_t f[64] = {0};
        int n = nf_arp_build(f, OUR_MAC, nf_ip(10,0,2,15), nf_ip(10,0,2,2));
        eq_int(n, 42, "14 bytes of Ethernet + 28 of ARP");

        static const uint8_t want[42] = {
            0xff,0xff,0xff,0xff,0xff,0xff,     /* to broadcast: we do not know */
            0x52,0x54,0x00,0x12,0x34,0x56,     /* from us                      */
            0x08,0x06,                         /* ethertype ARP                */
            0x00,0x01,                         /* htype  = Ethernet            */
            0x08,0x00,                         /* ptype  = IPv4                */
            0x06,                              /* hlen   = 6                   */
            0x04,                              /* plen   = 4                   */
            0x00,0x01,                         /* op     = REQUEST             */
            0x52,0x54,0x00,0x12,0x34,0x56,     /* sender hardware = us         */
            0x0a,0x00,0x02,0x0f,               /* sender protocol = 10.0.2.15  */
            0x00,0x00,0x00,0x00,0x00,0x00,     /* target hardware = the question */
            0x0a,0x00,0x02,0x02,               /* target protocol = 10.0.2.2   */
        };
        bytes_are(f, want, 42, "the ARP request, field by field");
    }

    /* ═══ 4. Reading a reply: accept the right one. ═══ */
    {
        uint8_t f[64], mac[6] = {0};
        make_reply(f);
        accepts(nf_arp_is_reply_for(f, 42, nf_ip(10,0,2,2), OUR_MAC, mac), 1,
                "a well-formed reply about the address we asked about");
        bytes_are(mac, GW_MAC, 6, "and it hands back the sender's MAC");
    }

    /* ═══ 5. ...and reject everything else. ═══
     *
     * Each row breaks exactly ONE field of the frame section 4 just accepted.
     * Any row that passes means the parser is not looking at that field. */
    {
        uint8_t f[64], mac[6];
        const uint32_t ASKED = nf_ip(10, 0, 2, 2);

        make_reply(f);
        accepts(nf_arp_is_reply_for(f, 41, ASKED, OUR_MAC, mac), 0,
                "REJECT: one byte short of a whole ARP frame");

        make_reply(f);
        nf_put16(f + 12, ETH_P_IPV4);
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: ethertype says IPv4, so the ARP body is not ARP");

        make_reply(f);
        nf_put16(f + ETH_HDR_LEN + 6, ARP_OP_REQUEST);
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: it is a REQUEST - somebody asking, not answering");

        /* THE ONE THAT MATTERS ON A REAL NETWORK. Every machine on a shared
         * segment broadcasts ARP, the card is promiscuous, and a parser that
         * skips this check resolves the gateway to whoever spoke last. */
        make_reply(f);
        nf_put32(f + ETH_HDR_LEN + 14, nf_ip(10, 0, 2, 99));
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: a real reply, about somebody ELSE's address");

        make_reply(f);
        f[ETH_HDR_LEN + 18] ^= 0xFF;
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: a real reply, addressed to somebody else");

        make_reply(f);
        for (int i = 0; i < 6; i++) f[ETH_HDR_LEN + 8 + i] = 0;
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: sender MAC is all zero - nothing can reach it");

        make_reply(f);
        for (int i = 0; i < 6; i++) f[ETH_HDR_LEN + 8 + i] = 0xFF;
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: sender MAC is broadcast - not a valid source");

        make_reply(f);
        f[ETH_HDR_LEN + 4] = 8;
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: hlen is not 6, so this is not Ethernet ARP");

        make_reply(f);
        nf_put16(f + ETH_HDR_LEN + 0, 6);
        accepts(nf_arp_is_reply_for(f, 42, ASKED, OUR_MAC, mac), 0,
                "REJECT: htype is not Ethernet");
    }

    /* ═══ 6. The MAC sanity guards, on their own. ═══
     *
     * A card that failed to load its EEPROM presents 00:00:00:00:00:00, and a
     * card that is not responding at all reads back as all-ones. Both are
     * addresses the driver must refuse to send FROM - otherwise it reports
     * success while the switch drops every frame. */
    {
        static const uint8_t zero[6] = {0};
        static const uint8_t ones[6] = { 0xFF,0xFF,0xFF,0xFF,0xFF,0xFF };
        eq_int(nf_mac_is_zero(zero), 1, "all-zero MAC is detected");
        eq_int(nf_mac_is_zero(OUR_MAC), 0, "a real MAC is not zero");
        eq_int(nf_mac_is_bcast(ones), 1, "all-ones MAC is detected");
        eq_int(nf_mac_is_bcast(OUR_MAC), 0, "a real MAC is not broadcast");
        eq_int(nf_mac_eq(OUR_MAC, OUR_MAC), 1, "a MAC equals itself");
        eq_int(nf_mac_eq(OUR_MAC, GW_MAC), 0, "two different MACs differ");
        /* Differing only in the LAST byte is the case a length-only or
         * first-byte comparison would miss. */
        uint8_t near[6]; memcpy(near, OUR_MAC, 6); near[5] ^= 1;
        eq_int(nf_mac_eq(OUR_MAC, near), 0, "differing in the last byte differs");
    }

    /* ═══ 7. Dotted quad. ═══ */
    {
        eq_int((long)nf_ip(10,0,2,2),      0x0A000202L, "10.0.2.2");
        eq_int((long)nf_ip(10,0,2,15),     0x0A00020FL, "10.0.2.15");
        eq_int((long)nf_ip(255,255,255,0), 0xFFFFFF00L, "a mask with the top bit set");
        eq_int((long)nf_ip(0,0,0,0),       0L,          "the unspecified address");
    }

    printf("\nfailures  %d\n", failures);
    printf("%s\n", failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
