/*
 * Astrion v2.0 - physical frame allocator
 *
 * Hands out 4 KiB physical frames from real RAM above the kernel heap and
 * below the 4 GiB identity-map limit. Every frame it returns is inside the
 * boot identity map, so a returned physical address is ALSO a valid kernel
 * pointer - callers zero it, write page-table entries into it, or copy a
 * program image in, by direct dereference.
 *
 * This is the foundation for Tier 3 per-process address spaces. On its own it
 * changes no live mapping - it is pure bookkeeping over otherwise-unused RAM.
 */
#ifndef ASTRION_PMM_H
#define ASTRION_PMM_H

#include <stdint.h>

#define PMM_FRAME_SIZE 4096ull

void     pmm_init(void);
uint64_t pmm_alloc(void);          /* a zeroed 4 KiB phys frame; 0 = out of memory */
void     pmm_free(uint64_t phys);  /* phys must be a frame pmm_alloc returned       */

/* A RUN of `n` physically contiguous, zeroed frames. The base is a valid kernel
 * pointer (the arena is identity-mapped) and the run is virtually contiguous, so
 * it backs a single flat buffer too large for the 32 MiB heap — the model KV
 * cache. alloc returns the base phys addr, or 0 if no run of `n` free frames
 * exists; free takes that same base and the same count. */
uint64_t pmm_alloc_contig(uint64_t n);
void     pmm_free_contig(uint64_t phys, uint64_t n);

uint64_t pmm_frames_total(void);
uint64_t pmm_frames_free(void);
uint64_t pmm_arena_base(void);
uint64_t pmm_arena_top(void);

#endif
