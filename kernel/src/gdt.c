/*
 * Astrion v2.0 — GDT + TSS builder (see gdt.h for the why).
 *
 * GDT layout (the order is MANDATORY for SYSCALL/SYSRET selector math):
 *   [0] 0x00 null
 *   [1] 0x08 kernel code64  DPL0   0x00AF9A000000FFFF
 *   [2] 0x10 kernel data    DPL0   0x00CF92000000FFFF
 *   [3] 0x18 user data      DPL3   0x00CFF2000000FFFF
 *   [4] 0x20 user code64    DPL3   0x00AFFA000000FFFF
 *   [5..6] 0x28 TSS (16-byte system descriptor)
 * SYSRET computes user CS = STAR[63:48]+16 and SS = +8 (RPL forced to 3),
 * so user-data MUST sit 8 below user-code; SYSCALL loads CS=STAR[47:32],
 * SS=+8, so kernel-data MUST sit 8 above kernel-code. This order satisfies
 * both with STAR base nibble 0x10 (see syscall.c).
 */
#include <stdint.h>
#include "gdt.h"

extern void serial_puts_x(const char *s);
extern void gdt_flush(uint64_t gdt_ptr_addr);  /* usermode.S: lgdt + reload */
extern void tss_flush(uint16_t sel);           /* usermode.S: ltr */

struct gdt_ptr { uint16_t limit; uint64_t base; } __attribute__((packed));

/* 7 qwords: null, kcode, kdata, udata, ucode, tss_lo, tss_hi. */
static uint64_t gdt[7];

/* Long-mode TSS. Only rsp0 + ist1 are used. MUST be packed — an unpacked
 * struct shifts every field by the natural alignment padding, so ltr would
 * load garbage as rsp0 and the first ring3->ring0 transition triple-faults. */
struct tss64 {
    uint32_t reserved0;
    uint64_t rsp0;
    uint64_t rsp1;
    uint64_t rsp2;
    uint64_t reserved1;
    uint64_t ist1, ist2, ist3, ist4, ist5, ist6, ist7;
    uint64_t reserved2;
    uint16_t reserved3;
    uint16_t iopb;          /* == sizeof(tss) -> no I/O permission bitmap */
} __attribute__((packed));

static struct tss64 tss;

/* Dedicated stacks for NMI / #DF / #MC — so those (which ignore IF) never
 * land on the half-switched user RSP in the sysret window. Each gets its OWN
 * IST slot + stack because IST is not re-entrant: routing all three to one
 * stack means a #MC during an NMI (etc.) would reload the same RSP and
 * overwrite the first frame. */
static uint8_t ist1_stack[4096] __attribute__((aligned(16)));   /* NMI  (vec 2)  */
static uint8_t ist2_stack[4096] __attribute__((aligned(16)));   /* #DF  (vec 8)  */
static uint8_t ist3_stack[4096] __attribute__((aligned(16)));   /* #MC  (vec 18) */

/* Mirror of tss.rsp0 read by the syscall asm stub (syscall does NOT load
 * the TSS automatically; the stub switches stacks in software). */
uint64_t tss_kernel_rsp;

void tss_set_rsp0(uint64_t rsp0) {
    tss.rsp0 = rsp0;
    tss_kernel_rsp = rsp0;
}

/* 16-byte system descriptor (TSS) spanning gdt[idx], gdt[idx+1]. */
static void set_tss_desc(int idx, uint64_t base, uint32_t limit) {
    uint64_t low = 0;
    low |= (limit & 0xFFFFull);
    low |= (base & 0xFFFFFFull) << 16;
    low |= (uint64_t)0x89 << 40;                  /* P=1,DPL=0,type=9 (64-bit TSS) */
    low |= ((uint64_t)(limit >> 16) & 0xF) << 48; /* G=0 -> byte granularity */
    low |= ((base >> 24) & 0xFFull) << 56;
    gdt[idx]     = low;
    gdt[idx + 1] = (base >> 32) & 0xFFFFFFFFull;
}

void gdt_install(void) {
    gdt[0] = 0;
    gdt[1] = 0x00AF9A000000FFFFull;   /* kernel code64 DPL0 */
    gdt[2] = 0x00CF92000000FFFFull;   /* kernel data   DPL0 */
    gdt[3] = 0x00CFF2000000FFFFull;   /* user data     DPL3 */
    gdt[4] = 0x00AFFA000000FFFFull;   /* user code64   DPL3 */
    set_tss_desc(5, (uint64_t)(uintptr_t)&tss, sizeof(struct tss64) - 1);

    tss.rsp0 = 0;                                            /* set per-task by scheduler */
    tss.ist1 = (uint64_t)(uintptr_t)(ist1_stack + sizeof(ist1_stack));   /* NMI  */
    tss.ist2 = (uint64_t)(uintptr_t)(ist2_stack + sizeof(ist2_stack));   /* #DF  */
    tss.ist3 = (uint64_t)(uintptr_t)(ist3_stack + sizeof(ist3_stack));   /* #MC  */
    tss.iopb = sizeof(struct tss64);
    tss_kernel_rsp = 0;

    static struct gdt_ptr gp;
    gp.limit = sizeof(gdt) - 1;
    gp.base  = (uint64_t)(uintptr_t)gdt;
    gdt_flush((uint64_t)(uintptr_t)&gp);
    tss_flush(SEL_TSS);
    serial_puts_x("GDT: reloaded (kcode/kdata/ucode/udata + TSS), TR loaded\n");
}
