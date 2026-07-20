/*
 * Astrion v2.0 — desktop shell (window chrome around the console)
 *
 * Paints the thing that makes Astrion read as an operating system rather
 * than a terminal: a gradient wallpaper, a top bar (logo + live clock +
 * status), a bottom dock of app icons, and a framed "Terminal" window that
 * hosts the scrolling console (console.c). Everything is drawn through the
 * kernel_mb2.c fb_* wrappers, so it composes with the existing shell, mouse
 * cursor, and full-screen apps without touching pixel-poke code here.
 *
 * T1.1 draws the chrome statically (direct-to-framebuffer). The dock icons
 * are not yet clickable and windows are not yet movable — that arrives with
 * the back-buffer compositor + window manager in T1.2.
 */
#ifndef ASTRION_DESKTOP_H
#define ASTRION_DESKTOP_H

#include <stdint.h>

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

/* Repaint the static chrome (wallpaper + bar + dock + window frame). Use
 * after a full-screen app (e.g. Snake) returns. Does not touch the console
 * text itself — the caller reprints as needed. */
void desktop_repaint_chrome(void);

/* Inner content rectangle of the Terminal window — where the console draws. */
void desktop_terminal_rect(uint32_t *x, uint32_t *y, uint32_t *w, uint32_t *h);

/* Draw the clock string (e.g. "12:34:56") on the right of the top bar. */
void desktop_draw_clock(const char *hhmmss);

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
