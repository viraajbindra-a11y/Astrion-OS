/*
 * Astrion v2.0 — antialiased font renderer (Inter, SIL OFL).
 *
 * Glyph atlases are generated offline (kernel/tools/gpt/../gen_font.py) into
 * af_font.h and alpha-blended over the framebuffer here. This is what makes
 * the kernel UI look like the web build instead of a blocky bitmap font.
 *
 * (x,y) passed to af_draw is the TOP-LEFT of the text line; glyph vertical
 * offsets are baked into the atlas so baselines line up.
 */
#ifndef ASTRION_AF_H
#define ASTRION_AF_H

#include <stdint.h>

/* Faces — indices into af_faces[] in af_font.h. Keep in sync with gen_font.py. */
enum { AF_REG13, AF_REG16, AF_SB16, AF_SB30 };

void     af_draw(uint32_t x, uint32_t y, const char *s, uint32_t color, int face);
uint32_t af_text_width(const char *s, int face);   /* pixel advance of s */
int      af_line_height(int face);
int      af_ascent(int face);

/* Draw s horizontally centered on cx (top at y). */
void     af_draw_center(uint32_t cx, uint32_t y, const char *s, uint32_t color, int face);

#endif
