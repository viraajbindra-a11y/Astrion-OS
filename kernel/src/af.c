/*
 * Astrion v2.0 — antialiased font renderer (see af.h).
 *
 * Integer-only (no SSE): each glyph is a grayscale coverage bitmap; we blend
 * it over the framebuffer with out = bg + (fg - bg) * a / 255 per channel.
 * af_font.h (the big generated atlas) is included ONLY here.
 */
#include <stdint.h>
#include "af.h"
#include "af_font.h"

extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern int      fb_present_x(void);

#define AF_NFACES ((int)(sizeof(af_faces) / sizeof(af_faces[0])))

static void blend_glyph(int px, int py, const af_glyph *g,
                        const unsigned char *blob, uint32_t color) {
    volatile uint32_t *fb = (volatile uint32_t *)(uintptr_t)fb_addr_x();
    uint32_t pitch = fb_pitch_x() / 4;
    int W = (int)fb_width_x(), H = (int)fb_height_x();
    int fr = (int)((color >> 16) & 0xFF);
    int fg = (int)((color >> 8) & 0xFF);
    int fbl = (int)(color & 0xFF);
    const unsigned char *src = blob + g->off;
    for (int yy = 0; yy < g->h; yy++) {
        int Y = py + g->yoff + yy;
        if (Y < 0 || Y >= H) continue;
        const unsigned char *row = src + (int)yy * g->w;
        for (int xx = 0; xx < g->w; xx++) {
            int a = row[xx];
            if (!a) continue;
            int X = px + g->xoff + xx;
            if (X < 0 || X >= W) continue;
            uint32_t bg = fb[(uint32_t)Y * pitch + (uint32_t)X];
            int br = (int)((bg >> 16) & 0xFF);
            int bgc = (int)((bg >> 8) & 0xFF);
            int bb = (int)(bg & 0xFF);
            int rr = br + (fr - br) * a / 255;
            int gg = bgc + (fg - bgc) * a / 255;
            int bl = bb + (fbl - bb) * a / 255;
            fb[(uint32_t)Y * pitch + (uint32_t)X] =
                ((uint32_t)rr << 16) | ((uint32_t)gg << 8) | (uint32_t)bl;
        }
    }
}

void af_draw(uint32_t x, uint32_t y, const char *s, uint32_t color, int face) {
    if (!fb_present_x() || face < 0 || face >= AF_NFACES) return;
    const af_face *f = &af_faces[face];
    int penx = (int)x;
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if ((int)c < f->first || (int)c >= f->first + f->count) {
            penx += f->glyphs[0].adv;      /* space width for unknown chars */
            continue;
        }
        const af_glyph *g = &f->glyphs[(int)c - f->first];
        blend_glyph(penx, (int)y, g, f->pix, color);
        penx += g->adv;
    }
}

uint32_t af_text_width(const char *s, int face) {
    if (face < 0 || face >= AF_NFACES) return 0;
    const af_face *f = &af_faces[face];
    uint32_t w = 0;
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if ((int)c < f->first || (int)c >= f->first + f->count) w += f->glyphs[0].adv;
        else w += f->glyphs[(int)c - f->first].adv;
    }
    return w;
}

int af_line_height(int face) {
    if (face < 0 || face >= AF_NFACES) return 0;
    return af_faces[face].line;
}
int af_ascent(int face) {
    if (face < 0 || face >= AF_NFACES) return 0;
    return af_faces[face].ascent;
}

void af_draw_center(uint32_t cx, uint32_t y, const char *s, uint32_t color, int face) {
    uint32_t w = af_text_width(s, face);
    af_draw(cx - w / 2, y, s, color, face);
}
