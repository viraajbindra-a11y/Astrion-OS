/*
 * Astrion v2.0 — DNS (RFC 1035), as pure byte arithmetic.
 *
 * The last thing between Astrion and a browser that can be pointed at a name
 * instead of a number. Everything under it already works: UDP carried DHCP, so
 * a DNS query is the same envelope with a different letter inside.
 *
 * THE HARD PART IS THE PARSER, AND IT IS HARDER THAN IT LOOKS.
 *
 * A DNS name is a chain of length-prefixed labels — "example.com" is
 * \7example\3com\0 — and a response is allowed to COMPRESS any name by
 * replacing its tail with a two-byte pointer back into the same message. Real
 * servers do this on essentially every answer: the answer's name is almost
 * always the two bytes 0xC0 0x0C, meaning "the name at offset 12", which is
 * the question we just sent.
 *
 * Three consequences, and all three are places this goes wrong:
 *
 *   1. A parser that treats the answer's name as literal labels reads 0xC0 as
 *      a length of 192 and walks 192 bytes into the middle of the record. It
 *      then finds garbage where the type should be, concludes there is no A
 *      record, and reports the name as unresolvable — from a perfectly good
 *      response.
 *
 *   2. A pointer can point ANYWHERE, including at itself. \xC0\x0C at offset
 *      12 is a name that expands forever. A parser that follows pointers
 *      without a bound hangs the kernel on one malformed packet, and that
 *      packet can come from anyone who can reach us. The bound below is not
 *      defensive decoration; it is the difference between a parser and a
 *      remote denial of service.
 *
 *   3. The answer may not be an address at all. A name with a CNAME gets an
 *      answer section holding the CNAME first and the A record after it, so a
 *      parser that reads only the FIRST answer returns the bytes of a name
 *      where an address should be. Walking to the first record that is
 *      actually TYPE=A is what makes www.<anything> work.
 *
 * All of it is pure — buffers in, values out — so kernel/tests/test_net.c
 * gates every one of those three on this laptop, including the pointer loop,
 * which is not something anybody wants to discover by booting it.
 */

#ifndef ASTRION_NET_DNS_H
#define ASTRION_NET_DNS_H

#include <stdint.h>
#include "net_frame.h"

#define DNS_PORT        53
#define DNS_HDR_LEN     12
#define DNS_TYPE_A      1
#define DNS_TYPE_CNAME  5
#define DNS_CLASS_IN    1

/* RFC 1035 limits: 63 bytes per label, 255 for the whole encoded name. Both
 * are enforced when building, because a name that violates them is a name no
 * server will answer and it is better to say so than to send it. */
#define DNS_MAX_LABEL   63
#define DNS_MAX_NAME    255

/* Encode "example.com" as \7example\3com\0 at p. Returns the encoded length,
 * or 0 if the name is malformed — empty, too long, a label too long, or an
 * empty label (which is what a doubled dot or a trailing dot produces). */
static inline int nf_dns_encode_name(uint8_t *p, const char *name)
{
    int out = 0;
    const char *s = name;
    if (!s || !*s) return 0;

    while (*s) {
        /* Measure this label up to the next dot. */
        int n = 0;
        while (s[n] && s[n] != '.') n++;
        if (n == 0 || n > DNS_MAX_LABEL) return 0;
        if (out + 1 + n + 1 > DNS_MAX_NAME) return 0;
        p[out++] = (uint8_t)n;
        for (int i = 0; i < n; i++) p[out++] = (uint8_t)s[i];
        s += n;
        if (*s == '.') {
            s++;
            /* A trailing dot is the root and is legal in a fully-qualified
             * name; a dot with nothing after it inside the name is not. */
            if (!*s) break;
        }
    }
    p[out++] = 0;
    return out;
}

/* Build the DNS message body — NOT the Ethernet/IP/UDP around it, which the
 * caller wraps. Returns the body length, or 0 if the name is unusable.
 *
 * RD (recursion desired) is set. Without it a resolver answers only from what
 * it already holds and returns an empty answer section for everything else,
 * which reads exactly like "that name does not exist". */
static inline int nf_dns_query_build(uint8_t *p, uint16_t id, const char *name)
{
    nf_put16(p + 0, id);
    nf_put16(p + 2, 0x0100);        /* standard query, recursion desired */
    nf_put16(p + 4, 1);             /* one question                      */
    nf_put16(p + 6, 0);
    nf_put16(p + 8, 0);
    nf_put16(p + 10, 0);

    int n = nf_dns_encode_name(p + DNS_HDR_LEN, name);
    if (!n) return 0;
    int off = DNS_HDR_LEN + n;
    nf_put16(p + off, DNS_TYPE_A);   off += 2;
    nf_put16(p + off, DNS_CLASS_IN); off += 2;
    return off;
}

/* Step over a name at `off`, returning the offset of whatever follows it, or
 * -1 if the name runs off the end or the pointer chain is bad.
 *
 * A COMPRESSION POINTER ENDS THE NAME. Once the two pointer bytes are read,
 * the thing after the name is two bytes past where the pointer started — the
 * pointer is not followed here, because this function's job is to say where
 * the RECORD continues, not what the name spells.
 *
 * The 0xC0 test is on the top TWO bits: 0b11 means pointer, 0b00 means a
 * literal label length, and 0b01/0b10 are reserved and treated as malformed.
 * Checking only for 0xC0 exactly would let 0xC1.. through as a length of 193.
 */
static inline int nf_dns_skip_name(const uint8_t *msg, int len, int off)
{
    int guard = 0;
    while (off >= 0 && off < len) {
        uint8_t b = msg[off];
        if ((b & 0xC0) == 0xC0) {
            if (off + 1 >= len) return -1;
            return off + 2;                  /* a pointer terminates the name */
        }
        if (b & 0xC0) return -1;             /* reserved label type           */
        if (b == 0) return off + 1;          /* the root label ends it        */
        off += 1 + b;
        /* A name is at most 255 bytes, so 128 labels is already impossible.
         * The bound is here so a crafted length chain cannot spin. */
        if (++guard > 128) return -1;
    }
    return -1;
}

/* Read the first A record out of a response.
 *
 * Returns 1 and sets *ip_out, or 0. Checked before believing anything: the id
 * is ours, it is a response and not a query, the reply code is 0, and there is
 * at least one answer. The id check matters for the same reason it did in
 * DHCP — the card is promiscuous and other machines' DNS traffic arrives here
 * looking entirely valid.
 *
 * Walks PAST records that are not A/IN rather than stopping at the first one.
 * That is what makes a CNAME chain resolve: ask for www.example.com and the
 * answer section holds the CNAME first and the address after it.
 */
static inline int nf_dns_parse_a(const uint8_t *msg, int len, uint16_t id,
                                 uint32_t *ip_out)
{
    if (len < DNS_HDR_LEN) return 0;
    if (nf_get16(msg + 0) != id) return 0;

    uint16_t flags = nf_get16(msg + 2);
    if (!(flags & 0x8000)) return 0;             /* QR must say "response"   */
    if ((flags & 0x000F) != 0) return 0;         /* RCODE 0, or it is an error */

    int qd = nf_get16(msg + 4);
    int an = nf_get16(msg + 6);
    if (an < 1) return 0;

    int off = DNS_HDR_LEN;
    for (int i = 0; i < qd; i++) {
        off = nf_dns_skip_name(msg, len, off);
        if (off < 0 || off + 4 > len) return 0;
        off += 4;                                /* qtype + qclass */
    }

    for (int i = 0; i < an; i++) {
        off = nf_dns_skip_name(msg, len, off);
        if (off < 0 || off + 10 > len) return 0;
        uint16_t type  = nf_get16(msg + off);
        uint16_t cls   = nf_get16(msg + off + 2);
        uint16_t rdlen = nf_get16(msg + off + 8);
        off += 10;
        if (off + rdlen > len) return 0;         /* rdlength off the end */
        if (type == DNS_TYPE_A && cls == DNS_CLASS_IN && rdlen == 4) {
            *ip_out = nf_get32(msg + off);
            return 1;
        }
        off += rdlen;                            /* a CNAME, or something else */
    }
    return 0;
}

#endif /* ASTRION_NET_DNS_H */
