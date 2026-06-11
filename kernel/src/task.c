/*
 * Astrion v2.0 — Cooperative task scheduler
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
 * entry RSP ≡ 8 (mod 16) — the normal SysV alignment.
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

    /* Fabricate the initial frame (see file header). */
    uint64_t top = ((uint64_t)(uintptr_t)stack + TASK_STACK_SIZE) & ~0xFULL;
    uint64_t *sp = (uint64_t *)(uintptr_t)top;
    *(--sp) = (uint64_t)(uintptr_t)task_entry_thunk;   /* ret target */
    for (int i = 0; i < 6; i++) *(--sp) = 0;           /* rbp,rbx,r12..r15 */
    t->rsp = (uint64_t)(uintptr_t)sp;

    t->state = TASK_READY;
    return tid;
}

void task_yield(void) {
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

void task_exit(void) {
    tasks[current_tid].state = TASK_DONE;
    task_yield();
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
