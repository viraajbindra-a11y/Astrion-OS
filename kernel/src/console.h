/*
 * Astrion v2.0 — Scrolling framebuffer console
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

/* Output redirection: when a capture buffer is set, console_putchar
 * APPENDS to that buffer instead of drawing on the framebuffer.
 * Used to implement '>' in the shell. Set buf=NULL to restore
 * normal screen output. */
void     console_set_capture(uint8_t *buf, uint32_t cap, uint32_t *len_out);
void     console_clear_capture(void);

#endif
