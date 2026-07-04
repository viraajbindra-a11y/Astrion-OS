/*
 * Astrion v2.0 — desktop shell (see desktop.h).
 *
 * Pure integer drawing on top of the kernel_mb2.c fb_* wrappers. No floats,
 * no SSE (MB2_CFLAGS bans them, lesson #196), no heap — geometry is computed
 * once from the screen size and stashed in file statics.
 */
#include <stdint.h>
#include "desktop.h"
#include "fb_font.h"

/* kernel_mb2.c exported framebuffer wrappers. */
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);

/* ─── Layout constants ─── */
#define TOPBAR_H    44u
#define DOCK_H      78u
#define WIN_MARGIN  48u
#define TITLE_H     30u
#define PAD         12u
#define ICON_SZ     52u
#define ICON_GAP    34u

/* Geometry computed at init. */
static uint32_t SW, SH;
static uint32_t win_x, win_y, win_w, win_h;         /* Terminal window outer */
static uint32_t term_x, term_y, term_w, term_h;     /* console content inner */

/* ─── Small helpers ─── */

static int str_len(const char *s) { int n = 0; while (s[n]) n++; return n; }

/* Linear RGB interpolation a→b at num/den. Uses signed math so a channel
 * that decreases (b<a) doesn't wrap through unsigned underflow. */
static uint32_t lerp_color(uint32_t a, uint32_t b, int num, int den) {
    int ar = (a >> 16) & 0xFF, ag = (a >> 8) & 0xFF, ab = a & 0xFF;
    int br = (b >> 16) & 0xFF, bg = (b >> 8) & 0xFF, bb = b & 0xFF;
    int r = ar + (br - ar) * num / den;
    int g = ag + (bg - ag) * num / den;
    int bl = ab + (bb - ab) * num / den;
    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)bl;
}

static void draw_border(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t c) {
    fb_rect_x(x, y, w, 1, c);
    fb_rect_x(x, y + h - 1, w, 1, c);
    fb_rect_x(x, y, 1, h, c);
    fb_rect_x(x + w - 1, y, 1, h, c);
}

/* Draw s centered horizontally about cx_center at baseline y. */
static void text_centered(uint32_t cx_center, uint32_t y, const char *s,
                          uint32_t color, int scale) {
    uint32_t w = (uint32_t)(str_len(s) * FONT_WIDTH * scale);
    fb_puts_x(cx_center - w / 2, y, s, color, scale);
}

/* ─── Components ─── */

static void draw_wallpaper(void) {
    /* Vertical gradient, one full-width row at a time. */
    for (uint32_t y = 0; y < SH; y++)
        fb_rect_x(0, y, SW, 1, lerp_color(AC_WALL_TOP, AC_WALL_BOT, (int)y, (int)SH));
}

static void draw_topbar(void) {
    fb_rect_x(0, 0, SW, TOPBAR_H, AC_BAR);
    /* Logo emblem: orange square with a navy notch. */
    fb_rect_x(16, 10, 24, 24, AC_ORANGE);
    fb_rect_x(23, 17, 10, 10, AC_BAR);
    fb_puts_x(52, 12, "Astrion", AC_WHITE, 2);
    fb_puts_x(52 + 7 * FONT_WIDTH * 2 + 10, 18, "v2.0", AC_MUTED, 1);
    /* Accent hairline under the bar. */
    fb_rect_x(0, TOPBAR_H, SW, 2, AC_ORANGE);
}

/* Dock icon table. glyph is drawn scale-3 centered; label sits underneath. */
struct dock_icon { const char *label; char glyph; uint32_t color; };
static const struct dock_icon g_icons[] = {
    { "Terminal",  'T', AC_ORANGE },
    { "Files",     'F', AC_BLUE   },
    { "Editor",    'E', AC_TEAL   },
    { "Snake",     'S', AC_GREEN  },
    { "Assistant", 'A', AC_PURPLE },
};
#define NICON ((uint32_t)(sizeof(g_icons) / sizeof(g_icons[0])))

static void draw_dock(void) {
    uint32_t dy = SH - DOCK_H;
    fb_rect_x(0, dy, SW, DOCK_H, AC_BAR);
    fb_rect_x(0, dy, SW, 2, 0x1E2A55u);   /* top-edge highlight */

    uint32_t total = NICON * ICON_SZ + (NICON - 1) * ICON_GAP;
    uint32_t sx = SW / 2 - total / 2;
    uint32_t iy = dy + 8;
    for (uint32_t i = 0; i < NICON; i++) {
        uint32_t ix = sx + i * (ICON_SZ + ICON_GAP);
        fb_rect_x(ix, iy, ICON_SZ, ICON_SZ, g_icons[i].color);
        char g[2] = { g_icons[i].glyph, 0 };
        fb_puts_x(ix + ICON_SZ / 2 - (FONT_WIDTH * 3) / 2,
                  iy + ICON_SZ / 2 - (FONT_HEIGHT * 3) / 2, g, AC_BAR, 3);
        text_centered(ix + ICON_SZ / 2, iy + ICON_SZ + 5, g_icons[i].label, AC_MUTED, 1);
    }
}

static void draw_terminal_window(void) {
    /* Soft drop shadow. */
    fb_rect_x(win_x + 5, win_y + 5, win_w, win_h, 0x0A0E24u);
    /* Body + title bar. */
    fb_rect_x(win_x, win_y, win_w, win_h, AC_TERM_BG);
    fb_rect_x(win_x, win_y, win_w, TITLE_H, AC_PANEL);
    /* Traffic-light dots. */
    fb_rect_x(win_x + 12, win_y + 10, 10, 10, AC_RED);
    fb_rect_x(win_x + 30, win_y + 10, 10, 10, AC_YELLOW);
    fb_rect_x(win_x + 48, win_y + 10, 10, 10, AC_TEAL);
    fb_puts_x(win_x + 72, win_y + 8, "Terminal", AC_WHITE, 2);
    draw_border(win_x, win_y, win_w, win_h, AC_BORDER);
}

/* ─── Public API ─── */

static void compute_geometry(void) {
    SW = fb_width_x();
    SH = fb_height_x();
    win_x = WIN_MARGIN;
    win_y = TOPBAR_H + 20;
    win_w = SW - 2 * WIN_MARGIN;
    win_h = SH - win_y - DOCK_H - 20;
    term_x = win_x + PAD;
    term_y = win_y + TITLE_H + 8;
    term_w = win_w - 2 * PAD;
    term_h = win_h - TITLE_H - 8 - PAD;
}

void desktop_init(void) {
    compute_geometry();
    draw_wallpaper();
    draw_topbar();
    draw_dock();
    draw_terminal_window();
}

void desktop_repaint_chrome(void) { desktop_init(); }

void desktop_terminal_rect(uint32_t *x, uint32_t *y, uint32_t *w, uint32_t *h) {
    *x = term_x; *y = term_y; *w = term_w; *h = term_h;
}

void desktop_draw_clock(const char *hhmmss) {
    if (!SW) return;   /* not initialized yet */
    uint32_t w = (uint32_t)(str_len(hhmmss) * FONT_WIDTH * 2);
    uint32_t x = SW - w - 24;
    fb_rect_x(x - 10, 8, w + 20, FONT_HEIGHT * 2 + 4, AC_BAR);   /* clear old */
    fb_puts_x(x, 12, hhmmss, AC_ORANGE, 2);
}
