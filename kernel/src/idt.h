/*
 * Astrion v2.0 - IDT (Interrupt Descriptor Table) + register frame
 *
 * 256-entry IDT, only vectors 0..31 wired today (CPU exceptions).
 * IRQ remap + keyboard etc. will fill 32..47 in the next step.
 *
 * The C handler receives a pointer to a struct registers laid out to
 * match the order pushed by isr.S (rax pushed last → at offset 0).
 */

#ifndef ASTRION_IDT_H
#define ASTRION_IDT_H

#include <stdint.h>

/* Layout MUST match the push order in isr.S isr_common. */
struct registers {
    /* Pushed by isr_common (last push = lowest address). */
    uint64_t rax, rbx, rcx, rdx, rsi, rdi, rbp;
    uint64_t r8, r9, r10, r11, r12, r13, r14, r15;
    /* Pushed by the per-vector stub. */
    uint64_t vector;
    uint64_t error_code;
    /* Pushed by the CPU on interrupt entry. */
    uint64_t rip;
    uint64_t cs;
    uint64_t rflags;
    uint64_t rsp;
    uint64_t ss;
} __attribute__((packed));

void idt_install(void);
void pic_remap(void);
void pic_unmask_irq(uint8_t irq);
void pic_mask_irq(uint8_t irq);

/* C entry points called from isr.S - defined in idt.c. */
void isr_handler(struct registers *r);
void irq_handler(struct registers *r);

/* Per-IRQ handler registration. handler(NULL) clears. */
typedef void (*irq_fn)(struct registers *r);
void irq_register(uint8_t irq, irq_fn fn);

#endif /* ASTRION_IDT_H */
