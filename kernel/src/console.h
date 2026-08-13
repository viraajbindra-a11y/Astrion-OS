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

/* ─── Attach / detach ───
 *
 * The console's text lives in a backing store (see console.c), not in the
 * pixels. That is what lets the Terminal be a real window you can close, move
 * and reopen instead of a permanent hole in the desktop.
 *
 *   detached  the grid keeps accumulating — the shell runs, output is recorded,
 *             the cursor advances, lines scroll — but NOTHING is painted. This
 *             is the state while the Terminal window is closed.
 *   attached  anchored to (x,y,w,h) and painting again.
 *
 * console_attach() re-anchors AND repaints from the store, so it is the one
 * call the window manager needs on open, on move, and on reveal. It preserves
 * the logical cursor (row/column), not its pixel position, so text picks up
 * exactly where it left off wherever the window has been dragged to.
 *
 * Every writer below is safe in either state; nothing has to ask first. */
void     console_attach(uint32_t x, uint32_t y, uint32_t w, uint32_t h);
void     console_detach(void);
int      console_is_attached(void);

/* ─── Occlusion ───
 *
 * Being attached is not the same as being visible. Another window can sit on
 * top of the Terminal, and the console has no idea the window stack exists —
 * so it happily painted its next prompt straight across the Files window's
 * border. (One row clipped and the next did not, which looks like a clipping
 * bug but is really an ordering one: the first row was painted BEFORE Files
 * opened and got covered; the second was painted after and did the covering.)
 *
 * The window manager installs this test. Return 1 if any part of the given
 * rectangle is covered by something above the Terminal. The console consults
 * it before every pixel it writes and skips what it cannot legally paint; the
 * backing store is updated either way, so raising the Terminal repaints
 * whatever was skipped.
 *
 * Called per glyph cell, so it must be cheap — a handful of rectangle
 * comparisons, no allocation, no repaint. Never set means never occluded. */
typedef int (*console_occlusion_fn)(uint32_t x, uint32_t y, uint32_t w, uint32_t h);
void     console_set_occlusion_test(console_occlusion_fn fn);

/* Repaint if a write had to skip its pixels, and push the serial mirror out.
 * Call once per main-loop pass on task 0, never with the writer lock held.
 * No-op unless something is pending. See the definition for why scrolling under
 * a window needs this. */
void     console_service(void);

/* ─── COM1 mirror ───
 *
 * Every byte the console shows is also written to the serial port, which is the
 * only output that survives a machine with no working display — real-hardware
 * bring-up, and the QEMU test scripts in tools/, which assert on the shell's
 * real words instead of on pixel counts.
 *
 * Writing to the UART means spinning ~260us per byte, and putchar runs with
 * interrupts off, so the console buffers into a ring and drains it from
 * console_service() on task 0 instead. Call console_serial_async(1) once, right
 * before entering the main loop: until then writes go straight to the wire,
 * which is what makes the boot log (and a panic) complete rather than stuck in
 * a ring nobody is draining yet.
 *
 * console_serial_drain() is exposed for callers that are about to stop the
 * machine — halt, shutdown, a panic path — and need the tail of the log out
 * before it does. console_service() already calls it every pass. */
void     console_serial_async(int on);
void     console_serial_drain(void);

/* Push one byte into the serial mirror WITHOUT drawing it. For keystrokes that
 * never reach the console because an app window consumed them — otherwise they
 * are missing from the log entirely. Do not use it to echo shell input: the
 * shell already echoes to the console, and the console already mirrors. */
void     console_serial_echo(char c);
void     console_putchar(char c);
void     console_puts(const char *s);
void     console_put_u32(uint32_t v);
void     console_put_u64(uint64_t v);
void     console_put_hex64(uint64_t v);
void     console_put_hex16(uint16_t v);
void     console_put_hex8(uint8_t v);
void     console_set_color(uint32_t color);
uint32_t console_color(void);
/* Clears the grid and repaints. Call from task 0 with interrupts ON: the
 * repaint happens OUTSIDE the writer lock (it has to — a clear under a window
 * must be clipped per cell, which is a redraw, not one fill). All four callers
 * today are shell commands and the window manager, which qualify. */
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
