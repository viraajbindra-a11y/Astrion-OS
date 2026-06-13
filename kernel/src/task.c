/*
 * Astrion v2.0 - Cooperative task scheduler
 *
 * See task.h for the model. The interesting part is fabricating a
 * new task's initial stack so the first context_switch into it works
 * identically to every later one:
 *
 *   high addr →  [16-aligned stack top]
 *                [&task_entry_thunk]      ← `ret` in context_switch pops this
 *                [0]  r15 slot            ┐
 *                [0]  r14 slot            │ popped by context_switch
 *                [0]  r13 slot            │ before its ret
 *                [0]  r12 slot            │
 *                [0]  rbx slot            │
 *                [0]  rbp slot            ┘ ← saved RSP points here
 *
 * After the pops + ret, RSP sits at the aligned top and execution is
 * inside task_entry_thunk, which calls the task's fn(arg) and then
 * task_exit(). The thunk's first call pushes 8 bytes, giving fn an
 * entry RSP ≡ 8 (mod 16) - the normal SysV alignment.
 *
 * Stack reaping: a DONE task's stack can't be freed while we might
 * still be standing on it, so task_exit only marks the state. The
 * next task_spawn() reaps any DONE-and-not-current slots.
 */

#include <stdint.h>
#include "task.h"
#include "heap.h"

/* context_switch.S */
extern void context_switch(uint64_t *save_rsp_here, uint64_t load_rsp);

/* Serial panic hook (kernel_mb2.c) - used if a task smashes its stack. */
extern void serial_puts_x(const char *s);

#define STACK_CANARY 0xA570CA1F5704DEADULL

struct task {
    uint64_t        rsp;
    enum task_state state;
    task_fn         fn;
    void           *arg;
    uint8_t        *stack_base;   /* kmalloc'd; NULL for task 0 */
    uint64_t        switches;
    char            name[TASK_NAME_MAX + 1];
};

static struct task tasks[TASK_MAX];
static int current_tid;

static void copy_name(char *dst, const char *src) {
    int i = 0;
    while (src && src[i] && i < TASK_NAME_MAX) { dst[i] = src[i]; i++; }
    dst[i] = 0;
}

void tasks_init(void) {
    for (int i = 0; i < TASK_MAX; i++) tasks[i].state = TASK_UNUSED;
    /* Adopt the caller (boot stack) as task 0. Its rsp gets filled in
     * by the first context_switch away from it. */
    tasks[0].state = TASK_RUNNING;
    tasks[0].stack_base = 0;
    tasks[0].switches = 1;
    copy_name(tasks[0].name, "shell");
    current_tid = 0;
}

/* Entered via `ret` from context_switch on a task's first slice. */
static void task_entry_thunk(void) {
    struct task *t = &tasks[current_tid];
    /* CRITICAL for preemption: a new task is entered via context_switch's
     * `ret`, so it inherits the switcher's interrupt flag — and the
     * switcher just did cli() inside task_yield/schedule, so IF is OFF.
     * A task that never voluntarily yields (and so never hits the sti in
     * task_yield's irq_restore) would run with interrupts disabled
     * forever, and the timer could never preempt it — it would
     * monopolize the CPU. Enable interrupts here so every task, yielding
     * or not, is preemptible from its very first instruction. */
    __asm__ volatile("sti");
    t->fn(t->arg);
    task_exit();
}

static void reap_done(void) {
    for (int i = 1; i < TASK_MAX; i++) {
        if (tasks[i].state == TASK_DONE && i != current_tid) {
            if (tasks[i].stack_base) kfree(tasks[i].stack_base);
            tasks[i].stack_base = 0;
            tasks[i].state = TASK_UNUSED;
        }
    }
}

int task_spawn(const char *name, task_fn fn, void *arg) {
    reap_done();

    int tid = -1;
    for (int i = 1; i < TASK_MAX; i++) {
        if (tasks[i].state == TASK_UNUSED) { tid = i; break; }
    }
    if (tid < 0) return -1;

    uint8_t *stack = (uint8_t *)kmalloc(TASK_STACK_SIZE);
    if (!stack) return -1;

    struct task *t = &tasks[tid];
    t->fn = fn;
    t->arg = arg;
    t->stack_base = stack;
    t->switches = 0;
    copy_name(t->name, name);

    /* Stack-overflow canary at the LOW end of the stack (the end a
     * deep call chain grows toward). task_yield checks it; a clobbered
     * canary means the task blew its 16 KiB and we halt it loudly
     * instead of letting it silently corrupt the adjacent heap block. */
    *(uint64_t *)stack = STACK_CANARY;

    /* Fabricate the initial frame so the first context_switch into this
     * task is identical to switching back into a previously-saved one.
     *
     * SysV requires RSP ≡ 8 (mod 16) at a function's ENTRY (because a
     * normal `call` pushes the 8-byte return address onto a 16-aligned
     * RSP). task_entry_thunk is entered via context_switch's `ret`, not
     * a `call`, so we fabricate one extra padding qword above the thunk
     * address: after the 6 pops + ret, RSP lands 8 below the 16-aligned
     * top - exactly the alignment a real call site would produce. (SSE
     * is disabled today per lesson #196, so a misaligned entry wouldn't
     * fault yet - but the Rust port + any future movaps would, so get
     * it right now.) */
    uint64_t top = ((uint64_t)(uintptr_t)stack + TASK_STACK_SIZE) & ~0xFULL;
    uint64_t *sp = (uint64_t *)(uintptr_t)top;
    *(--sp) = 0;                                        /* alignment pad */
    *(--sp) = (uint64_t)(uintptr_t)task_entry_thunk;   /* ret target */
    for (int i = 0; i < 6; i++) *(--sp) = 0;           /* rbp,rbx,r12..r15 */
    t->rsp = (uint64_t)(uintptr_t)sp;

    t->state = TASK_READY;
    return tid;
}

static inline uint64_t irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void irq_restore(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}

/* The actual switch. MUST run with interrupts disabled (so the timer
 * can't fire mid-switch and re-enter us). Both the voluntary path
 * (task_yield) and the preemptive path (task_preempt, from the timer
 * ISR) funnel through here. The same context_switch round-trips a task
 * whether it was saved voluntarily (resumes into task_yield -> sti) or
 * preemptively (resumes into task_preempt -> irq epilogue -> iretq),
 * because the resume point travels with the saved stack. */
static void schedule(void) {
    /* Stack-overflow guard: if the current task (other than task 0,
     * which runs on the boot stack and has no canary) has smashed the
     * canary at the low end of its stack, it has overflowed into the
     * adjacent heap. Don't switch away carrying corruption - report it
     * and halt that task. */
    struct task *cur = &tasks[current_tid];
    if (cur->stack_base && *(uint64_t *)cur->stack_base != STACK_CANARY) {
        serial_puts_x("\n!!! TASK STACK OVERFLOW: ");
        serial_puts_x(cur->name);
        serial_puts_x(" - halting task !!!\n");
        cur->state = TASK_DONE;
        /* fall through to schedule someone else; never come back here */
    }

    /* Round-robin: next READY slot after current. */
    int next = -1;
    for (int i = 1; i <= TASK_MAX; i++) {
        int cand = (current_tid + i) % TASK_MAX;
        if (tasks[cand].state == TASK_READY) { next = cand; break; }
    }
    if (next < 0) return;   /* nothing else runnable */

    struct task *from = &tasks[current_tid];
    struct task *to   = &tasks[next];
    if (from->state == TASK_RUNNING) from->state = TASK_READY;
    to->state = TASK_RUNNING;
    to->switches++;
    current_tid = next;
    context_switch(&from->rsp, to->rsp);
    /* When something switches back to us, execution resumes here. */
}

/* Voluntary yield from task context. Wrap the switch in cli/sti so a
 * timer tick can't preempt us mid-switch; irq_restore puts the caller's
 * interrupt flag back (tasks run with IF on, so this re-enables it). */
void task_yield(void) {
    uint64_t f = irq_save();
    schedule();
    irq_restore(f);
}

/* Preemptive switch. Called from the timer ISR (idt.c irq_handler)
 * AFTER the PIC has been sent EOI, with interrupts already disabled.
 * No save/restore: when this task is later resumed and unwinds back
 * through the ISR, iretq restores its saved interrupt flag. This is
 * what makes a task that never calls task_yield still share the CPU. */
void task_preempt(void) {
    schedule();
}

void task_exit(void) {
    uint64_t f = irq_save();
    tasks[current_tid].state = TASK_DONE;
    schedule();
    irq_restore(f);
    /* Unreachable while another READY task exists (task 0 always is).
     * Belt + suspenders: */
    for (;;) __asm__ volatile("sti; hlt");
}

int task_kill(int tid) {
    if (tid <= 0 || tid >= TASK_MAX) return -1;             /* can't kill shell */
    if (tasks[tid].state != TASK_READY &&
        tasks[tid].state != TASK_RUNNING) return -1;
    if (tid == current_tid) { task_exit(); }                /* suicide */
    tasks[tid].state = TASK_DONE;                           /* never scheduled again */
    return 0;
}

int task_get_info(int idx, struct task_info *out) {
    if (idx < 0 || idx >= TASK_MAX) return 0;
    if (tasks[idx].state == TASK_UNUSED) return 0;
    out->tid = idx;
    copy_name(out->name, tasks[idx].name);
    out->state = tasks[idx].state;
    out->switches = tasks[idx].switches;
    return 1;
}

int task_current_tid(void) { return current_tid; }
