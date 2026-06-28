/*
 * Astrion v2.0 — hostile user program (the ring-3 isolation PROOF)
 *
 * A real OS must survive a malicious program. This one runs in ring 3 and
 * deliberately tries to write into kernel memory (physical 1 MiB, where the
 * kernel image lives — identity-mapped supervisor-only, US=0). At CPL 3
 * that store has no right to the page, so the CPU raises a #PF. The kernel's
 * exception handler sees the fault came from ring 3 (CS RPL == 3), KILLS the
 * offending task, prints that isolation held, and keeps running.
 *
 * If isolation were broken, the second message would print and the kernel
 * would be corrupted. It must NOT print. `exec rogue.elf` is the live demo
 * that ring 3 cannot touch the kernel.
 */
#include "astrion_abi.h"

void _start(void) {
    sys_puts("rogue: I am ring 3. Watch me try to scribble on the kernel...\n");

    volatile uint64_t *kernel_mem = (volatile uint64_t *)0x100000ull;  /* kernel @ 1 MiB */
    *kernel_mem = 0xDEADBEEFDEADBEEFull;   /* expect #PF -> the kernel kills me here */

    /* Unreachable if isolation holds. */
    sys_puts("rogue: if you can read this, ISOLATION FAILED.\n");
    sys_exit(1);
}
