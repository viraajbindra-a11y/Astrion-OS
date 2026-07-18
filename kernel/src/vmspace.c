/*
 * Astrion v2.0 - per-process address spaces (see vmspace.h).
 *
 * Paging note (the AND rule): a page is user-accessible only if US=1 at EVERY
 * level (PML4e, PDPTe, PDe, PTe). We link the intermediate user tables with
 * US=1 so the leaf's US bit decides reachability; the leaf carries the caller's
 * real permission. The identity-map entries we copy keep their US=0, so kernel
 * memory stays supervisor-only even though PML4[0] itself is US=1.
 *
 * The boot tables (boot/multiboot2.S): PML4[0] -> p3_table -> PDPT[0..3] -> four
 * 2 MiB-huge-page PDs identity-mapping the low 4 GiB (US=0). usermem_init added
 * the old shared user window at p3_table[128]. Every space copies PML4[0], then
 * immediately forks p3_table into a PRIVATE PDPT (dropping [128]) at CREATE time,
 * so a space is isolated at USER_VA_BASE from birth - it never transiently
 * exposes the shared user window between create and its first map.
 */
#include <stdint.h>
#include "vmspace.h"
#include "usermem.h"   /* USER_VA_BASE */
#include "pmm.h"
#include "heap.h"

/* Boot page tables (boot/multiboot2.S, made global there). */
extern uint64_t p4_table[512];
extern uint64_t p3_table[512];

#define PTE_PS          (1ull << 7)                 /* huge page (PDPTe/PDe)     */
#define PTE_ADDR_MASK   0x000FFFFFFFFFF000ull       /* phys bits [51:12] of a PTE */

/* USER_VA_BASE is 128 GiB: PML4 idx 0, PDPT idx 128, PD idx 0, PT idx 0. The
 * whole user region shares PML4[0] with the identity map, so it must stay
 * below 512 GiB (one PML4 slot) - that keeps map and destroy on one subtree. */
#define USER_PDPT_IDX   ((USER_VA_BASE >> 30) & 0x1FF)   /* == 128 */
#define PML4_SLOT_SIZE  0x8000000000ull                  /* 512 GiB per PML4 entry */

/* 9-bit table indices for a virtual address. */
static uint64_t idx4(uint64_t va) { return (va >> 39) & 0x1FF; }
static uint64_t idx3(uint64_t va) { return (va >> 30) & 0x1FF; }
static uint64_t idx2(uint64_t va) { return (va >> 21) & 0x1FF; }
static uint64_t idx1(uint64_t va) { return (va >> 12) & 0x1FF; }

/* A pmm frame's phys address is also a valid kernel pointer (it lives in the
 * identity map), so page tables are read/written straight through it. */
static uint64_t *as_table(uint64_t phys) { return (uint64_t *)(uintptr_t)phys; }

vmspace_t *vmspace_create(void) {
    uint64_t pml4_phys = pmm_alloc();          /* zeroed 4 KiB frame */
    if (!pml4_phys) return 0;

    /* Copy the whole kernel PML4: the identity map + kernel + any high-half
     * mappings ride along, so the kernel stays reachable after a CR3 switch.
     * The destination is volatile so -O2 can't fold this element-wise copy
     * into a memcpy() call - this kernel is freestanding and provides no libc
     * mem* symbols (same reason pmm's zero_frame hand-rolls its loop). */
    volatile uint64_t *pml4 = (volatile uint64_t *)(uintptr_t)pml4_phys;
    for (int i = 0; i < 512; i++) pml4[i] = p4_table[i];

    /* Fork PML4[0] into a PRIVATE PDPT right here, at creation - so the space is
     * isolated at USER_VA_BASE from its very first breath, never transiently
     * exposing the shared user window (p3_table[128]) in the gap between create
     * and the first vmspace_map. Copy the boot PDPT verbatim so the identity
     * entries [0..3] (US=0) ride along and keep the kernel mapped, then drop the
     * shared window at [128]. Volatile dest keeps -O2 from lowering the copy to a
     * memcpy() call (freestanding: no libc mem* symbols). */
    uint64_t pdpt_phys = pmm_alloc();          /* zeroed 4 KiB frame */
    if (!pdpt_phys) { pmm_free(pml4_phys); return 0; }
    volatile uint64_t *pdpt = (volatile uint64_t *)(uintptr_t)pdpt_phys;
    for (int i = 0; i < 512; i++) pdpt[i] = p3_table[i];
    pdpt[USER_PDPT_IDX] = 0;                              /* drop shared window     */
    pml4[0] = pdpt_phys | PTE_P | PTE_W | PTE_US;         /* PML4[0] -> private PDPT */

    vmspace_t *sp = (vmspace_t *)kmalloc(sizeof *sp);
    if (!sp) { pmm_free(pdpt_phys); pmm_free(pml4_phys); return 0; }
    sp->pml4_phys = pml4_phys;
    return sp;
}

/* Ensure tbl[idx] points at a present table; allocate a fresh zeroed one if
 * not. Links with P|W|US so the AND rule lets ring 3 reach the leaf below.
 * Returns the child table's phys, or 0 on OOM. */
static uint64_t ensure_table(uint64_t *tbl, uint64_t idx) {
    if (tbl[idx] & PTE_P) return tbl[idx] & PTE_ADDR_MASK;
    uint64_t child = pmm_alloc();
    if (!child) return 0;
    tbl[idx] = child | PTE_P | PTE_W | PTE_US;
    return child;
}

int vmspace_map(vmspace_t *sp, uint64_t uva, uint64_t phys, uint64_t flags) {
    if (!sp) return -1;
    /* Keep every user mapping inside PML4[0]'s slot: at/above USER_VA_BASE and
     * below 512 GiB. That guarantees the PDPT index is >= 128 (never an
     * identity slot 0..3) and that this is the only PML4 entry we ever touch. */
    if (uva < USER_VA_BASE || uva >= PML4_SLOT_SIZE) return -1;

    uint64_t *pml4 = as_table(sp->pml4_phys);
    uint64_t i4 = idx4(uva);   /* == 0 for the user region */

    /* Level 4 -> 3: PML4[0] was forked into a PRIVATE PDPT by vmspace_create, so
     * here it is always present and never the shared boot p3_table. Refuse both
     * other cases rather than build into them - this is the fail-safe guard:
     *   - not present: would need a fresh kernel-less PDPT, whose task would
     *     triple-fault on the first instruction after the CR3 load (F2);
     *   - still == p3_table: writing a private PD into it would corrupt the
     *     shared boot PDPT, aliasing every space at once (F3).
     * Both are unreachable today (create always forks); the guard makes them
     * safe if a future USER_VA_BASE/slot change ever reaches here. */
    uint64_t e4 = pml4[i4];
    if (!(e4 & PTE_P)) return -1;
    uint64_t pdpt_phys = e4 & PTE_ADDR_MASK;
    if (pdpt_phys == ((uint64_t)(uintptr_t)p3_table)) return -1;

    /* Level 3 -> 2 -> 1: allocate the private PD and PT as needed. */
    uint64_t pd_phys = ensure_table(as_table(pdpt_phys), idx3(uva));
    if (!pd_phys) return -1;
    uint64_t pt_phys = ensure_table(as_table(pd_phys), idx2(uva));
    if (!pt_phys) return -1;

    /* Install the leaf. Mask phys to the address bits so a stray low bit can't
     * bleed into the flags (and vice versa). */
    as_table(pt_phys)[idx1(uva)] = (phys & PTE_ADDR_MASK) | flags;
    return 0;
}

uint64_t vmspace_translate(vmspace_t *sp, uint64_t uva) {
    if (!sp) return 0;
    uint64_t *pml4 = as_table(sp->pml4_phys);

    uint64_t e4 = pml4[idx4(uva)];
    if (!(e4 & PTE_P)) return 0;

    uint64_t e3 = as_table(e4 & PTE_ADDR_MASK)[idx3(uva)];
    if (!(e3 & PTE_P)) return 0;
    if (e3 & PTE_PS) return e3 & PTE_ADDR_MASK;   /* 1 GiB huge page (defensive) */

    uint64_t e2 = as_table(e3 & PTE_ADDR_MASK)[idx2(uva)];
    if (!(e2 & PTE_P)) return 0;
    if (e2 & PTE_PS) return e2 & PTE_ADDR_MASK;   /* 2 MiB huge page (identity)  */

    uint64_t e1 = as_table(e2 & PTE_ADDR_MASK)[idx1(uva)];
    if (!(e1 & PTE_P)) return 0;
    return e1 & PTE_ADDR_MASK;
}

void vmspace_destroy(vmspace_t *sp) {
    if (!sp) return;
    uint64_t *pml4 = as_table(sp->pml4_phys);

    /* Only PML4[0] is ever ours to unwind: the user region lives there, and it
     * is the one entry we fork (now in vmspace_create). Every other PML4 slot is
     * a shared kernel mapping we must leave alone. Since create always forks, [0]
     * is a PRIVATE PDPT here (!= the shared boot p3_table) - the guard below is a
     * defensive backstop, no longer the empty/mapped discriminator it once was. A
     * created-but-never-mapped space still unwinds correctly inside the walk: its
     * identity entries [0..3] equal p3_table[i3] and are skipped, [128] is 0 and
     * skipped, so only the private PDPT + PML4 (the two frames create allocated)
     * come back - the pmm balances even for a space that never mapped a page. */
    uint64_t e4 = pml4[0];
    if ((e4 & PTE_P) && (e4 & PTE_ADDR_MASK) != ((uint64_t)(uintptr_t)p3_table)) {
        uint64_t *pdpt = as_table(e4 & PTE_ADDR_MASK);
        for (int i3 = 0; i3 < 512; i3++) {
            uint64_t e3 = pdpt[i3];
            if (!(e3 & PTE_P)) continue;
            if (e3 == p3_table[i3]) continue;   /* shared identity/kernel entry */
            uint64_t *pd = as_table(e3 & PTE_ADDR_MASK);
            for (int i2 = 0; i2 < 512; i2++) {
                uint64_t e2 = pd[i2];
                if (!(e2 & PTE_P)) continue;
                uint64_t *pt = as_table(e2 & PTE_ADDR_MASK);
                for (int i1 = 0; i1 < 512; i1++)
                    if (pt[i1] & PTE_P) pmm_free(pt[i1] & PTE_ADDR_MASK);  /* leaf */
                pmm_free(e2 & PTE_ADDR_MASK);    /* PT */
            }
            pmm_free(e3 & PTE_ADDR_MASK);        /* PD */
        }
        pmm_free(e4 & PTE_ADDR_MASK);            /* private PDPT */
    }

    pmm_free(sp->pml4_phys);
    kfree(sp);
}
