/*
 * Astrion v2.0 — COM1 serial output
 *
 * The one output device that works before the framebuffer, after a crash, and
 * on a machine with nothing plugged into it. Two jobs:
 *
 *   1. Real-hardware bring-up. When the kernel does not reach the desktop on a
 *      physical box there is no screen to read the reason off, and a blank
 *      monitor cannot tell you whether you died in the multiboot2 parse or the
 *      page-table build. Serial can.
 *   2. Automated testing. The Python harnesses under kernel/tools boot QEMU
 *      with -serial file:… and assert on what comes out, so a UI test can check
 *      the shell's actual words instead of counting pixels that changed colour.
 *
 * These are the raw primitives and they are SYNCHRONOUS: serial_putc spins on
 * the transmit-holding-register-empty bit before it writes. At the 38400 baud
 * this configures, one byte is ~260us. That is unremarkable during boot and
 * unacceptable inside console.c's writer lock, which runs with interrupts off —
 * an 80-column line would hold them off for 20ms and starve the scheduler. See
 * console_serial_async() for how the console avoids that.
 */

#ifndef ASTRION_SERIAL_H
#define ASTRION_SERIAL_H

void serial_init(void);
void serial_putc(char c);
void serial_puts(const char *s);   /* expands '\n' to CRLF */

#endif
