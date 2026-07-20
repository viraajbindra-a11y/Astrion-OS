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
#include "settings.h"   /* accent + wallpaper are the user's, not this file's */

extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
/* Dimming the desktop behind the power dialog needs to READ pixels, so we take
 * the same framebuffer accessors wm.c/af.c use. */
extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);
extern int      fb_present_x(void);

/* The power dialog actually turns the machine off, so it calls Koa's power
 * mechanism (power.h). The host render harness can't run privileged
 * instructions, so it defines DESKTOP_HOST_TEST to swap in no-op stubs and a
 * no-op halt — the harness only ever paints the screens, never executes them. */
#ifdef DESKTOP_HOST_TEST
/* Only the two entry points the UI actually calls are stubbed; the harness
 * paints the screens but never executes them. */
static void power_off(void)    { }
static void power_reboot(void) { }
#define CPU_HALT() do { } while (0)
/* The harness has no PS/2 mouse, so nothing is ever cached over the pixels. */
static void mouse_invalidate_rect(int x, int y, int w, int h)
                                 { (void)x; (void)y; (void)w; (void)h; }
#else
#include "power.h"
#include "mouse.h"
#define CPU_HALT() __asm__ volatile("cli; hlt")
#endif

/* ─── Layout constants ───
 *
 * DESK_GAP is the desktop's gutter and it is the SAME on all four sides. It
 * used to be three different numbers — 48 left and right, 20 below the top bar,
 * 20 above the dock — which after the bar and dock ate their share left 19px of
 * wallpaper visible at the top and 15px at the bottom. The window did not read
 * as a window placed on a desktop; it read as a box that had failed to fill the
 * screen, and the gradient wallpaper (the one element that says "this is a
 * surface things sit on") was a sliver nobody could see. One gutter, one
 * rhythm, and the desktop is actually present on every side.
 *
 * TITLE_H matches wm.c's TITLE_H deliberately. The Terminal's title bar was 34
 * and every other window's was 30, so two windows side by side wore visibly
 * different chrome. Astrion has one kind of window. */
#define TOPBAR_H    44u
#define DOCK_H      86u
#define DESK_GAP    40u
#define TITLE_H     30u   /* == wm.c TITLE_H — change both or neither */
#define PAD         14u
#define ICON_SZ     52u
#define ICON_GAP    34u

/* Corner radii. Windows are gently rounded; dock tiles are rounded hard enough
 * to read as objects rather than swatches (~23% of the tile, the proportion a
 * squircle-ish app tile wants). */
#define WIN_R        8u
#define TILE_R      12u

/* Peak darkening under a floating surface, out of 256. 150 ≈ 59% — deep enough
 * to separate a window from the wall, shallow enough that the wallpaper still
 * reads through it as a backdrop rather than a black halo. */
#define SHADOW_MAX 150
/* Power button — far right of the top bar. The hit target is the button box;
 * the clock reserves CLOCK_PAD on the right so the two never overlap and the
 * clock's every-second repaint can't nibble the button. */
#define PWR_BTN_W   30u    /* button hit width                        */
#define PWR_MARGIN  14u    /* button's gap to the screen's right edge */
#define CLOCK_PAD   68u    /* clock's right margin: clears the button */
#define CLOCK_MAXW  200u   /* fixed clear band — see desktop_draw_clock */

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

/* ─── Shape primitives (see desktop.h for why these exist) ─── */

/* Integer square root. Bounded by the operand's root, and every caller here
 * passes a radius under ~64, so this is a few dozen compares — cheaper than
 * carrying a table, and there is no FPU to reach for anyway. */
static uint32_t isqrt_u(uint32_t v) {
    uint32_t r = 0;
    while ((r + 1) * (r + 1) <= v) r++;
    return r;
}

/* Read-modify-write one pixel toward `color` at coverage a/255. This is how we
 * antialias without an alpha channel: there is no compositor, so the "backdrop"
 * is literally whatever is already on the screen. */
static void blend_px(int x, int y, uint32_t color, int a) {
    if (a <= 0) return;
    if (!fb_present_x()) return;
    if (x < 0 || y < 0 || x >= (int)fb_width_x() || y >= (int)fb_height_x()) return;
    if (a >= 255) { fb_rect_x((uint32_t)x, (uint32_t)y, 1, 1, color); return; }
    volatile uint32_t *fb = (volatile uint32_t *)(uintptr_t)fb_addr_x();
    uint32_t pitch = fb_pitch_x() / 4;
    uint32_t bg = fb[(uint32_t)y * pitch + (uint32_t)x];
    int br = (int)((bg >> 16) & 0xFF), bgc = (int)((bg >> 8) & 0xFF), bb = (int)(bg & 0xFF);
    int fr = (int)((color >> 16) & 0xFF), fg = (int)((color >> 8) & 0xFF), fbl = (int)(color & 0xFF);
    int rr = br  + (fr  - br)  * a / 255;
    int gg = bgc + (fg  - bgc) * a / 255;
    int bl = bb  + (fbl - bb)  * a / 255;
    fb[(uint32_t)y * pitch + (uint32_t)x] =
        ((uint32_t)rr << 16) | ((uint32_t)gg << 8) | (uint32_t)bl;
}

/* Horizontal half-width, in EIGHTHS of a pixel, of a circle of radius r at a
 * vertical offset of dy8 eighths from its centre. Working in eighths is what
 * buys the antialiasing: the whole part picks the last solid pixel, the
 * remainder is the coverage of the one past it.
 *
 * The offset is passed in eighths (not whole pixels) because a pixel's centre
 * sits at its middle, not its top edge. Sampling the arc at the row's TOP
 * meant the first row of an 11px dot got a half-width of exactly zero, so the
 * dots came out as squares with a single pixel stuck on top and bottom. Half a
 * pixel is the whole difference between a circle and a lozenge at this size. */
static uint32_t arc_half8(uint32_t r, int dy8) {
    int r8 = (int)r * 8;
    if (dy8 < 0) dy8 = -dy8;
    if (dy8 >= r8) return 0;
    return isqrt_u((uint32_t)(r8 * r8 - dy8 * dy8));
}

/* Row j's vertical offset from the nearer corner-arc centre, in eighths.
 * Returns 0 and sets *straight for the rows between the two arcs. */
static int corner_dy8(uint32_t j, uint32_t h, uint32_t r, int *straight) {
    *straight = 0;
    if (j < r)          return (int)(r * 8) - (int)(j * 8) - 4;
    if (j >= h - r)     return (int)(j * 8) + 4 - (int)((h - r) * 8);
    *straight = 1;
    return 0;
}

void ac_fill_round(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                   uint32_t r, uint32_t color) {
    if (!w || !h) return;
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    if (!r) { fb_rect_x(x, y, w, h, color); return; }

    for (uint32_t j = 0; j < h; j++) {
        int straight;
        int dy8 = corner_dy8(j, h, r, &straight);
        if (straight) { fb_rect_x(x, y + j, w, 1, color); continue; }
        uint32_t half8  = arc_half8(r, dy8);
        uint32_t inset8 = r * 8 - half8;      /* shape's edge, in eighths of px */
        uint32_t whole  = inset8 / 8, frac = inset8 % 8;

        /* The shape's edge falls at x + whole + frac/8, i.e. INSIDE pixel
         * `whole`, covering the (8-frac)/8 of it that lies to the right. So the
         * solid run starts one pixel further in and `whole` itself carries the
         * partial coverage.
         *
         * The first cut of this had both halves of that wrong — it started the
         * solid run AT `whole` and put frac (rather than 8-frac) of the colour
         * on the pixel OUTSIDE it. The two errors compounded into roughly one
         * extra pixel of solid colour on each side of every arc, which at an
         * 11px window dot is the entire curve: the "circles" came out as
         * rounded squares. Small radii have no margin for this. */
        uint32_t solid = frac ? whole + 1 : whole;
        if (solid * 2 < w)
            fb_rect_x(x + solid, y + j, w - solid * 2, 1, color);
        if (frac) {
            int a = (int)((8u - frac) * 255u / 8u);
            blend_px((int)(x + whole),         (int)(y + j), color, a);
            blend_px((int)(x + w - 1 - whole), (int)(y + j), color, a);
        }
    }
}

void ac_stroke_round(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                     uint32_t r, uint32_t color) {
    if (!w || !h) return;
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    if (!r) { draw_border(x, y, w, h, color); return; }

    /* Straight runs first: the four sides between the corner arcs. */
    fb_rect_x(x + r, y,         w - 2 * r, 1, color);
    fb_rect_x(x + r, y + h - 1, w - 2 * r, 1, color);
    fb_rect_x(x,         y + r, 1, h - 2 * r, color);
    fb_rect_x(x + w - 1, y + r, 1, h - 2 * r, color);

    /* Corner arcs: one pixel per row, blended across the two it falls between. */
    for (uint32_t j = 0; j < r; j++) {
        int dy8         = (int)(r * 8) - (int)(j * 8) - 4;
        uint32_t inset8 = r * 8 - arc_half8(r, dy8);
        uint32_t whole  = inset8 / 8, frac = inset8 % 8;
        /* Split the 1px rim between the two pixels the edge falls between,
         * weighted the same way the fill weights them — so the outline traces
         * exactly the silhouette ac_fill_round paints and never sits a pixel
         * proud of it. Drawn inward, like draw_border. */
        int a_edge = (int)((8u - frac) * 255u / 8u);
        int a_next = 255 - a_edge;
        uint32_t ty = y + j, by = y + h - 1 - j;
        for (int s = 0; s < 2; s++) {
            uint32_t yy = s ? by : ty;
            blend_px((int)(x + whole),         (int)yy, color, a_edge);
            blend_px((int)(x + w - 1 - whole), (int)yy, color, a_edge);
            if (a_next) {
                blend_px((int)(x + whole + 1),     (int)yy, color, a_next);
                blend_px((int)(x + w - 2 - whole), (int)yy, color, a_next);
            }
        }
    }
}

/* A circle is a rounded rectangle whose radius is half its side, so this is
 * ac_fill_round with the numbers filled in. Deliberately NOT a second arc
 * loop: one geometry routine means a dot and a window corner can never end up
 * curving differently, which is exactly the kind of drift nobody notices for
 * months and then can't unsee. */
void ac_fill_disc(int cx, int cy, int r, uint32_t color) {
    if (r <= 0) return;
    if (cx - r < 0 || cy - r < 0) return;
    ac_fill_round((uint32_t)(cx - r), (uint32_t)(cy - r),
                  (uint32_t)(r * 2 + 1), (uint32_t)(r * 2 + 1),
                  (uint32_t)r, color);
}

void ac_shadow(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
               uint32_t r, uint32_t spread) {
    if (!fb_present_x() || !w || !h || !spread) return;
    volatile uint32_t *fb = (volatile uint32_t *)(uintptr_t)fb_addr_x();
    uint32_t pitch = fb_pitch_x() / 4;
    int SWi = (int)fb_width_x(), SHi = (int)fb_height_x();

    /* Light comes from above, so the shadow sits slightly below the box. */
    int bx = (int)x, by = (int)y + 2, bw = (int)w, bh = (int)h, sp = (int)spread;
    /* The window body will be painted over this rect, so skip it entirely. */
    int kx = (int)x, ky = (int)y, kw = (int)w, kh = (int)h;

    int y0 = by - sp, y1 = by + bh + sp;
    int x0 = bx - sp, x1 = bx + bw + sp;
    if (y0 < 0) y0 = 0;
    if (x0 < 0) x0 = 0;
    if (y1 > SHi) y1 = SHi;
    if (x1 > SWi) x1 = SWi;

    /* Corner radius pulls the shadow in at the corners so it follows the shape
     * of the thing casting it rather than its bounding box. */
    int ri = (int)r;
    if (ri > bw / 2) ri = bw / 2;
    if (ri > bh / 2) ri = bh / 2;

    for (int py = y0; py < y1; py++) {
        int inside_ky = (py >= ky && py < ky + kh);
        for (int px = x0; px < x1; px++) {
            if (inside_ky && px >= kx && px < kx + kw) {
                px = kx + kw - 1;            /* skip the whole covered run */
                continue;
            }
            /* Distance from the (rounded) shadow box, integer. */
            int dx = 0, dy = 0;
            if (px < bx + ri)           dx = (bx + ri) - px;
            else if (px > bx + bw - 1 - ri) dx = px - (bx + bw - 1 - ri);
            if (py < by + ri)           dy = (by + ri) - py;
            else if (py > by + bh - 1 - ri) dy = py - (by + bh - 1 - ri);
            int d = (int)isqrt_u((uint32_t)(dx * dx + dy * dy)) - ri;
            if (d < 0) d = 0;
            if (d >= sp) continue;

            /* Quadratic falloff: (sp-d)^2 / sp^2, scaled to a max darkening of
             * SHADOW_MAX/256. Linear looked like a band; this fades. */
            int t = sp - d;
            int strength = (t * t * SHADOW_MAX) / (sp * sp);
            int keep = 256 - strength;
            uint32_t v = fb[(uint32_t)py * pitch + (uint32_t)px];
            uint32_t rr = ((((v >> 16) & 0xFF) * (uint32_t)keep) >> 8);
            uint32_t gg = ((((v >> 8)  & 0xFF) * (uint32_t)keep) >> 8);
            uint32_t bb = (((v & 0xFF) * (uint32_t)keep) >> 8);
            fb[(uint32_t)py * pitch + (uint32_t)px] = (rr << 16) | (gg << 8) | bb;
        }
    }
}

/* The IEC power symbol: a ring broken at 12 o'clock by a vertical stub. Built
 * from the integer distance test (no sqrt, no diagonals) a pixel at a time — a
 * few hundred pokes, done once. It reads as exactly one thing in any language,
 * which is why it earns the corner over a word. */
static void draw_power_glyph(int cx, int cy, int r, int t, uint32_t color) {
    int ro2 = r * r, ri = r - t, ri2 = ri * ri;
    for (int dy = -r; dy <= r; dy++)
        for (int dx = -r; dx <= r; dx++) {
            int d2 = dx * dx + dy * dy;
            if (d2 > ro2 || d2 < ri2) continue;          /* the ring band only */
            if (dy < 0 && dx > -2 && dx < 2) continue;   /* gap for the stub    */
            fb_rect_x((uint32_t)(cx + dx), (uint32_t)(cy + dy), 1, 1, color);
        }
    fb_rect_x((uint32_t)(cx - 1), (uint32_t)(cy - r - 2), 2, (uint32_t)(r + 3), color);
}

/* A dial for the Settings tile: a closed ring with a pointer inside it aimed at
 * 12 o'clock. Same integer distance test as the power symbol above, and
 * deliberately NOT the same silhouette — the power ring is BROKEN at the top by
 * a stub that crosses it, this one is whole with a mark that sits inside. It
 * exists because every other dock tile carries a letter and 'S' was already
 * spoken for by Snake; two S tiles is a dock you have to read twice. */
static void draw_dial_glyph(int cx, int cy, int r, int t, uint32_t color) {
    int ro2 = r * r, ri = r - t, ri2 = ri * ri;
    for (int dy = -r; dy <= r; dy++)
        for (int dx = -r; dx <= r; dx++) {
            int d2 = dx * dx + dy * dy;
            if (d2 > ro2 || d2 < ri2) continue;
            fb_rect_x((uint32_t)(cx + dx), (uint32_t)(cy + dy), 1, 1, color);
        }
    if (r - t > 2)   /* the pointer, from just inside the ring to the centre */
        fb_rect_x((uint32_t)(cx - 1), (uint32_t)(cy - r + t + 1),
                  2, (uint32_t)(r - t - 1), color);
}

/* ─── Components ─── */

/* The gradient ends come from settings.c now rather than the AC_WALL_* macros
 * (which are still the defaults it hands back on a fresh boot). One read per
 * repaint, not per row — the wallpaper must be one gradient even if a setting
 * changed halfway down the screen. */
static void draw_wallpaper(void) {
    uint32_t top = settings_wall_top(), bot = settings_wall_bot();
    for (uint32_t y = 0; y < SH; y++)
        fb_rect_x(0, y, SW, 1, lerp_color(top, bot, (int)y, (int)SH));
}

static void draw_topbar(void) {
    fb_rect_x(0, 0, SW, TOPBAR_H, AC_BAR);
    /* Logo emblem: accent tile with a dark notch. Rounded at the same
     * proportion the dock tiles use, so the mark and the apps are visibly the
     * same family rather than a square next to eight rounded things. */
    ac_fill_round(16, 12, 22, 22, 5, settings_accent());
    ac_fill_round(23, 19, 8, 8, 2, AC_BAR);
    af_draw(48, 12, "Astrion", AC_WHITE, AF_SB16);
    af_draw(48 + af_text_width("Astrion", AF_SB16) + 8, 15, "v2.0", AC_MUTED, AF_REG13);

    /* Power button (far right), set off from the clock by a hairline divider —
     * a system control belongs in the chrome, not among the app icons. Muted by
     * default so it's quietly present rather than competing with the accent
     * logo; it's the universal symbol, so it needs no label. */
    uint32_t pbx = SW - PWR_MARGIN - PWR_BTN_W;
    fb_rect_x(pbx - 12, 13, 1, 18, AC_BORDER);
    draw_power_glyph((int)(pbx + PWR_BTN_W / 2), (int)(TOPBAR_H / 2), 8, 2, AC_MUTED);

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
    /* Teal, not pink: pink (0xFF375F) sits a hair off the traffic-light red
     * (AC_RED 0xFF5F57) every window wears in its title bar, and a Monitor
     * icon that is permanently red reads as an alarm that is always firing.
     * Teal is the colour the Monitor already speaks in — switches and the
     * heap high-water mark are both AC_TEAL — so the dock names the app in
     * the app's own colour, and nothing in the dock means "warning".
     *
     * This is systemTeal, NOT AC_TEAL (0x64D2FF). AC_TEAL is right for ink
     * on the dark window body but wrong for a tile: at ~0.58 relative
     * luminance it is far lighter than every other icon here (0.16..0.47),
     * and the white glyph these tiles all carry went soft on it. Every
     * colour in this table is mid-luminance for exactly that reason — it is
     * the rule that makes one glyph colour work for all six. */
    { "Monitor",   'M', 0x30B0C7u },   /* teal   */
    /* Amber, and a gold rather than the Editor's bright orange (0xFF9F0A):
     * it is the one hue this dock was missing, and at ~0.49 relative luminance
     * it lands inside the 0.16..0.47 band the note above sets, so the shared
     * white glyph holds. '=' instead of a letter — no other tile could mean it,
     * and it is the one mark a calculator is really for. */
    { "Calculator", '=', 0xA8791Au },  /* amber  */
    /* Neutral slate: Settings is a system control rather than a place you keep
     * things, so it takes the chrome's own register instead of a product hue.
     * glyph 0 = "draw me instead of lettering me" — see draw_dial_glyph. */
    { "Settings",   0,   0x6E7288u },  /* slate  */
};
#define NICON ((uint32_t)(sizeof(g_icons) / sizeof(g_icons[0])))

/* ─── The dock's vertical budget ───
 *
 * Named, and made to add up, because it did not. The dock is DOCK_H tall and
 * has to hold three things: a tile, a gap, and a label. It was:
 *
 *     12 (top) + 52 (tile) + 4 (gap) + 17 (label) = 85   of 86 — 1px spare
 *
 * and then it also tried to draw the "app is running" dot at tile + 22, which
 * is y = 800 on an 800px screen. That dot has never rendered a single time, in
 * any build. It wasn't a regression; the row never had room for it and nobody
 * checked the arithmetic against DOCK_H.
 *
 * The dot is gone rather than relocated: the active tile already carries an
 * accent ring AND a white label, so the dot was a third signal for a state
 * that was already saying itself twice. What's left adds up with room to
 * breathe, and the numbers are here where the next person will see them.
 *
 *     10 (top) + 52 (tile) + 6 (gap) + 17 (label) = 85   of 86 — and it fits. */
#define DOCK_TOP_PAD  10u   /* dock's top edge → tile top   */
#define DOCK_LBL_GAP   6u   /* tile bottom    → label top   */
#define DOCK_IY (SH - DOCK_H + DOCK_TOP_PAD)

/* Where the row of tiles starts and how far apart they sit. ONE function, called
 * by both the drawing and the hit-test, because two copies of a layout are two
 * layouts and they drift.
 *
 * It shrinks the gap before it lets the row run off the screen, and computes the
 * left edge subtractively (SW > total, never SW/2 - total/2). With six tiles the
 * old form was safe on any sane mode; with eight it needs 654px, and on a
 * narrower framebuffer SW/2 - total/2 would have wrapped a uint32 and started
 * the dock at ~4 billion. */
/* DOCK_EDGE: the row never touches the screen's edges. The shrink test used to
 * ask only whether the tiles FIT, so on a 640-wide mode it settled on the gap
 * that made the row exactly 640 px — flush left and flush right, with the first
 * and last tile welded to the bezel. Reserving the margin inside the test costs
 * one term and keeps the dock looking placed at every mode GRUB can hand us. */
#define DOCK_EDGE 12u

static void dock_layout(uint32_t *sx, uint32_t *gap) {
    uint32_t g = ICON_GAP;
    while (g > 8 && NICON * ICON_SZ + (NICON - 1) * g + 2 * DOCK_EDGE > SW) g -= 2;
    uint32_t total = NICON * ICON_SZ + (NICON - 1) * g;
    *sx  = (SW > total) ? (SW - total) / 2 : 0;
    *gap = g;
}

/* One dock tile.
 *
 * Two things were wrong with these, and they were the same thing twice. They
 * were hard-cornered flat-filled squares of fully saturated colour, so at a
 * glance the dock read as a row of paint chips with initials on them — and
 * because everything else on the screen sits in a 20-level band of dark blue,
 * that row of paint chips was the loudest object in the entire operating
 * system. The launcher was outshouting the work.
 *
 * So: rounded (they become objects), lit from above by a shallow vertical
 * gradient (objects have a surface), and — the part that actually fixes the
 * hierarchy — DIMMED unless the app is running. An idle launcher should be
 * quietly available, not competing with your terminal for attention. The one
 * app that IS running comes up to full colour and keeps the accent ring. */
static void draw_tile(uint32_t ix, uint32_t iy, uint32_t base, int active) {
    /* Lit from above: the top edge is a step toward white, the bottom a step
     * toward black, both shallow. 1/6 and 1/8 keep the hue and just give the
     * face some curvature — a strong gradient would read as a web button. */
    uint32_t top = lerp_color(base, AC_WHITE, 1, 6);
    uint32_t bot = lerp_color(base, 0x000000u, 1, 8);
    /* Idle tiles sit back toward the dock's own colour — but only a little.
     * The first pass took a fifth of the way there and it was a mistake: a dock
     * where seven of eight apps are washed out reads as seven disabled apps,
     * and swapping an aesthetic problem for a semantic one is a bad trade. A
     * sixth takes the glare off the chroma without ever saying "unavailable". */
    if (!active) {
        top = lerp_color(top, AC_BAR, 1, 6);
        bot = lerp_color(bot, AC_BAR, 1, 6);
    }
    /* Paint the shape solid in the top tone, then wash the gradient over the
     * interior — ac_fill_round owns the edge pixels so the antialiased rim is
     * never overwritten by a square row. The interior inset tracks the SAME
     * arc the fill used, one pixel in, so the gradient follows the corner
     * instead of cutting across it. */
    ac_fill_round(ix, iy, ICON_SZ, ICON_SZ, TILE_R, top);
    for (uint32_t j = 1; j < ICON_SZ - 1; j++) {
        int straight;
        int dy8 = corner_dy8(j, ICON_SZ, TILE_R, &straight);
        uint32_t inset = 0;
        if (!straight)
            inset = (TILE_R * 8 - arc_half8(TILE_R, dy8) + 7) / 8;   /* round up */
        inset += 1;                     /* leave ac_fill_round's edge pixel be */
        if (inset * 2 < ICON_SZ)
            fb_rect_x(ix + inset, iy + j, ICON_SZ - inset * 2, 1,
                      lerp_color(top, bot, (int)j, (int)ICON_SZ));
    }
}

static void draw_dock(void) {
    uint32_t dy = SH - DOCK_H;
    fb_rect_x(0, dy, SW, DOCK_H, AC_BAR);
    fb_rect_x(0, dy, SW, 1, AC_BORDER);

    uint32_t sx, gap;
    dock_layout(&sx, &gap);
    uint32_t iy = DOCK_IY;
    for (uint32_t i = 0; i < NICON; i++) {
        uint32_t ix = sx + i * (ICON_SZ + gap);
        int active = ((int)i == g_active_icon);
        if (active) {
            /* Ring, then a 1px gap in the dock colour, then the tile. Without
             * the gap the ring merges into any tile close to the accent, and
             * Files is 0x0A84FF — exactly AC_ACCENT — so its active ring was
             * invisible: the one running app was the one that looked idle.
             * The gap makes a single indicator read against all six tiles.
             * Rounded now, at the tile's own radius + its offset, so the ring
             * is concentric with the thing it is ringing. */
            ac_fill_round(ix - 3, iy - 3, ICON_SZ + 6, ICON_SZ + 6,
                          TILE_R + 3, settings_accent());
            ac_fill_round(ix - 1, iy - 1, ICON_SZ + 2, ICON_SZ + 2,
                          TILE_R + 1, AC_BAR);
        }
        draw_tile(ix, iy, g_icons[i].color, active);

        /* The glyph is the icon, so it is sized like one. AF_SB16 in a 52px
         * tile was a 16px letter floating in the middle of a big square — a
         * label stuck onto a swatch. AF_SB30 fills the tile the way a mark
         * should. The ink stays white on every tile, running or not: legibility
         * is not the thing to spend on hierarchy. */
        uint32_t ink = AC_WHITE;
        if (g_icons[i].glyph) {
            char g[2] = { g_icons[i].glyph, 0 };
            uint32_t gw = af_text_width(g, AF_SB30);
            af_draw(ix + ICON_SZ / 2 - gw / 2,
                    iy + ICON_SZ / 2 - (uint32_t)af_line_height(AF_SB30) / 2,
                    g, ink, AF_SB30);
        } else {
            draw_dial_glyph((int)(ix + ICON_SZ / 2), (int)(iy + ICON_SZ / 2),
                            13, 2, ink);
        }
        af_draw_center(ix + ICON_SZ / 2, iy + ICON_SZ + DOCK_LBL_GAP,
                       g_icons[i].label, active ? AC_WHITE : AC_MUTED, AF_REG13);
    }
}

void desktop_set_active_app(int icon) {
    g_active_icon = icon;
    draw_dock();
}

/* The three window dots. They are CIRCLES now. They were 11x11 fb_rect_x
 * squares, and of everything on this screen that was the tell people read
 * fastest: the silhouette is one almost everybody knows by heart, so drawing it
 * with the wrong shape says "hand-made" louder than any amount of misalignment.
 * r=5 gives the same 11px diameter the squares had, so nothing else moves. */
static void draw_window_dots(uint32_t x, uint32_t cy) {
    ac_fill_disc((int)(x + 14), (int)cy, 5, AC_RED);
    ac_fill_disc((int)(x + 32), (int)cy, 5, AC_YELLOW);
    ac_fill_disc((int)(x + 50), (int)cy, 5, AC_GREEN);
}

static void draw_terminal_window(void) {
    ac_shadow(win_x, win_y, win_w, win_h, WIN_R, 18);
    ac_fill_round(win_x, win_y, win_w, win_h, WIN_R, AC_TERM_BG);   /* body  */
    /* Title bar: rounded on top, square where it meets the body. Drawn as a
     * rounded box of double height and then clipped by the body fill below it,
     * which is cheaper than a two-radius primitive nobody else needs. */
    ac_fill_round(win_x, win_y, win_w, TITLE_H * 2, WIN_R, AC_PANEL);
    fb_rect_x(win_x + 1, win_y + TITLE_H, win_w - 2, TITLE_H, AC_TERM_BG);
    /* Hairline where chrome meets content. Without it the title bar and the
     * body just abut and the window has no seam — the eye reads one surface. */
    fb_rect_x(win_x + 1, win_y + TITLE_H, win_w - 2, 1, AC_BORDER);

    draw_window_dots(win_x, win_y + TITLE_H / 2);
    /* WHITE, not AC_MUTED. The focused window's own name was the dimmest text
     * in the frame — the thing you are using was labelled more quietly than the
     * files inside it. */
    af_draw_center(win_x + win_w / 2,
                   win_y + TITLE_H / 2 - (uint32_t)af_line_height(AF_SB16) / 2,
                   "Terminal", AC_WHITE, AF_SB16);
    ac_stroke_round(win_x, win_y, win_w, win_h, WIN_R, AC_BORDER);
}

/* ─── Public API ─── */

static void compute_geometry(void) {
    SW = fb_width_x();
    SH = fb_height_x();
    /* One gutter on all four sides — see DESK_GAP. Subtractive so a small mode
     * can't wrap: the dock and bar get their space first, the window takes what
     * is left, and if there is nothing left it collapses to zero rather than to
     * four billion. */
    uint32_t gap = DESK_GAP;
    uint32_t vert = TOPBAR_H + DOCK_H + 2 * gap;
    while (gap > 8 && (vert + 120 > SH || 2 * gap + 200 > SW)) {
        gap -= 4;
        vert = TOPBAR_H + DOCK_H + 2 * gap;
    }
    win_x = gap;
    win_y = TOPBAR_H + gap;
    win_w = (SW > 2 * gap) ? SW - 2 * gap : 0;
    win_h = (SH > vert)    ? SH - vert    : 0;
    term_x = win_x + PAD;
    term_y = win_y + TITLE_H + PAD;
    term_w = (win_w > 2 * PAD) ? win_w - 2 * PAD : 0;
    term_h = (win_h > TITLE_H + 2 * PAD) ? win_h - TITLE_H - 2 * PAD : 0;
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
    uint32_t sx, gap;
    dock_layout(&sx, &gap);
    uint32_t iy = DOCK_IY;
    for (uint32_t i = 0; i < NICON; i++) {
        uint32_t ix = sx + i * (ICON_SZ + gap);
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
    /* The clock is repainted from a background task every 250ms. While the power
     * dialog is up the whole desktop is dimmed, so a fresh bright clock would
     * punch a lit hole through the dim — hold the clock until the dialog closes
     * (repaint_all() then brings it back within a tick). */
    if (desktop_power_is_open()) return;
    uint32_t w = af_text_width(hhmmss, AF_SB16);
    if (SW <= w + CLOCK_PAD) return;   /* absurdly narrow mode: nowhere to put it */
    uint32_t x = SW - w - CLOCK_PAD;   /* left of the power button + divider */

    /* ─── Clear a FIXED band, not one measured from THIS string ───
     *
     * The clock is not a constant width. The month name varies by 10px across
     * the year in this face (Jul is 23px, May is 33px), and the 12-hour format
     * the Settings panel can select adds an AM/PM marker worth another 2. The
     * old clear was sized to the string being drawn, so a NARROWER string
     * started its clear too far right to cover the wider one already on the bar
     * and left the head of last month's name behind. With one format and
     * tabular digits that never bit; with two formats the margin is gone.
     *
     * So the band is anchored to the right edge and never moves. Its right edge
     * is exactly where it was — one pixel short of the power divider at
     * SW - 56 — so the divider and the button are untouched, as before.
     * CLOCK_MAXW's whole job is to be wider than any string this can draw; the
     * widest today is "Jul 18  02:32:05 PM" at 151px plus 10px of month
     * variation, so 200 leaves real room. */
    uint32_t bx = (SW > CLOCK_PAD + CLOCK_MAXW) ? SW - CLOCK_PAD - CLOCK_MAXW : 0;
    uint32_t bw = (SW - CLOCK_PAD + 12) - bx;

    /* This runs on the clock TASK, not task 0, so it must not lift the cursor:
     * it can preempt task 0 mid-redraw and mutate the sprite's state underneath
     * it. Flag the damage instead and let the main loop repair it — otherwise a
     * pointer parked on the clock caches these pixels and paints them back over
     * the next four times the time changes. The invalidate and the fill are the
     * SAME rect on purpose: the cursor must be told about exactly the pixels
     * that changed, no more and no less. */
    mouse_invalidate_rect((int)bx, 6, (int)bw, (int)TOPBAR_H - 8);
    fb_rect_x(bx, 6, bw, TOPBAR_H - 8, AC_BAR);   /* clear old */
    af_draw(x, 12, hhmmss, AC_WHITE, AF_SB16);
}

/* ─── Power: the confirm dialog and the shutdown screens ───
 *
 * Turning the machine off ends the session, so it takes one deliberate choice:
 * the top-bar button opens this modal, and only a button here acts. A misclick
 * on the corner just raises a dialog you can wave away (Cancel, Esc, or a click
 * anywhere outside it). Calm, not alarming — this is a normal thing a person
 * does, so there's no red, no warning icon, just a quiet question. */

static int pwr_open = 0;

/* Dialog geometry: computed once from the screen size and shared by the draw
 * and the hit-test, so the two can never disagree — the same discipline
 * desktop_dock_hit() keeps with draw_dock(). Three stacked, full-width buttons
 * read more calmly (and are far easier to hit) than a cramped row. */
#define PWR_CARD_W   300u
#define PWR_PAD      20u    /* card inner horizontal padding      */
#define PWR_BTN_H    44u
#define PWR_BTN_GAP  12u
#define PWR_NBTN     3
#define PWR_TOP      92u    /* card top → first button (glyph + subtitle above) */

static uint32_t pw_cx, pw_cy, pw_cw, pw_ch;   /* card rect                 */
static uint32_t pw_bx, pw_bw;                 /* button left edge + width  */
static uint32_t pw_by[PWR_NBTN];              /* each button's top y       */

/* Button 0 is the primary (Shut Down), 1 the alternative (Restart), 2 the out
 * (Cancel). Order puts the button's own purpose — turning off — first. */
static const char *const pw_label[PWR_NBTN] = { "Shut Down", "Restart", "Cancel" };

static void power_layout(void) {
    pw_cw = PWR_CARD_W;
    pw_ch = PWR_TOP + PWR_NBTN * PWR_BTN_H + (PWR_NBTN - 1) * PWR_BTN_GAP + 22;
    pw_cx = SW / 2 - pw_cw / 2;
    pw_cy = SH / 2 - pw_ch / 2;
    pw_bx = pw_cx + PWR_PAD;
    pw_bw = pw_cw - 2 * PWR_PAD;
    uint32_t by = pw_cy + PWR_TOP;
    for (int i = 0; i < PWR_NBTN; i++) { pw_by[i] = by; by += PWR_BTN_H + PWR_BTN_GAP; }
}

/* Darken the whole desktop so the card is the only lit thing. fb_rect_x can't
 * blend, so this is a read-modify-write: keep ~34% of each channel, enough that
 * the desktop still shows through as a backdrop — "paused", not "gone".
 * Integer-only, once per open. */
static void power_dim(void) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)(uintptr_t)fb_addr_x();
    uint32_t pitch = fb_pitch_x() / 4;
    for (uint32_t y = 0; y < SH; y++)
        for (uint32_t x = 0; x < SW; x++) {
            uint32_t v = fb[y * pitch + x];
            uint32_t r = (((v >> 16) & 0xFF) * 11) >> 5;   /* *11/32 */
            uint32_t g = (((v >> 8)  & 0xFF) * 11) >> 5;
            uint32_t b = ((v & 0xFF) * 11) >> 5;
            fb[y * pitch + x] = (r << 16) | (g << 8) | b;
        }
}

/* One button, hover lifts it to a lighter tone so the pointer always has a
 * clear target. The lift must clear the card colour (AC_PANEL) or it would
 * vanish into it, so the greys lift to 0x323A5C — a step ABOVE the card, not
 * onto it. Shut Down is the accent primary (it's the button's own purpose);
 * Restart is the outlined alternative; Cancel is a ghost until you're on it. */
#define PWR_LIFT 0x323A5Cu    /* hover grey — one step above the card */
static void power_draw_button(int i, int hover) {
    uint32_t by = pw_by[i], fill, ink; int outline = 0;
    /* The hover lift used to be a hardcoded lighter blue, which only worked
     * while the accent was guaranteed to be blue. It is a quarter-step of the
     * live accent toward white now, so Shut Down lifts in its own colour
     * whichever one that is. */
    if (i == 0)      { fill = hover ? lerp_color(settings_accent(), AC_WHITE, 1, 4)
                                    : settings_accent();      ink = AC_WHITE; }
    else if (i == 1) { fill = hover ? PWR_LIFT  : AC_TERM_BG; ink = AC_WHITE; outline = 1; }
    else             { fill = hover ? PWR_LIFT  : AC_PANEL;   ink = hover ? AC_WHITE : AC_MUTED;
                       outline = hover; }
    ac_fill_round(pw_bx, by, pw_bw, PWR_BTN_H, 8, fill);
    if (outline) ac_stroke_round(pw_bx, by, pw_bw, PWR_BTN_H, 8, AC_BORDER);
    af_draw_center(pw_bx + pw_bw / 2,
                   by + PWR_BTN_H / 2 - (uint32_t)af_line_height(AF_SB16) / 2,
                   pw_label[i], ink, AF_SB16);
}

void desktop_power_open(void) {
    power_layout();
    power_dim();
    ac_shadow(pw_cx, pw_cy, pw_cw, pw_ch, 14, 26);              /* real shadow */
    ac_fill_round(pw_cx, pw_cy, pw_cw, pw_ch, 14, AC_PANEL);    /* card body   */
    ac_stroke_round(pw_cx, pw_cy, pw_cw, pw_ch, 14, AC_BORDER);
    draw_power_glyph((int)(pw_cx + pw_cw / 2), (int)(pw_cy + 42), 14, 3, settings_accent());
    af_draw_center(pw_cx + pw_cw / 2, pw_cy + 66, "Your session will end.",
                   AC_MUTED, AF_REG13);
    for (int i = 0; i < PWR_NBTN; i++) power_draw_button(i, 0);
    pwr_open = 1;
}

int  desktop_power_is_open(void) { return pwr_open; }
void desktop_power_cancel(void)  { pwr_open = 0; }

int desktop_power_hit(int x, int y) {
    if (!SW) return 0;
    uint32_t bx = SW - PWR_MARGIN - PWR_BTN_W;
    return x >= (int)bx && x < (int)(bx + PWR_BTN_W) && y >= 0 && y < (int)TOPBAR_H;
}

int desktop_power_action(int x, int y) {
    if (!pwr_open) return PWR_NONE;
    /* Outside the card is a forgiving Cancel — the calm way out of a misclick. */
    if (x < (int)pw_cx || x >= (int)(pw_cx + pw_cw) ||
        y < (int)pw_cy || y >= (int)(pw_cy + pw_ch)) { pwr_open = 0; return PWR_CANCEL; }
    for (int i = 0; i < PWR_NBTN; i++)
        if (x >= (int)pw_bx && x < (int)(pw_bx + pw_bw) &&
            y >= (int)pw_by[i] && y < (int)(pw_by[i] + PWR_BTN_H)) {
            pwr_open = 0;
            return (i == 0) ? PWR_OFF : (i == 1) ? PWR_REBOOT : PWR_CANCEL;
        }
    return PWR_NONE;   /* inert card space — stay open */
}

/* Redraw the buttons with `hovered` (0..2, or -1 for none) lifted. Returns 1 if
 * the hover changed since last call, so the wm only repaints on a real change
 * and a still mouse costs nothing. */
int desktop_power_hover(int x, int y) {
    static int last = -2;
    int h = -1;
    if (pwr_open && x >= (int)pw_bx && x < (int)(pw_bx + pw_bw))
        for (int i = 0; i < PWR_NBTN; i++)
            if (y >= (int)pw_by[i] && y < (int)(pw_by[i] + PWR_BTN_H)) { h = i; break; }
    if (h == last) return 0;
    last = h;
    for (int i = 0; i < PWR_NBTN; i++) power_draw_button(i, i == h);
    return 1;
}

/* "Shutting down…" / "Restarting…" over the live wallpaper: the desktop calmly
 * standing down, not an error screen. */
static void power_progress_screen(const char *msg) {
    draw_wallpaper();
    int cxp = (int)(SW / 2), cyp = (int)(SH / 2);
    draw_power_glyph(cxp, cyp - 42, 16, 3, settings_accent());
    af_draw_center((uint32_t)cxp, (uint32_t)(cyp + 6), msg, AC_WHITE, AF_SB16);
}

/* The hardware fallback: flat and still, because the machine is meant to be off
 * now. Reached only when power_off() could not actually cut power (real HW with
 * no ACPI path and the I/O ports ignored). On QEMU you never see this — power is
 * gone before power_off() returns. */
static void power_safe_screen(void) {
    fb_rect_x(0, 0, SW, SH, 0x0A0E20u);
    int cxp = (int)(SW / 2), cyp = (int)(SH / 2);
    draw_power_glyph(cxp, cyp - 42, 16, 3, AC_MUTED);
    af_draw_center((uint32_t)cxp, (uint32_t)(cyp + 6),
                   "It's now safe to turn off your computer.", AC_WHITE, AF_SB16);
}

void desktop_power_shutdown(int reboot) {
    pwr_open = 0;
    if (reboot) {
        power_progress_screen("Restarting...");
        power_reboot();               /* reliable (8042 + triple-fault); no return */
    } else {
        power_progress_screen("Shutting down...");
        power_off();                  /* returns ONLY if it couldn't cut power */
        power_safe_screen();
    }
    for (;;) CPU_HALT();
}

#ifdef DESKTOP_HOST_TEST
/* Host render harness only: paint the not-otherwise-reachable screens so real
 * pixels can be judged. None of these exist in the kernel build. */
void desktop_test_progress(const char *m)  { power_progress_screen(m); }
void desktop_test_safe(void)               { power_safe_screen(); }
void desktop_test_hover(int i)             { for (int k = 0; k < PWR_NBTN; k++) power_draw_button(k, k == i); }
#endif
