/*
 * Astrion v2.0 - per-process address spaces (Tier 3, M2)
 *
 * A vmspace is one process's page-table tree. vmspace_create() forges a fresh
 * PML4 that COPIES the kernel's boot PML4 (so the kernel image, the low-4-GiB
 * identity map and any high-half kernel mappings stay reachable in every space
 * - which is what keeps code, interrupts and syscalls alive across a future
 * CR3 switch). Onto that shared skeleton it hangs a PRIVATE user subtree, so
 * two processes mapping the same user virtual address land on different frames.
 *
 * The user region lives under PML4[0] (USER_VA_BASE = 128 GiB, same 512-GiB
 * PML4 slot as the identity map). vmspace_create FORKS that slot into a private
 * PDPT immediately - copying the identity entries so the kernel stays mapped,
 * but dropping the old shared user window so this space starts isolated from
 * birth. Every table below the fork is allocated from the pmm and owned by this
 * space; vmspace_destroy frees exactly those, never a shared kernel table.
 *
 * M2 only BUILDS and WALKS tables - it never loads CR3. Activation is M3. So
 * nothing here can fault: it is all bookkeeping in fresh, un-activated frames.
 */
#ifndef ASTRION_VMSPACE_H
#define ASTRION_VMSPACE_H

#include <stdint.h>

/* PTE flags, exported so callers (exec, the self-test) can build map flags.
 * A page is user-reachable only if US=1 at EVERY level (the AND rule). */
#define PTE_P   (1ull << 0)   /* present     */
#define PTE_W   (1ull << 1)   /* writable    */
#define PTE_US  (1ull << 2)   /* user (ring 3 may touch) */

typedef struct vmspace {
    uint64_t pml4_phys;   /* phys (== kernel identity ptr) of this space's PML4 */
} vmspace_t;

vmspace_t *vmspace_create(void);                 /* fresh space; 0 = OOM        */
void       vmspace_destroy(vmspace_t *sp);       /* free the private tree + PML4 */

/* Map uva -> phys with flags in sp's PRIVATE user subtree. uva must sit in the
 * user region [USER_VA_BASE, 512 GiB). Returns 0, or <0 on OOM / bad uva. */
int        vmspace_map(vmspace_t *sp, uint64_t uva, uint64_t phys, uint64_t flags);

/* Walk sp's tables for uva; return the mapped phys (flags masked off) or 0 if
 * nothing is mapped. Read-only - this is how M2 proves a mapping without CR3. */
uint64_t   vmspace_translate(vmspace_t *sp, uint64_t uva);

#endif
