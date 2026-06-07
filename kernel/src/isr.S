/*
 * Astrion v2.0 — ISR (Interrupt Service Routine) stubs
 *
 * 32 stubs, one per CPU exception (vectors 0–31). Each stub:
 *   1. Pushes a fake 0 error code if the CPU didn't push one (so the
 *      stack layout is uniform across all 32 vectors).
 *   2. Pushes its own vector number.
 *   3. Jumps to isr_common, which saves all general-purpose registers,
 *      calls the C handler with a pointer to the saved frame, and
 *      returns via iretq.
 *
 * The C handler receives a `struct registers *` matching the order
 * pushed below (last push = first field). See idt.h.
 *
 * CPU pushes an error code for vectors 8, 10, 11, 12, 13, 14, 17, 21,
 * 29, 30. We emit ISR_ERR for those, ISR_NOERR for the rest.
 */

.section .text
.code64

.macro ISR_NOERR vec
.global isr\vec
isr\vec:
    pushq $0                 /* fake error code */
    pushq $\vec              /* vector number */
    jmp isr_common
.endm

.macro ISR_ERR vec
.global isr\vec
isr\vec:
    pushq $\vec              /* CPU already pushed the error code */
    jmp isr_common
.endm

/* ─── Vector table — exceptions 0..31 ─── */
ISR_NOERR 0    /* #DE  divide-by-zero            */
ISR_NOERR 1    /* #DB  debug                     */
ISR_NOERR 2    /* NMI                            */
ISR_NOERR 3    /* #BP  breakpoint                */
ISR_NOERR 4    /* #OF  overflow                  */
ISR_NOERR 5    /* #BR  bound-range exceeded      */
ISR_NOERR 6    /* #UD  invalid opcode            */
ISR_NOERR 7    /* #NM  device not available      */
ISR_ERR   8    /* #DF  double fault              */
ISR_NOERR 9    /* (reserved)                     */
ISR_ERR   10   /* #TS  invalid TSS               */
ISR_ERR   11   /* #NP  segment not present       */
ISR_ERR   12   /* #SS  stack-segment fault       */
ISR_ERR   13   /* #GP  general protection        */
ISR_ERR   14   /* #PF  page fault                */
ISR_NOERR 15   /* (reserved)                     */
ISR_NOERR 16   /* #MF  x87 FPU error             */
ISR_ERR   17   /* #AC  alignment check           */
ISR_NOERR 18   /* #MC  machine check             */
ISR_NOERR 19   /* #XF  SIMD FPU exception        */
ISR_NOERR 20   /* #VE  virtualization            */
ISR_ERR   21   /* #CP  control protection        */
ISR_NOERR 22
ISR_NOERR 23
ISR_NOERR 24
ISR_NOERR 25
ISR_NOERR 26
ISR_NOERR 27
ISR_NOERR 28
ISR_ERR   29   /* #HV  hypervisor injection      */
ISR_ERR   30   /* #VC  VMM communication         */
ISR_NOERR 31

/* ─── Common entry — push GP regs, call C, restore, iretq ─── */
isr_common:
    /* Save GP registers in reverse order so the C struct layout reads
     * "natural" (rax first, r15 last) — see struct registers in idt.h. */
    pushq %r15
    pushq %r14
    pushq %r13
    pushq %r12
    pushq %r11
    pushq %r10
    pushq %r9
    pushq %r8
    pushq %rbp
    pushq %rdi
    pushq %rsi
    pushq %rdx
    pushq %rcx
    pushq %rbx
    pushq %rax

    /* Pass the saved frame to the C handler. */
    mov %rsp, %rdi
    call isr_handler

    /* If isr_handler returns (most exceptions halt, but #BP/#DB can
     * resume), restore registers + unwind error code + vector. */
    popq %rax
    popq %rbx
    popq %rcx
    popq %rdx
    popq %rsi
    popq %rdi
    popq %rbp
    popq %r8
    popq %r9
    popq %r10
    popq %r11
    popq %r12
    popq %r13
    popq %r14
    popq %r15

    addq $16, %rsp           /* drop vector + error code */
    iretq
