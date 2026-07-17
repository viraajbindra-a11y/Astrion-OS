/*
 * Astrion v2.0 — window manager + built-in apps (Files, Editor, Assistant)
 *
 * The desktop base (wallpaper + top bar + dock + Terminal) is drawn directly
 * to the framebuffer and is always present. On top of it floats ONE app
 * window at a time — opened from the dock or a shell command. The window
 * saves the base pixels it covers when it opens and restores them when it
 * moves or closes (the same save/restore discipline the mouse cursor uses),
 * so no back-buffer or console scrollback is needed: closing a window brings
 * the Terminal back exactly as it was.
 *
 * Input routing: while an app window is open it receives the keyboard
 * (wm_handle_key consumes the keystroke); otherwise keys go to the shell.
 * The mouse drives dock clicks, title-bar dragging, and the close box.
 */
#ifndef ASTRION_WM_H
#define ASTRION_WM_H

#include <stdint.h>

void wm_init(void);                 /* reset state; call once after desktop_init */
void wm_tick(void);                 /* poll mouse each main-loop iteration */
int  wm_handle_key(char c);         /* 1 if a focused app consumed the key */
int  wm_active(void);               /* 1 if an app window is open */

/* Programmatic launch (dock icon index: 0=Terminal 1=Files 2=Editor
 * 3=Snake 4=Assistant 5=Monitor) and a direct editor open. Used by the dock
 * and by the shell's `files` / `edit` / `assistant` / `monitor` commands. */
void wm_open_app(int dock_icon);
void wm_open_editor(const char *name);   /* name may be 0 for a new buffer */

#endif
