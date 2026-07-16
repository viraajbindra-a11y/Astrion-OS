/*
 * Astrion v2.0 — desktop shell (see desktop.h).
 *
 * Integer drawing on top of the kernel_mb2.c fb_* wrappers, with text rendered
 * in antialiased Inter (af.c) so the chrome matches the web build. No floats,
 * no heap — geometry is computed once from the screen size.
 */
#include <stdint.h>
#include "desktop.h"
#include "af.h"

extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);

/* ─── Layout constants ─── */
#define TOPBAR_H    44u
#define DOCK_H      86u
#define WIN_MARGIN  48u
#define TITLE_H     34u
#define PAD         12u
#define ICON_SZ     52u
#define ICON_GAP    34u

/* Geometry computed at init. */
static uint32_t SW, SH;
static uint32_t win_x, win_y, win_w, win_h;         /* Terminal window outer */
static uint32_t term_x, term_y, term_w, term_h;     /* console content inner */
static int g_active_icon = -1;

/* ─── Small helpers ─── */

/* Linear RGB interpolation a→b at num/den (signed so channels can decrease). */
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

/* ─── Components ─── */

static void draw_wallpaper(void) {
    for (uint32_t y = 0; y < SH; y++)
        fb_rect_x(0, y, SW, 1, lerp_color(AC_WALL_TOP, AC_WALL_BOT, (int)y, (int)SH));
}

static void draw_topbar(void) {
    fb_rect_x(0, 0, SW, TOPBAR_H, AC_BAR);
    /* Logo emblem: accent square with a dark notch. */
    fb_rect_x(16, 12, 22, 22, AC_ACCENT);
    fb_rect_x(23, 19, 8, 8, AC_BAR);
    af_draw(48, 12, "Astrion", AC_WHITE, AF_SB16);
    af_draw(48 + af_text_width("Astrion", AF_SB16) + 8, 15, "v2.0", AC_MUTED, AF_REG13);
    fb_rect_x(0, TOPBAR_H, SW, 1, AC_BORDER);   /* hairline under the bar */
}

/* Dock icon table (distinct macOS-ish system colors). */
struct dock_icon { const char *label; char glyph; uint32_t color; };
static const struct dock_icon g_icons[] = {
    { "Terminal",  'T', 0x5E5CE6u },   /* indigo */
    { "Files",     'F', 0x0A84FFu },   /* blue   */
    { "Editor",    'E', 0xFF9F0Au },   /* orange */
    { "Snake",     'S', 0x30D158u },   /* green  */
    { "Assistant", 'A', 0xBF5AF2u },   /* purple */
};
#define NICON ((uint32_t)(sizeof(g_icons) / sizeof(g_icons[0])))
#define DOCK_IY (SH - DOCK_H + 12)

static void draw_dock(void) {
    uint32_t dy = SH - DOCK_H;
    fb_rect_x(0, dy, SW, DOCK_H, AC_BAR);
    fb_rect_x(0, dy, SW, 1, AC_BORDER);

    uint32_t total = NICON * ICON_SZ + (NICON - 1) * ICON_GAP;
    uint32_t sx = SW / 2 - total / 2;
    uint32_t iy = DOCK_IY;
    for (uint32_t i = 0; i < NICON; i++) {
        uint32_t ix = sx + i * (ICON_SZ + ICON_GAP);
        int active = ((int)i == g_active_icon);
        if (active) fb_rect_x(ix - 3, iy - 3, ICON_SZ + 6, ICON_SZ + 6, AC_ACCENT);
        fb_rect_x(ix, iy, ICON_SZ, ICON_SZ, g_icons[i].color);
        char g[2] = { g_icons[i].glyph, 0 };
        uint32_t gw = af_text_width(g, AF_SB16);
        af_draw(ix + ICON_SZ / 2 - gw / 2,
                iy + ICON_SZ / 2 - (uint32_t)af_line_height(AF_SB16) / 2,
                g, AC_WHITE, AF_SB16);
        af_draw_center(ix + ICON_SZ / 2, iy + ICON_SZ + 4, g_icons[i].label,
                       active ? AC_WHITE : AC_MUTED, AF_REG13);
        if (active) fb_rect_x(ix + ICON_SZ / 2 - 2, iy + ICON_SZ + 22, 4, 4, AC_ACCENT);
    }
}

void desktop_set_active_app(int icon) {
    g_active_icon = icon;
    draw_dock();
}

static void draw_terminal_window(void) {
    fb_rect_x(win_x + 5, win_y + 5, win_w, win_h, 0x0A0E20u);   /* soft shadow */
    fb_rect_x(win_x, win_y, win_w, win_h, AC_TERM_BG);          /* body        */
    fb_rect_x(win_x, win_y, win_w, TITLE_H, AC_PANEL);          /* title bar   */
    fb_rect_x(win_x + 14, win_y + 12, 11, 11, AC_RED);          /* traffic     */
    fb_rect_x(win_x + 32, win_y + 12, 11, 11, AC_YELLOW);
    fb_rect_x(win_x + 50, win_y + 12, 11, 11, AC_GREEN);
    af_draw_center(win_x + win_w / 2, win_y + 8, "Terminal", AC_MUTED, AF_SB16);
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

/* Hit-test the dock — mirrors draw_dock()'s layout exactly. */
int desktop_dock_hit(int x, int y) {
    if (!SW) return -1;
    uint32_t dy = SH - DOCK_H;
    if (x < 0 || y < (int)dy) return -1;
    uint32_t total = NICON * ICON_SZ + (NICON - 1) * ICON_GAP;
    uint32_t sx = SW / 2 - total / 2;
    uint32_t iy = DOCK_IY;
    for (uint32_t i = 0; i < NICON; i++) {
        uint32_t ix = sx + i * (ICON_SZ + ICON_GAP);
        if ((uint32_t)x >= ix && (uint32_t)x < ix + ICON_SZ &&
            (uint32_t)y >= iy && (uint32_t)y < iy + ICON_SZ)
            return (int)i;
    }
    return -1;
}

void desktop_terminal_rect(uint32_t *x, uint32_t *y, uint32_t *w, uint32_t *h) {
    *x = term_x; *y = term_y; *w = term_w; *h = term_h;
}

void desktop_draw_clock(const char *hhmmss) {
    if (!SW) return;
    uint32_t w = af_text_width(hhmmss, AF_SB16);
    uint32_t x = SW - w - 24;
    fb_rect_x(x - 12, 6, w + 24, TOPBAR_H - 8, AC_BAR);   /* clear old */
    af_draw(x, 12, hhmmss, AC_WHITE, AF_SB16);
}
