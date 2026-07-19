/*
 * Astrion v2.0 - PS/2 mouse driver
 *
 * 8042 controller auxiliary device on IRQ12. Reads 3-byte packets,
 * accumulates motion into (x, y) in screen-pixel units, exposes a
 * dirty flag the main loop polls to repaint the cursor.
 *
 * Cursor rendering happens here too - we own the sprite + the
 * save-restore-background discipline so the rest of the kernel
 * doesn't have to know the cursor exists.
 */

#ifndef ASTRION_MOUSE_H
#define ASTRION_MOUSE_H

#include <stdint.h>

void mouse_install(uint32_t screen_w, uint32_t screen_h);
void mouse_redraw_if_dirty(void);   /* called from main loop */
void mouse_lift(void);              /* restore cursor bg + force fresh redraw */
int  mouse_x(void);
int  mouse_y(void);
int  mouse_left_down(void);
int  mouse_right_down(void);

/* Latch the click edge - returns true if a left-click happened since
 * the last call. Used by demo "buttons" on the boot screen. */
int  mouse_take_left_click(void);

/* ─── Stale-background invalidation ───
 *
 * The cursor caches the pixels underneath it (saved_bg) and paints them back
 * when it moves. If somebody ELSE repaints that patch of framebuffer while the
 * cursor is sitting still, the cache is silently wrong, and the next move
 * stamps the old pixels over the new content. That was a real, visible bug:
 * three `help`s under an untouched cursor, then one nudge, and a 22x36 block of
 * boot-era background landed on top of the console text and ate a letter.
 *
 * mouse_lift() is the fix for painters that run on task 0 with interrupts on —
 * it takes the sprite off the screen BEFORE they paint, while the cache is
 * still true. It is the WRONG tool for two kinds of caller:
 *   - console.c, which masks interrupts around its mutating paths. mouse_lift()
 *     does ~800 framebuffer writes; doing those inside that critical section is
 *     exactly the interrupt latency we avoided by leaving console_redraw()
 *     unlocked.
 *   - anything on another task (the clock, a background ticker, a ring-3
 *     program printing). Those preempt task 0, which may be halfway through the
 *     cursor's own pixel loops — mouse_lift() would mutate lx/ly/saved_bg
 *     underneath it.
 *
 * So those callers INVALIDATE instead. mouse_invalidate_rect() takes no locks,
 * touches no framebuffer, and does nothing but test a rectangle and set a flag:
 * safe from any context, including with interrupts already masked.
 *
 * The repair then happens on task 0, in the main loop, where it is safe:
 *
 *     if (mouse_bg_stale()) {
 *         int x, y, w, h;
 *         mouse_erase_cursor(&x, &y, &w, &h);
 *         console_repaint_rect(x, y, w, h);   // owner repaints what was hidden
 *     }
 *     mouse_redraw_if_dirty();                // re-anchors on a clean background
 */

/* Tell the cursor that (x,y,w,h) is about to be repainted. No-ops unless that
 * rectangle actually overlaps the sprite, so a still cursor parked far from the
 * damage costs one compare. Flag-only: safe with interrupts off. */
void mouse_invalidate_rect(int x, int y, int w, int h);

/* 1 if a repaint has landed under the cursor since the last erase. */
int  mouse_bg_stale(void);

/* Take the sprite off the framebuffer SPRITE-SHAPED: only the pixels the arrow
 * actually covered are written back, so content that was painted around it
 * survives. Reports the rect that was occupied (w=h=0 if there was nothing to
 * erase) so the region's owner can repaint what the arrow was hiding. Leaves
 * the cursor un-painted, so the next mouse_redraw_if_dirty() re-captures a
 * clean background. Task-0 only — it writes pixels. */
void mouse_erase_cursor(int *x, int *y, int *w, int *h);

#endif
