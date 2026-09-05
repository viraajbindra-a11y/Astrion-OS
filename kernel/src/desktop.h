/*
 * Astrion v2.0 — the desktop: wallpaper, top bar, dock, and window chrome.
 *
 * This file owns the SURFACE. Three things live on it — a gradient wallpaper,
 * a top bar (logo, live clock, power), and a dock of app tiles — plus the two
 * pieces of chrome that are not the window manager's business: the one window
 * frame every window is drawn with, and the power dialog.
 *
 * It does NOT own windows. It used to paint a permanent Terminal-shaped
 * rectangle and call that the desktop, which is exactly why Astrion did not
 * read as an operating system: the shell was a painted hole rather than a
 * window, unmovable and unclosable, while everything else floated above it.
 * The Terminal is a real wm.c window now. This file just says where it opens
 * (desktop_terminal_frame) and how every window is drawn
 * (desktop_draw_window_frame).
 *
 * Everything goes through the kernel_mb2.c fb_* wrappers. There is no
 * compositor, no back buffer and no alpha channel: antialiasing and shadows
 * are read-modify-write against whatever is already on the framebuffer, and
 * the ordering rules that makes necessary are documented at each one.
 */
#ifndef ASTRION_DESKTOP_H
#define ASTRION_DESKTOP_H

#include <stdint.h>

/* ─── Window chrome metrics ───
 *
 * ONE definition, shared by desktop.c and wm.c, because the Terminal is a real
 * window managed by wm.c but its opening geometry is computed in desktop.c
 * (that is where the layout system lives). Those two files must agree about
 * exactly where a window's content rect is, to the pixel, or the console
 * anchors somewhere the window manager isn't going to draw.
 *
 * They already disagreed once: desktop.c had TITLE_H 34 and PAD 14, wm.c had
 * 30 and 12, which is why the Terminal wore visibly taller chrome than every
 * other window. These are wm.c's numbers — it has seven windows using them and
 * desktop.c had one. */
#define WIN_TITLE_H   30u   /* title bar height                       */
#define WIN_PAD       12u   /* content inset: left, right, bottom     */
#define WIN_TOP_GAP   10u   /* title bar bottom → content top         */

/* Content rect of a window whose outer rect is (x,y,w,h). */
#define WIN_CONTENT_X(x)    ((x) + WIN_PAD)
#define WIN_CONTENT_Y(y)    ((y) + WIN_TITLE_H + WIN_TOP_GAP)
#define WIN_CONTENT_W(w)    (((w) > 2 * WIN_PAD) ? (w) - 2 * WIN_PAD : 0u)
#define WIN_CONTENT_H(h)    (((h) > WIN_TITLE_H + WIN_TOP_GAP + WIN_PAD) \
                             ? (h) - WIN_TITLE_H - WIN_TOP_GAP - WIN_PAD : 0u)

/* Window dots: centre of the first one, relative to the window's left edge,
 * and their radius. Shared by the drawing and the hit-test. */
#define WIN_DOT_X    19u
#define WIN_DOT_R    5

/* Corner radius of a window body. Here rather than private to desktop.c for
 * the same reason as everything above it: snake.c paints a full-screen play
 * field that is meant to read as one of this OS's lit surfaces, and a surface
 * with a different corner is a surface from a different OS. One radius. */
#define WIN_R         8u

/* ─── The top bar's height ───
 *
 * Shared for one reason: a full-screen app (Snake) paints its OWN top bar so
 * that fullscreen reads as a mode of Astrion rather than an escape from it,
 * and if that bar were a different height the Astrion mark would visibly jump
 * when you entered and left the game. Same lesson as WIN_TITLE_H above — two
 * copies of a chrome metric is two metrics and they drift. */
#define TOPBAR_H     44u

/* How far outside its own rect a window's shadow reaches, on every side.
 *
 * wm.c saves the pixels beneath a window so it can drag it without repainting
 * the world, and that saved rect MUST cover the shadow too. The old shadow was
 * a hard rectangle offset down-right, so +6 on two sides was enough; a real
 * shadow falls on all four, and a save rect that misses it leaves a smear of
 * darkened wallpaper behind every drag. 22 clears the widest spread (20) plus
 * the 2px the shadow sits below the window. */
#define WIN_SHADOW_PAD 22u

/* Where the Terminal window opens: outer rect, derived from the type scale
 * rather than from the screen. See the note at desktop.c's definition. */
void desktop_terminal_frame(uint32_t *x, uint32_t *y, uint32_t *w, uint32_t *h);

/* ─── The one window frame ───
 * Every window in Astrion is drawn by this, including the Terminal. wm.c is the
 * only caller; it lives here because it is chrome. `focused` picks the accent
 * border, the white title and the live dots. */
void desktop_draw_window_frame(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                               const char *title, int focused);

/* 1 if (px,py) is on the close dot of a window whose top-left is (x,y). */
int  desktop_window_close_hit(uint32_t x, uint32_t y, int px, int py);

/* ─── Shape primitives ───
 *
 * Astrion had exactly one shape. The mb2 kernel links only fb_rect_x (the
 * gui/framebuffer.c that owns fb_fill_circle / fb_fill_rounded_rect is not in
 * the kernel-mb2 target), so every window, button, tile, dialog and "traffic
 * light" in the OS was an axis-aligned rectangle of flat colour. That is the
 * single biggest reason the whole thing read as hand-drawn: one primitive gives
 * you one texture, and a screen with one texture looks like a screen someone
 * made with the only call they had. The three dots on a window are the loudest
 * case — everyone alive knows that silhouette by heart, and ours were squares.
 *
 * These are the missing shapes. Integer only (no floats, no SSE), antialiased
 * against whatever is already in the framebuffer by reading it back — the same
 * read-modify-write power_dim() and af.c already do, since we have no alpha
 * blending and no compositor.
 *
 * Declared here rather than kept static in desktop.c so wm.c can round its own
 * window corners and close buttons with the SAME geometry. Two rounding
 * routines are two radii and they drift.
 */

/* Filled rounded rectangle, corner radius r (clamped to w/2, h/2). r == 0 is
 * an ordinary fb_rect_x. */
void ac_fill_round(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                   uint32_t r, uint32_t color);

/* 1px rounded outline, matching ac_fill_round's geometry exactly. */
void ac_stroke_round(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                     uint32_t r, uint32_t color);

/* Filled circle of DIAMETER 2r+1 centred on (cx,cy). */
void ac_fill_disc(int cx, int cy, int r, uint32_t color);

/* A real drop shadow: darkens what is already on the framebuffer in a band of
 * `spread` px around the box (x, y+2, w, h), falling off quadratically with
 * distance so it fades instead of ending on a hard line. Pixels inside the box
 * itself are left alone — the caller paints the window over them next.
 *
 * The old "shadow" was fb_rect_x(x+5, y+5, w, h, 0x0A0E20) — a hard-edged solid
 * rectangle offset down-right, which does not read as a shadow at all. It reads
 * as a second window peeking out from behind the first, which is why nothing on
 * the desktop felt like it was floating above anything.
 *
 * MUST be called after the backdrop is painted and before the box body, and
 * exactly once per repaint: it multiplies what it finds, so running it twice
 * over the same pixels darkens them twice. */
void ac_shadow(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
               uint32_t r, uint32_t spread);

/* Paint the whole desktop. Call once after the drivers are up and before
 * console_init (the console goes inside the Terminal window). */
void desktop_init(void);

/* Repaint the chrome: wallpaper + top bar + dock. NO WINDOWS.
 *
 * Almost nothing should call this directly. If you have scribbled over the
 * screen (Snake, a full-screen app) you want wm_repaint(), which does this and
 * then puts every open window back on top — including the Terminal, which is
 * now a window and will otherwise stay erased. wm.c's repaint_all() is the one
 * legitimate caller. */
void desktop_repaint_chrome(void);

/* Content rectangle of the Terminal window at its DEFAULT position — where the
 * console is first anchored at boot, before the window manager exists. Once wm
 * is up the Terminal can be dragged, and the live rect is whatever wm.c last
 * passed to console_attach(). */
void desktop_terminal_rect(uint32_t *x, uint32_t *y, uint32_t *w, uint32_t *h);

/* Draw the clock string (e.g. "12:34:56") on the right of the top bar. */
void desktop_draw_clock(const char *hhmmss);

/* ─── Live status, middle-right of the top bar ───
 *
 * Repainted from the SAME background task as the clock, on the same 250ms
 * beat and behind the same two guards (power dialog up, or a full-screen app
 * owns the screen). It only touches pixels when the string it would draw has
 * actually changed — a bar that re-stamps identical pixels four times a
 * second lifts the mouse cursor four times a second, and the pointer flickers
 * wherever you park it.
 *
 * That "has it changed" latch is a cache, so it is invalidated the only way a
 * cache in this file is allowed to be: draw_topbar() clears it before it
 * repaints the bar, so a repaint can never leave the status blank with the
 * latch claiming it is already on screen. */
void desktop_draw_status(void);

/* ─── Shared top-bar lead: ground, mark, wordmark, and an optional label ───
 *
 * Paints the bar's background across the full width, the Astrion emblem, the
 * "Astrion v2.0" wordmark, and — when `label` is non-null and non-empty — a
 * hairline divider and that label after it. Returns the x one past everything
 * it drew, and also lays down the hairline UNDER the bar.
 *
 * Two callers: desktop.c's own top bar (label = the focused window's name) and
 * snake.c's full-screen bar (label = "Snake"). One implementation on purpose —
 * a second hand-copied emblem is a mark that stops matching the moment either
 * one is touched. */
uint32_t desktop_draw_bar_lead(const char *label);

/* Repaint rows [y, y+h) of the wallpaper gradient, using the same absolute-y
 * ramp the full wallpaper uses so a band is pixel-identical to the full draw.
 *
 * Exists for full-screen apps: it puts the OS's real backdrop underneath them
 * instead of a flat colour they invented, and it lets them erase a strip of
 * their own text without having to know what the wallpaper looks like there
 * (which changes with the user's Settings). */
void desktop_wallpaper_band(uint32_t y, uint32_t h);

/* Hit-test the dock; returns icon index (0=Terminal 1=Files 2=Editor
 * 3=Snake 4=Assistant 5=Monitor) under (x,y), or -1 if none. */
int desktop_dock_hit(int x, int y);

/* Highlight the given dock icon as the active app (-1 = none). */
void desktop_set_active_app(int icon);

/* ─── Power control ───
 * A power button sits at the far right of the top bar (system chrome, not the
 * app dock). Clicking it opens a calm, modal confirm dialog over a dimmed
 * desktop — a misclick must never end someone's session, so turning off always
 * takes one deliberate choice. The wm (wm.c) owns the event loop and routes
 * clicks/keys here; desktop.c owns the drawing, the hit-testing and the power
 * calls themselves. */
enum { PWR_NONE = 0, PWR_OFF, PWR_REBOOT, PWR_CANCEL };

/* 1 if (x,y) is on the top-bar power button. */
int  desktop_power_hit(int x, int y);

/* Is the confirm dialog currently up? (Modal: while true the wm sends every
 * click/key here and does nothing else.) */
int  desktop_power_is_open(void);

/* Screen ownership, for apps that paint the WHOLE framebuffer and block task 0
 * until they exit (snake_play() today). Raise it around such a run and
 * background painters on other tasks — the clock — hold off instead of
 * scribbling over a screen they no longer own. Set it before the app paints
 * and clear it before the desktop repaint that follows. */
void desktop_set_exclusive(int on);
int  desktop_is_exclusive(void);

/* Open the dialog: dim the desktop and paint the card. Call mouse_lift() first
 * so the cursor isn't baked into the dimmed snapshot. */
void desktop_power_open(void);

/* Route a click while the dialog is open. Returns PWR_OFF / PWR_REBOOT /
 * PWR_CANCEL for a chosen action (and marks the dialog closed), or PWR_NONE for
 * a click on inert card space (dialog stays open). A click outside the card
 * counts as PWR_CANCEL. The caller repaints the desktop on OFF-not-taken /
 * CANCEL; OFF and REBOOT hand off to desktop_power_shutdown(). */
int  desktop_power_action(int x, int y);

/* Dismiss the dialog without acting (the Esc key). Marks it closed; the caller
 * repaints the desktop to clear the dim. */
void desktop_power_cancel(void);

/* Repaint the dialog buttons with the one under (x,y) highlighted. Returns 1
 * only when the hovered button changed, so the wm repaints on real movement and
 * a still mouse is free. */
int  desktop_power_hover(int x, int y);

/* Carry out the choice. reboot=0 shuts down, reboot=1 restarts. Paints the
 * full-screen "Shutting down…" / "Restarting…" screen, then calls the power
 * mechanism. Does NOT return: on the rare hardware where poweroff falls
 * through, it paints "safe to turn off your computer" and halts. */
void desktop_power_shutdown(int reboot);

/* ─── Astrion palette — dark, blue accent ───
 *
 * The surfaces are ordered by DEPTH, and the order is the whole point:
 *
 *     wallpaper  (darkest, furthest away)
 *   < top bar / dock                        — system chrome, sits on the wall
 *   < window body                           — the lit surface you work on
 *   < title bar                             — the handle, one step above it
 *
 * That ordering used to be inverted. AC_WALL_TOP was 0x1A2450 — (26,36,80),
 * brighter AND more saturated than the window body at (23,27,46) — so the
 * backdrop was the lightest large surface on the screen and every window read
 * as a dark hole cut into it rather than a panel floating above it. Nothing in
 * the frame receded, so nothing felt layered. The wallpaper is now genuinely
 * beneath the windows in value, which is what lets a shadow do its job. */
#define AC_WALL_TOP  0x0F1430u   /* wallpaper gradient top (deep blue)   */
#define AC_WALL_BOT  0x191038u   /* wallpaper gradient bottom (indigo)   */
/* Chrome is the darkest surface on the screen, one clear step below the
 * wallpaper. It was 0x12162C, within a point of the wallpaper's luminance, so
 * the top bar and dock had no edge against the desktop — they floated with
 * nothing under them. Dark chrome grounds the frame and lets the lit window
 * bodies be the thing your eye goes to. */
#define AC_BAR       0x0B0E1Eu   /* top bar + dock (near-black blue)     */
#define AC_PANEL     0x252A42u   /* window title bar                     */
#define AC_TERM_BG   0x171B2Eu   /* window body / terminal               */
#define AC_BORDER    0x3A4166u   /* 1px window border                    */
/* AC_ACCENT means one thing: "this has focus / this is the system speaking."
 * It is spent on the focused window border, the text caret, the active dock
 * icon, the power glyph and the boot splash — and nowhere else. Keeping it
 * scarce is what makes it read. For accent-coloured *ink* on a dark window
 * body use AC_TEAL instead; AC_ACCENT is too dark for thin glyph strokes. */
#define AC_ACCENT    0x0A84FFu   /* macOS-style blue accent              */
#define AC_WHITE     0xFFFFFFu
#define AC_MUTED     0x99A2BEu
#define AC_RED       0xFF5F57u   /* macOS traffic lights                 */
#define AC_YELLOW    0xFEBC2Eu
#define AC_GREEN     0x28C840u
#define AC_TEAL      0x64D2FFu
#define AC_BLUE      0x0A84FFu
#define AC_PURPLE    0xBF5AF2u

#endif
