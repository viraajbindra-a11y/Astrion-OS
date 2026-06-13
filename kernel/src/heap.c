/*
 * Astrion v2.0 - Kernel heap allocator
 *
 * Layout: a single contiguous region carved into variable-size blocks
 * via an intrusive doubly-linked free-list. Each block has an 8-byte-
 * aligned header:
 *
 *   struct block {
 *     ksize_t size;        // payload size in bytes (not counting header)
 *     uint32_t magic;      // 0xA570BAB1 when in-use, 0xA570F4EE when free
 *     uint32_t flags;      // bit 0 = free
 *     struct block *prev;  // physical-prev block (NULL = first)
 *     struct block *next;  // physical-next block (NULL = last)
 *   };
 *
 * Single doubly-linked list ordered by address. Split-on-alloc cuts a
 * block in two; coalesce-on-free merges with adjacent free neighbors.
 *
 * Concurrency: preemption-safe. The public kmalloc/kfree/krealloc/
 * kcalloc disable interrupts around the free-list critical section
 * (see irq_save/irq_restore). On a single CPU the only concurrency is
 * the timer ISR preempting a task mid-allocation, so cli IS the lock.
 * The internal *_alloc / block_free cores assume the lock is held.
 *
 * Heap address choice:
 *   - Kernel image lives at 0x100000..~0x113000.
 *   - Page tables (boot/multiboot2.S .bss) are in there too.
 *   - 4 MiB (0x400000) is well past anything we use, well within the
 *     1..256 MiB available range from the multiboot2 mmap, and within
 *     the 4 GiB identity-map we set up in boot/multiboot2.S.
 *   - 32 MiB is plenty for anything we'd do before having a real
 *     page allocator backing it.
 */

#include <stdint.h>
#include "heap.h"

#define HEAP_BASE   0x400000ULL          /* 4 MiB */
#define HEAP_SIZE   (32ULL * 1024 * 1024)/* 32 MiB */
#define ALIGN       16                   /* allocations are 16-byte aligned */

#define MAGIC_INUSE 0xA570BAB1u
#define MAGIC_FREE  0xA570F4EEu
#define FLAG_FREE   0x1u

struct block {
    ksize_t  size;       /* payload bytes after the header */
    uint32_t magic;
    uint32_t flags;
    struct block *prev;  /* physical neighbor, lower addr */
    struct block *next;  /* physical neighbor, higher addr */
};

#define HDR_SIZE ((ksize_t)sizeof(struct block))

static struct block *heap_list;

/* Stats. */
static ksize_t  stat_total;
static ksize_t  stat_used;
static ksize_t  stat_peak;
static uint64_t stat_allocs;
static uint64_t stat_frees;

static inline ksize_t align_up(ksize_t v, ksize_t a) {
    return (v + (a - 1)) & ~(a - 1);
}

/* The heap free-list is shared mutable state. Once preemption is on
 * (lesson #201), the timer can deschedule a task mid-kmalloc and let
 * another task corrupt the list. On a single CPU the only concurrency
 * is interrupts, so disabling them around each critical section IS the
 * lock. Save/restore (not bare cli/sti) so it nests safely if a caller
 * already had interrupts off. */
static inline uint64_t irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void irq_restore(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}

void heap_init(void) {
    /* Place a single huge free block covering the whole heap. */
    heap_list = (struct block *)(uintptr_t)HEAP_BASE;
    heap_list->size  = HEAP_SIZE - HDR_SIZE;
    heap_list->magic = MAGIC_FREE;
    heap_list->flags = FLAG_FREE;
    heap_list->prev  = 0;
    heap_list->next  = 0;
    stat_total  = HEAP_SIZE;
    stat_used   = 0;
    stat_peak   = 0;
    stat_allocs = 0;
    stat_frees  = 0;
}

static void *block_payload(struct block *b) {
    return (void *)((uintptr_t)b + HDR_SIZE);
}

static struct block *block_from_payload(void *p) {
    return (struct block *)((uintptr_t)p - HDR_SIZE);
}

/* Split `b` so it ends up holding exactly `need` bytes; the remainder
 * becomes a new free block right after it in the list. Only splits if
 * the remainder is big enough to hold a header + a minimum payload. */
static void split_block(struct block *b, ksize_t need) {
    ksize_t leftover = b->size - need;
    if (leftover < HDR_SIZE + ALIGN) return;
    uintptr_t new_addr = (uintptr_t)b + HDR_SIZE + need;
    struct block *n = (struct block *)new_addr;
    n->size  = leftover - HDR_SIZE;
    n->magic = MAGIC_FREE;
    n->flags = FLAG_FREE;
    n->prev  = b;
    n->next  = b->next;
    if (b->next) b->next->prev = n;
    b->next  = n;
    b->size  = need;
}

/* ── Unlocked cores. Callers below hold the IRQ lock. ───────────── */

static void *heap_alloc(ksize_t bytes) {
    if (bytes == 0) return 0;
    /* Guard the alignment round-up against overflow: align_up does
     * (bytes + 15) & ~15, which wraps for bytes within 15 of the max
     * and would return a tiny `need`. No alloc is ever that large, so
     * reject it outright. */
    if (bytes > HEAP_SIZE) return 0;
    ksize_t need = align_up(bytes, ALIGN);

    /* First-fit. */
    for (struct block *b = heap_list; b; b = b->next) {
        if (!(b->flags & FLAG_FREE)) continue;
        if (b->size < need) continue;
        split_block(b, need);
        b->flags &= ~FLAG_FREE;
        b->magic = MAGIC_INUSE;
        stat_used   += b->size + HDR_SIZE;
        if (stat_used > stat_peak) stat_peak = stat_used;
        stat_allocs += 1;
        return block_payload(b);
    }
    return 0;  /* OOM */
}

static void heap_block_free(void *p) {
    if (!p) return;
    struct block *b = block_from_payload(p);
    if (b->magic != MAGIC_INUSE) {
        /* Bad free - corruption or double-free. Silently ignore so
         * we don't take the kernel down; future panic-on-corruption
         * mode can flip this. */
        return;
    }
    b->flags |= FLAG_FREE;
    b->magic = MAGIC_FREE;
    stat_used -= b->size + HDR_SIZE;
    stat_frees += 1;

    /* Coalesce with next neighbor if free. */
    if (b->next && (b->next->flags & FLAG_FREE)) {
        struct block *n = b->next;
        b->size += HDR_SIZE + n->size;
        b->next = n->next;
        if (n->next) n->next->prev = b;
    }
    /* Coalesce with prev neighbor if free. */
    if (b->prev && (b->prev->flags & FLAG_FREE)) {
        struct block *p2 = b->prev;
        p2->size += HDR_SIZE + b->size;
        p2->next = b->next;
        if (b->next) b->next->prev = p2;
    }
}

/* ── Public, interrupt-safe wrappers. ───────────────────────────── */

void *kmalloc(ksize_t bytes) {
    uint64_t f = irq_save();
    void *p = heap_alloc(bytes);
    irq_restore(f);
    return p;
}

void kfree(void *p) {
    uint64_t f = irq_save();
    heap_block_free(p);
    irq_restore(f);
}

void *kcalloc(ksize_t n, ksize_t bytes) {
    /* Reject n*bytes overflow: a wrapped-small `total` would under-
     * allocate while the caller assumes n*bytes of zeroed space - a
     * classic heap-overflow primitive. */
    if (bytes != 0 && n > (~(ksize_t)0) / bytes) return 0;
    ksize_t total = n * bytes;
    void *p = kmalloc(total);          /* locks internally */
    if (!p) return 0;
    uint8_t *bp = (uint8_t *)p;
    for (ksize_t i = 0; i < total; i++) bp[i] = 0;
    return p;
}

void *krealloc(void *p, ksize_t new_size) {
    uint64_t f = irq_save();
    void *ret;
    if (!p) {
        ret = heap_alloc(new_size);
    } else if (new_size == 0) {
        heap_block_free(p);
        ret = 0;
    } else {
        struct block *b = block_from_payload(p);
        if (b->magic != MAGIC_INUSE) {
            ret = 0;
        } else if (b->size >= new_size) {
            ret = p;                   /* fits in place */
        } else {
            void *np = heap_alloc(new_size);
            if (!np) {
                ret = 0;
            } else {
                uint8_t *src = (uint8_t *)p;
                uint8_t *dst = (uint8_t *)np;
                for (ksize_t i = 0; i < b->size; i++) dst[i] = src[i];
                heap_block_free(p);
                ret = np;
            }
        }
    }
    irq_restore(f);
    return ret;
}

ksize_t  heap_total(void)        { return stat_total; }
ksize_t  heap_used(void)         { return stat_used; }
ksize_t  heap_free(void)         { return stat_total - stat_used; }
ksize_t  heap_peak(void)         { return stat_peak; }
uint64_t heap_alloc_count(void)  { return stat_allocs; }
uint64_t heap_free_count(void)   { return stat_frees; }

uint32_t heap_block_count(void) {
    uint32_t n = 0;
    for (struct block *b = heap_list; b; b = b->next) n++;
    return n;
}

uint32_t heap_free_blocks(void) {
    uint32_t n = 0;
    for (struct block *b = heap_list; b; b = b->next) {
        if (b->flags & FLAG_FREE) n++;
    }
    return n;
}
