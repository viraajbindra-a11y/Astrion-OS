/*
 * Astrion v2.0 — PS/2 mouse driver
 *
 * 8042 controller auxiliary device on IRQ12. Reads 3-byte packets,
 * accumulates motion into (x, y) in screen-pixel units, exposes a
 * dirty flag the main loop polls to repaint the cursor.
 *
 * Cursor rendering happens here too — we own the sprite + the
 * save-restore-background discipline so the rest of the kernel
 * doesn't have to know the cursor exists.
 */

#ifndef ASTRION_MOUSE_H
#define ASTRION_MOUSE_H

#include <stdint.h>

void mouse_install(uint32_t screen_w, uint32_t screen_h);
void mouse_redraw_if_dirty(void);   /* called from main loop */
int  mouse_x(void);
int  mouse_y(void);
int  mouse_left_down(void);
int  mouse_right_down(void);

/* Latch the click edge — returns true if a left-click happened since
 * the last call. Used by demo "buttons" on the boot screen. */
int  mouse_take_left_click(void);

#endif
