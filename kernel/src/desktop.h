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
 * 3=Snake 4=Assistant) under (x,y), or -1 if none. */
int desktop_dock_hit(int x, int y);

/* ─── Astrion palette (shared with the window manager + apps) ─── */
#define AC_WALL_TOP  0x141A3Fu   /* wallpaper gradient top (dark navy)   */
#define AC_WALL_BOT  0x1E2761u   /* wallpaper gradient bottom (navy)     */
#define AC_BAR       0x0E1330u   /* top bar + dock (near-black navy)     */
#define AC_PANEL     0x243056u   /* window title bar                     */
#define AC_TERM_BG   0x1E2761u   /* terminal content (matches console)   */
#define AC_BORDER    0x3A4A7Au   /* 1px window border                    */
#define AC_ORANGE    0xFF7A00u   /* Astrion accent                       */
#define AC_WHITE     0xFFFFFFu
#define AC_MUTED     0x8B98B8u
#define AC_RED       0xF87171u
#define AC_YELLOW    0xFBBF24u
#define AC_TEAL      0x34D399u
#define AC_BLUE      0x60A5FAu
#define AC_GREEN     0x4ADE80u
#define AC_PURPLE    0xA78BFAu

#endif
