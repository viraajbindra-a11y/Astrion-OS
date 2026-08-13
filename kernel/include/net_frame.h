/*
 * Astrion v2.0 — Ethernet and ARP frames, as pure byte arithmetic.
 *
 * Everything here builds or reads bytes in a caller's buffer. No MMIO, no
 * kernel headers, no allocation, no device. That is the entire point: this is
 * the half of networking that can be TESTED, and it is where the bugs are.
 *
 * A wrong offset or a byte-order slip produces a frame that looks completely
 * reasonable in a debugger and is silently dropped by every machine on the
 * wire — the failure arrives as "nothing happens", from a card that is working
 * perfectly and a driver that is doing exactly what it was told. Debugging
 * that through a NIC is miserable. Debugging it against a table of known-good
 * byte sequences on the host takes milliseconds, so the table lives in
 * kernel/tests/test_net.c and this header is what it includes.
 *
 * Same shape, and for the same reason, as include/assist_match.h.
 *
 * NETWORK BYTE ORDER IS BIG-ENDIAN AND x86 IS NOT. Every multi-byte field
 * below is written a byte at a time, most significant first. That is not
 * pedantry — a struct with a uint16_t in it and a cast is the single most
 * common way this goes wrong, and it goes wrong invisibly on one architecture
 * and correctly on another.
 */

#ifndef ASTRION_NET_FRAME_H
#define ASTRION_NET_FRAME_H

#include <stdint.h>

#define ETH_ALEN        6
#define ETH_HDR_LEN     14
#define ETH_MIN_FRAME   60      /* without FCS; the card pads, but see below */

#define ETH_P_IPV4      0x0800
#define ETH_P_ARP       0x0806

#define ARP_HDR_LEN     28
#define ARP_HTYPE_ETH   1
#define ARP_OP_REQUEST  1
#define ARP_OP_REPLY    2

/* ─── big-endian put/get ─── */

static inline void nf_put16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v >> 8);
    p[1] = (uint8_t)(v & 0xFF);
}

static inline void nf_put32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v >> 24);
    p[1] = (uint8_t)(v >> 16);
    p[2] = (uint8_t)(v >> 8);
    p[3] = (uint8_t)(v & 0xFF);
}

static inline uint16_t nf_get16(const uint8_t *p)
{
    return (uint16_t)(((uint16_t)p[0] << 8) | p[1]);
}

static inline uint32_t nf_get32(const uint8_t *p)
{
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
           ((uint32_t)p[2] << 8)  |  (uint32_t)p[3];
}

static inline void nf_copy(uint8_t *dst, const uint8_t *src, int n)
{
    for (int i = 0; i < n; i++) dst[i] = src[i];
}

static inline int nf_mac_eq(const uint8_t *a, const uint8_t *b)
{
    for (int i = 0; i < ETH_ALEN; i++) if (a[i] != b[i]) return 0;
    return 1;
}

/* An all-zero MAC is what an uninitialised buffer looks like, and it is not a
 * valid source address. Checked before the driver is allowed to believe a MAC
 * it read out of a register — a card that failed to load its EEPROM presents
 * 00:00:00:00:00:00, and sending from it produces frames the switch drops
 * while the driver reports success. */
static inline int nf_mac_is_zero(const uint8_t *m)
{
    for (int i = 0; i < ETH_ALEN; i++) if (m[i]) return 0;
    return 1;
}

/* ...and all-ones is the broadcast address, which is equally not a valid
 * SOURCE. A card whose registers read back 0xFF (the answer you get from a
 * device that is not responding at all) yields exactly this. */
static inline int nf_mac_is_bcast(const uint8_t *m)
{
    for (int i = 0; i < ETH_ALEN; i++) if (m[i] != 0xFF) return 0;
    return 1;
}

/* ─── Ethernet ───
 * dst[6] src[6] ethertype[2], then the payload. Returns the header length so
 * a caller can write the payload straight after it. */
static inline int nf_eth_build(uint8_t *buf, const uint8_t *dst,
                               const uint8_t *src, uint16_t ethertype)
{
    nf_copy(buf + 0, dst, ETH_ALEN);
    nf_copy(buf + 6, src, ETH_ALEN);
    nf_put16(buf + 12, ethertype);
    return ETH_HDR_LEN;
}

static inline uint16_t nf_eth_type(const uint8_t *frame) { return nf_get16(frame + 12); }
static inline const uint8_t *nf_eth_dst(const uint8_t *frame) { return frame; }
static inline const uint8_t *nf_eth_src(const uint8_t *frame) { return frame + 6; }

/* ─── ARP ───
 *
 * htype[2] ptype[2] hlen[1] plen[1] op[2] sha[6] spa[4] tha[6] tpa[4]
 *
 * Builds the whole frame, Ethernet header included, and returns its total
 * length. A request goes to the broadcast address because the entire point is
 * that we do not know the destination's MAC yet — that is what we are asking.
 *
 * The target hardware address is left ZERO in a request. Some stacks fill it
 * with broadcast instead; both are seen in the wild and both are accepted, but
 * zero is what RFC 826 describes and what every capture of a Linux host shows,
 * so zero is what a packet capture of Astrion should show too.
 */
static inline int nf_arp_build(uint8_t *buf, const uint8_t *src_mac,
                               uint32_t src_ip, uint32_t target_ip)
{
    static const uint8_t bcast[ETH_ALEN] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
    int n = nf_eth_build(buf, bcast, src_mac, ETH_P_ARP);
    uint8_t *a = buf + n;
    nf_put16(a + 0, ARP_HTYPE_ETH);
    nf_put16(a + 2, ETH_P_IPV4);
    a[4] = ETH_ALEN;
    a[5] = 4;
    nf_put16(a + 6, ARP_OP_REQUEST);
    nf_copy(a + 8, src_mac, ETH_ALEN);
    nf_put32(a + 14, src_ip);
    for (int i = 0; i < ETH_ALEN; i++) a[18 + i] = 0;      /* unknown: that is the question */
    nf_put32(a + 24, target_ip);
    return n + ARP_HDR_LEN;
}

/* Is this frame an ARP REPLY telling us the MAC of `want_ip`, addressed to us?
 * Returns 1 and fills mac_out, or 0.
 *
 * Every field is checked, not just the opcode. An ARP reply for a DIFFERENT
 * address is a completely normal thing to see on a shared network — the card
 * is in promiscuous mode and the wire is full of other people's conversations —
 * and accepting one would resolve the gateway to some unrelated machine's MAC
 * and then quietly send every packet to the wrong host.
 */
static inline int nf_arp_is_reply_for(const uint8_t *frame, int len,
                                      uint32_t want_ip, const uint8_t *our_mac,
                                      uint8_t *mac_out)
{
    if (len < ETH_HDR_LEN + ARP_HDR_LEN) return 0;
    if (nf_eth_type(frame) != ETH_P_ARP) return 0;

    const uint8_t *a = frame + ETH_HDR_LEN;
    if (nf_get16(a + 0) != ARP_HTYPE_ETH) return 0;
    if (nf_get16(a + 2) != ETH_P_IPV4)    return 0;
    if (a[4] != ETH_ALEN || a[5] != 4)    return 0;
    if (nf_get16(a + 6) != ARP_OP_REPLY)  return 0;
    if (nf_get32(a + 14) != want_ip)      return 0;   /* answering about the right IP */
    if (!nf_mac_eq(a + 18, our_mac))      return 0;   /* ...and answering US */

    /* A reply whose sender hardware address is zero or broadcast is malformed;
     * believing it would poison the cache with an address nothing can reach. */
    if (nf_mac_is_zero(a + 8) || nf_mac_is_bcast(a + 8)) return 0;

    nf_copy(mac_out, a + 8, ETH_ALEN);
    return 1;
}

/* Dotted quad -> host-order uint32. 10.0.2.2 becomes 0x0A000202, which is also
 * the order it goes on the wire once nf_put32 writes it big-endian. */
static inline uint32_t nf_ip(uint8_t a, uint8_t b, uint8_t c, uint8_t d)
{
    return ((uint32_t)a << 24) | ((uint32_t)b << 16) |
           ((uint32_t)c << 8)  |  (uint32_t)d;
}

/* ─── the internet checksum (RFC 1071) ───
 *
 * One's-complement sum of 16-bit big-endian words, complemented. Three things
 * about it are load-bearing and all three are easy to get wrong:
 *
 *   The CARRY WRAPS AROUND. A plain 16-bit sum that drops the carry produces a
 *   checksum that is right for most packets and wrong for the ones where the
 *   sum happens to overflow — which is the worst possible failure distribution,
 *   because it works in testing and drops one packet in a few hundred later.
 *   Accumulating in 32 bits and folding is what makes that impossible.
 *
 *   An ODD length needs the last byte treated as the HIGH half of a word, not
 *   the low half. Getting that backwards is invisible on even-length headers,
 *   which is every IPv4 header without options — so it survives every test
 *   anyone bothers to write and then corrupts the first odd-length payload.
 *
 *   The FIELD ITSELF must be zero while computing. Every caller here zeroes it
 *   first, and the check function relies on the opposite property: summing a
 *   header WITH a correct checksum in place gives 0xFFFF, which folds to 0.
 */
static inline uint16_t nf_checksum(const uint8_t *p, int len)
{
    uint32_t sum = 0;
    int i = 0;
    for (; i + 1 < len; i += 2)
        sum += ((uint32_t)p[i] << 8) | p[i + 1];
    if (i < len)
        sum += (uint32_t)p[i] << 8;          /* odd tail: HIGH half */
    while (sum >> 16)
        sum = (sum & 0xFFFFu) + (sum >> 16); /* fold the carry back in */
    return (uint16_t)(~sum & 0xFFFFu);
}

/* Does this header already carry a correct checksum? */
static inline int nf_checksum_ok(const uint8_t *p, int len)
{
    uint32_t sum = 0;
    int i = 0;
    for (; i + 1 < len; i += 2)
        sum += ((uint32_t)p[i] << 8) | p[i + 1];
    if (i < len)
        sum += (uint32_t)p[i] << 8;
    while (sum >> 16)
        sum = (sum & 0xFFFFu) + (sum >> 16);
    return sum == 0xFFFFu;
}

/* ─── IPv4 ───
 * Twenty bytes, no options. Writes the header and returns its length; the
 * caller has already placed `payload_len` bytes after it.
 *
 * The checksum covers the HEADER ONLY — not the payload — which is why it can
 * be computed here, before the caller has finished anything else. */
#define IP_HDR_LEN      20
#define IP_PROTO_ICMP   1
#define IP_PROTO_UDP    17
#define IP_PROTO_TCP    6

static inline int nf_ipv4_build(uint8_t *p, uint32_t src, uint32_t dst,
                                uint8_t proto, uint16_t payload_len,
                                uint16_t ident)
{
    p[0] = 0x45;                                   /* IPv4, 5 dwords of header */
    p[1] = 0;                                      /* no DSCP, no ECN          */
    nf_put16(p + 2, (uint16_t)(IP_HDR_LEN + payload_len));
    nf_put16(p + 4, ident);
    nf_put16(p + 6, 0);                            /* no fragmenting here      */
    p[8] = 64;                                     /* TTL                      */
    p[9] = proto;
    nf_put16(p + 10, 0);                           /* zero WHILE computing     */
    nf_put32(p + 12, src);
    nf_put32(p + 16, dst);
    nf_put16(p + 10, nf_checksum(p, IP_HDR_LEN));
    return IP_HDR_LEN;
}

static inline int      nf_ip_hdr_len(const uint8_t *ip) { return (ip[0] & 0x0F) * 4; }
static inline uint8_t  nf_ip_proto(const uint8_t *ip)   { return ip[9]; }
static inline uint32_t nf_ip_src(const uint8_t *ip)     { return nf_get32(ip + 12); }
static inline uint32_t nf_ip_dst(const uint8_t *ip)     { return nf_get32(ip + 16); }
static inline uint16_t nf_ip_total_len(const uint8_t *ip) { return nf_get16(ip + 2); }

/* Is this a well-formed IPv4 header we are willing to look inside?
 * Version, header length, the header's own checksum, and that the header
 * actually fits in the bytes we were handed. Everything downstream indexes
 * off this header, so a caller that skips it reads past the frame. */
static inline int nf_ipv4_ok(const uint8_t *ip, int avail)
{
    if (avail < IP_HDR_LEN)            return 0;
    if ((ip[0] >> 4) != 4)             return 0;
    int hl = nf_ip_hdr_len(ip);
    if (hl < IP_HDR_LEN || hl > avail) return 0;
    if (nf_ip_total_len(ip) > avail)   return 0;
    return nf_checksum_ok(ip, hl);
}

/* ─── UDP ───
 * Eight bytes. The checksum is left ZERO, which over IPv4 is legal and means
 * "not computed" — RFC 768 makes it optional, and every DHCP server accepts
 * it. It is NOT optional over IPv6, so this is a place that will need real
 * work the day Astrion speaks IPv6; saying so here beats discovering it. */
#define UDP_HDR_LEN 8

static inline int nf_udp_build(uint8_t *p, uint16_t sport, uint16_t dport,
                               uint16_t payload_len)
{
    nf_put16(p + 0, sport);
    nf_put16(p + 2, dport);
    nf_put16(p + 4, (uint16_t)(UDP_HDR_LEN + payload_len));
    nf_put16(p + 6, 0);
    return UDP_HDR_LEN;
}

static inline uint16_t nf_udp_sport(const uint8_t *u) { return nf_get16(u + 0); }
static inline uint16_t nf_udp_dport(const uint8_t *u) { return nf_get16(u + 2); }
static inline uint16_t nf_udp_len(const uint8_t *u)   { return nf_get16(u + 4); }

#endif /* ASTRION_NET_FRAME_H */
