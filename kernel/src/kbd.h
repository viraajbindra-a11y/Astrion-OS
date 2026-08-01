/*
 * Astrion v2.0 - keyboard input
 *
 * Wires IRQ1 to read scancodes from port 0x60, translates US-layout
 * Set 1 scancodes to ASCII, fills a ring buffer the main loop can
 * drain via kbd_getchar() / kbd_available().
 *
 * serial_kbd_install() adds COM1 on IRQ4 as a SECOND producer for that
 * same ring buffer, so a terminal on the other end of a serial cable is
 * indistinguishable from the PS/2 keyboard to every consumer. The two
 * paths are independent - installing either, both, or neither is fine.
 */

#ifndef ASTRION_KBD_H
#define ASTRION_KBD_H

#include <stdint.h>

void kbd_install(void);     /* registers IRQ1 handler + unmasks the line */

/* ─── real-hardware diagnostics ───
 * Astrion reaches the keyboard through the PS/2 ports, and on a modern machine
 * those only exist because the firmware emulates them for your USB keyboard.
 * When that emulation is absent, the desktop comes up perfectly and nothing you
 * type does anything — so these two exist to make that say so out loud.
 *
 * kbd_controller_present(): 0 only when the status port reads 0xFF, i.e. the
 *   bus is floating and there is definitively no controller. Certain, cheap,
 *   and checked without writing any command that could disturb a working one.
 * kbd_scancodes_seen(): how many keys have actually arrived. Zero long after
 *   boot is suspicious, but it is not proof — the user may simply not have
 *   typed — so it is reported, never acted on. */
int      kbd_controller_present(void);
uint32_t kbd_scancodes_seen(void);
int  kbd_available(void);
char kbd_getchar(void);     /* returns 0 if buffer empty (non-blocking) */

/* Serial console input on COM1 / IRQ4. Enables the UART's received-data
 * interrupt and unmasks IRQ4; serial OUTPUT is untouched and stays polled. */
void serial_kbd_install(void);

/* Called once per timer tick from pit.c. Times out a held Esc so a lone Esc
 * still reaches the WM when no byte follows it, and guarantees the escape
 * state machine can never stay stuck. Safe (and a no-op) when serial input
 * was never installed. */
void serial_kbd_tick(void);

/* Special keys emitted as values > 127 so they don't collide with ASCII.
 * Shell.c filters keystrokes to 32..126 so these slip past it; only
 * dedicated consumers (snake game, future apps) see them. */
#define KEY_UP     ((char)128)
#define KEY_DOWN   ((char)129)
#define KEY_LEFT   ((char)130)
#define KEY_RIGHT  ((char)131)

/* Ctrl+C / Ctrl+V are folded into their classic ASCII control codes (ETX /
 * SYN). Both are < 32, so - like ESC (27) - they pass straight through the
 * "printable 32..126" filters the shell and apps use for text input, and
 * only the clipboard consumers act on them. */
#define KEY_CTRL_C ((char)0x03)   /* copy  */
#define KEY_CTRL_V ((char)0x16)   /* paste */

#endif
