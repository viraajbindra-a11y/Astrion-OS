/*
 * Astrion v2.0 - IDT installer + exception handler
 *
 * Lays out a 256-entry IDT, fills entries 0..31 with the per-vector
 * stubs from isr.S, and loads IDTR via LIDT. After this runs, any CPU
 * exception lands in isr_handler() below instead of silent triple-fault.
 *
 * isr_handler() paints a panic screen on the framebuffer (Astrion red
 * bg, "PANIC" wordmark, exception name + vector + error code + key
 * registers), mirrors the same info to COM1 serial, then halts.
 *
 * Why each chunk:
 *   - The IDT entry format is the x86_64 interrupt gate: 16 bytes,
 *     present + ring 0 + 64-bit interrupt gate (type 0xE), no IST,
 *     code segment = the one set up by boot/multiboot2.S (selector 8
 *     in gdt64.code = first non-null GDT entry).
 *   - LIDT takes a pointer to a 10-byte IDTR: 2-byte limit + 8-byte base.
 *   - We must set CS to the kernel code selector that's actually loaded
 *     in CS. boot/multiboot2.S did `ljmp $gdt64.code, $long_mode_start`
 *     so CS holds the gdt64.code selector (offset 8 from gdt64).
 */

#include <stdint.h>
#include "idt.h"
#include "fb_font.h"

/* Forward declarations of the per-vector stubs (defined in isr.S). */
extern void isr0(void);  extern void isr1(void);  extern void isr2(void);  extern void isr3(void);
extern void isr4(void);  extern void isr5(void);  extern void isr6(void);  extern void isr7(void);
extern void isr8(void);  extern void isr9(void);  extern void isr10(void); extern void isr11(void);
extern void isr12(void); extern void isr13(void); extern void isr14(void); extern void isr15(void);
extern void isr16(void); extern void isr17(void); extern void isr18(void); extern void isr19(void);
extern void isr20(void); extern void isr21(void); extern void isr22(void); extern void isr23(void);
extern void isr24(void); extern void isr25(void); extern void isr26(void); extern void isr27(void);
extern void isr28(void); extern void isr29(void); extern void isr30(void); extern void isr31(void);

extern void irq0(void);  extern void irq1(void);  extern void irq2(void);  extern void irq3(void);
extern void irq4(void);  extern void irq5(void);  extern void irq6(void);  extern void irq7(void);
extern void irq8(void);  extern void irq9(void);  extern void irq10(void); extern void irq11(void);
extern void irq12(void); extern void irq13(void); extern void irq14(void); extern void irq15(void);

struct idt_entry {
    uint16_t offset_low;     /* handler offset bits 0..15 */
    uint16_t selector;       /* code segment selector */
    uint8_t  ist;            /* bits 0..2: IST index; rest 0 */
    uint8_t  type_attr;      /* P=1 DPL=0 0 type=0xE (64-bit interrupt gate) */
    uint16_t offset_mid;     /* offset bits 16..31 */
    uint32_t offset_high;    /* offset bits 32..63 */
    uint32_t reserved;
} __attribute__((packed));

struct idtr {
    uint16_t limit;
    uint64_t base;
} __attribute__((packed));

static struct idt_entry idt[256];
static struct idtr      idtr;

/* Same kernel code selector boot/multiboot2.S far-jumped to.
 * gdt64 has [null, code] → code offset = 8. */
#define KERNEL_CS 0x08

static void idt_set(uint8_t vec, void (*handler)(void)) {
    uint64_t addr = (uint64_t)handler;
    idt[vec].offset_low  = addr & 0xFFFF;
    idt[vec].selector    = KERNEL_CS;
    idt[vec].ist         = 0;
    idt[vec].type_attr   = 0x8E;  /* present | ring 0 | 64-bit interrupt gate */
    idt[vec].offset_mid  = (addr >> 16) & 0xFFFF;
    idt[vec].offset_high = (addr >> 32) & 0xFFFFFFFF;
    idt[vec].reserved    = 0;
}

void idt_install(void) {
    /* Wire exceptions 0..31. */
    idt_set(0,  isr0);   idt_set(1,  isr1);   idt_set(2,  isr2);   idt_set(3,  isr3);
    idt_set(4,  isr4);   idt_set(5,  isr5);   idt_set(6,  isr6);   idt_set(7,  isr7);
    idt_set(8,  isr8);   idt_set(9,  isr9);   idt_set(10, isr10);  idt_set(11, isr11);
    idt_set(12, isr12);  idt_set(13, isr13);  idt_set(14, isr14);  idt_set(15, isr15);
    idt_set(16, isr16);  idt_set(17, isr17);  idt_set(18, isr18);  idt_set(19, isr19);
    idt_set(20, isr20);  idt_set(21, isr21);  idt_set(22, isr22);  idt_set(23, isr23);
    idt_set(24, isr24);  idt_set(25, isr25);  idt_set(26, isr26);  idt_set(27, isr27);
    idt_set(28, isr28);  idt_set(29, isr29);  idt_set(30, isr30);  idt_set(31, isr31);

    /* IRQ vectors 32..47 - populated even if their per-IRQ handler is
     * NULL. The common irq_handler dispatches by index and sends EOI. */
    idt_set(32, irq0);   idt_set(33, irq1);   idt_set(34, irq2);   idt_set(35, irq3);
    idt_set(36, irq4);   idt_set(37, irq5);   idt_set(38, irq6);   idt_set(39, irq7);
    idt_set(40, irq8);   idt_set(41, irq9);   idt_set(42, irq10);  idt_set(43, irq11);
    idt_set(44, irq12);  idt_set(45, irq13);  idt_set(46, irq14);  idt_set(47, irq15);

    /* Vectors 48..255 left zeroed for now. */

    idtr.limit = sizeof(idt) - 1;
    idtr.base  = (uint64_t)&idt;
    __asm__ volatile("lidt %0" : : "m"(idtr));
}

/* ─── 8259 PIC remap ─────────────────────────────────────────
 *
 * The legacy PIC fires IRQs at vectors 8..15 (master) + 0x70..0x77
 * (slave) by default - overlapping CPU exceptions 8..15. Remap to
 * 32..47 so IRQs and CPU exceptions don't collide.
 *
 * The remap protocol is 4 init-control-word writes per PIC, in order.
 */

#define PIC1_CMD  0x20
#define PIC1_DATA 0x21
#define PIC2_CMD  0xA0
#define PIC2_DATA 0xA1

static inline void outb_(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}
static inline uint8_t inb_(uint16_t port) {
    uint8_t val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

/* Short I/O delay - write to unused port 0x80. Some old PICs need a
 * few cycles between command writes. */
static inline void io_wait(void) { outb_(0x80, 0); }

void pic_remap(void) {
    /* Save current masks. */
    uint8_t mask1 = inb_(PIC1_DATA);
    uint8_t mask2 = inb_(PIC2_DATA);

    /* ICW1: init + ICW4 will follow. */
    outb_(PIC1_CMD, 0x11); io_wait();
    outb_(PIC2_CMD, 0x11); io_wait();
    /* ICW2: vector offsets. */
    outb_(PIC1_DATA, 0x20); io_wait();      /* IRQs 0..7  → 32..39 */
    outb_(PIC2_DATA, 0x28); io_wait();      /* IRQs 8..15 → 40..47 */
    /* ICW3: master tells slave at IRQ2; slave its cascade identity. */
    outb_(PIC1_DATA, 0x04); io_wait();
    outb_(PIC2_DATA, 0x02); io_wait();
    /* ICW4: 8086 mode. */
    outb_(PIC1_DATA, 0x01); io_wait();
    outb_(PIC2_DATA, 0x01); io_wait();

    /* Restore previously-saved masks. Caller can pic_unmask_irq() to
     * enable specific lines. */
    outb_(PIC1_DATA, mask1);
    outb_(PIC2_DATA, mask2);
}

void pic_unmask_irq(uint8_t irq) {
    uint16_t port = (irq < 8) ? PIC1_DATA : PIC2_DATA;
    uint8_t  bit  = (irq < 8) ? irq : (irq - 8);
    uint8_t  v    = inb_(port) & ~(1 << bit);
    outb_(port, v);
}

void pic_mask_irq(uint8_t irq) {
    uint16_t port = (irq < 8) ? PIC1_DATA : PIC2_DATA;
    uint8_t  bit  = (irq < 8) ? irq : (irq - 8);
    uint8_t  v    = inb_(port) | (1 << bit);
    outb_(port, v);
}

static void pic_send_eoi(uint8_t irq) {
    if (irq >= 8) outb_(PIC2_CMD, 0x20);
    outb_(PIC1_CMD, 0x20);
}

/* ─── IRQ dispatch ────────────────────────────────────────── */

static irq_fn irq_handlers[16];

void irq_register(uint8_t irq, irq_fn fn) {
    if (irq < 16) irq_handlers[irq] = fn;
}

void irq_handler(struct registers *r) {
    /* vector 32..47 → IRQ 0..15 */
    uint8_t irq = (uint8_t)(r->vector - 32);
    if (irq < 16 && irq_handlers[irq]) irq_handlers[irq](r);
    pic_send_eoi(irq);
}

/* ─── Panic screen + handler ────────────────────────────────── */

#define COL_PANIC_BG   0x8A1B17u    /* deep red */
#define COL_PANIC_ACC  0xFF7A00u    /* Astrion orange */
#define COL_WHITE      0xFFFFFFu
#define COL_ICE        0xCADCFCu

/* Re-use a few helpers from kernel_mb2.c via simple extern decls. The
 * boot_info struct + the serial helpers + the fb text helpers live
 * in kernel_mb2.c; we add weak decls here so the linker can resolve
 * them without us duplicating definitions. */
extern void serial_puts_x(const char *s);
extern void serial_put_hex64_x(uint64_t v);
extern int  fb_present_x(void);

extern void fb_fill_x(uint32_t color);
extern void fb_rect_x(uint32_t x0, uint32_t y0, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);
extern uint32_t fb_put_hex64_x(uint32_t x, uint32_t y, uint64_t v, uint32_t color, int scale);
extern uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);

static const char *exception_name(uint32_t v) {
    static const char *names[32] = {
        "#DE divide-by-zero",     "#DB debug",              "NMI",
        "#BP breakpoint",         "#OF overflow",           "#BR bound-range",
        "#UD invalid opcode",     "#NM device not avail",   "#DF double fault",
        "(coproc seg overrun)",   "#TS invalid TSS",        "#NP segment not present",
        "#SS stack-segment",      "#GP general protection", "#PF page fault",
        "(reserved 15)",          "#MF x87 FPU error",      "#AC alignment check",
        "#MC machine check",      "#XF SIMD FPU",           "#VE virtualization",
        "#CP control protection", "(reserved 22)",          "(reserved 23)",
        "(reserved 24)",          "(reserved 25)",          "(reserved 26)",
        "(reserved 27)",          "(reserved 28)",          "#HV hypervisor",
        "#VC VMM comm",           "(reserved 31)",
    };
    if (v < 32) return names[v];
    return "(unknown)";
}

void isr_handler(struct registers *r) {
    /* Serial first - it works even if framebuffer is wedged. */
    serial_puts_x("\n!!! KERNEL PANIC !!!\n");
    serial_puts_x("vector  = ");
    serial_put_hex64_x(r->vector);
    serial_puts_x("\nname    = ");
    serial_puts_x(exception_name((uint32_t)r->vector));
    serial_puts_x("\nerror   = ");
    serial_put_hex64_x(r->error_code);
    serial_puts_x("\nRIP     = ");
    serial_put_hex64_x(r->rip);
    serial_puts_x("\nCS      = ");
    serial_put_hex64_x(r->cs);
    serial_puts_x("\nRFLAGS  = ");
    serial_put_hex64_x(r->rflags);
    serial_puts_x("\nRSP     = ");
    serial_put_hex64_x(r->rsp);
    serial_puts_x("\nRAX     = ");
    serial_put_hex64_x(r->rax);
    serial_puts_x("\nRBX     = ");
    serial_put_hex64_x(r->rbx);
    serial_puts_x("\nRCX     = ");
    serial_put_hex64_x(r->rcx);
    serial_puts_x("\nRDX     = ");
    serial_put_hex64_x(r->rdx);
    serial_puts_x("\n--- halt ---\n");

    /* Then framebuffer panic screen. */
    if (fb_present_x()) {
        fb_fill_x(COL_PANIC_BG);
        /* Orange accent bar across the top. */
        fb_rect_x(0, 0, fb_width_x(), 18, COL_PANIC_ACC);

        fb_puts_x(60,  60,  "PANIC",                 COL_WHITE, 6);
        fb_puts_x(60,  170, "kernel exception",      COL_ICE,   2);

        uint32_t sy = 230;
        int s = 2;
        int rowh = FONT_HEIGHT * s + 4;

        fb_puts_x(60, sy,                  "vector:", COL_PANIC_ACC, s);
        fb_puts_x(220, sy,                 exception_name((uint32_t)r->vector), COL_WHITE, s);

        fb_puts_x(60, sy + rowh,           "error:",  COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh,     r->error_code, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*2,         "RIP:",    COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*2,   r->rip, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*3,         "RSP:",    COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*3,   r->rsp, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*4,         "RFLAGS:", COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*4,   r->rflags, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*5,         "RAX:",    COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*5,   r->rax, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*6,         "RBX:",    COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*6,   r->rbx, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*7,         "RCX:",    COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*7,   r->rcx, COL_WHITE, s);

        fb_puts_x(60, sy + rowh*8,         "RDX:",    COL_PANIC_ACC, s);
        fb_put_hex64_x(220, sy + rowh*8,   r->rdx, COL_WHITE, s);

        uint32_t fy = fb_height_x() - FONT_HEIGHT*2 - 20;
        fb_puts_x(60, fy, "system halted - power-cycle to recover",
                  COL_ICE, 2);
    }

    /* Halt forever. */
    for (;;) __asm__ volatile("cli; hlt");
}
