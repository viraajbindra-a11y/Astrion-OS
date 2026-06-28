/*
 * Astrion v2.0 - Cooperative task scheduler
 *
 * Round-robin over a fixed task table. Tasks volunteer the CPU via
 * task_yield(); there is no preemption (the PIT still ticks, but
 * its ISR only counts - it never switches stacks). Single CPU.
 *
 * Task 0 is the boot/shell task - it's "created" by tasks_init()
 * adopting the current execution context, and it never exits.
 * Spawned tasks get a 16 KiB kmalloc'd stack and start in a
 * trampoline that calls fn(arg) then task_exit().
 *
 * Contract for spawned tasks: yield often. A task that loops
 * without yielding starves everyone (including the shell).
 */

#ifndef ASTRION_TASK_H
#define ASTRION_TASK_H

#include <stdint.h>

#define TASK_MAX        16
#define TASK_STACK_SIZE (16 * 1024)
#define TASK_NAME_MAX   15

enum task_state {
    TASK_UNUSED = 0,
    TASK_READY,
    TASK_RUNNING,
    TASK_DONE,
};

typedef void (*task_fn)(void *arg);

void tasks_init(void);                                  /* adopt caller as task 0 ("shell") */
int  task_spawn(const char *name, task_fn fn, void *arg);  /* returns tid or -1 */
/* Spawn a ring-3 task owning user-window frames [start, start+frames); the
 * frame bookkeeping is recorded atomically with the spawn (no leak window). */
int  task_spawn_user(const char *name, task_fn fn, void *arg,
                     uint32_t upool_start, uint32_t upool_frames);
void task_yield(void);                                  /* voluntary switch */
void task_preempt(void);                                /* called by timer ISR after EOI */
void task_exit(void);                                   /* never returns */
int  task_kill(int tid);                                /* never scheduled again */

/* Introspection for the 'ps' shell command. */
struct task_info {
    int        tid;
    char       name[TASK_NAME_MAX + 1];
    enum task_state state;
    uint64_t   switches;     /* times this task has been scheduled in */
};
int task_get_info(int idx, struct task_info *out);      /* 1 if slot in use */
int task_current_tid(void);
const char *task_current_name(void);                    /* name of the running task */

#endif
