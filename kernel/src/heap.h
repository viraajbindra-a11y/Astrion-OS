/*
 * Astrion v2.0 — Kernel heap allocator
 *
 * First-fit free list with split-on-alloc + coalesce-on-free. The
 * heap is a fixed range chosen from the multiboot2 memory map (we
 * verified the 1..256 MiB region is type=available, so 4..36 MiB
 * is safe to use — past the kernel image which ends ~1.1 MiB).
 *
 * Public API mirrors libc semantics. kmalloc returns NULL on OOM.
 * kfree(NULL) is a no-op. kcalloc zero-initializes. krealloc
 * allocates a new block + copies + frees the old (no in-place
 * resize for simplicity).
 */

#ifndef ASTRION_HEAP_H
#define ASTRION_HEAP_H

#include <stdint.h>

typedef uint64_t ksize_t;

void  heap_init(void);

void *kmalloc(ksize_t bytes);
void *kcalloc(ksize_t n, ksize_t bytes);
void *krealloc(void *p, ksize_t new_size);
void  kfree(void *p);

/* Stats — for the 'heap' shell command. */
ksize_t heap_total(void);
ksize_t heap_used(void);
ksize_t heap_free(void);
ksize_t heap_peak(void);
uint64_t heap_alloc_count(void);
uint64_t heap_free_count(void);
uint32_t heap_block_count(void);    /* total blocks in the list */
uint32_t heap_free_blocks(void);    /* free blocks specifically */

#endif
