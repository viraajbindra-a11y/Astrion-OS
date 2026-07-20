/*
 * Astrion v2.0 — window manager + built-in apps (Files, Editor, Assistant)
 *
 * The desktop base (wallpaper + top bar + dock) is drawn directly to the
 * framebuffer by desktop.c. Above it float WINDOWS, several at once, stacked
 * in z-order — and the Terminal is one of them. It opens, drags, raises and
 * closes exactly like Files or the Assistant, and the dock reopens it.
 *
 * That last part is recent and it is the point. The Terminal used to be part
 * of the base: painted by desktop.c, always present, and modelled here as the
 * ABSENCE of a window (a focus_shell flag, focused() == 0). An operating
 * system is a place things sit on; a shell welded to the screen is one program
 * with chrome around it. Closing the Terminal now does not stop the shell — it
 * stops drawing it. The console keeps its backing store, so reopening restores
 * the session exactly, wherever the window lands.
 *
 * Each window saves the pixels it covers when it opens and restores them when
 * it moves or closes (the same discipline the mouse cursor uses), so dragging
 * the top window is cheap and needs no back buffer. The saved rect includes
 * the shadow on all four sides — see WIN_SHADOW_PAD in desktop.h.
 *
 * Input routing: the focused window is the topmost one. If that is the
 * Terminal, wm_handle_key declines the key and the shell takes it; if nothing
 * is open at all, the key is dropped rather than typed into a console nobody
 * can see. The mouse drives dock clicks, title-bar dragging, and the close dot.
 */
#ifndef ASTRION_WM_H
#define ASTRION_WM_H

#include <stdint.h>

void wm_init(void);                 /* reset state; call once after desktop_init */
void wm_tick(void);                 /* poll mouse each main-loop iteration */

/* Repaint everything: desktop chrome, then every open window bottom-to-top.
 *
 * Anyone who has scribbled over the screen calls THIS, not
 * desktop_repaint_chrome(). The chrome is only the wallpaper, the top bar and
 * the dock — since the Terminal became a real window, repainting the chrome
 * alone leaves the shell erased along with everything else. */
void wm_repaint(void);
int  wm_handle_key(char c);         /* 1 if a focused app consumed the key */
int  wm_active(void);               /* 1 if an app window is open */

/* Programmatic launch (dock icon index: 0=Terminal 1=Files 2=Editor
 * 3=Snake 4=Assistant 5=Monitor 6=Calculator 7=Settings) and a direct editor
 * open. Used by the dock and by the shell's `files` / `edit` / `assistant` /
 * `monitor` / `calc` / `settings` commands. */
void wm_open_app(int dock_icon);
void wm_open_editor(const char *name);   /* name may be 0 for a new buffer */

#endif
