/*
 * Astrion v2.0 — DHCP (RFC 2131), as pure byte arithmetic.
 *
 * How a machine that knows nothing about a network gets an address on it.
 * Everything before this point could only talk to whoever answered a
 * broadcast; with an address, Astrion is a host.
 *
 * The exchange is four messages and the names are worth keeping straight
 * because the two we send look almost identical and mean opposite things:
 *
 *   DISCOVER  broadcast: "is there a DHCP server?"
 *   OFFER     a server replies: "you may have 10.0.2.15, I am 10.0.2.2"
 *   REQUEST   broadcast AGAIN: "I accept 10.0.2.15, from server 10.0.2.2"
 *   ACK       "confirmed"
 *
 * REQUEST is broadcast rather than sent to the server that offered, and that
 * is not a simplification — it is required. On a network with two DHCP
 * servers, both made an offer, and the broadcast is how the one that lost
 * learns to release the address it was holding. Unicasting it leaves an
 * address reserved forever on every server that did not win.
 *
 * The whole file is pure: buffers in, lengths out, no device and no kernel.
 * kernel/tests/test_net.c gates it byte for byte, because a DHCP packet has
 * four separate places to put an IP address (ciaddr, yiaddr, siaddr, giaddr)
 * and putting one in the wrong field produces a packet a server answers with
 * silence.
 */

#ifndef ASTRION_NET_DHCP_H
#define ASTRION_NET_DHCP_H

#include <stdint.h>
#include "net_frame.h"

#define DHCP_SPORT      68
#define DHCP_DPORT      67
#define DHCP_MAGIC      0x63825363u

#define DHCP_OP_REQUEST 1
#define DHCP_OP_REPLY   2

#define DHCP_DISCOVER   1
#define DHCP_OFFER      2
#define DHCP_REQUEST    3
#define DHCP_ACK        5
#define DHCP_NAK        6

#define DHCP_OPT_SUBNET     1
#define DHCP_OPT_ROUTER     3
#define DHCP_OPT_DNS        6
#define DHCP_OPT_REQIP     50
#define DHCP_OPT_MSGTYPE   53
#define DHCP_OPT_SERVERID  54
#define DHCP_OPT_PARAMLIST 55
#define DHCP_OPT_END      255

/* The fixed part is 236 bytes, then a 4-byte magic cookie, then options.
 * BOOTP's minimum body is 300 bytes and a number of servers still enforce it,
 * so every message built here is padded out to that whether it needs to be or
 * not — a shorter packet that works against one server and is dropped by the
 * next is not worth the bytes saved. */
#define DHCP_FIXED   236
#define DHCP_MIN_LEN 300

/* Build a complete Ethernet+IP+UDP+DHCP frame.
 *
 * `type` is DHCP_DISCOVER or DHCP_REQUEST. For a REQUEST, `req_ip` is the
 * address being accepted and `server_ip` is the server that offered it; both
 * are ignored for a DISCOVER, and both are REQUIRED for a REQUEST — a REQUEST
 * without option 50 and option 54 is answered by silence, because the server
 * cannot tell which of its offers is being accepted.
 *
 * Returns the total frame length. Everything goes to the broadcast address at
 * both the Ethernet and IP layers: we have no address yet, so there is no
 * source to reply to except the one the server reads out of chaddr.
 */
static inline int nf_dhcp_build(uint8_t *buf, const uint8_t *mac, uint32_t xid,
                                uint8_t type, uint32_t req_ip, uint32_t server_ip)
{
    static const uint8_t bcast[ETH_ALEN] = { 0xFF,0xFF,0xFF,0xFF,0xFF,0xFF };

    for (int i = 0; i < ETH_HDR_LEN + IP_HDR_LEN + UDP_HDR_LEN + DHCP_MIN_LEN; i++)
        buf[i] = 0;

    nf_eth_build(buf, bcast, mac, ETH_P_IPV4);
    uint8_t *ip  = buf + ETH_HDR_LEN;
    uint8_t *udp = ip + IP_HDR_LEN;
    uint8_t *d   = udp + UDP_HDR_LEN;

    d[0] = DHCP_OP_REQUEST;
    d[1] = ARP_HTYPE_ETH;
    d[2] = ETH_ALEN;
    d[3] = 0;                                    /* hops */
    nf_put32(d + 4, xid);
    nf_put16(d + 8, 0);                          /* secs */
    /* BROADCAST FLAG. Without it a server may unicast its reply to an address
     * we do not have yet and cannot receive on, and the exchange dies after
     * the DISCOVER with no error anywhere. */
    nf_put16(d + 10, 0x8000);
    /* ciaddr stays 0: it means "the address I am ALREADY using", and we are
     * not using one. The address we WANT goes in option 50, never here. */
    nf_copy(d + 28, mac, ETH_ALEN);              /* chaddr */
    nf_put32(d + DHCP_FIXED, DHCP_MAGIC);

    uint8_t *o = d + DHCP_FIXED + 4;
    *o++ = DHCP_OPT_MSGTYPE; *o++ = 1; *o++ = type;
    if (type == DHCP_REQUEST) {
        *o++ = DHCP_OPT_REQIP;    *o++ = 4; nf_put32(o, req_ip);    o += 4;
        *o++ = DHCP_OPT_SERVERID; *o++ = 4; nf_put32(o, server_ip); o += 4;
    }
    *o++ = DHCP_OPT_PARAMLIST; *o++ = 3;
    *o++ = DHCP_OPT_SUBNET; *o++ = DHCP_OPT_ROUTER; *o++ = DHCP_OPT_DNS;
    *o++ = DHCP_OPT_END;
    /* Anything between here and DHCP_MIN_LEN is already zero from the wipe
     * above, which is the correct pad value. */

    int udp_payload = DHCP_MIN_LEN;
    nf_udp_build(udp, DHCP_SPORT, DHCP_DPORT, (uint16_t)udp_payload);
    nf_ipv4_build(ip, 0, 0xFFFFFFFFu, IP_PROTO_UDP,
                  (uint16_t)(UDP_HDR_LEN + udp_payload), (uint16_t)xid);

    return ETH_HDR_LEN + IP_HDR_LEN + UDP_HDR_LEN + DHCP_MIN_LEN;
}

/* What a DHCP reply told us. Only filled when nf_dhcp_parse returns 1. */
struct nf_dhcp_reply {
    uint8_t  type;          /* DHCP_OFFER / DHCP_ACK / DHCP_NAK  */
    uint32_t your_ip;       /* yiaddr — the address being offered */
    uint32_t server_ip;     /* option 54                          */
    uint32_t router;        /* option 3, or 0                     */
    uint32_t dns;           /* option 6, or 0                     */
    uint32_t subnet;        /* option 1, or 0                     */
};

/* Read a received Ethernet frame as a DHCP reply addressed to us.
 *
 * Returns 1 only when every layer checks out: it is IPv4 with a valid header
 * checksum, it is UDP to port 68, it is a BOOTREPLY, the transaction id is the
 * one WE chose, and the hardware address in it is ours.
 *
 * The xid check is the one that cannot be skipped. Every DHCP message on the
 * segment is broadcast and the card is promiscuous, so another machine's OFFER
 * arrives here looking perfectly valid — and accepting it means taking an
 * address that was promised to somebody else, which is an address collision
 * that shows up as two machines intermittently losing traffic and is close to
 * impossible to trace back here.
 */
static inline int nf_dhcp_parse(const uint8_t *frame, int len, uint32_t xid,
                                const uint8_t *our_mac,
                                struct nf_dhcp_reply *out)
{
    if (len < ETH_HDR_LEN + IP_HDR_LEN + UDP_HDR_LEN + DHCP_FIXED + 4) return 0;
    if (nf_eth_type(frame) != ETH_P_IPV4) return 0;

    const uint8_t *ip = frame + ETH_HDR_LEN;
    int avail = len - ETH_HDR_LEN;
    if (!nf_ipv4_ok(ip, avail))            return 0;
    if (nf_ip_proto(ip) != IP_PROTO_UDP)   return 0;

    int hl = nf_ip_hdr_len(ip);
    const uint8_t *udp = ip + hl;
    if (avail - hl < UDP_HDR_LEN)          return 0;
    if (nf_udp_dport(udp) != DHCP_SPORT)   return 0;

    /* The UDP length field is attacker/server-controlled and everything below
     * indexes off it, so it has to be inside the bytes we actually received
     * before it is trusted. */
    int ulen = nf_udp_len(udp);
    if (ulen < UDP_HDR_LEN || ulen > avail - hl) return 0;

    const uint8_t *d = udp + UDP_HDR_LEN;
    int dlen = ulen - UDP_HDR_LEN;
    if (dlen < DHCP_FIXED + 4)             return 0;

    if (d[0] != DHCP_OP_REPLY)             return 0;
    if (nf_get32(d + 4) != xid)            return 0;      /* OUR conversation */
    if (!nf_mac_eq(d + 28, our_mac))       return 0;      /* ...and our card  */
    if (nf_get32(d + DHCP_FIXED) != DHCP_MAGIC) return 0;

    out->type = 0;
    out->your_ip = nf_get32(d + 16);
    out->server_ip = out->router = out->dns = out->subnet = 0;

    /* Walk the TLV options. Every step is bounded by dlen: a length byte that
     * runs off the end of the packet is exactly how a malformed or hostile
     * reply reads kernel memory, and there is no framing here to catch it
     * other than this loop's own arithmetic. */
    int i = DHCP_FIXED + 4;
    while (i < dlen) {
        uint8_t code = d[i];
        if (code == DHCP_OPT_END) break;
        if (code == 0) { i++; continue; }              /* pad */
        if (i + 1 >= dlen) return 0;
        int olen = d[i + 1];
        if (i + 2 + olen > dlen) return 0;
        const uint8_t *v = d + i + 2;
        switch (code) {
        case DHCP_OPT_MSGTYPE:  if (olen >= 1) out->type      = v[0];          break;
        case DHCP_OPT_SERVERID: if (olen >= 4) out->server_ip = nf_get32(v);   break;
        case DHCP_OPT_ROUTER:   if (olen >= 4) out->router    = nf_get32(v);   break;
        case DHCP_OPT_DNS:      if (olen >= 4) out->dns       = nf_get32(v);   break;
        case DHCP_OPT_SUBNET:   if (olen >= 4) out->subnet    = nf_get32(v);   break;
        default: break;
        }
        i += 2 + olen;
    }

    /* No message type means it is not a DHCP message we can act on. Returning
     * 1 here would hand the caller a reply of type 0 and let it treat a
     * malformed packet as an OFFER. */
    return out->type != 0;
}

#endif /* ASTRION_NET_DHCP_H */
