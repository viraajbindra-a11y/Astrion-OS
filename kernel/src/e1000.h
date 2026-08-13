/*
 * Astrion v2.0 — Intel 82540EM (e1000) Ethernet driver
 *
 * The card QEMU emulates as `-device e1000`, and a real chip that shipped in
 * a great many PCs and PCIe cards. Chosen over virtio-net on purpose: virtio
 * is easier and only exists inside a hypervisor, and Astrion's whole claim is
 * that it runs on metal. A driver that works only in emulation would make the
 * September VM release look finished while leaving the hardware story exactly
 * where it was.
 *
 * POLLED, NOT INTERRUPT-DRIVEN. The card can raise an IRQ per packet and this
 * ignores that entirely: transmit writes a descriptor and spins on its done
 * bit, receive walks the ring looking for one. That is the wrong design for a
 * busy server and the right one for the first version of anything — an IRQ
 * path adds a handler, a shared-line check, a lost-wakeup race and an
 * interaction with the scheduler, and every one of those failures looks
 * identical to "the ring is set up wrong" from the outside. Polling makes the
 * first question answerable. The IRQ path can come after packets provably move.
 *
 * All DMA addresses handed to the card are physical, and this kernel identity-
 * maps the low 4 GiB, so a pmm frame's address is both its physical address
 * and a valid kernel pointer. That is what makes the ring setup here as short
 * as it is; on a kernel with a higher-half mapping every one of these would
 * need a translation.
 */

#ifndef ASTRION_E1000_H
#define ASTRION_E1000_H

#include <stdint.h>

/* Probe PCI, reset the card, build the rings, bring the link up.
 * Returns 1 when the card is ready to move packets, 0 when there is no card or
 * it did not come up. 0 is a normal answer on a machine with no NIC and must
 * not be treated as a fault. */
int e1000_init(void);

int  e1000_present(void);

/* Our MAC, valid only once e1000_init() has returned 1. */
const uint8_t *e1000_mac(void);

/* Does the card say the cable is plugged in? Separate from present(): a card
 * that initialised fine with no link is the single most common real-hardware
 * situation, and reporting it as "no card" would send someone hunting for a
 * driver bug instead of a cable. */
int e1000_link_up(void);

/* Put `len` bytes on the wire. Returns 1 on success, 0 if the card never
 * reported the descriptor done. Blocks until the card acknowledges, which at
 * gigabit is microseconds. */
int e1000_send(const void *frame, uint16_t len);

/* Take one received frame, if there is one. Returns its length, or 0 when the
 * ring is empty. Never blocks. */
int e1000_recv(void *out, int cap);

/* Counters, for the shell and for telling "nothing arrived" apart from
 * "something arrived and we dropped it" — which look the same from a caller
 * and have completely different causes. */
uint32_t e1000_tx_count(void);
uint32_t e1000_rx_count(void);
uint32_t e1000_rx_dropped(void);

/* Did WE mark the register window uncacheable, or are we relying on firmware
 * having done it? Both work; only one of them is ours. Reported so the answer
 * is on record for whatever machine this ends up on, rather than assumed. */
int e1000_mmio_uncached(void);

#endif /* ASTRION_E1000_H */
