/*
 * Astrion v2.0 — user-mode memory window + frame allocator (see usermem.h).
 *
 * Paging note: the effective US (user-accessible) permission of a page is
 * the AND of the US bits at EVERY level (PML4e, PDPTe, PDe, PTe). So to
 * make the window reachable from ring 3 we set US=1 on the user subtree
 * AND on PML4[0] (shared with the identity map). That does NOT expose the
 * identity map: its PDPT/PD entries keep US=0, so identity addresses still
 * AND down to US=0 (supervisor-only). One US=1 upper entry can't grant
 * user access on its own.
 */
#include <stdint.h>
#include "usermem.h"

extern void serial_puts_x(const char *s);

/* Boot page tables (boot/multiboot2.S, made global there). */
extern uint64_t p4_table[512];
extern uint64_t p3_table[512];

#define PTE_P   (1ull << 0)
#define PTE_W   (1ull << 1)
#define PTE_US  (1ull << 2)

#define PDPT_IDX        128   /* USER_VA_BASE >> 30 & 0x1FF == 128 (128 GiB / 1 GiB) */
#define MAX_SYSCALL_LEN 65536ull

/* 4 KiB-aligned backing store + its page-table subtree, all in BSS. */
static uint8_t  user_pool[USER_POOL_FRAMES * USER_FRAME_SIZE] __attribute__((aligned(4096)));
static uint64_t user_pd[512] __attribute__((aligned(4096)));
static uint64_t user_pt[512] __attribute__((aligned(4096)));
static uint8_t  pool_bitmap[USER_POOL_FRAMES / 8];

static int  bit_get(uint32_t i) { return (pool_bitmap[i >> 3] >> (i & 7)) & 1; }
static void bit_set(uint32_t i) { pool_bitmap[i >> 3] |=  (uint8_t)(1u << (i & 7)); }
static void bit_clr(uint32_t i) { pool_bitmap[i >> 3] &= (uint8_t)~(1u << (i & 7)); }

void usermem_init(void) {
    uint64_t pool_phys = (uint64_t)(uintptr_t)user_pool;   /* identity: phys == virt */

    for (uint32_t i = 0; i < USER_POOL_FRAMES; i++)
        user_pt[i] = (pool_phys + (uint64_t)i * USER_FRAME_SIZE) | PTE_P | PTE_W | PTE_US;

    user_pd[0]          = ((uint64_t)(uintptr_t)user_pt) | PTE_P | PTE_W | PTE_US;
    p3_table[PDPT_IDX]  = ((uint64_t)(uintptr_t)user_pd) | PTE_P | PTE_W | PTE_US;
    p4_table[0]        |= PTE_US;   /* allow user at the top level; lower id-map stays US=0 */

    /* Flush the TLB so the new mappings + the PML4[0] US change take effect. */
    __asm__ volatile("mov %%cr3, %%rax; mov %%rax, %%cr3" ::: "rax", "memory");

    serial_puts_x("USERMEM: ring-3 window mapped at 128 GiB (US=1), 2 MiB pool\n");
}

int upool_alloc(uint32_t nframes) {
    if (nframes == 0 || nframes > USER_POOL_FRAMES) return -1;
    uint32_t s = 0;
    while (s + nframes <= USER_POOL_FRAMES) {
        uint32_t k = 0;
        while (k < nframes && !bit_get(s + k)) k++;
        if (k == nframes) {
            for (uint32_t j = 0; j < nframes; j++) bit_set(s + j);
            /* Scrub the frames so a new program can't read a previous (maybe
             * already-exited) program's leftover stack/bss bytes. Covers the
             * whole allocation — image AND user-stack frames. */
            uint8_t  *p   = user_pool + (uint64_t)s * USER_FRAME_SIZE;
            uint64_t  end = (uint64_t)nframes * USER_FRAME_SIZE;
            for (uint64_t b = 0; b < end; b++) p[b] = 0;
            return (int)s;
        }
        s += k + 1;   /* skip the occupied frame at s+k */
    }
    return -1;
}

void upool_free(uint32_t start, uint32_t nframes) {
    for (uint32_t k = 0; k < nframes; k++)
        if (start + k < USER_POOL_FRAMES) bit_clr(start + k);
}

uint8_t *upool_kptr(uint32_t frame) { return user_pool + (uint64_t)frame * USER_FRAME_SIZE; }
uint64_t upool_uva(uint32_t frame)  { return USER_VA_BASE + (uint64_t)frame * USER_FRAME_SIZE; }

uint64_t usermem_window_end(void) {
    return USER_VA_BASE + (uint64_t)USER_POOL_FRAMES * USER_FRAME_SIZE;
}

/* Wrap-safe: never compute uptr+len (it would wrap for huge len and pass).
 * Reject by length cap, low bound, high bound, then remaining-space — in
 * that order, each comparison subtraction-free of attacker-controlled sums. */
int validate_user_range(uint64_t uptr, uint64_t len) {
    uint64_t end = usermem_window_end();
    if (len > MAX_SYSCALL_LEN) return 0;
    if (uptr < USER_VA_BASE)   return 0;
    if (uptr > end)            return 0;
    if (len > end - uptr)      return 0;
    return 1;
}
