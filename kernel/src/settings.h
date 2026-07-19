/*
 * Astrion v2.0 — session settings
 *
 * The handful of things a person is allowed to change about their machine, and
 * the single place the rest of the kernel reads them from. desktop.c asks it
 * what colour the wallpaper is, wm.c asks it what the accent is, the clock task
 * asks it whether to say 14:32 or 2:32 PM.
 *
 * Every setting here is WIRED — there is no switch in this file that doesn't
 * change something you can see. A settings panel with a dead control is worse
 * than no settings panel, so if a control can't be built honestly it doesn't
 * get an entry.
 *
 * SCOPE: the session. State lives in module statics, so a change holds until
 * the machine is shut down and then the defaults come back. Nothing is written
 * to disk yet — and the panel says so in as many words, because a setting that
 * quietly forgets is the same lie as a dead switch.
 */
#ifndef ASTRION_SETTINGS_H
#define ASTRION_SETTINGS_H

#include <stdint.h>

void settings_init(void);          /* defaults; call once before desktop_init */

/* ─── What the rest of the kernel reads ─── */
uint32_t settings_accent(void);    /* focus / "the system is speaking" colour */
uint32_t settings_wall_top(void);  /* wallpaper gradient, top                 */
uint32_t settings_wall_bot(void);  /* wallpaper gradient, bottom              */
int      settings_clock_24h(void); /* 1 = 14:32:05, 0 = 2:32:05 PM            */

/* ─── What the Settings panel walks ───
 * The panel is generic: it loops over the groups and their choices and knows
 * nothing about what any of them mean. Adding a fourth setting is a table edit
 * in settings.c and no UI change at all. */
enum { SET_ACCENT = 0, SET_WALL, SET_CLOCK, SET_GROUPS };

const char *settings_group_name(int group);
int         settings_count(int group);          /* choices in the group       */
int         settings_get(int group);            /* current choice index       */
void        settings_set(int group, int idx);   /* clamped; caller repaints   */
const char *settings_label(int group, int idx); /* "" when the chip is a swatch */

/* Preview colours for a choice's chip. Returns 1 and fills in top and bot for a
 * colour swatch (accent = one flat colour, wallpaper = its two gradient ends),
 * 0 for a text chip. */
int settings_swatch(int group, int idx, uint32_t *top, uint32_t *bot);

#endif
