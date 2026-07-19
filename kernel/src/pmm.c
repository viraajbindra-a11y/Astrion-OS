/*
 * Astrion v2.0 - physical frame allocator (see pmm.h).
 *
 * Bitmap allocator (1 bit / 4 KiB frame, 0 = free, 1 = used). The arena is the
 * RAM above the kernel heap and below the 4 GiB identity-map limit. We start
 * with EVERY frame marked used and then free only the frames that the boot
 * memory map calls "available" - so ACPI tables, reserved holes and MMIO in
 * that span are never handed out, whatever the machine's layout.
 *
 * The whole arena is inside the boot identity map, so a frame's physical
 * address is a usable kernel pointer: we zero every frame on the way out.
 */
#include <stdint.h>
#include "pmm.h"
#include "heap.h"

extern uint64_t heap_phys_end(void);
extern uint32_t boot_mmap_avail_count(void);
extern int      boot_mmap_avail_region(uint32_t i, uint64_t *base, uint64_t *len);

extern void serial_puts_x(const char *s);
extern void serial_put_hex64_x(uint64_t v);
extern void serial_put_u64_x(uint64_t v);

/* How far the boot identity map reaches. A frame above it is not addressable
 * as a kernel pointer, so the pmm must never hand it out — zero_frame() would
 * dereference an unmapped address and fault.
 *
 * This is a RUNTIME value, not a constant, because boot/multiboot2.S chooses
 * its mapping from CPUID: 512 GiB via 1 GiB pages when the CPU has PDPE1GB,
 * else the old 4 GiB via 2 MiB pages. It was hardcoded to 4 GiB, which was
 * correct while that was the only shape — but once the map grew, the allocator
 * kept ignoring everything above 4 GiB. On a 12 GiB machine that left 8 GiB
 * claimed by nobody: visible in the memory map, addressable by the CPU, and
 * unusable. Deriving it from the same flag the boot code sets means the two
 * cannot drift apart. */
extern uint64_t pdpe1gb_used;

#define IDMAP_1GIB_LIMIT (512ull << 30)   /* 512 PDPT entries x 1 GiB */
#define IDMAP_2MIB_LIMIT 0x100000000ull   /* 4 PDs x 512 x 2 MiB      */

static uint64_t idmap_limit(void) {
    return pdpe1gb_used ? IDMAP_1GIB_LIMIT : IDMAP_2MIB_LIMIT;
}

static uint64_t  arena_base;   /* first managed frame (4 KiB aligned)     */
static uint64_t  arena_top;    /* one past the last managed byte          */
static uint64_t  nframes;      /* frames spanned by the bitmap            */
static uint64_t  nfree;        /* currently free                          */
static uint8_t  *bitmap;       /* nframes bits, kmalloc'd (lives in heap)  */
static uint64_t  hint;         /* rotating search start                    */

static int  bit_get(uint64_t i) { return (bitmap[i >> 3] >> (i & 7)) & 1; }
static void bit_set(uint64_t i) { bitmap[i >> 3] |=  (uint8_t)(1u << (i & 7)); }
static void bit_clr(uint64_t i) { bitmap[i >> 3] &= (uint8_t)~(1u << (i & 7)); }

static uint64_t align_up(uint64_t x)   { return (x + PMM_FRAME_SIZE - 1) & ~(PMM_FRAME_SIZE - 1); }
static uint64_t align_down(uint64_t x) { return x & ~(PMM_FRAME_SIZE - 1); }

static void zero_frame(uint64_t phys) {
    volatile uint64_t *p = (volatile uint64_t *)(uintptr_t)phys;
    for (uint32_t i = 0; i < PMM_FRAME_SIZE / 8; i++) p[i] = 0;
}

/* End of a memory-map region, clamped into the identity map and wrap-safe. */
static uint64_t region_end(uint64_t base, uint64_t len) {
    uint64_t limit = idmap_limit();
    if (base >= limit) return base;               /* wholly out of range */
    if (len > limit - base) return limit;
    return base + len;
}

void pmm_init(void) {
    arena_base = arena_top = nframes = nfree = 0;
    bitmap = 0;
    hint = 0;

    uint64_t base = align_up(heap_phys_end());

    /* Pass 1: the arena top is the highest available byte in range, so the
     * bitmap is no bigger than the RAM it actually covers. */
    uint64_t top = base;
    uint32_t n = boot_mmap_avail_count();
    for (uint32_t i = 0; i < n; i++) {
        uint64_t rb, rl;
        if (!boot_mmap_avail_region(i, &rb, &rl)) continue;
        uint64_t re = region_end(rb, rl);
        if (re > top) top = re;
    }
    top = align_down(top);
    if (top <= base) {
        serial_puts_x("PMM: no free arena above the heap\n");
        return;
    }

    arena_base = base;
    arena_top  = top;
    nframes    = (top - base) / PMM_FRAME_SIZE;

    uint64_t bytes = (nframes + 7) / 8;
    bitmap = (uint8_t *)kmalloc(bytes);
    if (!bitmap) {
        arena_base = arena_top = nframes = nfree = 0;
        serial_puts_x("PMM: bitmap alloc failed - pmm disabled\n");
        return;
    }
    for (uint64_t i = 0; i < bytes; i++) bitmap[i] = 0xFF;   /* all USED */

    /* Pass 2: free only the frames the map calls available, intersected with
     * the arena. Holes/reserved/ACPI inside the span stay used forever. */
    for (uint32_t i = 0; i < n; i++) {
        uint64_t rb, rl;
        if (!boot_mmap_avail_region(i, &rb, &rl)) continue;
        uint64_t rstart = align_up(rb < arena_base ? arena_base : rb);
        uint64_t rend   = align_down(region_end(rb, rl));
        if (rend > arena_top) rend = arena_top;
        for (uint64_t p = rstart; p < rend; p += PMM_FRAME_SIZE) {
            uint64_t f = (p - arena_base) / PMM_FRAME_SIZE;
            if (f < nframes && bit_get(f)) { bit_clr(f); nfree++; }
        }
    }

    serial_puts_x("PMM: arena ");
    serial_put_hex64_x(arena_base);
    serial_puts_x(" .. ");
    serial_put_hex64_x(arena_top);
    serial_puts_x(", ");
    serial_put_u64_x(nfree);
    serial_puts_x(" free / ");
    serial_put_u64_x(nframes);
    serial_puts_x(" frames (");
    serial_put_u64_x((nfree * PMM_FRAME_SIZE) / (1024 * 1024));
    serial_puts_x(" MiB usable)\n");
}

uint64_t pmm_alloc(void) {
    if (nfree == 0 || nframes == 0 || !bitmap) return 0;
    for (uint64_t scan = 0; scan < nframes; scan++) {
        uint64_t i = hint + scan;
        if (i >= nframes) i -= nframes;
        if (!bit_get(i)) {
            bit_set(i);
            nfree--;
            hint = (i + 1 >= nframes) ? 0 : i + 1;
            uint64_t phys = arena_base + i * PMM_FRAME_SIZE;
            zero_frame(phys);
            return phys;
        }
    }
    return 0;
}

void pmm_free(uint64_t phys) {
    if (!bitmap) return;
    if (phys < arena_base || phys >= arena_top) return;   /* not ours     */
    if (phys & (PMM_FRAME_SIZE - 1)) return;              /* not a frame  */
    uint64_t f = (phys - arena_base) / PMM_FRAME_SIZE;
    if (f >= nframes) return;
    if (!bit_get(f)) return;                              /* double free  */
    bit_clr(f);
    nfree++;
}

uint64_t pmm_frames_total(void) { return nframes; }
uint64_t pmm_frames_free(void)  { return nfree; }
uint64_t pmm_arena_base(void)   { return arena_base; }
uint64_t pmm_arena_top(void)    { return arena_top; }
