/*
 * Astrion v2.0 — Cooperative context switch
 *
 * void context_switch(uint64_t *save_rsp_here, uint64_t load_rsp);
 *   rdi = where to store the outgoing task's stack pointer
 *   rsi = the incoming task's saved stack pointer
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
 */

.section .text
.code64
.global context_switch
context_switch:
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
    ret

/* Non-executable stack marker — silences the ld warning. */
.section .note.GNU-stack, "", @progbits
