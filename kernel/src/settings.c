/*
 * Astrion v2.0 — session settings (see settings.h).
 *
 * Freestanding: integer-only, no heap, no libc. Three small tables and three
 * indices — that is the whole module. It holds no pixels and no policy about
 * repainting: whoever changes a setting is responsible for redrawing, because
 * only the window manager knows what is on screen.
 */
#include <stdint.h>
#include "settings.h"
#include "desktop.h"      /* the palette these presets are drawn from */

/* ─── Accent ───
 * The one colour that means "this has focus / this is the system speaking":
 * the focused window border, the caret, the Files selection edge, the active
 * dock ring, the heap gauge, the power glyph.
 *
 * Every preset is taken from the palette the desktop already uses, and every
 * one is at least as light as the default blue (0x0A84FF), which is the
 * darkest thing here. That matters: the accent is used as INK in a couple of
 * places (the Assistant heading, the caret) over AC_TERM_BG 0x171B2E, and
 * 0x0A84FF is already the contrast floor for that. Choosing another preset can
 * only make those lighter, never dimmer — so no choice in this list can push a
 * piece of text below the contrast it ships with. */
static const struct { const char *name; uint32_t rgb; } accents[] = {
    { "Blue",   AC_ACCENT   },   /* 0x0A84FF — the default */
    { "Purple", AC_PURPLE   },   /* 0xBF5AF2 */
    { "Teal",   AC_TEAL     },   /* 0x64D2FF */
    { "Green",  0x30D158u   },   /* the dock's Snake green  */
    { "Orange", 0xFF9F0Au   },   /* the dock's Editor orange */
    { "Pink",   0xFF6482u   },   /* lighter than AC_RED, so it never reads as an alarm */
};
#define N_ACCENT ((int)(sizeof(accents) / sizeof(accents[0])))

/* ─── Wallpaper ───
 * A vertical gradient, same as it has always been — only the two ends move.
 * All of them are dark: the desktop is the backdrop for white text in window
 * bodies and the top bar, and a light wallpaper would put the dock and the
 * window shadows in the wrong register entirely. */
static const struct { const char *name; uint32_t top, bot; } walls[] = {
    { "Midnight", AC_WALL_TOP, AC_WALL_BOT },   /* 0x1A2450 -> 0x281C4A, default */
    { "Slate",    0x1C2233u,   0x2A3145u   },
    { "Ember",    0x2A1A2Eu,   0x4A2436u   },
    { "Forest",   0x14261Fu,   0x1E3A2Cu   },
    { "Ink",      0x0E1020u,   0x191C33u   },
};
#define N_WALL ((int)(sizeof(walls) / sizeof(walls[0])))

/* ─── Clock ─── */
static const char *const clocks[] = { "24-hour", "12-hour" };
#define N_CLOCK ((int)(sizeof(clocks) / sizeof(clocks[0])))

static int i_accent, i_wall, i_clock;

void settings_init(void) { i_accent = 0; i_wall = 0; i_clock = 0; }

uint32_t settings_accent(void)   { return accents[i_accent].rgb; }
uint32_t settings_wall_top(void) { return walls[i_wall].top; }
uint32_t settings_wall_bot(void) { return walls[i_wall].bot; }
int      settings_clock_24h(void){ return i_clock == 0; }

int settings_count(int group) {
    switch (group) {
        case SET_ACCENT: return N_ACCENT;
        case SET_WALL:   return N_WALL;
        case SET_CLOCK:  return N_CLOCK;
        default:         return 0;
    }
}

const char *settings_group_name(int group) {
    switch (group) {
        case SET_ACCENT: return "Accent colour";
        case SET_WALL:   return "Wallpaper";
        case SET_CLOCK:  return "Clock";
        default:         return "";
    }
}

int settings_get(int group) {
    switch (group) {
        case SET_ACCENT: return i_accent;
        case SET_WALL:   return i_wall;
        case SET_CLOCK:  return i_clock;
        default:         return 0;
    }
}

/* Clamped rather than rejected: the caller is a UI walking an index around, and
 * silently landing on a valid choice beats a control that stops responding. */
void settings_set(int group, int idx) {
    int n = settings_count(group);
    if (n <= 0) return;
    if (idx < 0)  idx = 0;
    if (idx >= n) idx = n - 1;
    switch (group) {
        case SET_ACCENT: i_accent = idx; break;
        case SET_WALL:   i_wall   = idx; break;
        case SET_CLOCK:  i_clock  = idx; break;
        default: break;
    }
}

const char *settings_label(int group, int idx) {
    int n = settings_count(group);
    if (idx < 0 || idx >= n) return "";
    switch (group) {
        /* Swatch groups carry their name for the header line, not the chip —
         * the colour IS the label, so the chip stays a colour. */
        case SET_ACCENT: return accents[idx].name;
        case SET_WALL:   return walls[idx].name;
        case SET_CLOCK:  return clocks[idx];
        default:         return "";
    }
}

int settings_swatch(int group, int idx, uint32_t *top, uint32_t *bot) {
    int n = settings_count(group);
    if (idx < 0 || idx >= n || !top || !bot) return 0;
    if (group == SET_ACCENT) { *top = accents[idx].rgb; *bot = accents[idx].rgb; return 1; }
    if (group == SET_WALL)   { *top = walls[idx].top;   *bot = walls[idx].bot;   return 1; }
    return 0;
}
