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
#else
#include "power.h"
#define CPU_HALT() __asm__ volatile("cli; hlt")
#endif

/* ─── Layout constants ─── */
#define TOPBAR_H    44u
#define DOCK_H      86u
#define WIN_MARGIN  48u
#define TITLE_H     34u
#define PAD         12u
#define ICON_SZ     52u
#define ICON_GAP    34u
/* Power button — far right of the top bar. The hit target is the button box;
 * the clock reserves CLOCK_PAD on the right so the two never overlap and the
 * clock's every-second repaint can't nibble the button. */
#define PWR_BTN_W   30u    /* button hit width                        */
#define PWR_MARGIN  14u    /* button's gap to the screen's right edge */
#define CLOCK_PAD   68u    /* clock's right margin: clears the button */

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
    /* The clock is repainted from a background task every 250ms. While the power
     * dialog is up the whole desktop is dimmed, so a fresh bright clock would
     * punch a lit hole through the dim — hold the clock until the dialog closes
     * (repaint_all() then brings it back within a tick). */
    if (desktop_power_is_open()) return;
    uint32_t w = af_text_width(hhmmss, AF_SB16);
    uint32_t x = SW - w - CLOCK_PAD;   /* left of the power button + divider */
    fb_rect_x(x - 12, 6, w + 24, TOPBAR_H - 8, AC_BAR);   /* clear old */
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
    if (i == 0)      { fill = hover ? 0x3D9BFFu : AC_ACCENT;  ink = AC_WHITE; }
    else if (i == 1) { fill = hover ? PWR_LIFT  : AC_TERM_BG; ink = AC_WHITE; outline = 1; }
    else             { fill = hover ? PWR_LIFT  : AC_PANEL;   ink = hover ? AC_WHITE : AC_MUTED;
                       outline = hover; }
    fb_rect_x(pw_bx, by, pw_bw, PWR_BTN_H, fill);
    if (outline) draw_border(pw_bx, by, pw_bw, PWR_BTN_H, AC_BORDER);
    af_draw_center(pw_bx + pw_bw / 2,
                   by + PWR_BTN_H / 2 - (uint32_t)af_line_height(AF_SB16) / 2,
                   pw_label[i], ink, AF_SB16);
}

void desktop_power_open(void) {
    power_layout();
    power_dim();
    fb_rect_x(pw_cx + 6, pw_cy + 6, pw_cw, pw_ch, 0x05060Fu);   /* soft shadow */
    fb_rect_x(pw_cx, pw_cy, pw_cw, pw_ch, AC_PANEL);            /* card body   */
    draw_border(pw_cx, pw_cy, pw_cw, pw_ch, AC_BORDER);
    draw_power_glyph((int)(pw_cx + pw_cw / 2), (int)(pw_cy + 42), 14, 3, AC_ACCENT);
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
    draw_power_glyph(cxp, cyp - 42, 16, 3, AC_ACCENT);
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
