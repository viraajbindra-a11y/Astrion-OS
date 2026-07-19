/*
 * Astrion v2.0 — peek: the READER half of the visible isolation proof (RING 3)
 *
 * Pairs with poke.elf. Run this WHILE poke is still holding (between poke's
 * "HOLD WINDOW OPEN" and "HOLD WINDOW CLOSED" lines) and it reads the exact
 * same virtual address poke just wrote a sentinel to.
 *
 * It must find ZERO. Not because the value was cleaned up — poke is still
 * running and still holding it — but because this is a DIFFERENT process with
 * a different CR3, and that virtual address resolves to a different physical
 * frame. Two programs, one address, nothing shared.
 *
 * peek reports what it actually finds, including the failures. If it ever
 * prints poke's sentinel, per-process isolation is genuinely broken and that
 * is the single most important bug this tree could have. A demo program that
 * can only print success isn't a proof, it's a poster.
 */
#include "astrion_abi.h"

/* ── The contract with poke.elf. These three lines are duplicated, verbatim,
 * in progs/poke.c. They MUST match — the whole demo is "the same address".
 * Both programs print the address they used, so a divergence is visible on
 * screen the moment it happens rather than quietly faking a pass. ── */
#define SCRATCH_VA     0x2000006000ull   /* USER_VA_BASE + 24 KiB */
#define SCRATCH_WORDS  4096u             /* 32 KiB of zeroed .bss  */
#define SENTINEL       0xDEADBEEFull

/* The same reserved region poke has, at the same size, so SCRATCH_VA is
 * mapped, zero-filled and clear of our code and data here too. peek never
 * writes to it — it only proves the address is legitimately its own. Not
 * page-aligned, for the same reason as poke: an aligned(4096) .bss becomes its
 * own bss-only PT_LOAD whose p_offset sits past the last real file byte, and
 * elf.c checks every p_offset against the file length. */
static volatile uint64_t scratch[SCRATCH_WORDS] __attribute__((used));

/* ── tiny hex printers (the ABI only gives us decimal) ── */
static const char HEXD[] = "0123456789ABCDEF";

/* Fixed 16 digits — for addresses, so poke's and peek's line up on screen. */
static void put_hex64(uint64_t v) {
    char buf[19];
    buf[0] = '0'; buf[1] = 'x';
    for (int i = 0; i < 16; i++) buf[2 + i] = HEXD[(v >> (60 - 4 * i)) & 0xFull];
    buf[18] = 0;
    sys_puts(buf);
}

/* No leading zeros — for values, so an empty page reads as a plain "0x0"
 * instead of a wall of sixteen zeros nobody can count from the back row. */
static void put_hex(uint64_t v) {
    char buf[19];
    int i = 18;
    buf[i] = 0;
    if (v == 0) buf[--i] = '0';
    else while (v) { buf[--i] = HEXD[v & 0xFull]; v >>= 4; }
    buf[--i] = 'x';
    buf[--i] = '0';
    sys_puts(&buf[i]);
}

/* Is SCRATCH_VA really inside our own reserved array? Written wrap-safe
 * (`va > hi - 8`, never `va + 8 > hi`) like every bound in this tree. If this
 * ever fails the linker moved things and the read would be meaningless — say
 * so and stop, rather than report a number that proves nothing. */
static int bounds_ok(void) {
    uint64_t lo = (uint64_t)(uintptr_t)&scratch[0];
    uint64_t hi = lo + sizeof(scratch);          /* exclusive; >= lo + 32 KiB */
    return SCRATCH_VA >= lo && SCRATCH_VA <= hi - 8;
}

static uint64_t entry(void) {
    if (!bounds_ok()) {
        sys_puts("peek: SCRATCH_VA is outside my own scratch array - build bug.\n");
        sys_puts("peek: refusing to report. (my array starts at ");
        put_hex64((uint64_t)(uintptr_t)&scratch[0]);
        sys_puts(")\n");
        return 1;
    }

    sys_puts("peek: ring 3. reading ");
    put_hex64(SCRATCH_VA);
    sys_puts(" - the SAME address poke wrote.\n");

    volatile uint64_t *p = (volatile uint64_t *)(uintptr_t)SCRATCH_VA;
    uint64_t v = *p;

    sys_puts("peek: it holds ");
    put_hex(v);
    sys_puts("\n");

    if (v == 0) {
        sys_puts("peek: ZERO. poke's ");
        put_hex(SENTINEL);
        sys_puts(" is not here.\n");
        sys_puts("peek: this page is mine alone - I cannot see another program's memory.\n");
        return 0;
    }
    if (v == SENTINEL) {
        sys_puts("peek: *** THAT IS POKE'S SENTINEL. ISOLATION FAILED. ***\n");
        return 1;
    }
    sys_puts("peek: NOT zero and not poke's value - unexpected, investigate.\n");
    return 1;
}

void _start(void) { sys_exit(entry()); }
