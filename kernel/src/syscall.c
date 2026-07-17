/*
 * Astrion v2.0 — syscall dispatch (see syscall.h).
 *
 * Every pointer a user program hands us is UNTRUSTED: it runs in ring 3
 * and could pass a kernel address hoping the CPL-0 kernel will dereference
 * it (info leak / crash). validate_user_range() rejects anything outside
 * the user window BEFORE we touch it, and string reads are bounded to the
 * window so a non-terminated string can't walk the kernel off a cliff.
 */
#include <stdint.h>

#define ASTRION_KERNEL 1          /* don't pull the user-side inline syscall wrappers */
#include "astrion_abi.h"
#include "syscall.h"
#include "usermem.h"
#include "fs.h"

extern void serial_puts_x(const char *s);
extern void console_puts(const char *s);
extern void console_putchar(char c);
extern void console_put_u32(uint32_t v);
extern void console_set_color(uint32_t rgb);
extern char kbd_getchar(void);
extern uint64_t pit_elapsed_ms(void);
extern void task_yield(void);
extern void task_exit(void);
extern const char *task_current_name(void);

extern void syscall_entry(void);  /* usermode.S — LSTAR target */

static inline void wrmsr(uint32_t msr, uint64_t val) {
    uint32_t lo = (uint32_t)val, hi = (uint32_t)(val >> 32);
    __asm__ volatile("wrmsr" :: "c"(msr), "a"(lo), "d"(hi));
}
static inline uint64_t rdmsr(uint32_t msr) {
    uint32_t lo, hi;
    __asm__ volatile("rdmsr" : "=a"(lo), "=d"(hi) : "c"(msr));
    return ((uint64_t)hi << 32) | lo;
}

#define IA32_EFER  0xC0000080u
#define IA32_STAR  0xC0000081u
#define IA32_LSTAR 0xC0000082u
#define IA32_FMASK 0xC0000084u

#define MAX_SYSCALL_LEN 65536ull   /* cap on any single user buffer (matches usermem) */

void syscall_init(void) {
    wrmsr(IA32_EFER, rdmsr(IA32_EFER) | 1u);                 /* SCE: enable syscall */
    /* STAR[47:32]=0x08 -> syscall CS=0x08, SS=0x10 (kernel).
     * STAR[63:48]=0x10 -> sysret  CS=0x20|3, SS=0x18|3 (user). */
    wrmsr(IA32_STAR, ((uint64_t)0x10 << 48) | ((uint64_t)0x08 << 32));
    wrmsr(IA32_LSTAR, (uint64_t)(uintptr_t)syscall_entry);
    /* Clear TF|IF|DF|NT|AC on entry. IF (0x200) is load-bearing: it makes
     * the stack switch in the stub atomic vs. preemption. */
    wrmsr(IA32_FMASK, 0x47700ull);
    serial_puts_x("SYSCALL: SCE on; STAR/LSTAR/FMASK programmed\n");
}

/* Bounded print of a user string: validate the pointer, then copy at most
 * (window_end - ptr) bytes, stopping at NUL. A string with no NUL inside
 * the window simply prints up to the boundary and stops — never a kernel
 * page fault. */
static void sys_puts_user(uint64_t uptr) {
    if (!validate_user_range(uptr, 1)) return;
    const char *p = (const char *)(uintptr_t)uptr;
    uint64_t max = usermem_window_end() - uptr;
    if (max > 65536ull) max = 65536ull;
    for (uint64_t i = 0; i < max; i++) {
        char c = p[i];
        if (!c) break;
        console_putchar(c);
    }
}

/* Copy a user-supplied filename into a kernel buffer. Validates the pointer is
 * inside the user window, then copies at most (window_end - ptr) bytes, capped
 * to the buffer, stopping at NUL. Always NUL-terminates. Returns 0 if the
 * pointer is outside the window. Wrap-safe (never computes ptr+len). */
static int copy_user_name(uint64_t uptr, char *out, int outcap) {
    if (outcap <= 0) return 0;
    if (!validate_user_range(uptr, 1)) { out[0] = 0; return 0; }
    const char *p = (const char *)(uintptr_t)uptr;
    uint64_t max = usermem_window_end() - uptr;   /* uptr <= end (validated) */
    if (max > (uint64_t)(outcap - 1)) max = (uint64_t)(outcap - 1);
    int i = 0;
    for (; i < (int)max; i++) { char c = p[i]; out[i] = c; if (!c) return 1; }
    out[i] = 0;
    return 1;
}

/* SYS_READ_FILE: copy up to `cap` bytes of file `name` into user `buf`. The
 * kernel (CPL 0) can read the US=1 user pages once the range is validated.
 *
 * `name` may be a path ("/a/b.txt"); a relative one resolves against the
 * shell's cwd, exactly like a program launched from that directory would
 * expect. The buffer is FS_PATH_MAX so a legal path can't be silently
 * truncated into a DIFFERENT legal path. */
static uint64_t sys_read_file(uint64_t name_ptr, uint64_t buf_ptr, uint64_t cap) {
    char name[FS_PATH_MAX + 1];
    if (!copy_user_name(name_ptr, name, sizeof(name)))       return (uint64_t)-1;
    if (cap > MAX_SYSCALL_LEN) cap = MAX_SYSCALL_LEN;
    if (!validate_user_range(buf_ptr, cap))                  return (uint64_t)-1;
    fs_node *n = fs_find(name);
    if (!n || n->kind != FS_FILE)                            return (uint64_t)-1;
    uint32_t k = n->size;
    if ((uint64_t)k > cap) k = (uint32_t)cap;
    uint8_t *dst = (uint8_t *)(uintptr_t)buf_ptr;
    for (uint32_t i = 0; i < k; i++) dst[i] = n->data[i];
    return k;
}

/* SYS_WRITE_FILE: write `len` bytes of user `buf` to file `name` (created if
 * absent), then persist. Validates the whole user range before reading it. */
static uint64_t sys_write_file(uint64_t name_ptr, uint64_t buf_ptr, uint64_t len) {
    char name[FS_PATH_MAX + 1];
    if (!copy_user_name(name_ptr, name, sizeof(name)))       return (uint64_t)-1;
    if (len > MAX_SYSCALL_LEN)                               return (uint64_t)-1;
    if (!validate_user_range(buf_ptr, len))                  return (uint64_t)-1;
    int rc = fs_write(name, (const uint8_t *)(uintptr_t)buf_ptr, (uint32_t)len);
    if (rc < 0)                                              return (uint64_t)-1;
    fs_sync();
    return (uint64_t)rc;
}

uint64_t syscall_dispatch(uint64_t no, uint64_t a1, uint64_t a2, uint64_t a3) {
    switch (no) {
    case SYS_PUTS:      sys_puts_user(a1);                    return 0;
    case SYS_PUTCHAR:   console_putchar((char)(a1 & 0xFF));   return 0;
    case SYS_PUT_U32:   console_put_u32((uint32_t)a1);        return 0;
    case SYS_GETKEY:    return (uint64_t)(unsigned char)kbd_getchar();
    case SYS_UPTIME_MS: return pit_elapsed_ms();
    case SYS_YIELD:     task_yield();                         return 0;
    case SYS_READ_FILE:  return sys_read_file(a1, a2, a3);
    case SYS_WRITE_FILE: return sys_write_file(a1, a2, a3);
    case SYS_EXIT:
        console_set_color(0x34D399u);
        console_puts("\nexec: ");
        console_set_color(0xFFFFFFu);
        console_puts(task_current_name());
        console_puts(" exited (code ");
        console_put_u32((uint32_t)a1);
        console_puts(")\n");
        task_exit();          /* marks task DONE, schedules away — never returns */
        return 0;             /* not reached */
    default:
        return (uint64_t)-1;  /* unknown syscall */
    }
}
