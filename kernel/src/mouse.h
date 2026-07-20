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

/* ─── The one rule ───
 *
 *   ANNOUNCE BEFORE YOU PAINT.
 *
 * The cursor caches the pixels underneath it and paints them back when it
 * moves. Any painter touching that patch must call mouse_invalidate_rect()
 * BEFORE it writes — not after, not instead. That single ordering is what the
 * whole thing rests on, and it has now cost three bugs to learn.
 *
 * WHY BEFORE. mouse_invalidate_rect() lifts the sprite immediately, using the
 * cache it is holding. Called before the write, that cache is still true and
 * the lift is exact. Called after, it is a lie, and putting it back stamps
 * stale pixels over fresh content — which was bug one: three `help`s under an
 * untouched pointer, one nudge, and a 22x36 block of boot-era background
 * landed on the console and ate a letter.
 *
 * WHY NOT REPAIR AFTERWARDS. This used to set a flag and let task 0 clean up
 * later. That is unfixable for a painter which MOVES pixels rather than
 * overwriting them: console scroll blits the terminal up a row with the arrow
 * in it, and afterwards there is a copy of the cursor somewhere nothing has a
 * record of. Cleaning "where the cursor is" left every scrolled-away copy on
 * screen — five stacked arrows after five scrolls, gone only on `clear`. That
 * was bug three, and it is why the repair is now eager rather than deferred:
 * lifted before the move, there is nothing of ours to copy.
 *
 * SO: after invalidate, nothing of ours is on the framebuffer. Paint freely.
 * mouse_redraw_if_dirty() on task 0 puts the cursor back on whatever you left,
 * capturing a fresh background. There is no repair step and no rect to hand
 * back — the region's owner never has to repaint what the arrow was hiding,
 * because the arrow was gone before it drew.
 *
 * mouse_lift() remains the equivalent for task-0 painters that want the cursor
 * down across a whole sequence (the window manager, opening or dragging a
 * window) rather than for one rectangle. */

/* Tell the cursor that (x,y,w,h) is ABOUT TO BE painted, and lift it if that
 * rectangle touches the sprite. Call it before every write to the region,
 * including one that only moves pixels.
 *
 * Safe from any context — it takes no lock and cannot wait, and it saves and
 * restores the interrupt flag so it nests inside console.c's masked sections.
 * It DOES write pixels (this changed): a sprite-shaped erase, ~300 writes, and
 * only on the first damage after the cursor is drawn. A still cursor parked
 * away from the damage costs one compare. */
void mouse_invalidate_rect(int x, int y, int w, int h);

/* How many times a caller announced a rectangle whose pixels had ALREADY
 * changed — i.e. painted first and called us second, breaking the rule above.
 * Should be 0 forever. It is a convention no compiler can enforce, so it is
 * measured instead: if this is ever non-zero, some painter is reintroducing
 * the stale-cache bug family and the count is the only thing that will say so. */
unsigned long mouse_bg_faults(void);

#endif
