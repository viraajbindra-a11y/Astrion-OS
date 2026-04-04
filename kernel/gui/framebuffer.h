/**
 * NOVA OS Kernel — Framebuffer Graphics
 * Low-level pixel drawing on the screen.
 */

#ifndef NOVA_FRAMEBUFFER_H
#define NOVA_FRAMEBUFFER_H

#include "../include/types.h"
#include "../include/bootinfo.h"

// Initialize the framebuffer from boot info
void fb_init(BootInfo *info);

// Screen dimensions
uint32_t fb_width(void);
uint32_t fb_height(void);

// Drawing primitives
void fb_put_pixel(int x, int y, Color color);
void fb_fill_rect(int x, int y, int w, int h, Color color);
void fb_draw_rect(int x, int y, int w, int h, Color color);
void fb_fill_rounded_rect(int x, int y, int w, int h, int radius, Color color);
void fb_draw_line(int x0, int y0, int x1, int y1, Color color);
void fb_draw_circle(int cx, int cy, int r, Color color);
void fb_fill_circle(int cx, int cy, int r, Color color);
void fb_clear(Color color);

// Alpha blending
Color fb_blend(Color bg, Color fg);
void fb_put_pixel_alpha(int x, int y, Color color);
void fb_fill_rect_alpha(int x, int y, int w, int h, Color color);

// Text rendering (built-in bitmap font)
void fb_draw_char(int x, int y, char c, Color color, int scale);
void fb_draw_string(int x, int y, const char *str, Color color, int scale);
int  fb_text_width(const char *str, int scale);
int  fb_text_height(int scale);

// Double buffering
void fb_swap(void);  // copy back buffer to front buffer

// Screen regions
void fb_copy_rect(int sx, int sy, int dx, int dy, int w, int h);

#endif
