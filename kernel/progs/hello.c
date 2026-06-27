/*
 * Astrion v2.0 — sample user program
 *
 * Compiled SEPARATELY from the kernel into a freestanding ELF64 PIE,
 * embedded into the kernel image as a byte array, and seeded into the
 * filesystem as /hello.elf at boot. `exec hello.elf` reads those bytes
 * back out of the file node, the kernel's ELF loader parses + loads +
 * relocates them, and calls entry() here as a preemptible task.
 *
 * This program links against NOTHING in the kernel — it reaches every
 * service through the syscall table it receives at entry. That's what
 * makes it a real loaded program and not a compiled-in function.
 *
 * Constraints (mirror the kernel): no libc, no SSE, no globals, no big
 * stack arrays. Keep it small + leaf-ish.
 */

#include "astrion_abi.h"

uint64_t entry(const astrion_syscalls *sys) {
    /* Refuse to run against an ABI we don't understand. */
    if (sys->abi_version != ASTRION_ABI_VERSION) return 1;

    sys->puts("Hello from a real ELF, loaded from /hello.elf!\n");
    sys->puts("I am a separate program the kernel parsed + relocated.\n");

    sys->puts("uptime when I started: ");
    sys->put_u32((uint32_t)sys->uptime_ms());
    sys->puts(" ms\n");

    /* Tiny loop that yields — proves a loaded program can run cooperatively
     * (and, since it runs as a task, is preemptible too). Counts to 5. */
    for (uint32_t i = 1; i <= 5; i++) {
        sys->puts("  tick ");
        sys->put_u32(i);
        sys->putchar('\n');
        sys->yield();
    }

    sys->puts("goodbye.\n");
    return 0;   /* exit code, surfaced by the shell */
}
