/*
 * Astrion v2.0 — syscall plumbing (kernel side)
 *
 * syscall_init() programs the MSRs so the `syscall` instruction traps to
 * syscall_entry (usermode.S): EFER.SCE, STAR (segment selectors), LSTAR
 * (entry RIP), FMASK (RFLAGS bits cleared on entry). syscall_dispatch()
 * is the C handler the asm stub calls with the syscall number + args.
 */
#ifndef ASTRION_SYSCALL_H
#define ASTRION_SYSCALL_H

#include <stdint.h>

void     syscall_init(void);
uint64_t syscall_dispatch(uint64_t no, uint64_t a1, uint64_t a2, uint64_t a3);

#endif
