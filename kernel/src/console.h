/*
 * Astrion v2.0 - Scrolling framebuffer console
 *
 * Manages a fixed text region on the framebuffer. Tracks cursor,
 * scrolls when the cursor would go off the bottom, and exposes
 * putchar / puts / put_u32 / put_hex helpers tuned for an in-kernel
 * shell. Owns its own color palette so callers don't pass colors on
 * every call.
 */

#ifndef ASTRION_CONSOLE_H
#define ASTRION_CONSOLE_H

#include <stdint.h>

void     console_init(uint32_t x, uint32_t y, uint32_t w, uint32_t h);
void     console_putchar(char c);
void     console_puts(const char *s);
void     console_put_u32(uint32_t v);
void     console_put_u64(uint64_t v);
void     console_put_hex64(uint64_t v);
void     console_set_color(uint32_t color);
uint32_t console_color(void);
void     console_clear(void);
void     console_newline(void);
void     console_backspace(void);    /* erase prior glyph, retreats cursor */

/* Repaint the whole console region from its backing store. Needed when
 * something (an overlapping window) has drawn over the terminal. */
void     console_redraw(void);

/* Repaint only the cells intersecting this rect, clipped to the console region
 * (a no-op if it falls outside). For the main loop's mouse-cursor repair: the
 * cursor can put back the pixels it covered, but not the glyph ink the console
 * blended around it while it sat there — only the backing store has that. */
void     console_repaint_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h);

/* ─── Writer lock ───
 * Every function above already locks itself, so ONE putchar/puts/put_u32 call
 * can't be split by another writer. These two are for the case where one
 * logical line is built from SEVERAL calls (set_color + puts + put_u32 + puts)
 * and you need the whole run to land together — a ring-3 program printing
 * through SYS_PUTS while the shell is drawing its prompt, say.
 *
 * Usage, and it must be exactly this shape:
 *     uint64_t f = console_lock();
 *     ... console calls ...
 *     console_unlock(f);
 *
 * The lock is the interrupt flag, saved and restored, so it nests safely with
 * the per-call locking inside console.c and with any caller that already had
 * interrupts off. Nothing ever waits on it, so it cannot deadlock.
 *
 * Two rules: keep the held region SHORT (interrupts are off — no full-screen
 * repaints, no disk I/O), and always unlock BEFORE any call that doesn't
 * return (task_exit, halt loops), or the next task inherits IF=0 and the
 * scheduler stops. */
uint64_t console_lock(void);
void     console_unlock(uint64_t flags);

/* Output redirection: when a capture buffer is set, console_putchar
 * APPENDS to that buffer instead of drawing on the framebuffer.
 * Used to implement '>' in the shell. Set buf=NULL to restore
 * normal screen output. */
void     console_set_capture(uint8_t *buf, uint32_t cap, uint32_t *len_out);
void     console_clear_capture(void);
int      console_capture_active(void);   /* 1 if output is being captured */

#endif
