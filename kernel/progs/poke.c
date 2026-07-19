/*
 * Astrion v2.0 — poke: the WRITER half of the visible isolation proof (RING 3)
 *
 * Pairs with peek.elf. Together they turn "each process has its own address
 * space" from a claim into something an audience can watch happen:
 *
 *   poke writes a sentinel to a fixed virtual address inside its OWN space,
 *   then stays alive. peek — a different process, its own CR3 — reads the
 *   SAME virtual address and finds ZERO. One address, two programs, and
 *   nothing crosses between them.
 *
 * Two things make this an honest demo rather than a rigged one, and both are
 * load-bearing:
 *
 *   1. WHERE we write. SCRATCH_VA must be mapped in both programs, must be
 *      writable, and must NOT sit under either program's code or data — if it
 *      did, peek would read its own instructions instead of a clean page and
 *      the "zero" would mean nothing. So both programs reserve the same 32 KiB
 *      zero-filled .bss array and aim at an address deep inside it. exec maps
 *      [USER_VA_BASE, image + 16 KiB stack) contiguously, so anything inside
 *      our own .bss is guaranteed backed. bounds_ok() re-checks that at run
 *      time and refuses to print a result it can't stand behind.
 *
 *   2. WHEN peek runs. poke must still be ALIVE. If poke exited first, its
 *      frames would go back to the pmm and peek would be handed a recycled
 *      zeroed frame — that demonstrates frame-wiping, not isolation, and it is
 *      a different (weaker) claim. So poke holds for HOLD_MS, and prints an
 *      explicit OPEN and CLOSED marker around that window: a peek that lands
 *      after the CLOSED line proves nothing, and the transcript says so.
 *
 * Everything here goes through `syscall`. This program links against nothing.
 */
#include "astrion_abi.h"

/* ── The contract with peek.elf. These three lines are duplicated, verbatim,
 * in progs/peek.c. They MUST match — the whole demo is "the same address".
 * Both programs print the address they used, so a divergence is visible on
 * screen the moment it happens rather than quietly faking a pass. ── */
#define SCRATCH_VA     0x2000006000ull   /* USER_VA_BASE + 24 KiB */
#define SCRATCH_WORDS  4096u             /* 32 KiB of zeroed .bss  */
#define SENTINEL       0xDEADBEEFull

#define HOLD_MS        30000u   /* how long poke keeps its space alive */
#define SPIN_ITERS     500000u  /* throttle between yields (~ms), not a timebase */

/* The reserved scratch region. Big enough that SCRATCH_VA lands well inside it
 * under any linker layout: everything ahead of it (code + rodata + data) is
 * ~12 KiB, so the array starts far below SCRATCH_VA and still runs 32 KiB past
 * it. `used` keeps it from being optimised away — nothing reads it by name.
 *
 * Deliberately NOT page-aligned. An aligned(4096) .bss gets its own bss-only
 * PT_LOAD, whose p_offset points past the last real file byte; elf.c validates
 * every segment's p_offset against the file length, and whether that passes
 * then depends on how much symtab happens to trail the image. Left at natural
 * alignment it stays inside the normal RW segment and the question never
 * arises. */
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
 * ever fails the linker moved things and the demo would be lying — say so and
 * stop, rather than write into whatever is actually there. */
static int bounds_ok(void) {
    uint64_t lo = (uint64_t)(uintptr_t)&scratch[0];
    uint64_t hi = lo + sizeof(scratch);          /* exclusive; >= lo + 32 KiB */
    return SCRATCH_VA >= lo && SCRATCH_VA <= hi - 8;
}

static uint64_t entry(void) {
    if (!bounds_ok()) {
        sys_puts("poke: SCRATCH_VA is outside my own scratch array - build bug.\n");
        sys_puts("poke: refusing to write. (my array starts at ");
        put_hex64((uint64_t)(uintptr_t)&scratch[0]);
        sys_puts(")\n");
        return 1;
    }

    sys_puts("poke: ring 3. writing a sentinel into MY OWN private memory.\n");

    volatile uint64_t *p = (volatile uint64_t *)(uintptr_t)SCRATCH_VA;
    *p = SENTINEL;

    sys_puts("poke: wrote ");
    put_hex(SENTINEL);
    sys_puts(" at ");
    put_hex64(SCRATCH_VA);
    sys_puts("\n");
    sys_puts("poke: HOLD WINDOW OPEN - run 'exec peek.elf' now (30s).\n");

    /* Stay alive so peek runs against a LIVE address space, not a freed one.
     * Bounded by the clock, not by the loop count, so it holds for the same
     * wall time on any machine. We yield between spins: the scheduler is
     * preemptive either way, but yielding keeps the shell crisp while the
     * presenter types. */
    volatile uint64_t spin = 0;
    uint64_t t0 = sys_uptime_ms();
    for (;;) {
        if (sys_uptime_ms() - t0 >= HOLD_MS) break;
        for (uint32_t i = 0; i < SPIN_ITERS; i++) spin++;
        sys_yield();
    }

    /* Re-read live, after peek has been and gone. This is the other half of
     * the proof: peek's zero is not because the value vanished — it is still
     * right here, in poke's space, untouched. */
    uint64_t mine = *p;
    sys_puts("poke: re-read ");
    put_hex64(SCRATCH_VA);
    sys_puts(" -> ");
    put_hex(mine);
    if (mine == SENTINEL) sys_puts(" (still mine, untouched)\n");
    else                  sys_puts(" (UNEXPECTED - my own value changed!)\n");

    sys_puts("poke: HOLD WINDOW CLOSED - a peek after this line proves nothing.\n");
    return mine == SENTINEL ? 0 : 1;
}

void _start(void) { sys_exit(entry()); }
