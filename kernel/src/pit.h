/*
 * Astrion v2.0 — Programmable Interval Timer (8254 PIT)
 *
 * Channel 0 is wired to IRQ0. We configure it as a rate generator
 * (mode 3) at ~100 Hz. Each tick increments a 64-bit counter.
 *
 * Public API:
 *   pit_install(hz)       — set frequency, register IRQ0 handler.
 *   pit_ticks()           — total ticks since boot.
 *   pit_elapsed_ms()      — elapsed time in ms (cached on tick).
 *   pit_format_clock(buf) — writes "HH:MM:SS" into buf[9].
 */

#ifndef ASTRION_PIT_H
#define ASTRION_PIT_H

#include <stdint.h>

void     pit_install(uint32_t hz);
uint64_t pit_ticks(void);
uint64_t pit_elapsed_ms(void);
void     pit_format_clock(char buf[9]);

#endif
