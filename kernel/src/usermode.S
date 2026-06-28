/*
 * Astrion v2.0 — ring-3 transition + syscall asm (see gdt.c / syscall.c)
 *
 * Four routines:
 *   gdt_flush(rdi=&gdtr)            lgdt + reload data segs + far-reload CS
 *   tss_flush(di=selector)         ltr
 *   syscall_entry                  LSTAR target: ring3 `syscall` lands here
 *   enter_user(rdi=rip, rsi=rsp)   iretq down to ring 3 (never returns)
 *
 * SYSCALL semantics we rely on (all enforced by the MSRs in syscall.c):
 *   - on entry rcx=user RIP, r11=user RFLAGS, IF already cleared (FMASK),
 *     RSP is STILL the user RSP (syscall does NOT switch stacks).
 *   - sysretq (REX.W — NOT bare sysret, which returns to 32-bit compat)
 *     restores RIP from rcx, RFLAGS from r11, CS/SS from STAR at RPL 3.
 *
 * The stub switches to the per-task kernel stack (tss_kernel_rsp, kept in
 * sync with tss.rsp0 by the scheduler), saves the user return context on
 * THAT stack, and only then re-enables interrupts — so a preemption or a
 * SYS_YIELD reschedule mid-syscall finds the user context safely parked on
 * the task's own kernel stack. The global scratch is touched only in the
 * IF=0 prologue, so it can't be clobbered cross-task.
 */

.section .text
.code64

/* ── void gdt_flush(uint64_t gdtr_addr) ── */
.global gdt_flush
gdt_flush:
    lgdt (%rdi)
    movw $0x10, %ax          /* kernel data selector */
    movw %ax, %ds
    movw %ax, %es
    movw %ax, %ss
    movw %ax, %fs
    movw %ax, %gs
    leaq 1f(%rip), %rax      /* reload CS via far return to 0x08:1f */
    pushq $0x08
    pushq %rax
    lretq
1:  ret

/* ── void tss_flush(uint16_t selector) ── */
.global tss_flush
tss_flush:
    movw %di, %ax
    ltr %ax
    ret

/* ── syscall_entry (MSR LSTAR) ──
 * rax=number, rdi/rsi/rdx=args; rcx=user RIP, r11=user RFLAGS; RSP=user. */
.global syscall_entry
syscall_entry:
    movq %rsp, scratch_user_rsp(%rip)   /* stash user RSP (IF=0, single-CPU: safe) */
    movq tss_kernel_rsp(%rip), %rsp      /* switch to this task's kernel stack */
    pushq scratch_user_rsp(%rip)         /* save user RSP   */
    pushq %rcx                           /* save user RIP   */
    pushq %r11                           /* save user RFLAGS */
    pushq %rdi                           /* preserve user caller-saved regs across */
    pushq %rsi                           /* the C call. The ABI promises we touch   */
    pushq %rdx                           /* only RAX/RCX/R11; syscall_dispatch (SysV)*/
    pushq %r8                            /* would otherwise scribble r8/r9/r10.      */
    pushq %r9
    pushq %r10
    sti                                  /* user context parked -> dispatch is preemptible */

    /* marshal SYSCALL(rax,rdi,rsi,rdx) -> C dispatch(no,a1,a2,a3 = rdi,rsi,rdx,rcx) */
    movq %rdx, %rcx
    movq %rsi, %rdx
    movq %rdi, %rsi
    movq %rax, %rdi
    call syscall_dispatch                /* return value in rax */

    cli                                  /* epilogue must be atomic vs. preemption */
    popq %r10
    popq %r9
    popq %r8
    popq %rdx
    popq %rsi
    popq %rdi
    popq %r11                            /* user RFLAGS (restores IF=1 in ring 3) */
    popq %rcx                            /* user RIP */
    popq %rsp                            /* user RSP */
    sysretq

/* ── void enter_user(uint64_t rip, uint64_t user_rsp) ── drops to ring 3 ── */
.global enter_user
enter_user:
    cli
    pushq $0x1B          /* SS  = user data | RPL 3 */
    pushq %rsi           /* RSP = user stack top    */
    pushq $0x202         /* RFLAGS: IF=1, reserved bit1=1, IOPL=0 */
    pushq $0x23          /* CS  = user code | RPL 3 */
    pushq %rdi           /* RIP = program entry     */
    /* Scrub GP regs so no kernel value leaks across the privilege drop. */
    xorq %rax, %rax
    xorq %rbx, %rbx
    xorq %rcx, %rcx
    xorq %rdx, %rdx
    xorq %rsi, %rsi
    xorq %rdi, %rdi
    xorq %rbp, %rbp
    xorq %r8,  %r8
    xorq %r9,  %r9
    xorq %r10, %r10
    xorq %r11, %r11
    xorq %r12, %r12
    xorq %r13, %r13
    xorq %r14, %r14
    xorq %r15, %r15
    iretq

.section .bss
.align 8
scratch_user_rsp:
    .skip 8
