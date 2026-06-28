/*
 * Astrion v2.0 — GDT + TSS + syscall MSR setup (ring-3 support)
 *
 * The boot GDT (boot/multiboot2.S) has only null + one ring-0 code
 * segment. To run user programs in ring 3 we need: a kernel data
 * segment, ring-3 code + data segments (DPL 3), and a Task State
 * Segment whose RSP0 the CPU loads on every ring3->ring0 transition
 * (syscall is the exception — it keeps the user RSP; the syscall stub
 * switches stacks in software using the same value, mirrored in
 * tss_kernel_rsp).
 *
 * gdt_install() rebuilds the GDT in C (the TSS base is only known at
 * runtime), reloads the segment registers, and LTRs the TSS.
 * tss_set_rsp0() is called by the scheduler on every switch-in so the
 * incoming task's kernel stack is the one the CPU uses when that task
 * next faults / is preempted / syscalls from ring 3.
 */
#ifndef ASTRION_GDT_H
#define ASTRION_GDT_H

#include <stdint.h>

/* Selector values (also hard-coded in usermode.S / syscall MSRs). */
#define SEL_KCODE 0x08u
#define SEL_KDATA 0x10u
#define SEL_UDATA 0x18u   /* | 3 = 0x1B at ring 3 */
#define SEL_UCODE 0x20u   /* | 3 = 0x23 at ring 3 */
#define SEL_TSS   0x28u

void gdt_install(void);            /* build GDT+TSS, lgdt, reload segs, ltr */
void tss_set_rsp0(uint64_t rsp0);  /* scheduler hook: per-task kernel stack */

#endif
