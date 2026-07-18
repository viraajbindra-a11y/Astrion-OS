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

/* Ring-3 support (gdt.c / usermem.c). */
extern void tss_set_rsp0(uint64_t rsp0);          /* per-task kernel stack for the CPU */
extern void upool_free(uint32_t start, uint32_t frames);
extern uint8_t stack_top[];                        /* boot stack top (multiboot2.S) */

#define STACK_CANARY 0xA570CA1F5704DEADULL

struct task {
    uint64_t        rsp;
    enum task_state state;
    task_fn         fn;
    void           *arg;
    uint8_t        *stack_base;   /* kmalloc'd; NULL for task 0 */
    uint64_t        kstack_top;   /* 16-aligned top of this task's kernel stack (-> tss.rsp0) */
    uint64_t        cr3;          /* address space to activate on switch-in (kernel_cr3 = default) */
    uint32_t        upool_start;  /* ring-3 user-window frames (0/0 if not a user task) */
    uint32_t        upool_frames;
    uint64_t        switches;
    char            name[TASK_NAME_MAX + 1];
};

static struct task tasks[TASK_MAX];
static int current_tid;

/* The kernel's CR3 (phys of the boot PML4 p4_table), captured once at
 * tasks_init from the boot context. Every task defaults its cr3 to this, so a
 * task with no private address space runs on the shared kernel mapping exactly
 * as it did before M3. Only a task explicitly bound to a vmspace carries a
 * different cr3 - and only then does schedule() actually load CR3. */
static uint64_t kernel_cr3;

static void copy_name(char *dst, const char *src) {
    int i = 0;
    while (src && src[i] && i < TASK_NAME_MAX) { dst[i] = src[i]; i++; }
    dst[i] = 0;
}

void tasks_init(void) {
    /* Capture the kernel's CR3 (the boot PML4) once, from the boot context we
     * are running in right now. This is the default address space every task
     * inherits, and the baseline schedule() compares against. */
    __asm__ volatile("mov %%cr3, %0" : "=r"(kernel_cr3));

    for (int i = 0; i < TASK_MAX; i++) tasks[i].state = TASK_UNUSED;
    /* Adopt the caller (boot stack) as task 0. Its rsp gets filled in
     * by the first context_switch away from it. */
    tasks[0].state = TASK_RUNNING;
    tasks[0].stack_base = 0;
    tasks[0].kstack_top = (uint64_t)(uintptr_t)stack_top;   /* boot stack (ring-0 only) */
    tasks[0].cr3 = kernel_cr3;                              /* the kernel space */
    tasks[0].upool_start = 0;
    tasks[0].upool_frames = 0;
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
            /* A ring-3 task owns a SECOND allocation: its user-window frames
             * (image + user stack). Free those here too — neither the normal
             * exit (SYS_EXIT) nor the fault-kill path frees them, since both
             * are standing on the kernel stack and just mark the task DONE. */
            if (tasks[i].upool_frames) {
                upool_free(tasks[i].upool_start, tasks[i].upool_frames);
                tasks[i].upool_start = 0;
                tasks[i].upool_frames = 0;
            }
            tasks[i].state = TASK_UNUSED;
        }
    }
}

static inline uint64_t irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void irq_restore(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}

/* Load CR3 - switch the active page-table root. The "memory" clobber tells the
 * compiler this changes the address space, so it must not move memory accesses
 * across it. Only ever called from schedule() (interrupts off) and only when the
 * incoming task's space differs from the outgoing one. */
static inline void load_cr3(uint64_t cr3) {
    __asm__ volatile("mov %0, %%cr3" :: "r"(cr3) : "memory");
}

/* Spawn a task, optionally owning a ring-3 user-window allocation
 * [upool_start, upool_start+upool_frames). The ENTIRE body runs with
 * interrupts OFF: it reaps DONE slots (freeing kernel stacks + user frames)
 * and builds the new slot field-by-field, and the shared tasks[] table is
 * also walked by schedule() from the timer ISR. If a tick landed mid-build,
 * the scheduler could switch into a half-initialized or just-freed slot ->
 * kernel-stack corruption. The lock also makes the upool bookkeeping appear
 * atomically with TASK_READY, so a ring-3 task that faults the instant it
 * runs can't be reaped before its frames are recorded (which would leak them). */
static int spawn_locked(const char *name, task_fn fn, void *arg,
                        uint32_t upool_start, uint32_t upool_frames,
                        uint64_t cr3) {
    uint64_t flags = irq_save();
    reap_done();

    int tid = -1;
    for (int i = 1; i < TASK_MAX; i++) {
        if (tasks[i].state == TASK_UNUSED) { tid = i; break; }
    }
    if (tid < 0) { irq_restore(flags); return -1; }

    uint8_t *stack = (uint8_t *)kmalloc(TASK_STACK_SIZE);
    if (!stack) { irq_restore(flags); return -1; }

    struct task *t = &tasks[tid];
    t->fn = fn;
    t->arg = arg;
    t->stack_base = stack;
    t->kstack_top = ((uint64_t)(uintptr_t)stack + TASK_STACK_SIZE) & ~0xFULL;
    /* Bind the address space now, under the lock, before the task is READY - so
     * it runs under this space from its very first slice. cr3 == 0 (a phys frame
     * addr is never 0) is a safe "default to the kernel space" sentinel, so no
     * task can ever reach schedule() with a bogus cr3 of 0. */
    t->cr3 = cr3 ? cr3 : kernel_cr3;
    t->upool_start = upool_start;
    t->upool_frames = upool_frames;
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

    t->state = TASK_READY;        /* schedulable now — set LAST, fully built */
    irq_restore(flags);
    return tid;
}

int task_spawn(const char *name, task_fn fn, void *arg) {
    return spawn_locked(name, fn, arg, 0, 0, kernel_cr3);
}

/* Spawn a ring-3 task that owns user-window frames. Atomic with the spawn so
 * the task can't run (and fault, and be reaped) before its frames are on
 * record — otherwise an immediately-faulting program leaks its pool window.
 * Stays on the kernel space + shared user window until M4 rewires exec. */
int task_spawn_user(const char *name, task_fn fn, void *arg,
                    uint32_t upool_start, uint32_t upool_frames) {
    return spawn_locked(name, fn, arg, upool_start, upool_frames, kernel_cr3);
}

/* Spawn a kernel task bound to a given address space (its vmspace PML4 phys).
 * See task.h: the cr3 is set under the lock before READY, so the scheduler
 * activates that space the first time it switches in. */
int task_spawn_in_space(const char *name, task_fn fn, void *arg, uint64_t cr3) {
    return spawn_locked(name, fn, arg, 0, 0, cr3);
}

/* The actual switch. MUST run with interrupts disabled (so the timer
 * can't fire mid-switch and re-enter us). Both the voluntary path
 * (task_yield) and the preemptive path (task_preempt, from the timer
 * ISR) funnel through here. The same context_switch round-trips a task
 * whether it was saved voluntarily (resumes into task_yield -> sti) or
 * preemptively (resumes into task_preempt -> irq epilogue -> iretq),
 * because the resume point travels with the saved stack. */
static void schedule(void) {
    /* Reclaim any DONE task here, not only at the next task_spawn(): a
     * program that exits (or is fault-killed) and is never followed by a
     * spawn would otherwise strand its kernel stack + user-window frames
     * forever. schedule() always runs with IF=0, so this is safe; reap_done
     * skips the current task, so we never free a stack we're standing on. */
    reap_done();

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
    /* Point the CPU at the INCOMING task's kernel stack BEFORE switching to
     * it. When that task next faults / is preempted / syscalls FROM ring 3,
     * the CPU loads tss.rsp0 — it must already be this task's own kernel
     * stack, or two ring-3 tasks would trap onto one stack and corrupt each
     * other. context_switch.S is TSS-agnostic, so this hook lives here. */
    tss_set_rsp0(to->kstack_top);
    /* Activate the incoming task's address space - but ONLY when it differs from
     * the outgoing one. Guarding this matters: an unconditional CR3 load flushes
     * the entire (non-global) TLB on every tick and tanks performance; the guard
     * keeps the common same-space switch a no-op, byte-identical to pre-M3.
     *
     * Loading here is safe because the kernel half is mapped IDENTICALLY in every
     * space: we are still executing shared kernel code (schedule() lives in the
     * low identity map), standing on a kernel stack (boot stack / kmalloc heap,
     * also identity-mapped), and context_switch is about to push onto that same
     * stack and read both tasks' rsp from the identity-mapped tasks[] array.
     * Every byte touched from now until `to` actually runs is in the shared half,
     * so it stays reachable across the CR3 change. Interrupts are off, so no tick
     * can re-enter us mid-switch. */
    if (to->cr3 != from->cr3) load_cr3(to->cr3);
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
    if (tid == current_tid) { task_exit(); return 0; }      /* suicide (task_exit never returns) */
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

const char *task_current_name(void) { return tasks[current_tid].name; }

uint64_t task_kernel_cr3(void) { return kernel_cr3; }
