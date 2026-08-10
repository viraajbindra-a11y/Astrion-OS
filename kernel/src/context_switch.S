/*
 * Astrion v2.0 — Cooperative context switch
 *
 * void context_switch(uint64_t *save_rsp_here, uint64_t load_rsp,
 *                     void *save_fx, void *load_fx);
 *   rdi = where to store the outgoing task's stack pointer
 *   rsi = the incoming task's saved stack pointer
 *   rdx = outgoing task's 512-byte FXSAVE area (16-byte aligned)
 *   rcx = incoming task's 512-byte FXSAVE area (16-byte aligned)
 *
 * SysV ABI: rbx, rbp, r12-r15 are callee-saved — they're the only
 * registers that must survive a function call, so they're the only
 * ones we push. Everything else (rax, rcx, rdx, rsi, rdi, r8-r11)
 * is caller-saved; the C compiler already spilled anything it needs
 * around the call to this function.
 *
 * A brand-new task's stack is fabricated by task_spawn() to look
 * exactly like a stack this function previously saved: six zeroed
 * register slots, then the address of task_entry_thunk where our
 * `ret` will land. First switch into a new task therefore needs no
 * special casing.
 *
 * ─── THE FLOATING-POINT HALF, AND WHY IT IS NOT OPTIONAL ───
 *
 * The pushes above cover the callee-saved GENERAL registers and nothing
 * else. x87 and the sixteen XMM registers were never saved, and the
 * kernel got away with it on one assumption, written down in
 * enable_sse(): "no other task uses XMM, so its registers survive
 * preemption without a context-switch save."
 *
 * That assumption is true today and is held together by nothing but
 * discipline. The whole kernel builds -mno-sse -mgeneral-regs-only so
 * the compiler cannot emit XMM behind anyone's back; src/gpt.c is the
 * single exception, built -msse -msse2, and it runs the Assistant's
 * model. The day a second task touches a float — a second model, a
 * user program, one file's flags edited without reading this comment —
 * the timer preempts mid-inference and XMM comes back holding another
 * task's numbers.
 *
 * That failure does not crash. It returns WRONG ARITHMETIC, silently,
 * from the part of the product whose whole job is to be trusted. There
 * is no log line and no fault to catch it, and "the AI said something
 * strange once" is not a bug report anyone can act on.
 *
 * So FXSAVE/FXRSTOR run unconditionally, on every switch. The eager
 * form, not the lazy CR0.TS + #NM dance: this kernel has a handful of
 * tasks, 512 bytes and ~100 cycles each is nothing next to a full
 * forward pass, and the lazy version needs a fault handler that would
 * itself be untested kernel code sitting under the AI.
 *
 * FXSAVE #UDs if CR0.EM is set, so enable_sse() must have run first.
 * It does — it is the second call in kernel_mb2_main, ~1200 lines
 * before tasks_init.
 */

.section .text
.code64
.global context_switch
context_switch:
    fxsave  (%rdx)           /* outgoing x87 + XMM + MXCSR */

    pushq %rbp
    pushq %rbx
    pushq %r12
    pushq %r13
    pushq %r14
    pushq %r15

    movq %rsp, (%rdi)        /* save outgoing RSP */
    movq %rsi, %rsp          /* adopt incoming RSP */

    popq %r15
    popq %r14
    popq %r13
    popq %r12
    popq %rbx
    popq %rbp

    /* rcx is caller-saved and nothing above touches it, so it still
     * holds load_fx even though we are now standing on the incoming
     * task's stack. Restored AFTER the pops so a new task — whose
     * first exit from here is the `ret` below into task_entry_thunk —
     * gets its float state on the same path every other task does. */
    fxrstor (%rcx)           /* incoming x87 + XMM + MXCSR */
    ret

/*
 * void fpu_snapshot(void *area512);
 *
 * FXSAVE the CPU's current float state into a 16-byte-aligned buffer.
 * task.c calls this once at tasks_init to capture a known-good image to
 * seed every task with.
 *
 * It lives here rather than as inline asm in task.c because task.c is
 * compiled -mno-sse -mgeneral-regs-only. Inline asm is passed through
 * untouched and would probably work, but "probably" is not a reason to
 * put the correctness of every task's float state at the mercy of a
 * compiler flag. The assembler has no such opinions.
 */
.global fpu_snapshot
fpu_snapshot:
    fxsave (%rdi)
    ret

/* Non-executable stack marker — silences the ld warning. */
.section .note.GNU-stack, "", @progbits
