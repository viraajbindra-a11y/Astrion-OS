/*
 * Astrion v2.0 — user-program ABI (ring 3)
 *
 * A loaded program runs in RING 3 in its own US=1 memory window. It has
 * no libc and cannot call into the kernel directly — the kernel's pages
 * are supervisor-only and unreachable. The ONLY way across the boundary
 * is the `syscall` instruction, which traps to the kernel at CPL 0.
 *
 * Calling convention (mirrors the Linux x86-64 syscall ABI so the wrappers
 * are trivially correct): number in RAX, args in RDI, RSI, RDX; return in
 * RAX. The kernel preserves all registers except RAX, RCX, R11 (RCX/R11
 * are clobbered by the `syscall` instruction itself). No XMM — programs are
 * built -mno-sse, same as the kernel (a stray SSE op triple-faults).
 *
 * This header is included VERBATIM by both sides. The kernel defines
 * ASTRION_KERNEL before including it (it only wants the SYS_* numbers); a
 * user program includes it plain and gets the inline `syscall` wrappers.
 */
#ifndef ASTRION_ABI_H
#define ASTRION_ABI_H

#include <stdint.h>

#define ASTRION_ABI_VERSION 2u

/* Syscall numbers (RAX). */
#define SYS_PUTS       0u   /* (const char *s)  print a NUL-terminated string */
#define SYS_PUTCHAR    1u   /* (char c)         print one character           */
#define SYS_PUT_U32    2u   /* (uint32_t v)     print an unsigned decimal      */
#define SYS_GETKEY     3u   /* () -> int        non-blocking key; 0 if none    */
#define SYS_UPTIME_MS  4u   /* () -> uint64     milliseconds since boot        */
#define SYS_YIELD      5u   /* ()               cooperatively give up the CPU  */
#define SYS_EXIT       6u   /* (uint64 code)    terminate; never returns       */

#ifndef ASTRION_KERNEL

static inline uint64_t __syscall0(uint64_t n) {
    uint64_t ret;
    __asm__ volatile("syscall" : "=a"(ret) : "a"(n) : "rcx", "r11", "memory");
    return ret;
}
static inline uint64_t __syscall1(uint64_t n, uint64_t a1) {
    uint64_t ret;
    __asm__ volatile("syscall" : "=a"(ret) : "a"(n), "D"(a1) : "rcx", "r11", "memory");
    return ret;
}

static inline void     sys_puts(const char *s)  { __syscall1(SYS_PUTS, (uint64_t)(uintptr_t)s); }
static inline void     sys_putchar(char c)      { __syscall1(SYS_PUTCHAR, (uint64_t)(unsigned char)c); }
static inline void     sys_put_u32(uint32_t v)  { __syscall1(SYS_PUT_U32, (uint64_t)v); }
static inline int      sys_getkey(void)         { return (int)__syscall0(SYS_GETKEY); }
static inline uint64_t sys_uptime_ms(void)      { return __syscall0(SYS_UPTIME_MS); }
static inline void     sys_yield(void)          { __syscall0(SYS_YIELD); }
static inline void     sys_exit(uint64_t code)  { __syscall1(SYS_EXIT, code); for (;;) {} }

#endif /* !ASTRION_KERNEL */
#endif /* ASTRION_ABI_H */
