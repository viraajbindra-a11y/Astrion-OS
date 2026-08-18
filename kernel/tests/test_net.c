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
#include "net_dhcp.h"
#include "net_dns.h"

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

    /* ═══ 8. The internet checksum (RFC 1071). ═══
     *
     * The vector is a PUBLISHED IPv4 header with a published checksum, not
     * something this code produced. Three rows below it are the three ways
     * this function goes wrong, and each one is written so that the naive
     * implementation gives a different answer. */
    {
        /* The worked example from the IPv4 header-checksum literature.
         * Checksum field zeroed; the answer is 0xb861. */
        static const uint8_t hdr[20] = {
            0x45,0x00, 0x00,0x73, 0x00,0x00, 0x40,0x00,
            0x40,0x11, 0x00,0x00,                       /* checksum: zeroed */
            0xc0,0xa8,0x00,0x01,                        /* 192.168.0.1      */
            0xc0,0xa8,0x00,0xc7,                        /* 192.168.0.199    */
        };
        eq_int(nf_checksum(hdr, 20), 0xb861, "the published IPv4 header vector");

        /* Same header with the right checksum in place must verify. */
        uint8_t ok[20]; memcpy(ok, hdr, 20);
        ok[10] = 0xb8; ok[11] = 0x61;
        eq_int(nf_checksum_ok(ok, 20), 1, "a correct checksum verifies");
        ok[19] ^= 0x01;
        eq_int(nf_checksum_ok(ok, 20), 0, "one flipped bit does not");

        /* THE CARRY. A 16-bit accumulator that drops the overflow gives
         * 0x0001 here instead of 0x0000 — right for most packets, wrong for
         * the ones that happen to overflow, which is the worst possible way
         * to be wrong because it passes testing and drops packets later. */
        static const uint8_t carry[4] = { 0xFF,0xFF, 0xFF,0xFF };
        eq_int(nf_checksum(carry, 4), 0x0000,
               "the carry wraps around (a 16-bit sum would say 0x0001)");

        /* THE ODD TAIL. The last byte is the HIGH half of the final word.
         * Treating it as the low half gives 0xed75 — invisible on every
         * even-length header, which is every IPv4 header without options. */
        static const uint8_t odd[3] = { 0x12, 0x34, 0x56 };
        eq_int(nf_checksum(odd, 3), 0x97cb,
               "an odd tail is the HIGH half (the low half would say 0xed75)");

        eq_int(nf_checksum(hdr, 0), 0xFFFF, "an empty range sums to nothing");
    }

    /* ═══ 9. IPv4 and UDP headers. ═══ */
    {
        uint8_t p[128] = {0};
        int n = nf_ipv4_build(p, nf_ip(10,0,2,15), nf_ip(10,0,2,2),
                              IP_PROTO_UDP, 100, 0x1234);
        eq_int(n, 20, "an IPv4 header with no options is 20 bytes");
        eq_int(p[0], 0x45, "version 4, header length 5 dwords");
        eq_int(nf_get16(p + 2), 120, "total length is header PLUS payload");
        eq_int(p[8], 64, "TTL");
        eq_int(p[9], IP_PROTO_UDP, "protocol");
        eq_int((long)nf_ip_src(p), (long)nf_ip(10,0,2,15), "source");
        eq_int((long)nf_ip_dst(p), (long)nf_ip(10,0,2,2), "destination");
        eq_int(nf_checksum_ok(p, 20), 1, "and it checksums itself correctly");
        eq_int(nf_ipv4_ok(p, 120), 1, "so the validator accepts it");

        /* THE READ-PAST-THE-END GUARD, and the row that caught this test being
         * written wrong. The header says 120 bytes; hand the validator only the
         * 20 that are really there and it must refuse. A parser that trusts
         * total_len without this reads 100 bytes past the frame it was given. */
        eq_int(nf_ipv4_ok(p, 20), 0,
               "REJECT: the header claims more bytes than actually arrived");

        /* Rejections. Each breaks one thing about an otherwise valid header. */
        uint8_t b[128];
        memcpy(b, p, 128); b[0] = 0x65;
        eq_int(nf_ipv4_ok(b, 120), 0, "REJECT: version 6 in an IPv4 slot");
        memcpy(b, p, 128); b[0] = 0x43;
        eq_int(nf_ipv4_ok(b, 120), 0, "REJECT: header shorter than 20 bytes");
        memcpy(b, p, 128); b[12] ^= 0xFF;
        eq_int(nf_ipv4_ok(b, 120), 0, "REJECT: a corrupted header fails checksum");
        eq_int(nf_ipv4_ok(p, 19), 0, "REJECT: fewer bytes than a header needs");

        uint8_t u[16] = {0};
        eq_int(nf_udp_build(u, 68, 67, 300), 8, "a UDP header is 8 bytes");
        eq_int(nf_udp_sport(u), 68, "source port");
        eq_int(nf_udp_dport(u), 67, "destination port");
        eq_int(nf_udp_len(u), 308, "length is header PLUS payload");
        eq_int(nf_get16(u + 6), 0, "checksum left 0 - legal over IPv4");
    }

    /* ═══ 10. DHCP DISCOVER, field by field against RFC 2131. ═══ */
    {
        uint8_t f[512];
        int n = nf_dhcp_build(f, OUR_MAC, 0xDEADBEEF, DHCP_DISCOVER, 0, 0);
        eq_int(n, 14 + 20 + 8 + 300, "eth + ip + udp + a 300-byte BOOTP body");

        static const uint8_t bcast[6] = { 0xff,0xff,0xff,0xff,0xff,0xff };
        bytes_are(f, bcast, 6, "goes to the Ethernet broadcast address");
        bytes_are(f + 6, OUR_MAC, 6, "from our card");
        eq_int(nf_eth_type(f), ETH_P_IPV4, "ethertype IPv4");

        const uint8_t *ip = f + 14;
        eq_int((long)nf_ip_src(ip), 0L, "source IP is 0.0.0.0 - we have none yet");
        eq_int((long)nf_ip_dst(ip), 0xFFFFFFFFL, "to the IP broadcast address");
        eq_int(nf_checksum_ok(ip, 20), 1, "the IP header checksums");

        const uint8_t *udp = ip + 20;
        eq_int(nf_udp_sport(udp), 68, "from the DHCP client port");
        eq_int(nf_udp_dport(udp), 67, "to the DHCP server port");

        const uint8_t *d = udp + 8;
        eq_int(d[0], 1, "op = BOOTREQUEST");
        eq_int(d[1], 1, "htype = Ethernet");
        eq_int(d[2], 6, "hlen = 6");
        eq_int((long)nf_get32(d + 4), 0xDEADBEEFL, "the transaction id we chose");
        eq_int(nf_get16(d + 10), 0x8000,
               "the BROADCAST flag - without it the reply is unicast to an "
               "address we do not have and cannot receive on");
        eq_int((long)nf_get32(d + 12), 0L,
               "ciaddr is 0: it means the address we ALREADY have, not the one we want");
        bytes_are(d + 28, OUR_MAC, 6, "chaddr is our MAC - how the server finds us");
        eq_int((long)nf_get32(d + 236), 0x63825363L, "the DHCP magic cookie");
        eq_int(d[240], 53, "first option is the message type");
        eq_int(d[241], 1,  "  ...one byte long");
        eq_int(d[242], DHCP_DISCOVER, "  ...and it is a DISCOVER");
    }

    /* ═══ 11. DHCP REQUEST carries the two options that make it answerable. ═══
     *
     * A REQUEST without option 50 and option 54 is met with silence: the
     * server cannot tell which of its offers is being accepted, and silence
     * from a DHCP server is indistinguishable from no DHCP server at all. */
    {
        uint8_t f[512];
        nf_dhcp_build(f, OUR_MAC, 0x11223344, DHCP_REQUEST,
                      nf_ip(10,0,2,15), nf_ip(10,0,2,2));
        const uint8_t *d = f + 14 + 20 + 8;
        eq_int(d[242], DHCP_REQUEST, "message type is REQUEST");
        eq_int(d[243], 50, "option 50: the address being accepted");
        eq_int(d[244], 4,  "  ...four bytes");
        eq_int((long)nf_get32(d + 245), (long)nf_ip(10,0,2,15), "  ...10.0.2.15");
        eq_int(d[249], 54, "option 54: which server offered it");
        eq_int((long)nf_get32(d + 251), (long)nf_ip(10,0,2,2), "  ...10.0.2.2");
        eq_int((long)nf_get32(d + 12), 0L,
               "ciaddr STILL 0 - the requested address goes in option 50, "
               "never in ciaddr, and putting it there gets no reply");
    }

    /* ═══ 12. Reading an OFFER, and refusing everybody else's. ═══ */
    {
        /* Build a reply the way a server would, so each rejection row can
         * break exactly one field of something known good. */
        uint8_t f[512];
        const uint32_t XID = 0xCAFEF00D;

        #define MAKE_OFFER()                                                   \
            do {                                                               \
                for (int i = 0; i < 512; i++) f[i] = 0;                        \
                nf_eth_build(f, OUR_MAC, GW_MAC, ETH_P_IPV4);                  \
                uint8_t *d_ = f + 14 + 20 + 8;                                 \
                d_[0] = 2; d_[1] = 1; d_[2] = 6;                               \
                nf_put32(d_ + 4, XID);                                         \
                nf_put32(d_ + 16, nf_ip(10,0,2,15));                           \
                nf_copy(d_ + 28, OUR_MAC, 6);                                  \
                nf_put32(d_ + 236, 0x63825363u);                               \
                d_[240] = 53; d_[241] = 1; d_[242] = DHCP_OFFER;               \
                d_[243] = 54; d_[244] = 4; nf_put32(d_ + 245, nf_ip(10,0,2,2));\
                d_[249] =  3; d_[250] = 4; nf_put32(d_ + 251, nf_ip(10,0,2,2));\
                d_[255] =  6; d_[256] = 4; nf_put32(d_ + 257, nf_ip(10,0,2,3));\
                d_[261] = 255;                                                 \
                nf_udp_build(f + 14 + 20, 67, 68, 300);                        \
                nf_ipv4_build(f + 14, nf_ip(10,0,2,2), 0xFFFFFFFFu,            \
                              IP_PROTO_UDP, 8 + 300, 0);                       \
            } while (0)

        struct nf_dhcp_reply r;
        const int FLEN = 14 + 20 + 8 + 300;

        MAKE_OFFER();
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 1, "a real OFFER");
        eq_int(r.type, DHCP_OFFER, "  ...is read as an OFFER");
        eq_int((long)r.your_ip,   (long)nf_ip(10,0,2,15), "  ...offering 10.0.2.15");
        eq_int((long)r.server_ip, (long)nf_ip(10,0,2,2),  "  ...from server 10.0.2.2");
        eq_int((long)r.router,    (long)nf_ip(10,0,2,2),  "  ...router 10.0.2.2");
        eq_int((long)r.dns,       (long)nf_ip(10,0,2,3),  "  ...dns 10.0.2.3");

        /* THE ONE THAT CAUSES ADDRESS COLLISIONS. Every DHCP message on the
         * segment is broadcast and the card is promiscuous, so another
         * machine's OFFER arrives here looking perfectly valid. Taking it
         * means taking an address promised to somebody else. */
        MAKE_OFFER();
        nf_put32(f + 14 + 20 + 8 + 4, XID ^ 0xFFFFFFFFu);
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: a valid OFFER from somebody else's conversation");

        MAKE_OFFER();
        f[14 + 20 + 8 + 28] ^= 0xFF;
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: our xid, but addressed to a different card");

        MAKE_OFFER();
        f[14 + 20 + 8] = 1;
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: op is BOOTREQUEST - that is a client talking, not a server");

        MAKE_OFFER();
        f[14 + 12] ^= 0xFF;
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: the IP header does not checksum");

        MAKE_OFFER();
        nf_put16(f + 14 + 20 + 2, 9999);
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: UDP to a port that is not the DHCP client port");

        MAKE_OFFER();
        nf_put32(f + 14 + 20 + 8 + 236, 0);
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: no DHCP magic cookie");

        MAKE_OFFER();
        f[14 + 20 + 8 + 240] = 3;   /* router option where the type should be */
        f[14 + 20 + 8 + 243] = 255;
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: no message-type option - not a DHCP message we can act on");

        /* An option length that runs off the end of the packet. This is how a
         * malformed reply reads kernel memory: there is no framing to stop the
         * walk except the loop's own arithmetic. */
        MAKE_OFFER();
        f[14 + 20 + 8 + 244] = 250;
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: an option whose length runs past the end of the packet");

        /* Truncated below the fixed part. */
        MAKE_OFFER();
        accepts(nf_dhcp_parse(f, 60, XID, OUR_MAC, &r), 0,
                "REJECT: too short to hold a DHCP message at all");

        /* A UDP length claiming more than arrived — same read-past-the-end
         * shape, one layer up. */
        MAKE_OFFER();
        nf_put16(f + 14 + 20 + 4, 60000);
        accepts(nf_dhcp_parse(f, FLEN, XID, OUR_MAC, &r), 0,
                "REJECT: UDP length longer than the bytes actually received");
        #undef MAKE_OFFER
    }

    /* ═══ 13. ICMP echo, and the routing decision in front of it. ═══ */
    {
        uint8_t ic[64];
        static const uint8_t pay[8] = { 'a','s','t','r','i','o','n','!' };
        int n = nf_icmp_echo_build(ic, 0xABCD, 7, pay, 8);
        eq_int(n, 16, "8 bytes of ICMP header plus 8 of payload");
        eq_int(ic[0], 8, "type 8 = echo request");
        eq_int(ic[1], 0, "code 0");
        eq_int(nf_get16(ic + 4), 0xABCD, "our id");
        eq_int(nf_get16(ic + 6), 7, "our sequence number");
        bytes_are(ic + 8, pay, 8, "the payload comes back verbatim");
        /* Unlike UDP's, this checksum is mandatory and covers the PAYLOAD too.
         * A host receiving a bad one drops it silently, which looks exactly
         * like the network being down. */
        eq_int(nf_checksum_ok(ic, 16), 1, "and it checksums over header + payload");

        /* Build a reply the way a host would: same id and seq, type 0. */
        uint8_t f[128];
        const uint32_t US = nf_ip(10,0,2,15), THEM = nf_ip(10,0,2,2);
        #define MAKE_PONG()                                                    \
            do {                                                               \
                for (int i = 0; i < 128; i++) f[i] = 0;                        \
                nf_eth_build(f, OUR_MAC, GW_MAC, ETH_P_IPV4);                  \
                uint8_t *i_ = f + 14 + 20;                                     \
                i_[0] = ICMP_ECHO_REPLY; i_[1] = 0;                            \
                nf_put16(i_ + 2, 0);                                           \
                nf_put16(i_ + 4, 0xABCD); nf_put16(i_ + 6, 7);                 \
                for (int k = 0; k < 8; k++) i_[8 + k] = pay[k];                \
                nf_put16(i_ + 2, nf_checksum(i_, 16));                         \
                nf_ipv4_build(f + 14, THEM, US, IP_PROTO_ICMP, 16, 0);         \
            } while (0)
        const int PLEN = 14 + 20 + 16;

        MAKE_PONG();
        accepts(nf_icmp_is_reply(f, PLEN, THEM, US, 0xABCD, 7), 1,
                "the echo reply to the request we sent");

        MAKE_PONG();
        nf_put16(f + 14 + 20 + 4, 0x1111);
        accepts(nf_icmp_is_reply(f, PLEN, THEM, US, 0xABCD, 7), 0,
                "REJECT: a valid ping reply with somebody else's id");

        MAKE_PONG();
        nf_put16(f + 14 + 20 + 6, 99);
        accepts(nf_icmp_is_reply(f, PLEN, THEM, US, 0xABCD, 7), 0,
                "REJECT: the right id but an older sequence number");

        MAKE_PONG();
        f[14 + 20] = ICMP_ECHO_REQUEST;
        accepts(nf_icmp_is_reply(f, PLEN, THEM, US, 0xABCD, 7), 0,
                "REJECT: type 8 - that is somebody pinging US");

        MAKE_PONG();
        accepts(nf_icmp_is_reply(f, PLEN, nf_ip(10,0,2,99), US, 0xABCD, 7), 0,
                "REJECT: a reply from a host we did not ping");

        MAKE_PONG();
        f[14 + 20 + 9] ^= 0xFF;      /* corrupt the payload, not the checksum */
        accepts(nf_icmp_is_reply(f, PLEN, THEM, US, 0xABCD, 7), 0,
                "REJECT: the ICMP checksum does not cover what arrived");
        #undef MAKE_PONG

        /* ── the routing decision ──
         * On-subnet goes straight to the host; off-subnet goes to the router
         * while KEEPING the destination IP. Backwards produces a packet
         * addressed to a machine that has never heard of the destination. */
        const uint32_t MASK = nf_ip(255,255,255,0), GW = nf_ip(10,0,2,2);
        eq_int((long)nf_next_hop(nf_ip(10,0,2,99), US, MASK, GW),
               (long)nf_ip(10,0,2,99), "same subnet: ARP the host itself");
        eq_int((long)nf_next_hop(nf_ip(8,8,8,8), US, MASK, GW),
               (long)GW, "different subnet: ARP the router");
        eq_int((long)nf_next_hop(nf_ip(8,8,8,8), US, MASK, 0),
               (long)nf_ip(8,8,8,8),
               "no router known: try the host directly rather than refuse");
        eq_int((long)nf_next_hop(nf_ip(10,0,2,99), US, 0, GW),
               (long)GW, "no mask known: everything looks off-subnet");
        /* A /16 must treat 10.0.99.1 as local where a /24 does not — proof
         * the mask is really applied and not assumed to be 255.255.255.0. */
        eq_int((long)nf_next_hop(nf_ip(10,0,99,1), US, nf_ip(255,255,0,0), GW),
               (long)nf_ip(10,0,99,1), "a /16 makes 10.0.99.1 local");
        eq_int((long)nf_next_hop(nf_ip(10,0,99,1), US, MASK, GW),
               (long)GW, "...and a /24 does not");
    }

    /* ═══ 14. DNS. The parser is the hard part; see net_dns.h. ═══ */
    {
        uint8_t p[512];

        /* Name encoding, from RFC 1035 §3.1 — length-prefixed labels. */
        int n = nf_dns_encode_name(p, "example.com");
        eq_int(n, 13, "\\7example\\3com\\0 is 13 bytes");
        static const uint8_t want[13] = {
            7,'e','x','a','m','p','l','e', 3,'c','o','m', 0
        };
        bytes_are(p, want, 13, "each label carries its own length in front");

        /* Four labels of one letter: (1 length + 1 char) * 4, plus the root
         * terminator. Nine, not twelve — the dots do NOT survive encoding,
         * they become the length bytes. */
        eq_int(nf_dns_encode_name(p, "a.b.c.d"), 9, "four one-letter labels");
        eq_int(nf_dns_encode_name(p, "example.com."), 13,
               "a trailing dot is the root and is legal");
        eq_int(nf_dns_encode_name(p, ""), 0, "REJECT: an empty name");
        eq_int(nf_dns_encode_name(p, "a..b"), 0, "REJECT: an empty label");
        eq_int(nf_dns_encode_name(p, ".example.com"), 0, "REJECT: a leading dot");
        {
            char big[80];
            for (int i = 0; i < 64; i++) big[i] = 'a';
            big[64] = 0;
            eq_int(nf_dns_encode_name(p, big), 0, "REJECT: a label over 63 bytes");
        }

        /* The query, header and all. */
        int qlen = nf_dns_query_build(p, 0x1234, "example.com");
        eq_int(qlen, 12 + 13 + 4, "header + name + qtype + qclass");
        eq_int(nf_get16(p + 0), 0x1234, "our id");
        eq_int(nf_get16(p + 2), 0x0100,
               "RD set - without it a resolver answers only from cache, which "
               "reads exactly like the name not existing");
        eq_int(nf_get16(p + 4), 1, "one question");
        eq_int(nf_get16(p + 6), 0, "no answers in a query");
        eq_int(nf_get16(p + 12 + 13), DNS_TYPE_A, "asking for an A record");
        eq_int(nf_get16(p + 12 + 15), DNS_CLASS_IN, "in class IN");
        eq_int(nf_dns_query_build(p, 1, "a..b"), 0, "a bad name builds nothing");

        /* ── a response, built the way a real server writes one ──
         * The answer's name is the two bytes C0 0C: a COMPRESSION POINTER back
         * to offset 12, which is the question. Essentially every real answer
         * looks like this, and a parser that reads 0xC0 as a label length of
         * 192 walks into the middle of the record and reports the name as
         * unresolvable from a perfectly good response. */
        uint8_t r[512];
        int rl;
        #define MAKE_ANSWER()                                                  \
            do {                                                               \
                for (int i = 0; i < 512; i++) r[i] = 0;                        \
                nf_put16(r + 0, 0x1234);                                       \
                nf_put16(r + 2, 0x8180);   /* response, RD, RA, RCODE 0 */     \
                nf_put16(r + 4, 1); nf_put16(r + 6, 1);                        \
                int o_ = 12 + nf_dns_encode_name(r + 12, "example.com");       \
                nf_put16(r + o_, DNS_TYPE_A);   o_ += 2;                       \
                nf_put16(r + o_, DNS_CLASS_IN); o_ += 2;                       \
                r[o_++] = 0xC0; r[o_++] = 0x0C;        /* <- the pointer */    \
                nf_put16(r + o_, DNS_TYPE_A);   o_ += 2;                       \
                nf_put16(r + o_, DNS_CLASS_IN); o_ += 2;                       \
                nf_put32(r + o_, 300);          o_ += 4;                       \
                nf_put16(r + o_, 4);            o_ += 2;                       \
                nf_put32(r + o_, nf_ip(93,184,216,34)); o_ += 4;               \
                rl = o_;                                                       \
            } while (0)

        uint32_t ip = 0;
        MAKE_ANSWER();
        accepts(nf_dns_parse_a(r, rl, 0x1234, &ip), 1,
                "an ordinary answer, with the name compressed as a pointer");
        eq_int((long)ip, (long)nf_ip(93,184,216,34), "  ...and the address in it");

        MAKE_ANSWER();
        accepts(nf_dns_parse_a(r, rl, 0x9999, &ip), 0,
                "REJECT: somebody else's query id");

        MAKE_ANSWER();
        nf_put16(r + 2, 0x0100);
        accepts(nf_dns_parse_a(r, rl, 0x1234, &ip), 0,
                "REJECT: QR says query - that is somebody ASKING, not answering");

        MAKE_ANSWER();
        nf_put16(r + 2, 0x8183);
        accepts(nf_dns_parse_a(r, rl, 0x1234, &ip), 0,
                "REJECT: RCODE 3 - the server says no such name");

        MAKE_ANSWER();
        nf_put16(r + 6, 0);
        accepts(nf_dns_parse_a(r, rl, 0x1234, &ip), 0,
                "REJECT: zero answers");

        MAKE_ANSWER();
        accepts(nf_dns_parse_a(r, rl - 3, 0x1234, &ip), 0,
                "REJECT: truncated inside the address itself");

        /* rdlength claiming more than arrived — the read-past-the-end shape,
         * one protocol up from where it was caught in DHCP. */
        MAKE_ANSWER();
        nf_put16(r + rl - 6, 4000);
        accepts(nf_dns_parse_a(r, rl, 0x1234, &ip), 0,
                "REJECT: rdlength runs past the end of the message");

        /* ── THE POINTER LOOP ──
         * \xC0\x0C at offset 12 is a name that points at itself. A parser that
         * FOLLOWS pointers without a bound never returns, and the packet that
         * does it can come from anyone who can reach the machine. This test
         * hanging IS the failure — there is no assertion that catches it, only
         * a suite that never finishes. */
        MAKE_ANSWER();
        r[12] = 0xC0; r[13] = 0x0C;
        accepts(nf_dns_parse_a(r, rl, 0x1234, &ip), 0,
                "REJECT: a name pointing at itself terminates instead of hanging");

        /* ── A CNAME IN FRONT OF THE ADDRESS ──
         * Ask for www.<anything> and the answer section holds the CNAME first
         * and the A record after it. A parser that reads only the first answer
         * hands back the bytes of a NAME where an address should be. */
        {
            for (int i = 0; i < 512; i++) r[i] = 0;
            nf_put16(r + 0, 0x1234);
            nf_put16(r + 2, 0x8180);
            nf_put16(r + 4, 1);
            nf_put16(r + 6, 2);                       /* TWO answers */
            int o = 12 + nf_dns_encode_name(r + 12, "www.example.com");
            nf_put16(r + o, DNS_TYPE_A);   o += 2;
            nf_put16(r + o, DNS_CLASS_IN); o += 2;
            /* answer 1: CNAME */
            r[o++] = 0xC0; r[o++] = 0x0C;
            nf_put16(r + o, DNS_TYPE_CNAME); o += 2;
            nf_put16(r + o, DNS_CLASS_IN);   o += 2;
            nf_put32(r + o, 300);            o += 4;
            int cn = nf_dns_encode_name(r + o + 2, "example.com");
            nf_put16(r + o, (uint16_t)cn);   o += 2;
            o += cn;
            /* answer 2: the address */
            r[o++] = 0xC0; r[o++] = 0x0C;
            nf_put16(r + o, DNS_TYPE_A);   o += 2;
            nf_put16(r + o, DNS_CLASS_IN); o += 2;
            nf_put32(r + o, 300);          o += 4;
            nf_put16(r + o, 4);            o += 2;
            nf_put32(r + o, nf_ip(1,2,3,4)); o += 4;

            ip = 0;
            accepts(nf_dns_parse_a(r, o, 0x1234, &ip), 1,
                    "a CNAME in front of the address is walked past");
            eq_int((long)ip, (long)nf_ip(1,2,3,4),
                   "  ...and the ADDRESS comes back, not the CNAME's bytes");
        }
        #undef MAKE_ANSWER
    }

    printf("\nfailures  %d\n", failures);
    printf("%s\n", failures ? "FAIL" : "PASS");
    return failures ? 1 : 0;
}
