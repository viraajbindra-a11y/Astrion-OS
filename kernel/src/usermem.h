/*
 * Astrion v2.0 — user-mode memory window (ring-3 isolation)
 *
 * The boot identity map covers the first 4 GiB with 2 MiB pages, all
 * supervisor-only (US=0) — so ring 3 cannot read, write, or even fetch
 * from kernel memory; any attempt #PFs and the task is killed.
 *
 * usermem_init() carves a SEPARATE window at a high virtual address
 * (USER_VA_BASE) backed by a static pool, mapped with US=1 at every
 * paging level. That window is the ONLY ring-3-reachable memory. The
 * pool is also identity-mapped (US=0) so the kernel loads programs into
 * it via a normal pointer while ring 3 sees the US=1 alias.
 *
 * There is one shared window (no per-process address spaces yet), so
 * concurrent user programs are NOT isolated from EACH OTHER — but every
 * one of them is isolated from the KERNEL, which is the boundary that
 * matters when the parser is the only thing standing between an
 * untrusted ELF and ring 0.
 */
#ifndef ASTRION_USERMEM_H
#define ASTRION_USERMEM_H

#include <stdint.h>

#define USER_VA_BASE       0x2000000000ull   /* 128 GiB — outside the 4 GiB id-map */
#define USER_POOL_FRAMES   512u              /* 512 * 4 KiB = 2 MiB */
#define USER_FRAME_SIZE    4096ull

void      usermem_init(void);                /* map the window; call once at boot */

/* Frame allocator over the pool. Returns a starting frame index, or -1. */
int       upool_alloc(uint32_t nframes);
void      upool_free(uint32_t start, uint32_t nframes);
uint8_t  *upool_kptr(uint32_t frame);        /* kernel (identity) pointer to a frame */
uint64_t  upool_uva(uint32_t frame);         /* ring-3 virtual address of a frame */

/* Bounds for syscall pointer validation. */
uint64_t  usermem_window_end(void);
int       validate_user_range(uint64_t uptr, uint64_t len);  /* 1 if fully in-window */

#endif
