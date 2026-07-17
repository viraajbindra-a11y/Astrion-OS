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

/* ─── Astrion palette — matches the web build (dark, blue accent) ─── */
#define AC_WALL_TOP  0x1A2450u   /* wallpaper gradient top (deep blue)   */
#define AC_WALL_BOT  0x281C4Au   /* wallpaper gradient bottom (indigo)   */
#define AC_BAR       0x12162Cu   /* top bar + dock (near-black blue)     */
#define AC_PANEL     0x252A42u   /* window title bar                     */
#define AC_TERM_BG   0x171B2Eu   /* window body / terminal               */
#define AC_BORDER    0x3A4166u   /* 1px window border                    */
#define AC_ACCENT    0x0A84FFu   /* macOS-style blue accent              */
#define AC_ORANGE    AC_ACCENT   /* legacy name -> now the blue accent   */
#define AC_WHITE     0xFFFFFFu
#define AC_MUTED     0x99A2BEu
#define AC_RED       0xFF5F57u   /* macOS traffic lights                 */
#define AC_YELLOW    0xFEBC2Eu
#define AC_GREEN     0x28C840u
#define AC_TEAL      0x64D2FFu
#define AC_BLUE      0x0A84FFu
#define AC_PURPLE    0xBF5AF2u

#endif
