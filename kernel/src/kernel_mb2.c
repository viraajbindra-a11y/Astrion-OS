/*
 * Astrion v2.0 — Multiboot2 kernel entry (minimal stub)
 *
 * Called from boot/multiboot2.S after long-mode setup. The job here is
 * intentionally minimal:
 *   1. Initialize COM1 serial.
 *   2. Print a recognizable banner.
 *   3. Print the multiboot2 magic + info pointer so we can verify the
 *      hand-off was clean.
 *   4. Halt.
 *
 * This proves the multiboot2+GRUB path works end-to-end: GRUB loads us,
 * the asm stub gets us to long mode, the C code runs and produces
 * observable output. From here, the next step is parsing the multiboot
 * info tags (framebuffer, memory map) and wiring up the existing kernel
 * GUI loop — but that's incremental on a working substrate, not a
 * firmware archaeology dig.
 *
 * Deliberately separate from src/kernel.c (the UEFI/gnu-efi path) so
 * each can evolve independently. They'll merge once both reach the
 * same "drive the framebuffer + input + run desktop loop" state.
 */

#include <stdint.h>

/* COM1 UART (0x3F8) — identical setup to boot/boot.c so the serial
 * line is interchangeable across both boot paths. */

static inline void outb(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static inline uint8_t inb(uint16_t port) {
    uint8_t val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

static void serial_init(void) {
    outb(0x3F8 + 1, 0x00);
    outb(0x3F8 + 3, 0x80);
    outb(0x3F8 + 0, 0x03);
    outb(0x3F8 + 1, 0x00);
    outb(0x3F8 + 3, 0x03);
    outb(0x3F8 + 2, 0xC7);
    outb(0x3F8 + 4, 0x0B);
}

static void serial_putc(char c) {
    while ((inb(0x3F8 + 5) & 0x20) == 0) { }
    outb(0x3F8, (uint8_t)c);
}

static void serial_puts(const char *s) {
    while (*s) {
        if (*s == '\n') serial_putc('\r');
        serial_putc(*s);
        s++;
    }
}

static void serial_put_hex64(uint64_t v) {
    static const char hex[] = "0123456789abcdef";
    serial_puts("0x");
    for (int i = 15; i >= 0; i--) {
        serial_putc(hex[(v >> (i * 4)) & 0xF]);
    }
}

/* Called from boot/multiboot2.S */
void kernel_mb2_main(uint32_t magic, uint64_t info_ptr) {
    serial_init();
    serial_puts("\n");
    serial_puts("=== Astrion v2.0 Kernel (multiboot2 path) ===\n");
    serial_puts("kernel_mb2_main reached; long-mode OK\n");

    serial_puts("multiboot2 magic = ");
    serial_put_hex64((uint64_t)magic);
    serial_puts("\n");

    serial_puts("multiboot2 info  = ");
    serial_put_hex64(info_ptr);
    serial_puts("\n");

    if (magic == 0x36d76289u) {
        serial_puts("magic OK — GRUB hand-off clean\n");
    } else {
        serial_puts("WARN: magic mismatch; bootloader may not be multiboot2\n");
    }

    serial_puts("kernel halt (stub — next: parse info tags + drive framebuffer)\n");

    /* Halt forever. */
    for (;;) {
        __asm__ volatile("cli; hlt");
    }
}
