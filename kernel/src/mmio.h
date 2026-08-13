/*
 * Astrion v2.0 — make a physical range safe to use as device registers.
 *
 * THE PROBLEM
 * -----------
 * boot/multiboot2.S identity-maps the low memory as huge pages with the cache
 * left ON, because everything it was mapping was RAM and RAM wants to be
 * cached. A PCI device's register window is inside that range and is not RAM.
 * Reading a status register through a cache line can return a value the card
 * changed a microsecond ago; writing a command register into a write-back
 * buffer can leave the card waiting for a command that is sitting in the CPU.
 *
 * Both failures are intermittent, both look exactly like a driver bug, and
 * neither reproduces in QEMU — emulated device memory is trapped on every
 * access no matter what the page tables say. So this is a class of bug that
 * cannot be found on the machine it is written on, and only appears on the
 * hardware a stranger is running.
 *
 * Most kernels get away with it because firmware programs the MTRRs to mark
 * the PCI hole uncacheable, and the CPU takes the more conservative of the two
 * types. "Most" and "usually" are not what Astrion ships on: the point of
 * writing an e1000 driver rather than a virtio one was that it has to work on
 * a real machine, and relying on someone else's firmware to fix our page
 * tables would give that away for nothing.
 *
 * WHAT THIS DOES
 * --------------
 * Sets PCD (page-level cache disable) on exactly the pages covering a range,
 * splitting a 1 GiB mapping into 2 MiB pages first if that is what boot left.
 * Splitting matters: setting PCD on the whole 1 GiB page containing a NIC's
 * BAR would also mark uncacheable whatever RAM shares that gigabyte, which on
 * a machine with 3-4 GiB installed is real memory and a large, permanent,
 * invisible slowdown.
 *
 * mmio_is_uncached() reads the mapping back afterwards. On a machine where the
 * change cannot be verified by its effect — which is every machine, since a
 * cached mapping works fine right up until it does not — reading back the bit
 * that was supposed to be set is the only honest check available.
 */

#ifndef ASTRION_MMIO_H
#define ASTRION_MMIO_H

#include <stdint.h>

/* Mark [phys, phys+len) uncacheable in the kernel's identity map.
 * Returns 1 on success, 0 if the range could not be split or is out of the
 * mapped region. A 0 here is not fatal — the driver still works wherever
 * firmware already marked the range UC — so the caller should log it rather
 * than refuse to run. */
int mmio_map_uncached(uint64_t phys, uint64_t len);

/* Does the mapping covering this address actually have PCD set? Walks the
 * live page tables; does not trust what mmio_map_uncached returned. */
int mmio_is_uncached(uint64_t phys);

#endif /* ASTRION_MMIO_H */
