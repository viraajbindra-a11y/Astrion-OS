/*
 * Astrion v2.0 — ring-3 file I/O demo.
 *
 * Runs in CPL 3, isolated from the kernel, and does real filesystem I/O
 * ONLY through the `syscall` boundary: it writes a file, reads it back into
 * its own memory, and prints what it read. Proof that an untrusted userspace
 * program can persist data without ever touching kernel memory directly.
 */
#include "astrion_abi.h"

static char rbuf[256];

static uint64_t entry(void) {
    const char *msg = "hello from a ring-3 program, saved via syscall\n";
    int n = 0;
    while (msg[n]) n++;

    int w = sys_write_file("ring3.txt", msg, (uint32_t)n);
    if (w < 0) { sys_puts("iodemo: write failed\n"); return 1; }
    sys_puts("iodemo: wrote ring3.txt (");
    sys_put_u32((uint32_t)w);
    sys_puts(" bytes)\n");

    int r = sys_read_file("ring3.txt", rbuf, (uint32_t)(sizeof(rbuf) - 1));
    if (r < 0) { sys_puts("iodemo: read failed\n"); return 1; }
    rbuf[r] = 0;
    sys_puts("iodemo: read it back -> ");
    sys_puts(rbuf);
    return 0;
}

void _start(void) { sys_exit(entry()); }
