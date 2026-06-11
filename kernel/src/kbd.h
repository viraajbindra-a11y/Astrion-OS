/*
 * Astrion v2.0 - PS/2 keyboard driver
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

/* Special keys emitted as values > 127 so they don't collide with ASCII.
 * Shell.c filters keystrokes to 32..126 so these slip past it; only
 * dedicated consumers (snake game, future apps) see them. */
#define KEY_UP     ((char)128)
#define KEY_DOWN   ((char)129)
#define KEY_LEFT   ((char)130)
#define KEY_RIGHT  ((char)131)

#endif
