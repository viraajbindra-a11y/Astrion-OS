/*
 * Astrion v2.0 — COM1 serial output. See serial.h for why this exists.
 *
 * Lifted verbatim out of kernel_mb2.c, where it was three static functions the
 * rest of the kernel could not reach. Nothing about the register programming
 * changed; it just has a header now so console.c can mirror into it.
 */
#include "serial.h"

#include <stdint.h>

#define COM1 0x3F8

#define UART_DATA       (COM1 + 0)
#define UART_IER        (COM1 + 1)
#define UART_FCR        (COM1 + 2)
#define UART_LCR        (COM1 + 3)
#define UART_MCR        (COM1 + 4)
#define UART_LSR        (COM1 + 5)

#define LSR_THR_EMPTY   0x20        /* transmit holding register is free */
#define LCR_DLAB        0x80        /* divisor-latch access bit */

static inline void outb(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static inline uint8_t inb(uint16_t port) {
    uint8_t val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

void serial_init(void) {
    outb(UART_IER, 0x00);           /* no interrupts — this port is polled */
    outb(UART_LCR, LCR_DLAB);       /* unlock the divisor latch */
    outb(UART_DATA, 0x03);          /* divisor 3 -> 115200/3 = 38400 baud */
    outb(UART_IER, 0x00);           /* divisor high byte */
    outb(UART_LCR, 0x03);           /* 8 bits, no parity, 1 stop; relock */
    outb(UART_FCR, 0xC7);           /* FIFO on, cleared, 14-byte threshold */
    outb(UART_MCR, 0x0B);           /* DTR + RTS + OUT2 */
}

void serial_putc(char c) {
    /* BOUNDED spin. The original spun forever on THR-empty, which is fine
     * under QEMU and fine on a box with a real 16550 — but on hardware with no
     * UART at 0x3F8 the read can float to 0x00, the bit never sets, and the
     * kernel hangs in a debug path with nothing on screen to say why. A device
     * that is not there must not be able to stop the machine.
     *
     * The cap is generous: one character at 38400 baud is ~260us, and this
     * loop is far faster than that per iteration, so a working UART never
     * comes close. Past the cap we write anyway and let the byte be lost —
     * a torn debug log beats a hung kernel. */
    for (int spins = 0; spins < 100000; spins++) {
        if (inb(UART_LSR) & LSR_THR_EMPTY) break;
    }
    outb(UART_DATA, (uint8_t)c);
}

void serial_puts(const char *s) {
    while (*s) {
        if (*s == '\n') serial_putc('\r');   /* terminals want CRLF */
        serial_putc(*s);
        s++;
    }
}
