/*
 * Astrion v2.0 — uncacheable mappings for device register windows.
 * See mmio.h for why this exists and why it cannot be tested by its effect.
 *
 * Only the kernel's own identity map is touched, and only ever at boot, before
 * any vmspace has been created. That ordering is load-bearing: vmspace_create
 * COPIES the boot PDPT, so a change made after a process exists would be
 * invisible to that process. Nothing here re-walks existing address spaces,
 * because at the one moment it runs there are none.
 */

#include <stdint.h>
#include "mmio.h"
#include "pmm.h"

/* Boot page tables, from boot/multiboot2.S. */
extern uint64_t p3_table[512];
extern uint64_t pdpe1gb_used;

#define PTE_P           (1ull << 0)
#define PTE_W           (1ull << 1)
#define PTE_PCD         (1ull << 4)     /* page-level cache disable */
#define PTE_PS          (1ull << 7)     /* this entry IS a page, not a table */
#define PTE_ADDR_MASK   0x000FFFFFFFFFF000ull

#define GIB             0x40000000ull
#define MIB2            0x200000ull

static uint64_t *as_table(uint64_t phys) { return (uint64_t *)(uintptr_t)phys; }

static void flush_tlb(void) {
    /* Reloading CR3 drops every non-global entry. Heavier than invlpg per
     * page and this runs once at boot, where "obviously correct" beats fast —
     * an invlpg loop that misses one page leaves a stale cached translation
     * for device registers, which is the exact bug being fixed. */
    uint64_t cr3;
    __asm__ volatile("mov %%cr3, %0" : "=r"(cr3));
    __asm__ volatile("mov %0, %%cr3" :: "r"(cr3) : "memory");
}

/* Turn the 1 GiB page at p3_table[i] into a page directory of 512 2 MiB pages
 * covering exactly the same physical range with exactly the same flags.
 * Returns the new PD's physical address, or 0. */
static uint64_t split_1g(int i) {
    uint64_t e = p3_table[i];
    if (!(e & PTE_P) || !(e & PTE_PS)) return 0;   /* not a 1 GiB page */

    uint64_t pd_phys = pmm_alloc();                /* zeroed */
    if (!pd_phys) return 0;

    /* A 1 GiB page's address field is bits 51:30 — NOT the 51:12 that
     * PTE_ADDR_MASK covers. Bit 12 in a huge entry is the PAT bit, so masking
     * with PTE_ADDR_MASK here would quietly drop the caller's memory type
     * while claiming to preserve the flags. It happens to be zero in the boot
     * tables, which is exactly why this would have gone unnoticed until some
     * future mapping set it. */
    uint64_t base  = e &  0x000FFFFFC0000000ull;
    uint64_t flags = e & ~0x000FFFFFC0000000ull;
    /* PS stays set: at PD level it still means "this entry is a page", which
     * is what a 2 MiB page is. Everything else — W, US, PWT, PCD, A, D, G,
     * PAT, NX — carries down unchanged, so the split is invisible except for
     * the granularity. */

    uint64_t *pd = as_table(pd_phys);
    for (int k = 0; k < 512; k++)
        pd[k] = (base + (uint64_t)k * MIB2) | flags;

    /* The PDPT entry becomes a TABLE pointer, so PS must come off IT. */
    p3_table[i] = pd_phys | PTE_P | PTE_W;
    return pd_phys;
}

int mmio_map_uncached(uint64_t phys, uint64_t len) {
    if (!len) return 0;

    uint64_t start = phys & ~(MIB2 - 1);
    uint64_t end   = (phys + len + MIB2 - 1) & ~(MIB2 - 1);
    int touched = 0;

    for (uint64_t a = start; a < end; a += MIB2) {
        int i3 = (int)((a >> 30) & 0x1FF);
        /* The boot map covers the low 4 GiB in the 2 MiB shape and 512 GiB in
         * the 1 GiB shape; either way an address past PML4[0]'s 512 GiB is not
         * ours to touch. */
        if (a >= 512ull * GIB) return 0;

        uint64_t e3 = p3_table[i3];
        if (!(e3 & PTE_P)) return 0;               /* nothing mapped there */

        if (e3 & PTE_PS) {                         /* a 1 GiB page: split it */
            if (!split_1g(i3)) return 0;
            e3 = p3_table[i3];
        }

        uint64_t *pd = as_table(e3 & PTE_ADDR_MASK);
        int i2 = (int)((a >> 21) & 0x1FF);
        if (!(pd[i2] & PTE_P)) return 0;

        /* Only 2 MiB pages are handled. A PD entry that points at a page TABLE
         * would need the same treatment one level further down, and nothing in
         * this kernel builds 4 KiB identity mappings — so rather than write
         * untested code for a case that cannot occur, refuse and say so. */
        if (!(pd[i2] & PTE_PS)) return 0;

        pd[i2] |= PTE_PCD;
        touched++;
    }

    if (touched) flush_tlb();
    return touched > 0;
}

int mmio_is_uncached(uint64_t phys) {
    if (phys >= 512ull * GIB) return 0;
    uint64_t e3 = p3_table[(phys >> 30) & 0x1FF];
    if (!(e3 & PTE_P)) return 0;
    if (e3 & PTE_PS) return (e3 & PTE_PCD) != 0;   /* still a 1 GiB page */

    uint64_t *pd = as_table(e3 & PTE_ADDR_MASK);
    uint64_t e2 = pd[(phys >> 21) & 0x1FF];
    if (!(e2 & PTE_P)) return 0;
    if (e2 & PTE_PS) return (e2 & PTE_PCD) != 0;

    uint64_t *pt = as_table(e2 & PTE_ADDR_MASK);
    uint64_t e1 = pt[(phys >> 12) & 0x1FF];
    return (e1 & PTE_P) && (e1 & PTE_PCD);
}
