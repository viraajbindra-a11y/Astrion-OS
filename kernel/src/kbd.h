/*
 * Astrion v2.0 — PS/2 keyboard driver
 *
 * Wires IRQ1 to read scancodes from port 0x60, translates US-layout
 * Set 1 scancodes to ASCII, fills a ring buffer the main loop can
 * drain via kbd_getchar() / kbd_available().
 */

#ifndef ASTRION_KBD_H
#define ASTRION_KBD_H

#include <stdint.h>

void kbd_install(void);     /* registers IRQ1 handler + unmasks the line */
int  kbd_available(void);
char kbd_getchar(void);     /* returns 0 if buffer empty (non-blocking) */

#endif
