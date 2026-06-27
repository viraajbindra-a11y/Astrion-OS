/*
 * Astrion v2.0 — user-program ABI
 *
 * Included VERBATIM by both the kernel (the loader fills the table) and
 * every user program (it receives a pointer to the table at entry). This
 * is the single seam between a loaded program and the kernel: a program
 * has no libc, so the only way it reaches kernel services is through
 * these function pointers.
 *
 * Calling convention: SysV AMD64. The entry point takes one pointer
 * argument (lands in RDI) and returns a uint64 exit code (RAX). Every
 * arg + return is integer/pointer, so only general-purpose registers are
 * used — no XMM — which is required because the kernel + programs are
 * built -mno-sse (a stray SSE op would triple-fault; lesson #196).
 */

#ifndef ASTRION_ABI_H
#define ASTRION_ABI_H

#include <stdint.h>

#define ASTRION_ABI_VERSION 1u

typedef struct astrion_syscalls {
    uint32_t abi_version;            /* loader sets = ASTRION_ABI_VERSION; program checks */
    uint32_t reserved;               /* pad so the pointers below are 8-aligned */
    void     (*puts)(const char *s); /* print a NUL-terminated string to the console */
    void     (*putchar)(char c);     /* print one character */
    void     (*put_u32)(uint32_t v); /* print an unsigned decimal */
    int      (*getkey)(void);        /* non-blocking key read; 0 if none pending */
    uint64_t (*uptime_ms)(void);     /* milliseconds since boot */
    void     (*yield)(void);         /* cooperatively give up the CPU (loops should call) */
} astrion_syscalls;

/* The entry point every Astrion program exports as `entry`. */
typedef uint64_t (*astrion_entry)(const astrion_syscalls *sys);

#endif /* ASTRION_ABI_H */
