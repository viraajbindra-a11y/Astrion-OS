/*
 * Astrion v2.0 — sample user program (RING 3)
 *
 * Compiled separately into a freestanding ELF64 PIE, embedded in the
 * kernel, and seeded as /hello.elf. `exec hello.elf` loads it into the
 * US=1 user window and drops to ring 3 at _start. From there it reaches
 * the kernel ONLY through the `syscall` instruction — it links against
 * nothing and cannot touch kernel memory.
 *
 * _start is the ELF entry point (the loader jumps here). It calls entry()
 * and then sys_exit() — a ring-3 program can't just `ret` into the void,
 * so the exit syscall is how it hands control (and its code) back.
 */
#include "astrion_abi.h"

static uint64_t entry(void) {
    sys_puts("Hello from RING 3 - a real user-mode program!\n");
    sys_puts("I run at CPL 3 and can only reach the kernel via `syscall`.\n");

    sys_puts("uptime when I started: ");
    sys_put_u32((uint32_t)sys_uptime_ms());
    sys_puts(" ms\n");

    /* Loop that yields: proves a ring-3 task is scheduled cooperatively
     * (and, since it runs preemptibly, the timer can deschedule it too). */
    for (uint32_t i = 1; i <= 5; i++) {
        sys_puts("  tick ");
        sys_put_u32(i);
        sys_putchar('\n');
        sys_yield();
    }

    sys_puts("goodbye from ring 3.\n");
    return 0;
}

void _start(void) {
    sys_exit(entry());
}
