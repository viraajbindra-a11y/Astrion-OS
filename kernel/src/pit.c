/*
 * Astrion v2.0 - PIT driver
 *
 * The legacy 8254 PIT lives at I/O ports 0x40..0x43. Channel 0 is the
 * one wired to IRQ0; channel 2 used to be the PC speaker (we don't
 * care). The base clock is 1.193182 MHz. divisor = 1193182 / hz gives
 * the rate-generator reload value.
 */

#include <stdint.h>
#include "pit.h"
#include "idt.h"

#define PIT_BASE_HZ   1193182u
#define PIT_CMD       0x43
#define PIT_CH0       0x40

static volatile uint64_t ticks_total;
static uint32_t          tick_hz;
static volatile uint64_t cached_ms;

static inline void outb_(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static void pit_isr(struct registers *r) {
    (void)r;
    ticks_total++;
    /* Cheap integer ms - 1000 * ticks / hz. Cached so callers don't
     * pay the divide on hot paths. */
    cached_ms = (ticks_total * 1000) / tick_hz;
}

void pit_install(uint32_t hz) {
    if (hz == 0) hz = 100;
    tick_hz = hz;
    uint32_t divisor = PIT_BASE_HZ / hz;
    if (divisor > 0xFFFF) divisor = 0xFFFF;

    /* Command: channel 0, lobyte/hibyte access, mode 3 (rate gen),
     * binary count. Byte = 0b00110110. */
    outb_(PIT_CMD, 0x36);
    outb_(PIT_CH0, (uint8_t)(divisor & 0xFF));
    outb_(PIT_CH0, (uint8_t)((divisor >> 8) & 0xFF));

    irq_register(0, pit_isr);
    pic_unmask_irq(0);
}

uint64_t pit_ticks(void)      { return ticks_total; }
uint64_t pit_elapsed_ms(void) { return cached_ms; }

/* "HH:MM:SS" - clamped to 99:59:59. */
void pit_format_clock(char buf[9]) {
    uint64_t total_s = cached_ms / 1000;
    uint32_t s = (uint32_t)(total_s % 60);
    uint32_t m = (uint32_t)((total_s / 60) % 60);
    uint32_t h = (uint32_t)(total_s / 3600);
    if (h > 99) h = 99;
    buf[0] = '0' + (h / 10);
    buf[1] = '0' + (h % 10);
    buf[2] = ':';
    buf[3] = '0' + (m / 10);
    buf[4] = '0' + (m % 10);
    buf[5] = ':';
    buf[6] = '0' + (s / 10);
    buf[7] = '0' + (s % 10);
    buf[8] = 0;
}
