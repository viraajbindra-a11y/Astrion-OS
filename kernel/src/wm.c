/*
 * Astrion v2.0 — window manager + built-in apps (see wm.h).
 *
 * Freestanding: integer-only, no libc. Draws through the kernel_mb2.c fb_*
 * wrappers and reads the framebuffer directly for the save/restore of the
 * base layer under the floating window.
 */
#include <stdint.h>
#include "wm.h"
#include "desktop.h"    /* palette + desktop_dock_hit + desktop_repaint_chrome */
#include "fb_font.h"
#include "fs.h"
#include "kbd.h"
#include "clipboard.h"  /* copy the current line / paste at the cursor */
#include "heap.h"       /* kmalloc/kfree (ksize_t) */
#include "console.h"    /* console_clear/console_puts */
#include "snake.h"      /* snake_play */
#include "mouse.h"      /* mouse_x/y/left_down/take_left_click/lift */
#include "gpt.h"        /* on-device GPT for the Assistant */
#include "assist_match.h" /* prompt matching, unit-tested on the host */
#include "af.h"         /* antialiased Inter text */
#include "task.h"       /* task_get_info — the assistant reports what's running */
#include "ata.h"        /* ata_present/model/sectors — disk + persistence status */
#include "rtc.h"        /* rtc_read — the assistant knows the real date */
#include "calc.h"       /* the Calculator's arithmetic + state machine */
#include "settings.h"   /* the session's accent / wallpaper / clock format */
#include "pmm.h"        /* pmm_frames_* — the assistant reports physical RAM */
#include "version.h"    /* ASTRION_VERSION — shared with the shell, not a second copy */

/* Framebuffer wrappers live in kernel_mb2.c with no header — declare them
 * here the same way console.c / mouse.c do. */
extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);
extern int      fb_present_x(void);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);

/* Boot facts GRUB handed us, same accessors the shell's `version` / `mem`
 * commands read. Declared here rather than in a header for the same reason
 * the fb_* wrappers are — kernel_mb2.c doesn't publish one. */
extern uint32_t    mb_total_available_mib_x(void);
extern uint32_t    mb_mmap_entry_count_x(void);
extern uint8_t     mb_fb_bpp_x(void);
extern const char *mb_bootloader_name_x(void);

/* ─── Geometry ─── */
/* One generous size for the apps that hold content of unbounded length — a
 * file list, a document, a conversation. The window can't know how much
 * there'll be, so it takes room and lets the content fill it.
 *
 * The System Monitor is NOT one of those: its content is a fixed-width mono
 * table and a heap gauge, and both are bounded. It gets a size derived from
 * that table instead (size_for), so its rules, its bar and its rows all end
 * on the same right edge. At APP_W it was ~30% full — the table stranded in
 * the left 60% and the footer rule framing 245px of nothing. */
#define APP_W     860u
#define APP_H     520u
#define TITLE_H   30u
#define PAD       12u
#define WM_TOP    66u    /* below top bar + accent */
#define WM_DOCK   82u    /* reserved dock height at the bottom */
/* Content text cell — seeded from the antialiased mono face (JetBrains Mono)
 * in wm_init(), the same trick as console.c: the editor/assistant layout math
 * (advance, wrap, line step) is unchanged; only the glyph draw + cell differ. */
static uint32_t GW = 12, GH = 27, LINE = 29;   /* real values set in wm_init */

enum app_kind { APP_NONE = 0, APP_FILES, APP_EDITOR, APP_ASSIST, APP_MON,
                APP_CALC, APP_SET };

static uint32_t SW, SH;

/* ─── Windows ───
 * One window per app kind (the dock model: clicking an app opens it, or
 * focuses it if it is already open), several open at once, stacked in
 * z-order — the topmost is the focused one.
 *
 * `savebuf` holds the pixels that were beneath a window when it was painted,
 * so dragging the TOP window stays cheap (restore → move → save → draw) with
 * no full repaint. Anything that changes the stack (open / close / raise)
 * calls repaint_all() instead, which is always correct — that is why the
 * console needs a backing store (console_redraw).
 *
 * That savebuf rule is also what bounds the System Monitor's live repaint:
 * a window may only paint over itself, because anything above it holds a
 * savebuf snapshotted from BEFORE the paint. See mon_can_live_paint(). */
#define WM_MAX 6

struct window {
    int           open;
    enum app_kind app;
    uint32_t      x, y, w, h;     /* outer rect */
    uint32_t      sw, sh;         /* saved-rect dims (incl. shadow) */
    uint32_t     *savebuf;        /* pixels beneath this window at paint time */
    uint32_t      savecap;        /* savebuf capacity in pixels (grows, never shrinks) */
};
static struct window wins[WM_MAX];
static int zord[WM_MAX];      /* z-order: [0] = bottom … [zn-1] = top */
static int zn;                /* number of open windows */
static int focus_shell = 1;   /* 1 = the keyboard belongs to the terminal */

/* Content rect of the window currently being drawn / keyed. */
static uint32_t cx, cy, cw, ch;

/* Forward decls. */
static void wm_close(void);
static void repaint_all(void);
static void draw_frame(struct window *w);
static void draw_content(struct window *w);
static void set_content_rect(struct window *w);
static void settings_apply(int g, int idx);   /* the Assistant can change settings too */

static int slot_of(enum app_kind a) {
    switch (a) { case APP_FILES: return 0; case APP_EDITOR: return 1;
                 case APP_ASSIST: return 2; case APP_MON: return 3;
                 case APP_CALC: return 4; case APP_SET: return 5;
                 default: return -1; }
}
static int icon_of(enum app_kind a) {   /* dock icon index */
    switch (a) { case APP_FILES: return 1; case APP_EDITOR: return 2;
                 case APP_ASSIST: return 4; case APP_MON: return 5;
                 case APP_CALC: return 6; case APP_SET: return 7;
                 default: return 0; }
}
static struct window *topwin(void)  { return zn > 0 ? &wins[zord[zn - 1]] : 0; }
static struct window *focused(void) { return focus_shell ? 0 : topwin(); }
static void z_remove(int slot) {
    int k = 0;
    for (int i = 0; i < zn; i++) if (zord[i] != slot) zord[k++] = zord[i];
    zn = k;
}
static void z_raise(int slot) { z_remove(slot); zord[zn++] = slot; }

/* Drag state. */
static int dragging, drag_ox, drag_oy, last_mx, last_my;

/* ─── Small helpers ─── */

static int str_len(const char *s) { int n = 0; while (s && s[n]) n++; return n; }
static void str_copy(char *d, const char *s, int max) {
    int i = 0; while (s && s[i] && i < max - 1) { d[i] = s[i]; i++; } d[i] = 0;
}

static void draw_border(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t c) {
    fb_rect_x(x, y, w, 1, c); fb_rect_x(x, y + h - 1, w, 1, c);
    fb_rect_x(x, y, 1, h, c); fb_rect_x(x + w - 1, y, 1, h, c);
}

static void save_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t *buf) {
    if (!fb_present_x() || !buf) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch = fb_pitch_x() / 4;
    for (uint32_t r = 0; r < h; r++)
        for (uint32_t c = 0; c < w; c++) {
            uint32_t px = x + c, py = y + r, v = 0;
            if (px < SW && py < SH) v = fb[py * pitch + px];
            buf[r * w + c] = v;
        }
}
static void restore_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t *buf) {
    if (!fb_present_x() || !buf) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch = fb_pitch_x() / 4;
    for (uint32_t r = 0; r < h; r++)
        for (uint32_t c = 0; c < w; c++) {
            uint32_t px = x + c, py = y + r;
            if (px < SW && py < SH) fb[py * pitch + px] = buf[r * w + c];
        }
}

/* ─── Editor state ─── */
/* ed_name holds a PATH now, not a bare name (Files hands it a full one),
 * so both buffers are sized off FS_PATH_MAX. */
static char     ed_name[FS_PATH_MAX + 1];
static char     ed_title[FS_PATH_MAX + 16];
static uint8_t *ed_buf;
static uint32_t ed_len, ed_cap, ed_cursor;
static int      ed_copied;   /* raise a brief "copied" cue after Ctrl+C; any next key clears it */

/* Pin a possibly-relative name to the cwd AS IT IS RIGHT NOW. The editor
 * holds ed_name across many keystrokes and only writes it on ESC, so a
 * 'cd' in the terminal in between would otherwise silently redirect the
 * save into a different directory. Absolute names are taken as-is. */
static void abs_path_of(const char *name, char *out, int cap) {
    if (cap <= 0) return;
    out[0] = 0;
    if (!name || !name[0]) return;
    if (name[0] == '/') { str_copy(out, name, cap); return; }
    char base[FS_PATH_MAX + 1];
    if (fs_cwd_path(base, sizeof(base)) == 0) { str_copy(out, name, cap); return; }
    int t = 0;
    for (int i = 0; base[i] && t < cap - 1; i++) out[t++] = base[i];
    if (t > 0 && out[t - 1] != '/' && t < cap - 1) out[t++] = '/';   /* "/" needs no second slash */
    for (int i = 0; name[i] && t < cap - 1; i++) out[t++] = name[i];
    out[t] = 0;
}

static void editor_open(const char *name) {
    if (ed_buf) { kfree(ed_buf); ed_buf = 0; }   /* reopening: don't leak */
    ed_cap = 8192;
    ed_buf = (uint8_t *)kmalloc(ed_cap);
    ed_len = 0; ed_cursor = 0; ed_copied = 0;
    abs_path_of((name && name[0]) ? name : "untitled.txt", ed_name, sizeof(ed_name));
    str_copy(ed_title, "Editor: ", sizeof(ed_title));
    /* append the name to the title */
    {
        int t = str_len(ed_title), i = 0;
        while (ed_name[i] && t < (int)sizeof(ed_title) - 1) ed_title[t++] = ed_name[i++];
        ed_title[t] = 0;
    }
    if (!ed_buf) return;
    /* Load through the SAME anchored path we'll save to, so open and save
     * can never disagree about which file this is. */
    fs_node *n = (name && name[0]) ? fs_find(ed_name) : 0;
    if (n && n->kind == FS_FILE) {
        uint32_t k = n->size;
        if (k > ed_cap - 1) k = ed_cap - 1;
        for (uint32_t i = 0; i < k; i++) ed_buf[i] = n->data[i];
        ed_len = k; ed_cursor = k;
    }
}

static void editor_save(void) {
    if (!ed_buf) return;
    fs_write(ed_name, ed_buf, ed_len);
    fs_sync();
}

/* A calm "copied" chip in the bottom-right of the page — the one reassurance
 * that Ctrl+C took, since the copy itself is invisible (the clipboard is
 * off-screen). It's the small chrome face (Inter), not the document's mono, so
 * it reads as the machine speaking rather than text you typed; a 2px teal edge
 * gives it the same "here" language the Files selection uses. It never lingers
 * or nags: the next keystroke repaints the page without it. Teal is Astrion's
 * soft yes (the folder glyph, the prompt caret) — a quieter affirmative than
 * the loud blue accent, which is the right register for reassurance. */
static void editor_draw_copied(void) {
    const char *msg = "copied";
    uint32_t tw = af_text_width(msg, AF_REG13);
    uint32_t lh = (uint32_t)af_line_height(AF_REG13);
    uint32_t edge = 2, padx = 10, pady = 5, margin = 8;
    uint32_t pw = edge + padx + tw + padx;
    uint32_t ph = pady + lh + pady;
    if (pw + margin > cw || ph + margin > ch) return;   /* tiny window: skip, never overhang */
    uint32_t bx = cx + cw - pw - margin;
    uint32_t by = cy + ch - ph - margin;
    fb_rect_x(bx, by, pw, ph, AC_PANEL);                /* chip body   */
    fb_rect_x(bx, by, edge, ph, AC_TEAL);               /* accent edge */
    af_draw(bx + edge + padx, by + pady, msg, AC_TEAL, AF_REG13);
}

static void editor_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    uint32_t gx = cx, gy = cy, caret_x = cx, caret_y = cy;
    for (uint32_t i = 0; i <= ed_len; i++) {
        if (i < ed_len && ed_buf[i] != '\n' && gx + GW > cx + cw) { gx = cx; gy += LINE; }
        if (i == ed_cursor) { caret_x = gx; caret_y = gy; }
        if (i == ed_len) break;
        char c = ed_buf[i];
        if (c == '\n') { gx = cx; gy += LINE; continue; }
        if (gy + GH > cy + ch) break;
        char s[2] = { c, 0 };
        af_draw(gx, gy, s, AC_WHITE, AF_MONO);
        gx += GW;
    }
    if (caret_y + GH <= cy + ch)
        fb_rect_x(caret_x, caret_y, 2, GH, settings_accent());   /* text caret */
    if (ed_copied) editor_draw_copied();
}

static void editor_key(char c) {
    if (c == 27) { wm_close(); return; }   /* ESC: save + close */
    ed_copied = 0;   /* any action clears the cue... (copy re-raises it below) */
    if (c == (char)KEY_LEFT)  { if (ed_cursor > 0)      ed_cursor--; editor_draw(); return; }
    if (c == (char)KEY_RIGHT) { if (ed_cursor < ed_len) ed_cursor++; editor_draw(); return; }
    if (c == KEY_CTRL_C) {   /* copy the current line (cursor's line) to clipboard */
        if (ed_buf) {
            uint32_t s = ed_cursor, e = ed_cursor;
            while (s > 0     && ed_buf[s - 1] != '\n') s--;   /* back to line start */
            while (e < ed_len && ed_buf[e]     != '\n') e++;  /* fwd to line end     */
            clipboard_set((const char *)ed_buf + s, e - s);   /* excludes the '\n'   */
            ed_copied = 1;   /* ...except copy, which raises it */
        }
        editor_draw();       /* repaint so the cue appears */
        return;
    }
    if (c == KEY_CTRL_V) {   /* paste the clipboard at the cursor */
        if (ed_buf) {
            const char *p = clipboard_get();
            uint32_t n = clipboard_len();
            /* Insert byte-by-byte, mirroring the printable-insert path below.
             * Wrap-safe: stop while there is no room for one more byte. */
            for (uint32_t k = 0; k < n && ed_len < ed_cap - 1; k++) {
                for (uint32_t i = ed_len; i > ed_cursor; i--) ed_buf[i] = ed_buf[i - 1];
                ed_buf[ed_cursor] = (uint8_t)p[k]; ed_len++; ed_cursor++;
            }
            editor_draw();
        }
        return;
    }
    if (c == '\b') {
        if (ed_cursor > 0 && ed_len > 0) {
            for (uint32_t i = ed_cursor - 1; i < ed_len - 1; i++) ed_buf[i] = ed_buf[i + 1];
            ed_len--; ed_cursor--;
        }
        editor_draw(); return;
    }
    if (c == '\n' || (c >= 32 && c <= 126)) {
        if (ed_buf && ed_len + 1 < ed_cap) {
            for (uint32_t i = ed_len; i > ed_cursor; i--) ed_buf[i] = ed_buf[i - 1];
            ed_buf[ed_cursor] = (uint8_t)c; ed_len++; ed_cursor++;
        }
        editor_draw();
    }
}

/* ─── Files state ───
 *
 * A directory browser over the shell's cwd. Entries are stored as FULL
 * paths: a leaf name no longer identifies a file (two directories can
 * each hold a "notes.txt"), and handing the editor an absolute path means
 * it opens the right one no matter where the cwd has wandered since. The
 * ROW still shows only the leaf — every row in a folder shares the same
 * prefix, so printing it on each one is noise the breadcrumb already
 * covered.
 *
 * Navigation moves the machine-wide cwd (fs_chdir), because that is the
 * model fs.h commits to: one cwd, shared by the shell, the Assistant and
 * ring-3 programs. Files showing a different "here" than `pwd` would be a
 * lie. Every key reloads from fs_cwd(), so the view can't drift from it.
 */
enum { FL_UP = 0, FL_DIR = 1, FL_FILE = 2 };   /* also the sort rank */

/* Row geometry, as a rule rather than a set of literals. The gutter is
 * built so the glyph can never crowd the name: 12px in from the row edge
 * (which also clears the selection bar), a 14px box for the glyph, then a
 * full 10px of air before the text starts. Every glyph is centred on
 * FL_INSET + FL_GLYPH/2, so folders, files and ".." share one axis. */
#define FL_INSET  12u    /* row edge  -> glyph box */
#define FL_GLYPH  14u    /* glyph box width        */
#define FL_GAP    10u    /* glyph box -> name      */
#define FL_TEXT   (FL_INSET + FL_GLYPH + FL_GAP)

#define FL_MAX 64
static char    fl_names[FL_MAX][FS_PATH_MAX + 1];   /* full path — the editor needs it */
static uint8_t fl_kind[FL_MAX];
static int     fl_count, fl_sel, fl_top;   /* fl_top = first visible row (the scroll offset) */

/* When a folder holds more rows than fit, a slim scrollbar rides the right
 * edge — position and proportion at a glance. It costs the rows a thin lane on
 * the right (only when it's actually there), which beats a "+N more" line that
 * would steal a whole row from the very content it's meant to reveal. */
#define SB_W        4u                /* scrollbar width                     */
#define SB_GAP      5u                /* breathing room between rows and bar  */
#define SB_LANE     (SB_W + SB_GAP)
#define SB_MINTHUMB 24u               /* a thumb still visible in a huge dir  */

static int str_eq(const char *a, const char *b) {
    while (*a && *a == *b) { a++; b++; }
    return *a == *b;
}
/* The last component of a path — what the row actually prints. */
static const char *leaf_of(const char *path) {
    const char *l = path;
    for (const char *p = path; *p; p++) if (*p == '/') l = p + 1;
    return l;
}
static char lower_c(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }
static int name_cmp(const char *a, const char *b) {
    for (;;) {
        char x = lower_c(*a), y = lower_c(*b);
        if (x != y) return (int)(unsigned char)x - (int)(unsigned char)y;
        if (!x) return 0;
        a++; b++;
    }
}
/* Sort key: rank first (up < dir < file), then name. Folders landing above
 * files is the real signal — the glyph only confirms what the order
 * already told you. FL_UP being rank 0 pins ".." first for free. */
static int entry_after(uint8_t ka, const char *pa, uint8_t kb, const char *pb) {
    if (ka != kb) return ka > kb;
    return name_cmp(leaf_of(pa), leaf_of(pb)) > 0;
}

/* Load the cwd's children. If `want` (a full path) turns up in the list the
 * cursor parks on it — coming back up from a folder should land you on that
 * folder, not scrolled back to the top. Otherwise the cursor takes the first
 * real row, skipping ".." so Enter never just bounces you back out. */
static void files_load_at(const char *want) {
    fl_count = 0; fl_sel = 0; fl_top = 0;
    fs_node *dir = fs_cwd();

    /* Off the root, "up" is a real place you can go, so it gets a real row. */
    if (dir != fs_root() && dir->parent) {
        if (fs_path(dir->parent, fl_names[fl_count], FS_PATH_MAX + 1)) {
            fl_kind[fl_count] = FL_UP; fl_count++;
        }
    }
    for (fs_node *n = fs_first_in(dir); n && fl_count < FL_MAX; n = fs_next_in(dir, n)) {
        /* fs_path returns 0 only if the path can't fit, which fs.c refuses
         * to create in the first place - skip rather than show a blank row. */
        if (fs_path(n, fl_names[fl_count], FS_PATH_MAX + 1) == 0) continue;
        fl_kind[fl_count] = (n->kind == FS_DIR) ? FL_DIR : FL_FILE;
        fl_count++;
    }

    /* Insertion sort. FL_MAX is 64 and this runs once per directory change,
     * so the O(n^2) is cheaper than the string compares a path walk does. */
    for (int i = 1; i < fl_count; i++) {
        char key[FS_PATH_MAX + 1]; str_copy(key, fl_names[i], FS_PATH_MAX + 1);
        uint8_t kk = fl_kind[i];
        int j = i - 1;
        while (j >= 0 && entry_after(fl_kind[j], fl_names[j], kk, key)) {
            str_copy(fl_names[j + 1], fl_names[j], FS_PATH_MAX + 1);
            fl_kind[j + 1] = fl_kind[j];
            j--;
        }
        str_copy(fl_names[j + 1], key, FS_PATH_MAX + 1);
        fl_kind[j + 1] = kk;
    }

    if (fl_count > 1 && fl_kind[0] == FL_UP) fl_sel = 1;
    if (want && want[0]) {
        for (int i = 0; i < fl_count; i++)
            if (fl_kind[i] != FL_UP && str_eq(fl_names[i], want)) { fl_sel = i; break; }
    }
}
static void files_load(void) { files_load_at(0); }

/* Where you are, drawn as a path you can read left to right: the folder
 * you are actually in is the only white thing, everything behind it
 * recedes. AF_REG13 throughout — this is chrome, not content.
 *
 * The separators wanted to be AC_BORDER (structure, not text) and that
 * failed on contact: AC_BORDER is a fine 1px rule because a rule is 100%
 * coverage, but an antialiased glyph is mostly PARTIAL coverage, so the
 * same hex lands near 1.7:1 on AC_TERM_BG and the slashes dissolve. A
 * path with invisible separators is just words in a row. They're muted
 * alongside the ancestors instead — two levels that you can read beats
 * three that you can't. */
static void files_draw_crumb(uint32_t bx, uint32_t by) {
    char path[FS_PATH_MAX + 1];
    if (fs_cwd_path(path, sizeof(path)) == 0) { path[0] = '/'; path[1] = 0; }

    /* At the root the separator IS the current folder, so it goes white. */
    if (path[0] == '/' && path[1] == 0) {
        af_draw(bx, by, "/", AC_WHITE, AF_REG13);
        return;
    }

    int last = 0;                       /* index of the final '/' */
    for (int i = 0; path[i]; i++) if (path[i] == '/') last = i;

    uint32_t x = bx;
    int i = 0;
    while (path[i]) {
        if (path[i] == '/') {
            af_draw(x, by, "/", AC_MUTED, AF_REG13);
            x += af_text_width("/", AF_REG13);
            i++;
            continue;
        }
        char comp[FS_NAME_MAX + 1];
        int j = i, k = 0;
        while (path[j] && path[j] != '/') { if (k < FS_NAME_MAX) comp[k++] = path[j]; j++; }
        comp[k] = 0;
        af_draw(x, by, comp, (i - 1 == last) ? AC_WHITE : AC_MUTED, AF_REG13);
        x += af_text_width(comp, AF_REG13);
        i = j;
    }
}

/* The kind glyph. gx is the left of the 14px box, gcy the row's optical
 * centre — every glyph is built outward from that one point so they all
 * sit on a shared axis. A folder is a filled tab-and-body; a file is a
 * hollow portrait page. Solid-vs-outline reads faster at this size than
 * any two silhouettes would, and it survives being 14px tall. */
static void files_row_glyph(uint8_t kind, uint32_t gx, uint32_t gcy, int sel) {
    uint32_t mid = gx + FL_GLYPH / 2;                       /* the shared axis */
    if (kind == FL_UP) {
        for (uint32_t k = 0; k < 7; k++)                    /* head */
            fb_rect_x(mid - k, gcy - 7 + k, 1 + k * 2, 1, AC_MUTED);
        fb_rect_x(mid - 2, gcy - 1, 5, 8, AC_MUTED);        /* shaft */
        return;
    }
    if (kind == FL_DIR) {
        fb_rect_x(gx, gcy - 6, 6, 2, AC_TEAL);              /* tab  */
        fb_rect_x(gx, gcy - 4, FL_GLYPH, 10, AC_TEAL);      /* body */
        return;
    }
    /* A page with a folded corner. An empty outline is legible but says
     * nothing; the fold is what makes it read as a file rather than a box.
     * Drawn as edges + a 1px stair because we have no diagonals — at 14px
     * the stair IS the fold. AC_BORDER keeps it quiet (files are the
     * default and shouldn't compete with the folders above them), but it
     * would sink into AC_PANEL, so a selected row lifts it to stay seen. */
    uint32_t c = sel ? AC_MUTED : AC_BORDER;
    fb_rect_x(gx + 1, gcy - 7,  8,  1, c);        /* top, stopping at the fold */
    fb_rect_x(gx + 1, gcy - 7,  1, 14, c);        /* left  */
    fb_rect_x(gx + 1, gcy + 6, 12,  1, c);        /* bottom */
    fb_rect_x(gx + 12, gcy - 3, 1, 10, c);        /* right, below the fold */
    for (uint32_t k = 0; k < 5; k++)              /* the fold itself */
        fb_rect_x(gx + 8 + k, gcy - 7 + k, 1, 1, c);
}

/* Slide the visible window so the selection is always on it. Driven from
 * files_draw with the live row budget, so the view reconciles to the cursor
 * however fl_sel got where it is — arrowed past an edge, or parked deep by
 * files_load_at coming back up out of a folder. */
static void files_ensure_visible(int vis) {
    if (vis < 1) vis = 1;
    if (fl_count <= vis)        { fl_top = 0; return; }   /* it all fits: no scroll */
    if (fl_sel < fl_top)          fl_top = fl_sel;                 /* selection above view */
    if (fl_sel >= fl_top + vis)   fl_top = fl_sel - vis + 1;       /* selection below view */
    int maxtop = fl_count - vis;                          /* no blank tail past the end */
    if (fl_top > maxtop) fl_top = maxtop;
    if (fl_top < 0)      fl_top = 0;
}

/* The bar: a quiet track the height of the rows region, with a thumb sized to
 * the fraction on screen and slid to fl_top. Only ever drawn when fl_count
 * exceeds the page, so a folder that fits looks exactly as it did before. */
static void files_draw_scrollbar(uint32_t rtop, int vis, uint32_t rh) {
    uint32_t track_h = (uint32_t)vis * rh;
    uint32_t bx = cx + cw - SB_W;
    fb_rect_x(bx, rtop, SB_W, track_h, AC_PANEL);            /* track */

    uint32_t thumb = track_h * (uint32_t)vis / (uint32_t)fl_count;
    if (thumb < SB_MINTHUMB) thumb = SB_MINTHUMB;
    if (thumb > track_h)     thumb = track_h;
    uint32_t denom = (uint32_t)(fl_count - vis);            /* > 0: caller guarantees overflow */
    uint32_t ty = rtop + (uint32_t)fl_top * (track_h - thumb) / denom;
    fb_rect_x(bx, ty, SB_W, thumb, AC_MUTED);               /* thumb */
}

static void files_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);

    /* Header: where you are, and nothing else. */
    files_draw_crumb(cx, cy);
    fb_rect_x(cx, cy + 24, cw, 1, AC_BORDER);

    /* Footer: the keys. These sit at the foot rather than beside the
     * breadcrumb because up there a 39-character hint out-shouted the one
     * short string the row exists to say. Same rule as the header, so the
     * content is framed top and bottom by the same 1px line. */
    const char *hint = "Enter opens   Backspace up   Esc closes";
    uint32_t fy   = cy + ch - (uint32_t)af_line_height(AF_REG13);
    uint32_t foot = fy - 8;                        /* the footer's rule */
    fb_rect_x(cx, foot, cw, 1, AC_BORDER);
    uint32_t hw = af_text_width(hint, AF_REG13);
    if (cw > hw) af_draw(cx + cw - hw, fy, hint, AC_MUTED, AF_REG13);

    /* The row derives from the font rather than a guess, so the rhythm
     * follows if the face ever changes: line height plus 5px of air, with
     * the text centred in it instead of riding the bottom. */
    uint32_t rh  = GH + 5;
    uint32_t top = cy + 32;
    int vis = (foot > top) ? (int)((foot - top) / rh) : 0;
    if (vis < 1) vis = 1;
    files_ensure_visible(vis);

    /* More rows than fit → a scrollbar, and the rows yield it a lane so a long
     * name can't run under the thumb. A folder that fits is untouched. */
    int over = (fl_count > vis);
    uint32_t rw = (over && cw > SB_LANE) ? (cw - SB_LANE) : cw;

    for (int k = 0; k < vis; k++) {
        int i = fl_top + k;
        if (i >= fl_count) break;
        uint32_t ry = top + (uint32_t)k * rh;
        int sel = (i == fl_sel);
        if (sel) {
            fb_rect_x(cx, ry, rw, rh, AC_PANEL);
            fb_rect_x(cx, ry, 2, rh, settings_accent());   /* the selection's edge */
        }
        files_row_glyph(fl_kind[i], cx + FL_INSET, ry + rh / 2, sel);

        uint32_t tx = cx + FL_TEXT, ty = ry + (rh - GH) / 2;
        const char *nm = leaf_of(fl_names[i]);
        if (fl_kind[i] == FL_UP) {
            af_draw(tx, ty, "..", sel ? AC_WHITE : AC_MUTED, AF_MONO);
        } else if (fl_kind[i] == FL_DIR) {
            /* The trailing '/' says "this opens into something" before the
             * colour or the glyph has to. Teal holds through selection —
             * the accent bar carries that, so colour is free to mean kind. */
            af_draw(tx, ty, nm, AC_TEAL, AF_MONO);
            af_draw(tx + af_text_width(nm, AF_MONO), ty, "/", AC_TEAL, AF_MONO);
        } else {
            af_draw(tx, ty, nm, sel ? AC_WHITE : AC_MUTED, AF_MONO);
        }
    }

    if (over) files_draw_scrollbar(top, vis, rh);
}

/* Up one level. Backspace and the ".." row land here; ESC still closes the
 * window — "up" and "leave" must never be the same key. */
static void files_up(void) {
    fs_node *dir = fs_cwd();
    if (dir == fs_root() || !dir->parent) return;      /* already home */
    char here[FS_PATH_MAX + 1];
    if (fs_path(dir, here, sizeof(here)) == 0) here[0] = 0;
    if (fs_chdir("..") != 0) return;
    files_load_at(here);                               /* land on where we were */
    files_draw();
}

static void files_key(char c) {
    if (c == 27) { wm_close(); return; }
    if (c == (char)KEY_UP)   { if (fl_sel > 0)             fl_sel--; files_draw(); return; }
    if (c == (char)KEY_DOWN) { if (fl_sel < fl_count - 1)  fl_sel++; files_draw(); return; }
    if (c == '\b') { files_up(); return; }
    if (c == '\n' && fl_count > 0) {
        if (fl_kind[fl_sel] == FL_UP) { files_up(); return; }
        char nm[FS_PATH_MAX + 1]; str_copy(nm, fl_names[fl_sel], sizeof(nm));
        if (fl_kind[fl_sel] == FL_DIR) {
            /* A directory is not text — descend into it instead of handing
             * the editor an empty buffer that would no-op on save. */
            if (fs_chdir(nm) == 0) { files_load(); files_draw(); }
            return;
        }
        wm_open_editor(nm);
    }
}

/* ─── Assistant: the on-device GPT chat window ─── */
static char     as_prompt[128];
static int      as_plen;
static uint32_t as_ox, as_oy;      /* streaming output cursor */
/* Everything the assistant has emitted for the current answer. Kept so the
 * output can be repainted when the window moves / is raised — pixels alone
 * can't be recovered once another window has covered them. */
static char     as_out[3072];
static int      as_olen;

/* ─── the confirmation gate ───
 *
 * A destructive action that has been described to the user and is waiting on
 * a yes. Nothing here is a pointer into the filesystem: the file is stored by
 * NAME and re-resolved at the moment it is acted on, because the shell can
 * unlink or replace it between the question and the answer, and an fs_node*
 * cached across those two keystrokes is a stale pointer aimed at a delete.
 *
 * Cleared by assist_reset(), which runs every time the window is opened — so
 * an armed delete can never outlive the window that asked about it. */
enum as_pend {
    AS_PEND_NONE = 0,
    AS_PEND_DELETE,      /* unlink as_pend_a                            */
    AS_PEND_OVERWRITE,   /* copy as_pend_b over the existing as_pend_a  */
    AS_PEND_WRITE,       /* put as_pend_text into the existing as_pend_a */
};
static enum as_pend as_pending;
static char         as_pend_a[FS_NAME_MAX + 1];
static char         as_pend_b[FS_NAME_MAX + 1];
/* The payload of a held-back write. Held here rather than re-parsed from the
 * prompt at confirm time, because by then the prompt is the word "y". */
static char         as_pend_text[128];
/* What as_pend_a looked like when we described it on screen. The answer is
 * only good for the file the question was about. */
static struct am_ident as_pend_id;

/* ─── the conversation's one slot ───
 *
 * The last file an intent actually succeeded on. "it" / "that" / "the file"
 * resolve to this and nothing else — one slot, never a stack.
 *
 * as_last_age counts prompts that went by without touching a file; the bound
 * itself is AM_REF_MAX_AGE, in assist_match.h with the reasoning. */
static char as_last_file[FS_NAME_MAX + 1];
static int  as_last_age;

/* Record a file as the thing "it" now means. Called only where an intent has
 * genuinely succeeded on that file — a failed operation must not move the slot,
 * or "it" starts meaning something the user never got. */
static void assist_touch_file(const char *name) {
    int k = 0;
    while (name[k] && k < (int)sizeof(as_last_file) - 1) { as_last_file[k] = name[k]; k++; }
    as_last_file[k] = 0;
    as_last_age = 0;
}

static void assist_forget_file(void) { as_last_file[0] = 0; as_last_age = 0; }

static void assist_disarm(void) {
    as_pending = AS_PEND_NONE;
    as_pend_a[0] = 0; as_pend_b[0] = 0; as_pend_text[0] = 0;
    as_pend_id.size = 0; as_pend_id.hash = 0; as_pend_id.valid = 0;
}

/* The file the pending question is about, or 0 when nothing is armed. Every
 * gate stores the file that stands to lose something in as_pend_a — the one
 * being unlinked, or the one whose bytes get replaced — so a confirmation can
 * always be checked against the thing it is supposed to be confirming. */
static const char *assist_pending_target(void) {
    return as_pending != AS_PEND_NONE ? as_pend_a : 0;
}

/* FNV-1a over a file's bytes. Not a security hash and does not need to be —
 * the job is to notice that a file was replaced between the question and the
 * answer, and the other actor here is a person typing at a shell, not an
 * adversary constructing collisions. One pass at arm and one at confirm; a
 * file this filesystem can hold is a few KiB, so it costs nothing. */
static unsigned long file_hash(const fs_node *n) {
    unsigned long h = 2166136261UL;
    if (!n->data) return h;                 /* an empty file has no bytes */
    for (uint32_t i = 0; i < n->size; i++) {
        h ^= (unsigned long)n->data[i];
        h *= 16777619UL;
    }
    return h;
}

/* What `name` resolves to RIGHT NOW: the size we would put on screen and a
 * fingerprint of the content behind it. Invalid when there is no regular file
 * there, which is itself a change worth refusing on. */
static struct am_ident ident_of(const char *name) {
    struct am_ident id;
    id.size = 0; id.hash = 0; id.valid = 0;
    fs_node *n = fs_find(name);
    if (!n || n->kind != FS_FILE) return id;
    id.size  = (unsigned long)n->size;
    id.hash  = file_hash(n);
    id.valid = 1;
    return id;
}

static void assist_reset(void) {
    as_plen = 0; as_prompt[0] = 0; as_olen = 0; assist_disarm();
    /* The slot expires with the window. Reopening the Assistant is a new
     * conversation, and "it" must not reach back into the last one. */
    assist_forget_file();
}

static void assist_prompt_line(void) {
    uint32_t py = cy + 60;
    fb_rect_x(cx, py, cw, GH + 2, AC_TERM_BG);
    af_draw(cx, py, ">", AC_TEAL, AF_MONO);
    af_draw(cx + GW + 6, py, as_prompt, AC_WHITE, AF_MONO);
    uint32_t caret = cx + GW + 6 + (uint32_t)as_plen * GW;
    fb_rect_x(caret, py, 2, GH, settings_accent());
}

/* Draw one char at the streaming cursor, wrapping + clipping. Draw only. */
static void assist_put(char c) {
    if (c == '\n') { as_ox = cx; as_oy += LINE; return; }
    if (as_ox + GW > cx + cw) { as_ox = cx; as_oy += LINE; }
    if (as_oy + GH > cy + ch) return;         /* full */
    char s[2] = { c, 0 };
    af_draw(as_ox, as_oy, s, AC_WHITE, AF_MONO);
    as_ox += GW;
}

/* Record + draw. Everything (intent replies and streamed GPT text) goes
 * through here, so assist_render_output() can rebuild the answer verbatim. */
static void assist_emit(char c) {
    if (as_olen < (int)sizeof(as_out) - 1) as_out[as_olen++] = c;
    assist_put(c);
}

/* Repaint the output area from the recorded answer. */
static void assist_render_output(void) {
    uint32_t oy0 = cy + 96;
    fb_rect_x(cx, oy0, cw, (cy + ch) - oy0, AC_TERM_BG);
    as_ox = cx; as_oy = oy0;
    for (int i = 0; i < as_olen; i++) assist_put(as_out[i]);
}

/* ─── local command layer: the assistant DOES things, fully offline ─── */
extern uint64_t pit_elapsed_ms(void);

#define lc  am_lc   /* both now live in include/assist_match.h */

#define has am_has

/* Bounded string copy — always terminates, never runs past cap. */
static void scopy(char *dst, const char *src, int cap) {
    int k = 0;
    while (src[k] && k < cap - 1) { dst[k] = src[k]; k++; }
    dst[k] = 0;
}

/* last whitespace-delimited token of s, trailing punctuation trimmed.
 *
 * LENIENT ON PURPOSE, and only safe for the intents that read rather than
 * destroy. It takes whatever ends the sentence, so `delete edge3.txt later`
 * hands back "later" — which is how a file the user never named got deleted.
 * Anything that removes or overwrites data uses am_named_file() instead and
 * refuses when it can't find exactly one explicitly named file. */
static void last_word(const char *s, char *out, int cap) {
    int end = 0; while (s[end]) end++;
    while (end > 0) { char c = s[end - 1];
        if (c==' '||c=='\t'||c=='.'||c=='!'||c=='?'||c==',') end--; else break; }
    int st = end;
    while (st > 0 && s[st - 1] != ' ' && s[st - 1] != '\t') st--;
    int k = 0; for (int i = st; i < end && k < cap - 1; i++) out[k++] = s[i];
    out[k] = 0;
}

/* the word following key (case-insensitive) -> out; 1 if found + non-empty */
static int word_after(const char *s, const char *key, char *out, int cap) {
    const char *p = 0;
    for (int i = 0; s[i]; i++) {
        int j = 0; while (key[j] && lc(s[i + j]) == lc(key[j])) j++;
        if (!key[j]) { p = &s[i + j]; break; }
    }
    if (!p) return 0;
    while (*p == ' ' || *p == '\t') p++;
    int k = 0;
    while (*p && *p != ' ' && *p != '\t' && k < cap - 1) out[k++] = *p++;
    out[k] = 0;
    return k > 0;
}

/* first of " into " / " to " / " in " in s; returns pointer + sets *sl to len */
static const char *find_to(const char *s, int *sl) {
    static const char *const seps[] = { " into ", " to ", " in " };
    static const int lens[] = { 6, 4, 4 };
    for (int k = 0; k < 3; k++)
        for (int i = 0; s[i]; i++) {
            int j = 0; while (seps[k][j] && lc(s[i + j]) == lc(seps[k][j])) j++;
            if (!seps[k][j]) { *sl = lens[k]; return &s[i]; }
        }
    return 0;
}

static int name_has_ext(const char *n) {
    for (int i = 0; n[i]; i++) if (n[i] == '.') return 1;
    return 0;
}

/* Resolve `name`, or `name`.txt (appended in place); returns node or 0. */
static fs_node *resolve_file(char *name, int cap) {
    fs_node *n = fs_find(name);
    if (n) return n;
    if (!name_has_ext(name)) {
        int k = 0; while (name[k]) k++;
        const char *e = ".txt"; int j = 0;
        while (e[j] && k < cap - 1) name[k++] = e[j++];
        name[k] = 0;
        n = fs_find(name);
    }
    return n;
}

/* The closest existing filename to what they typed, or 0 when nothing is near
 * enough to be worth saying. Best match only.
 *
 * SUGGESTION ONLY. Nothing here is ever applied automatically, and least of
 * all in front of a destructive verb: a near-miss on `delete` is exactly where
 * a helpful guess destroys the wrong file. It turns a dead end into a
 * retype, which is all it should ever do. */
static const char *assist_did_you_mean(const char *typed) {
    const char *best = 0; int bestd = 99;
    for (fs_node *n = fs_first(); n; n = fs_next(n)) {
        if (n->kind != FS_FILE) continue;
        if (!am_did_you_mean(typed, n->name)) continue;
        int d = am_edit_distance(typed, n->name);
        if (d < bestd) { bestd = d; best = n->name; }
    }
    return best;
}

static void assist_begin_output(void) {
    uint32_t oy0 = cy + 96;
    fb_rect_x(cx, oy0, cw, (cy + ch) - oy0, AC_TERM_BG);
    as_ox = cx; as_oy = oy0;
    as_olen = 0;                 /* start recording a fresh answer */
    mouse_lift();
}
static void assist_say(const char *s) { while (*s) assist_emit(*s++); }
static void assist_num(uint32_t v) {
    char b[12]; int i = 0;
    if (!v) { assist_emit('0'); return; }
    while (v) { b[i++] = (char)('0' + v % 10); v /= 10; }
    while (i) assist_emit(b[--i]);
}

/* human-readable scheduler state, for "what's running" */
static const char *task_state_name(enum task_state s) {
    switch (s) {
        case TASK_RUNNING: return "running";
        case TASK_READY:   return "ready";
        case TASK_DONE:    return "done";
        default:           return "-";
    }
}

/* Append ".txt" to a bare name, in place. Every file intent wants this so
 * "copy notes to backup" means what a person means by it. */
static void ensure_txt(char *name, int cap) {
    if (name_has_ext(name)) return;
    int k = 0; while (name[k]) k++;
    const char *e = ".txt"; int j = 0;
    while (e[j] && k < cap - 1) name[k++] = e[j++];
    name[k] = 0;
}

/* Copy a file's bytes to another name. Straight out of the source node's
 * buffer: the previous copy path ran through a fixed 1 KiB static and
 * silently truncated anything larger, which is the worst possible way for a
 * "copy" to fail — you don't find out until you read the copy back. Returns
 * bytes written, or -1. */
static int dup_file_bytes(fs_node *sn, const char *dst) {
    if (!sn->data || sn->size == 0)
        return fs_write(dst, (const uint8_t *)"", 0) < 0 ? -1 : 0;
    return fs_write(dst, sn->data, sn->size);
}

static void cpuid_x(uint32_t leaf, uint32_t *a, uint32_t *b,
                    uint32_t *c, uint32_t *d) {
    __asm__ volatile("cpuid"
        : "=a"(*a), "=b"(*b), "=c"(*c), "=d"(*d)
        : "a"(leaf), "c"(0));
}

/* CPUID returns its ASCII four bytes to a register. Unpacked by shifting
 * rather than by casting the buffer to uint32_t*: the buffer is a char array
 * with alignment 1, and the cast is the kind of aliasing the compiler is
 * allowed to be creative about. */
static void cpuid_word(char *dst, uint32_t v) {
    dst[0] = (char)(v & 0xFF);         dst[1] = (char)((v >> 8) & 0xFF);
    dst[2] = (char)((v >> 16) & 0xFF); dst[3] = (char)((v >> 24) & 0xFF);
}

/* ─── the question half of the intent table ───
 * Everything here is terminal: the kernel always has something true to say,
 * so none of these can fall through. WHICH one runs is decided by
 * am_classify() in include/assist_match.h, where the order is unit-tested —
 * see the note there about first-match-wins silently eating prompts. */
static void assist_report(enum am_intent w, const char *p) {
    switch (w) {

    case AM_VERSION: {
        const char *bl = mb_bootloader_name_x();
        assist_begin_output();
        assist_say(ASTRION_VERSION "\n");
        assist_say("  boot:       multiboot2, handed over by ");
        assist_say(bl ? bl : "(unknown)"); assist_emit('\n');
        assist_say("  arch:       x86_64 long mode, ring 0 + ring 3\n");
        assist_say("  built:      " __DATE__ " " __TIME__ "\n");
        assist_say("written from scratch in C. no Linux under me.\n");
        return;
    }

    case AM_IDENTITY:
        assist_begin_output();
        assist_say("I'm Astrion's assistant. I live inside a kernel written from\n");
        assist_say("scratch in C - no Linux under me, no internet anywhere.\n");
        assist_say("I don't just chat: I run this machine for you. Ask me your\n");
        assist_say("memory, disk, cpu, uptime, what's running or your files -\n");
        assist_say("or tell me to make, write, append, copy, rename, read or\n");
        assist_say("delete them, open an app, or change a setting.\n");
        return;

    case AM_HELP:
        assist_begin_output();
        assist_say("I run this machine, all offline:\n\n");
        assist_say("  machine: how much memory / disk space / what cpu\n");
        assist_say("           what's running / uptime / what version\n");
        assist_say("           screen resolution / what happened at boot\n");
        assist_say("  files:   list my files / how many files\n");
        assist_say("           make notes.txt / read notes.txt\n");
        assist_say("           write hi to notes.txt / append bye to notes.txt\n");
        assist_say("           copy notes.txt to backup.txt\n");
        assist_say("           rename notes.txt to todo.txt / delete notes.txt\n");
        assist_say("  desktop: what apps do i have / open the editor\n");
        assist_say("           set the accent to teal / clear the screen\n\n");
        assist_say("ask me to write a story or a poem and you get the on-device\n");
        assist_say("model - 212K parameters, so expect nonsense. No internet, ever.\n");
        return;

    /* ─── change a setting, for real: this repaints the whole desktop ─── */
    case AM_SET_CHANGE: {
        int g = am_setting_group(p);
        if (g < 0) {
            assist_begin_output();
            assist_say("I can change the accent, the wallpaper or the clock.\n");
            assist_say("try: set the accent to teal\n");
            return;
        }
        int n = settings_count(g), hit = -1;
        for (int i = 0; i < n; i++)
            if (am_word(p, settings_label(g, i))) { hit = i; break; }
        /* The clock's labels are "24-hour" / "12-hour"; people say "12 hour". */
        if (hit < 0 && g == SET_CLOCK) {
            if      (am_word(p, "12")) hit = 1;
            else if (am_word(p, "24")) hit = 0;
        }
        if (hit < 0) {
            assist_begin_output();
            assist_say(settings_group_name(g)); assist_say(" can be:\n  ");
            for (int i = 0; i < n; i++) {
                assist_say(settings_label(g, i));
                if (i + 1 < n) assist_say("  ");
            }
            assist_emit('\n');
            return;
        }
        /* Say it BEFORE applying. settings_apply() calls repaint_all(), which
         * redraws this window from as_out and leaves the content rect pointing
         * at some other window - so nothing may be emitted after it. */
        assist_begin_output();
        assist_say("set "); assist_say(settings_group_name(g));
        assist_say(" to ");  assist_say(settings_label(g, hit));
        assist_say(".\nlive now - the whole desktop just repainted.\n");
        settings_apply(g, hit);
        return;
    }

    case AM_SET_SHOW:
        assist_begin_output();
        assist_say("your settings right now:\n");
        for (int g = 0; g < SET_GROUPS; g++) {
            assist_say("  "); assist_say(settings_group_name(g));
            assist_say(": ");  assist_say(settings_label(g, settings_get(g)));
            assist_emit('\n');
        }
        assist_say("say 'set the accent to teal' and I'll change it.\n");
        assist_say("session only - none of it is written to disk yet.\n");
        return;

    /* ─── memory: the kernel heap AND the physical RAM behind it ─── */
    case AM_MEMORY: {
        uint32_t usedkb = (uint32_t)(heap_used() >> 10);
        uint32_t freekb = (uint32_t)(heap_free() >> 10);
        uint32_t ffree  = (uint32_t)pmm_frames_free();
        uint32_t ftotal = (uint32_t)pmm_frames_total();
        assist_begin_output();
        assist_say("RAM this machine has: ");
        assist_num(mb_total_available_mib_x()); assist_say(" MiB usable.\n");
        assist_say("kernel heap: ");
        assist_num(usedkb); assist_say(" KB used, ");
        assist_num(freekb); assist_say(" KB free (");
        assist_num(usedkb + freekb); assist_say(" KB total).\n");
        assist_say("page frames: "); assist_num(ffree);
        assist_say(" free of ");     assist_num(ftotal);
        assist_say(" (");            assist_num(ffree / 256);
        assist_say(" MiB spare for new programs).\n");
        assist_say("all on this machine - nothing in a cloud.\n");
        return;
    }

    /* ─── disk: is one attached, how big, and what's on it ─── */
    case AM_DISK: {
        assist_begin_output();
        if (ata_present()) {
            uint32_t sect = ata_total_sectors();
            assist_say("disk: attached");
            const char *m = ata_model();
            if (m && m[0]) { assist_say(" - "); assist_say(m); }
            assist_emit('\n');
            assist_say("  capacity: "); assist_num(sect / 2048);
            assist_say(" MiB ("); assist_num(sect); assist_say(" sectors)\n");
            assist_say("  in use:   "); assist_num(fs_total_bytes());
            assist_say(" bytes across "); assist_num(fs_count());
            assist_say(" files\n");
            assist_say("your files persist across reboots - I save on every change.\n");
        } else {
            assist_say("no disk this boot - your ");
            assist_num(fs_count()); assist_say(" files (");
            assist_num(fs_total_bytes()); assist_say(" bytes) live in RAM\n");
            assist_say("and go away at power-off. attach a disk and they stay.\n");
        }
        return;
    }

    /* ─── cpu: straight out of CPUID, not a guess ─── */
    case AM_CPU: {
        uint32_t a, b, c, d;
        char vendor[13];
        cpuid_x(0, &a, &b, &c, &d);
        uint32_t maxleaf = a;
        cpuid_word(&vendor[0], b); cpuid_word(&vendor[4], d);
        cpuid_word(&vendor[8], c); vendor[12] = 0;

        assist_begin_output();
        assist_say("cpu: "); assist_say(vendor); assist_emit('\n');

        cpuid_x(0x80000000, &a, &b, &c, &d);
        if (a >= 0x80000004) {
            char brand[49];
            int at = 0;
            for (uint32_t leaf = 0x80000002; leaf <= 0x80000004; leaf++) {
                cpuid_x(leaf, &a, &b, &c, &d);
                cpuid_word(&brand[at],      a); cpuid_word(&brand[at + 4],  b);
                cpuid_word(&brand[at + 8],  c); cpuid_word(&brand[at + 12], d);
                at += 16;
            }
            brand[48] = 0;
            const char *bp = brand; while (*bp == ' ') bp++;
            assist_say("  "); assist_say(bp); assist_emit('\n');
        }

        cpuid_x(1, &a, &b, &c, &d);
        uint32_t family = (a >> 8) & 0xF, model = (a >> 4) & 0xF;
        if (family == 0xF) family += (a >> 20) & 0xFF;
        if (family >= 6)   model  += ((a >> 16) & 0xF) << 4;
        assist_say("  family "); assist_num(family);
        assist_say(", model ");  assist_num(model);
        assist_say(", stepping "); assist_num(a & 0xF);
        assist_say(" (cpuid leaves to "); assist_num(maxleaf); assist_say(")\n");
        assist_say("one core is all I use - the scheduler is single-CPU.\n");
        return;
    }

    /* ─── what's running — the real scheduler table ─── */
    case AM_TASKS: {
        struct task_info ti;
        int live = 0;
        assist_begin_output();
        assist_say("running right now:\n");
        for (int i = 0; i < TASK_MAX; i++) {
            if (!task_get_info(i, &ti)) continue;
            live++;
            assist_say("  "); assist_num((uint32_t)ti.tid);
            assist_say("  "); assist_say(ti.name);
            assist_say("  ("); assist_say(task_state_name(ti.state)); assist_say(")\n");
        }
        assist_say("  = "); assist_num((uint32_t)live);
        assist_say(" of "); assist_num((uint32_t)TASK_MAX); assist_say(" task slots.\n");
        assist_say("preemptive - no runaway task can freeze me.\n");
        return;
    }

    case AM_CLEAR:
        /* Clears THIS window's answer, not the Terminal's scrollback. Painting
         * the console while a window floats over it would poison that window's
         * saved backdrop, which is a bug we have already fixed twice. */
        assist_begin_output();
        assist_say("cleared.\n");
        assist_say("(this window - type 'clear' in the Terminal for that one.)\n");
        return;

    case AM_SCREEN:
        assist_begin_output();
        assist_say("screen: "); assist_num(fb_width_x());
        assist_emit('x');       assist_num(fb_height_x());
        assist_say(" at ");     assist_num((uint32_t)mb_fb_bpp_x());
        assist_say(" bits per pixel.\n");
        assist_say("a linear framebuffer GRUB set up before I started - I draw\n");
        assist_say("every pixel of this myself, no graphics driver underneath.\n");
        return;

    case AM_APPS:
        assist_begin_output();
        assist_say("apps on this machine:\n");
        assist_say("  Terminal        the shell - say 'go to the terminal'\n");
        assist_say("  Files           browse the tree - 'open files'\n");
        assist_say("  Editor          write a file - 'open the editor'\n");
        assist_say("  Snake           'open snake'\n");
        assist_say("  Assistant       me - you're in it\n");
        assist_say("  System Monitor  live tasks + heap - 'open the monitor'\n");
        assist_say("  Calculator      'open the calculator'\n");
        assist_say("  Settings        'open the settings'\n");
        assist_say("all built in. there is no app store and no download.\n");
        return;

    case AM_UPTIME: {
        uint32_t secs = (uint32_t)(pit_elapsed_ms() / 1000);
        assist_begin_output();
        assist_say("up ");
        if (secs >= 3600) { assist_num(secs / 3600);        assist_say(" hr ");
                            assist_num((secs / 60) % 60);   assist_say(" min ");
                            assist_num(secs % 60);          assist_say(" sec"); }
        else if (secs >= 60) { assist_num(secs / 60);       assist_say(" min ");
                               assist_num(secs % 60);       assist_say(" sec"); }
        else                 { assist_num(secs);            assist_say(" seconds"); }
        assist_say(" - counted off the PIT at 100 Hz, no network.\n");
        return;
    }

    /* ─── what happened at boot: everything GRUB and init actually found ─── */
    case AM_BOOT: {
        const char *bl = mb_bootloader_name_x();
        uint32_t secs = (uint32_t)(pit_elapsed_ms() / 1000);
        assist_begin_output();
        assist_say("this boot, in order:\n");
        assist_say("  "); assist_say(bl ? bl : "the bootloader");
        assist_say(" loaded me at 1 MiB and jumped in 32-bit,\n");
        assist_say("  my asm stub built page tables and entered long mode,\n");
        assist_say("  memory map: "); assist_num(mb_mmap_entry_count_x());
        assist_say(" regions, "); assist_num(mb_total_available_mib_x());
        assist_say(" MiB usable,\n");
        assist_say("  framebuffer: "); assist_num(fb_width_x());
        assist_emit('x'); assist_num(fb_height_x());
        assist_say(" at "); assist_num((uint32_t)mb_fb_bpp_x());
        assist_say(" bpp,\n");
        assist_say("  heap "); assist_num((uint32_t)(heap_total() >> 10));
        assist_say(" KB up, "); assist_num((uint32_t)pmm_frames_total());
        assist_say(" page frames claimed,\n");
        assist_say("  disk: ");
        assist_say(ata_present() ? "found, files loaded from it.\n"
                                 : "none, so files are in RAM only.\n");
        assist_say("that was "); assist_num(secs); assist_say(" seconds ago.\n");
        return;
    }

    /* ─── date / time — the real wall clock, not uptime ─── */
    case AM_DATE: {
        struct rtc_time t;
        assist_begin_output();
        if (rtc_read(&t) == 0) {
            char c[9];
            rtc_format_time(&t, c);
            assist_say("it's "); assist_say(c);
            assist_say(" on ");  assist_say(rtc_month_name(t.month));
            assist_emit(' ');    assist_num((uint32_t)t.day);
            assist_say(", ");    assist_num((uint32_t)t.year);
            assist_say("\nstraight off the clock chip - I never asked a server.\n");
        } else {
            assist_say("my clock chip isn't answering - I only know uptime.\n");
        }
        return;
    }

    case AM_FILES_COUNT:
        assist_begin_output();
        assist_say("you have "); assist_num(fs_count());
        assist_say(" files, "); assist_num(fs_total_bytes());
        assist_say(" bytes total.\n");
        return;

    case AM_FILES_LIST:
        assist_begin_output();
        assist_say("your files:\n");
        /* Whole tree, by full path - a leaf name on its own would be a lie
         * now that /a/notes.txt and /b/notes.txt can both exist. */
        for (fs_node *n = fs_first(); n; n = fs_next(n)) {
            char path[FS_PATH_MAX + 1];
            if (fs_path(n, path, sizeof(path)) == 0) continue;
            assist_say("  "); assist_say(path);
            if (n->kind == FS_DIR) { assist_say("/\n"); continue; }
            assist_say("  ("); assist_num(n->size); assist_say(" B)\n");
        }
        assist_say("  = "); assist_num(fs_count()); assist_say(" files, ");
        assist_num(fs_total_bytes()); assist_say(" bytes.\n");
        return;

    /* AM_CLOSE never reaches here (try_intent handles it before any drawing —
     * there is no window left to draw into) and AM_NONE never gets sent. */
    case AM_CLOSE:
    case AM_NONE:
        return;
    }
}

/* The other half of the confirmation gate: the armed action is described, the
 * user answered, and this is where it happens or doesn't.
 *
 * Two properties worth stating out loud, because both were bugs elsewhere:
 *
 *   Disarmed FIRST, before anything can fail. One question gets exactly one
 *   answer — there is no path through here that leaves the action still armed
 *   for the NEXT thing the user types.
 *
 *   The target is looked up again, by name, right now. The file the question
 *   was about may have been unlinked or replaced from the shell in between,
 *   and acting on a remembered pointer would be acting on whatever moved into
 *   its place. */
static void assist_answer_pending(const char *p, int confirmed) {
    enum as_pend op = as_pending;
    struct am_ident id = as_pend_id;   /* what we told them they'd lose */
    char a[FS_NAME_MAX + 1], b[FS_NAME_MAX + 1], txt[sizeof(as_pend_text)];
    scopy(a, as_pend_a, sizeof(a));
    scopy(b, as_pend_b, sizeof(b));
    scopy(txt, as_pend_text, sizeof(txt));
    assist_disarm();

    assist_begin_output();
    if (!confirmed) {
        assist_say("cancelled - "); assist_say(a); assist_say(" is untouched.\n");
        assist_say("nothing was deleted and nothing was written.\n");
        /* An affirmative that named a DIFFERENT file is the case worth
         * spelling out: the user was correcting me, not agreeing with me, and
         * a bare "cancelled" would leave them thinking I had simply misheard
         * a yes. Name both files so it is obvious which question was on the
         * table and which one they answered. */
        char other[FS_NAME_MAX + 1];
        am_confirm_other(p, a, other, sizeof(other));
        if (other[0] && am_confirm_yes(p)) {
            assist_say("\nyou said yes but named "); assist_say(other);
            assist_say(", and the question was\nabout "); assist_say(a);
            assist_say(". I won't guess which one you meant,\nso I've touched neither. say what you want and I'll ask again.\n");
            return;
        }
        /* If they answered with a COMMAND rather than a yes or a no, say that
         * it did not run. It is deliberately not executed — a command typed
         * while a different question was on screen would be carried out in a
         * context the user was not looking at, which is its own surprise. One
         * retype is the cheaper end of that trade, but only if we admit the
         * command was swallowed instead of quietly dropping it. */
        if (p && p[0] && !am_word_any(p, "n|no|nope|nah|cancel|stop|wait")) {
            assist_say("\nI didn't run \""); assist_say(p);
            assist_say("\" - that was your answer to the\nquestion above. say it again and I will.\n");
        }
        return;
    }

    /* The answer is only good for the file the question DESCRIBED. Every gate
     * put a byte count on screen, so every gate has to prove that count is
     * still true before it acts on the strength of it. Hoisted above the
     * three branches precisely so it cannot be true of one and forgotten in
     * another. */
    struct am_ident now = ident_of(a);
    if (!am_ident_same(id, now)) {
        if (!now.valid) {
            assist_say("no file called "); assist_say(a);
            assist_say(" any more - it went away while I was\nasking, so I've done nothing.\n");
        } else {
            assist_say(a); assist_say(" changed while I was asking - it was ");
            assist_num((uint32_t)id.size); assist_say(" B, it's ");
            assist_num((uint32_t)now.size); assist_say(" B now.\n");
            assist_say("you agreed to the old one, so I've touched nothing.\n");
            assist_say("have a look at it and ask me again.\n");
        }
        return;
    }

    if (op == AS_PEND_WRITE) {
        int tl = 0; while (txt[tl]) tl++;
        if (fs_write(a, (const uint8_t *)txt, (uint32_t)tl) < 0) {
            assist_say("couldn't write "); assist_say(a); assist_emit('\n');
            return;
        }
        fs_sync();
        assist_touch_file(a);
        assist_say("wrote to "); assist_say(a); assist_say(", replacing what was there:\n  ");
        assist_say(txt); assist_emit('\n');
        return;
    }

    if (op == AS_PEND_DELETE) {
        fs_node *n = fs_find(a);
        if (!n || n->kind != FS_FILE) {
            assist_say("no file called "); assist_say(a);
            assist_say(" any more - nothing deleted.\n");
            return;
        }
        fs_unlink(a); fs_sync();
        /* Do NOT record a deleted file: "it" would then name something that no
         * longer exists, and the next "open it" would fail confusingly. */
        assist_forget_file();
        assist_say("deleted "); assist_say(a); assist_emit('\n');
        return;
    }

    /* AS_PEND_OVERWRITE: b -> a, where a already exists and loses its bytes. */
    fs_node *sn = fs_find(b);
    if (!sn || sn->kind != FS_FILE) {
        assist_say("no file called "); assist_say(b); assist_say(" any more - ");
        assist_say(a); assist_say(" is untouched.\n");
        return;
    }
    int wn = dup_file_bytes(sn, a);
    fs_sync();
    if (wn < 0) {
        assist_say("couldn't write "); assist_say(a); assist_emit('\n');
    } else {
        assist_touch_file(a);
        assist_say("copied "); assist_say(b); assist_say(" -> "); assist_say(a);
        assist_say(" ("); assist_num((uint32_t)wn); assist_say(" B, replaced)\n");
    }
}

/* Try to handle the prompt as a real, safe, LOCAL action — the whole thesis:
 * you talk to the OS and it DOES things, offline. Returns 1 if handled; 0
 * falls through to the GPT for open-ended text.
 *
 * Two passes, matching the two halves of include/assist_match.h. The question
 * pass is terminal. The action pass may DELIBERATELY fall through when it
 * can't find its argument: "write me a poem in the style of X" contains " in "
 * and must not become a file called "the". */
static int try_intent(const char *p) {
    enum am_intent w = am_classify(p);

    /* Handled before assist_report because there will be no window to draw
     * into afterwards, and cx/cy would be pointing at a dead rect. */
    if (w == AM_CLOSE) { wm_close(); return 1; }
    if (w != AM_NONE)  { assist_report(w, p); return 1; }

    /* ─── resolve "it" before anything looks for a filename ───
     *
     * The prompt is rewritten and everything downstream runs on the rewrite —
     * extractor, guards, confirmation — so a pronoun gets exactly the same
     * treatment a typed filename does, including having its resolution shown
     * on screen before a destructive verb touches anything.
     *
     * The age bump sits here rather than at a successful op because it has to
     * count prompts that never reach a file at all. Anything that does touch
     * one resets it. */
    if (as_last_file[0] && am_ref_expired(++as_last_age)) assist_forget_file();

    char rp[sizeof(as_prompt)];
    switch (am_resolve_ref(p, as_last_file, rp, sizeof(rp))) {
    case AM_REF_DONE:
        p = rp;                       /* act on the rewrite from here on */
        break;
    case AM_REF_UNSET: {
        /* Refuse, and never fall back to the literal word — "open it" must not
         * become a file called it.txt. */
        char w2[32]; am_ref_word(p, w2, sizeof(w2));
        assist_begin_output();
        assist_say("I don't know what \""); assist_say(w2);
        assist_say("\" refers to.\n\n");
        assist_say("I only remember the last file I worked on, and right now\n");
        assist_say("there isn't one. name the file and I'll keep track of it:\n");
        assist_say("  read notes.txt   then   delete it\n");
        return 1;
    }
    case AM_REF_NONE:
        break;
    }

    switch (am_action_of(p)) {

    /* rename / move FILE to NEWNAME — a real move on disk, not a copy left
     * behind. Refuses to clobber: an existing destination stops it. */
    case AM_ACT_RENAME: {
        int sl; const char *sep = find_to(p, &sl);
        char src[FS_NAME_MAX + 1];
        if (!sep) break;
        /* Same exposure as DELETE, milder shape: the source is unlinked, so
         * picking the wrong one loses the name the user's data was under.
         * word_after() is anchored to the verb rather than the end of the
         * sentence, so it never invented a target the way last_word did — but
         * it still hands back "the" for `rename the file notes.txt to x.txt`.
         * If the source side names exactly one file, that IS the source; two
         * is ambiguous and refused; none keeps the old verb-anchored guess,
         * which is what lets `rename notes to todo` still work. */
        char left[sizeof(as_prompt)]; int lk = 0;
        for (const char *q = p; q < sep && lk < (int)sizeof(left) - 1; q++)
            left[lk++] = *q;
        left[lk] = 0;
        enum am_named snf = am_named_file(left, src, sizeof(src));
        if (snf == AM_NAMED_MANY) {
            char other[FS_NAME_MAX + 1];
            am_file_tokens(left, 1, other, sizeof(other));
            assist_begin_output();
            assist_say("I won't rename anything - you named more than one file (");
            assist_say(src); assist_say(", "); assist_say(other);
            assist_say(")\nbefore the 'to', so I can't tell which one moves.\n");
            return 1;
        }
        if (snf == AM_NAMED_NONE &&
            !word_after(p, "rename", src, sizeof(src)) &&
            !word_after(p, "move",   src, sizeof(src))) break;
        char dst[64]; const char *fp = sep + sl; while (*fp == ' ') fp++;
        int k = 0; while (*fp && *fp != ' ' && k < 63) dst[k++] = *fp++;
        while (k > 0 && (dst[k-1]=='.'||dst[k-1]=='!'||dst[k-1]=='?'||dst[k-1]==',')) k--;
        dst[k] = 0;
        if (!dst[0]) break;
        fs_node *sn = resolve_file(src, sizeof(src));
        ensure_txt(dst, sizeof(dst));
        assist_begin_output();
        if (!sn || sn->kind != FS_FILE) {
            assist_say("no file called "); assist_say(src); assist_emit('\n');
        { const char *sg = assist_did_you_mean(src);
          if (sg) { assist_say("did you mean "); assist_say(sg); assist_say("?\n"); } }
        } else if (fs_find(dst) == sn) {
            assist_say(src); assist_say(" is already called that.\n");
        } else if (fs_find(dst)) {
            assist_say(dst); assist_say(" already exists - I won't overwrite it.\n");
        } else if (dup_file_bytes(sn, dst) < 0) {
            assist_say("couldn't write "); assist_say(dst); assist_say(" - nothing moved.\n");
        } else {
            uint32_t moved = sn->size;
            fs_unlink(src);          /* only after the copy landed */
            fs_sync();
            assist_touch_file(dst);
            assist_say("renamed "); assist_say(src); assist_say(" -> ");
            assist_say(dst); assist_say(" ("); assist_num(moved); assist_say(" B)\n");
        }
        return 1;
    }

    /* copy FILE to NEWNAME — a real duplicate on disk */
    case AM_ACT_COPY: {
        int sl; const char *sep = find_to(p, &sl);
        char src[64];
        if (!sep || (!word_after(p, "copy", src, sizeof(src)) &&
                     !word_after(p, "duplicate", src, sizeof(src)))) break;
        char dst[64]; const char *fp = sep + sl; while (*fp == ' ') fp++;
        int k = 0; while (*fp && *fp != ' ' && k < 63) dst[k++] = *fp++;
        while (k > 0 && (dst[k-1]=='.'||dst[k-1]=='!'||dst[k-1]=='?'||dst[k-1]==',')) k--;
        dst[k] = 0;
        fs_node *sn = resolve_file(src, sizeof(src));
        assist_begin_output();
        if (sn && sn->kind == FS_FILE && dst[0]) {
            ensure_txt(dst, sizeof(dst));
            /* A copy onto a name that already exists is a destroy: fs_write
             * replaces the destination's bytes outright and they are not
             * recoverable. RENAME has always refused to clobber; COPY did it
             * silently. It asks now, which is the same answer in a friendlier
             * shape — say yes and the copy lands. */
            fs_node *dn = fs_find(dst);
            if (dn && dn->kind != FS_FILE) {
                assist_say(dst); assist_say(" is a folder - I won't write over it.\n");
                return 1;
            }
            if (am_needs_confirm(AM_ACT_COPY, dn && dn->size > 0)) {
                as_pending = AS_PEND_OVERWRITE;
                as_pend_id = ident_of(dst);   /* the bytes about to be replaced */
                scopy(as_pend_a, dst, sizeof(as_pend_a));
                scopy(as_pend_b, src, sizeof(as_pend_b));
                assist_say(dst); assist_say(" already exists (");
                assist_num(dn->size); assist_say(" B) and copying over it\n");
                assist_say("replaces what's in it. that can't be undone.\n\n");
                assist_say("type y to replace it. anything else cancels.\n");
                return 1;
            }
            fs_create(dst, FS_FILE);
            int n = dup_file_bytes(sn, dst);
            fs_sync();
            if (n < 0) { assist_say("couldn't write "); assist_say(dst); assist_emit('\n'); }
            else {
                assist_touch_file(dst);
                assist_say("copied "); assist_say(src); assist_say(" -> ");
                assist_say(dst); assist_say(" ("); assist_num((uint32_t)n);
                assist_say(" B)\n");
            }
        } else {
            assist_say("copy needs: copy <file> to <newname>\n");
        }
        return 1;
    }

    /* append TEXT to FILE — grow an existing note */
    case AM_ACT_APPEND: {
        int sl; const char *sep = find_to(p, &sl);
        if (!sep) break;
        char file[64]; const char *fp = sep + sl; while (*fp == ' ') fp++;
        int fk = 0; while (*fp && *fp != ' ' && fk < 63) file[fk++] = *fp++;
        while (fk > 0 && (file[fk-1]=='.'||file[fk-1]=='!'||file[fk-1]=='?'||file[fk-1]==',')) fk--;
        file[fk] = 0;
        const char *tp = p; while (*tp && *tp != ' ') tp++;   /* skip the verb */
        while (*tp == ' ') tp++;
        char text[128]; int tk = 0;
        for (const char *q = tp; q < sep && tk < 127; q++) text[tk++] = *q;
        text[tk] = 0;
        if (!file[0] || !text[0]) break;
        ensure_txt(file, sizeof(file));
        int existed = (fs_find(file) != 0);
        if (!existed) fs_create(file, FS_FILE);
        if (existed) fs_append(file, (const uint8_t *)" ", 1);
        fs_append(file, (const uint8_t *)text, (uint32_t)tk);
        fs_sync();
        assist_touch_file(file);
        assist_begin_output();
        assist_say("appended to "); assist_say(file); assist_say(":\n  ");
        assist_say(text); assist_emit('\n');
        return 1;
    }

    /* write TEXT to FILE — gated so creative "write a poem in X" still hits GPT */
    case AM_ACT_WRITE: {
        int sl; const char *sep = find_to(p, &sl);
        if (!sep) break;
        char file[64]; const char *fp = sep + sl;
        while (*fp == ' ') fp++;
        int fk = 0; while (*fp && *fp != ' ' && fk < 63) file[fk++] = *fp++;
        while (fk > 0 && (file[fk-1]=='.'||file[fk-1]=='!'||file[fk-1]=='?'||file[fk-1]==',')) fk--;
        file[fk] = 0;
        /* The gate that keeps "write a poem in the style of X" out of the
         * filesystem: the destination has to LOOK like a file. */
        int looks_like_file = has(p, "file") || name_has_ext(file) || (fs_find(file) != 0);
        const char *tp = p; while (*tp && *tp != ' ') tp++;   /* skip the verb */
        while (*tp == ' ') tp++;
        char text[128]; int tk = 0;
        for (const char *q = tp; q < sep && tk < 127; q++) text[tk++] = *q;
        text[tk] = 0;
        if (!file[0] || !text[0] || !looks_like_file) break;
        ensure_txt(file, sizeof(file));
        fs_node *wn = fs_find(file);
        assist_begin_output();
        if (wn && wn->kind != FS_FILE) {
            assist_say(file); assist_say(" is a folder - I won't write over it.\n");
            return 1;
        }
        /* fs_write REPLACES: every byte already in the file goes. Writing a
         * file that doesn't exist yet destroys nothing and stays one step —
         * that is the demo's headline command and it must not slow down. */
        if (am_needs_confirm(AM_ACT_WRITE, wn && wn->size > 0)) {
            as_pending = AS_PEND_WRITE;
            as_pend_id = ident_of(file);  /* the bytes about to be replaced */
            scopy(as_pend_a, file, sizeof(as_pend_a));
            scopy(as_pend_text, text, sizeof(as_pend_text));
            assist_say(file); assist_say(" already exists and has ");
            assist_num(wn->size); assist_say(" B in it.\n");
            assist_say("writing replaces all of it - those bytes don't come back.\n\n");
            assist_say("type y to replace them. anything else cancels, and\n");
            assist_say(file); assist_say(" stays exactly as it is.\n");
            return 1;
        }
        fs_write(file, (const uint8_t *)text, (uint32_t)tk);
        fs_sync();
        assist_touch_file(file);
        assist_say("wrote to "); assist_say(file); assist_say(":\n  ");
        assist_say(text); assist_emit('\n');
        return 1;
    }
    /* make FILE (or a folder) */
    case AM_ACT_CREATE: {
        char name[64];
        if (!word_after(p, "called", name, sizeof(name)) &&
            !word_after(p, "named", name, sizeof(name)))
            last_word(p, name, sizeof(name));
        if (!name[0]) break;
        /* A folder is a real kind in this fs, so "make a folder called notes"
         * makes a DIRECTORY - and must not get ".txt" stapled to it. */
        int want_dir = am_word_any(p, "folder|folders|directory|mkdir");
        if (!want_dir) ensure_txt(name, sizeof(name));
        assist_begin_output();
        if (fs_find(name)) {
            assist_say(name); assist_say(" already exists.\n");
            return 1;
        }
        if (!fs_create(name, want_dir ? (uint32_t)FS_DIR : (uint32_t)FS_FILE)) {
            assist_say("couldn't make "); assist_say(name);
            assist_say(" - is the folder above it there?\n");
            return 1;
        }
        fs_sync();
        assist_touch_file(name);
        assist_say("made "); assist_say(name);
        if (want_dir) assist_say("/\nsay 'list my files' to see it.\n");
        else          assist_say("\nsay 'open the editor' to write in it.\n");
        return 1;
    }

    /* DELETE — the only branch here that destroys data, and now the only one
     * that asks first.
     *
     * The target comes from am_named_file(), NOT last_word(). last_word takes
     * whatever ends the sentence, so `delete edge3.txt later` deleted a file
     * called later.txt while edge3.txt sat there untouched — the user named a
     * file and a different one died. Nothing on this path may guess: no bare
     * word, no ".txt" stapled onto a noun (which is why this calls fs_find
     * directly rather than resolve_file), and no acting on one of two named
     * files while quietly leaving the other.
     *
     * And then, having found the exact file: ask. The word list in am_negated
     * has a ceiling — "the last thing I want is to delete edge4.txt" contains
     * no negation token to match on — so the guard that actually holds is the
     * one that makes the user press a key. */
    case AM_ACT_DELETE: {
        char name[FS_NAME_MAX + 1], other[FS_NAME_MAX + 1];
        enum am_named nf = am_named_file(p, name, sizeof(name));
        assist_begin_output();

        if (nf == AM_NAMED_NONE) {
            assist_say("I won't delete anything - you didn't name a file.\n\n");
            assist_say("I need the whole filename, extension and all:\n");
            assist_say("  delete notes.txt\n\n");
            assist_say("I won't guess which file you meant from a bare word.\n");
            assist_say("guessing is how the wrong file gets deleted.\n");
            return 1;
        }
        if (nf == AM_NAMED_MANY) {
            am_file_tokens(p, 1, other, sizeof(other));
            assist_say("I won't delete anything - you named more than one file (");
            assist_say(name); assist_say(", "); assist_say(other);
            assist_say(").\n\nI delete one at a time, so nothing here is half-done.\n");
            assist_say("say 'delete "); assist_say(name);
            assist_say("', then 'delete "); assist_say(other); assist_say("'.\n");
            return 1;
        }

        fs_node *n = fs_find(name);
        if (!n || n->kind != FS_FILE) {
            assist_say("no file called "); assist_say(name); assist_emit('\n');
            { const char *sg = assist_did_you_mean(name);
          if (sg) { assist_say("did you mean "); assist_say(sg); assist_say("?\n"); } }
            return 1;
        }
        as_pending = AS_PEND_DELETE;
        as_pend_id = ident_of(name);  /* the file about to be unlinked */
        scopy(as_pend_a, name, sizeof(as_pend_a));
        assist_say("delete "); assist_say(name); assist_say(" (");
        assist_num(n->size); assist_say(" B)?\n");
        assist_say("this cannot be undone - there is no trash to fish it out of.\n\n");
        assist_say("type y to confirm. anything else, including a bare Enter,\n");
        assist_say("cancels and leaves the file exactly where it is.\n");
        return 1;
    }

    case AM_ACT_READ: {
        char name[64]; last_word(p, name, sizeof(name));
        /* Read this BEFORE resolving. resolve_file() appends ".txt" to a bare
         * name in place, so asking "does it have a dot?" afterwards is always
         * yes — which made the fall-through below dead code and turned
         * "show me something nice" into "no file called nice.txt" instead of
         * the honest menu. The question is whether the USER named a file. */
        int named_a_file = has(name, ".");
        fs_node *n = resolve_file(name, sizeof(name));
        if (n && n->kind == FS_FILE) {
            assist_touch_file(name);
            assist_begin_output();
            assist_say("contents of "); assist_say(name); assist_say(":\n");
            for (uint32_t i = 0; i < n->size && i < 1024; i++) assist_emit((char)n->data[i]);
            assist_emit('\n');
            return 1;
        }
        /* No such file. This used to fall through on the theory that it was
         * "probably a chat request" — only ever true while there WAS a chat
         * model behind it to catch the fall. There isn't any more, and the
         * fall-through is how `read poem.txt` reached a poetry generator.
         * If they named something shaped like a file, say the file is missing;
         * anything else falls through to the honest menu. */
        if (named_a_file) {
            assist_begin_output();
            assist_say("no file called "); assist_say(name); assist_say(".\n");
        { const char *sg = assist_did_you_mean(name);
          if (sg) { assist_say("did you mean "); assist_say(sg); assist_say("?\n"); } }
            assist_say("say 'list my files' to see what's there.\n");
            return 1;
        }
        break;
    }

    /* open an APP, or - when no app is named - a FILE in the editor. Every
     * one of these hands the window over immediately; nothing may draw into
     * the Assistant's rect afterwards. */
    case AM_ACT_OPEN: {
        switch (am_open_target(p)) {
            case AM_OPEN_FILES:    wm_open_app(1);    return 1;
            case AM_OPEN_EDITOR:   wm_open_editor(0); return 1;
            case AM_OPEN_SNAKE:    wm_open_app(3);    return 1;
            case AM_OPEN_ASSIST:   wm_open_app(4);    return 1;
            case AM_OPEN_MONITOR:  wm_open_app(5);    return 1;
            case AM_OPEN_CALC:     wm_open_app(6);    return 1;
            case AM_OPEN_SETTINGS: wm_open_app(7);    return 1;
            case AM_OPEN_TERMINAL: wm_close();        return 1;
            case AM_OPEN_NONE:     break;
        }
        /* "open notes.txt" - no app by that name, so try it as a file. Same
         * before-resolve rule as READ: "start over" must reach the menu, not
         * be told there is no file called over.txt. */
        char name[64]; last_word(p, name, sizeof(name));
        int named_a_file = has(name, ".");
        fs_node *n = resolve_file(name, sizeof(name));
        if (n && n->kind == FS_FILE) { assist_touch_file(name); wm_open_editor(name); return 1; }
        if (named_a_file) {
            assist_begin_output();
            assist_say("no file or app called "); assist_say(name); assist_say(".\n");
        { const char *sg = assist_did_you_mean(name);
          if (sg) { assist_say("did you mean "); assist_say(sg); assist_say("?\n"); } }
            assist_say("say 'what apps do i have' for the list.\n");
            return 1;
        }
        break;
    }

    /* The action chain declined. If it declined something DESTRUCTIVE, say so
     * and say which guard did it — a blocked delete used to come back as the
     * same "I didn't understand that one" a typo gets, so the user could not
     * tell they had been refused on purpose, and the natural thing to do with
     * a parser miss is to type it again. */
    case AM_ACT_NONE: {
        char name[FS_NAME_MAX + 1];
        int one;
        switch (am_delete_refusal(p)) {
        case AM_REFUSE_NEGATED:
            one = (am_named_file(p, name, sizeof(name)) == AM_NAMED_ONE);
            assist_begin_output();
            assist_say("I won't delete ");
            assist_say(one ? name : "anything");
            assist_say(" - that reads like you're telling me NOT to.\n\n");
            if (one) {
                assist_say("if you do want it gone, say it on its own:\n  delete ");
                assist_say(name);
            } else {
                assist_say("if you did mean it, say just the verb and the\n");
                assist_say("filename:\n  delete notes.txt");
            }
            assist_say("\nand I'll ask you to confirm before it goes.\n");
            return 1;
        case AM_REFUSE_UNNAMED:
            assist_begin_output();
            assist_say("I won't delete anything - you didn't name a file.\n\n");
            assist_say("say the whole filename, extension and all:\n");
            assist_say("  delete notes.txt\n\n");
            assist_say("I won't work out which file you meant from a bare word.\n");
            assist_say("say 'list my files' if you want to see what's there.\n");
            return 1;
        case AM_REFUSE_NONE:
            break;
        }
        break;
    }
    }

    return 0;   /* -> GPT */
}


static void assist_run(void) {
    /* One decision, made in one place (include/assist_match.h) and asked the
     * same way by the key handler above. A pending question is modal and
     * consumes EVERY submission, the empty one included — that is what makes
     * a bare Enter cancel instead of leaving the action armed behind a
     * question the user thinks they dismissed. */
    switch (am_submit_action(as_prompt, assist_pending_target())) {
    case AM_SUBMIT_IGNORE:  return;
    case AM_SUBMIT_RUN:     assist_answer_pending(as_prompt, 1); return;
    case AM_SUBMIT_CANCEL:  assist_answer_pending(as_prompt, 0); return;
    case AM_SUBMIT_PROMPT:  break;
    }

    if (try_intent(as_prompt)) return;   /* did a real action, offline */

    /* The model is 212K parameters. It can produce English-shaped text; it
     * cannot answer a question. Routing every unmatched prompt into it is what
     * made the assistant look like it was hallucinating — it was being handed
     * the one job a model this size cannot do. So: run it only when someone
     * explicitly asks for invented text, and label what they're getting. */
    if (am_wants_generation(as_prompt)) {
        assist_begin_output();
        assist_say("on-device model, 212K parameters, no internet involved.\n");
        assist_say("it writes English-shaped text, not sense - that's the size:\n\n");
        gpt_generate(as_prompt, 220, assist_emit);
        return;
    }

    /* Everything else: say so. An honest "I didn't get that" reads as a small
     * assistant that knows its limits; confident nonsense reads as a broken
     * one. Same information, and only one of them survives a demo. */
    assist_begin_output();
    assist_say("I didn't understand that one.\n\n");
    assist_say("I'm not a chatbot - I run this machine. What I do:\n\n");
    assist_say("  machine: how much memory / how much disk space\n");
    assist_say("           what cpu / what's running / uptime\n");
    assist_say("           what version / screen resolution\n");
    assist_say("  files:   list my files / make notes.txt / read notes.txt\n");
    assist_say("           write hi to notes.txt / append bye to notes.txt\n");
    assist_say("           copy notes.txt to backup.txt\n");
    assist_say("           rename notes.txt to todo.txt / delete notes.txt\n");
    assist_say("  desktop: what apps do i have / open the editor\n");
    assist_say("           set the accent to teal\n\n");
    assist_say("say 'help' for the full list.\n");
}

static void assist_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    af_draw(cx, cy, "Astrion Assistant", settings_accent(), AF_SB16);
    af_draw(cx, cy + 24, "offline - try:  write hi to notes.txt  /  read notes.txt  /  what's running  /  open snake  /  help",
            AC_MUTED, AF_REG13);
    assist_prompt_line();
    assist_render_output();      /* redraw the last answer from its buffer */
}

static void assist_key(char c) {
    if (c == 27) { wm_close(); return; }
    if (c == KEY_CTRL_V) {   /* paste the clipboard into the prompt */
        const char *p = clipboard_get();
        for (int k = 0; p[k] && as_plen < (int)sizeof(as_prompt) - 1; k++) {
            char ch = p[k];
            if (ch < 32 || ch > 126) continue;   /* prompt is one printable line */
            as_prompt[as_plen++] = ch; as_prompt[as_plen] = 0;
        }
        assist_prompt_line();
        return;
    }
    if (c == '\n') {
        /* THE BUG THIS REPLACED: `if (as_plen > 0)`. An empty submission was
         * discarded right here, so it never reached the pending-action check
         * and a bare Enter left an armed delete armed — behind a question the
         * user had every reason to believe they had just dismissed. A "yes"
         * typed later for any unrelated reason then destroyed the file.
         *
         * am_confirm_yes("") returning 0 did not help and could not: the
         * string never got that far. So the emptiness test lives in
         * am_submit_action() now, BELOW the pending test, where an empty line
         * is a real answer rather than a non-event. */
        enum am_submit s = am_submit_action(as_prompt, assist_pending_target());
        if (s == AM_SUBMIT_IGNORE) return;
        assist_run();
        /* Two separate questions, and conflating them was the bug. Whether the
         * line is cleared depends on whether it was CONSUMED; whether we
         * repaint depends on who has focus now. The clear used to live inside
         * the focus test, so "open the calculator" left its text in the buffer
         * for the next bare Enter to re-run. */
        struct window *f = focused();
        int kept = (f && f->app == APP_ASSIST);
        if (am_submit_consumes(s, kept)) { as_plen = 0; as_prompt[0] = 0; }
        if (kept) { set_content_rect(f); assist_prompt_line(); }
        return;
    }
    if (c == '\b') {
        if (as_plen > 0) { as_plen--; as_prompt[as_plen] = 0; assist_prompt_line(); }
        return;
    }
    if (c >= 32 && c <= 126 && as_plen < (int)sizeof(as_prompt) - 1) {
        as_prompt[as_plen++] = c; as_prompt[as_plen] = 0;
        assist_prompt_line();
    }
}

/* ─── System Monitor ───
 *
 * The GUI form of what the Assistant already answers in prose: the real
 * scheduler table, the real heap, real uptime. Every number is read live
 * from the kernel at paint time — nothing here is cached or simulated.
 *
 * LIVE UPDATE, AND WHY IT IS SHAPED LIKE THIS:
 *
 * 1. It repaints from wm_tick(), i.e. task 0's main loop — NOT from a
 *    spawned task. A background task would be preempted into the middle
 *    of another window's draw and interleave two apps' pixels. Every
 *    other wm draw already happens on task 0; the monitor joins that
 *    single thread rather than opening a second one. The clock task gets
 *    away with being a task only because the top bar (y < 44) is a region
 *    wm_move() can never let a window reach (it clamps to WM_TOP = 66).
 *
 * 2. It repaints ONLY when no window above it in z-order overlaps the
 *    rect it is about to touch. This is forced, not lazy: `savebuf` holds
 *    what was under a window when it was painted, so if we redrew our
 *    numbers while covered we would (a) paint straight over the window on
 *    top of us, and (b) leave that window's savebuf holding stale digits
 *    to smear back on its next drag. Covered => hold the last frame; the
 *    next raise repaints it through repaint_all() anyway.
 *
 * 3. Only the volatile bands (header / heap numbers / rows) clear+redraw.
 *    The rules, labels and column header are painted once per full paint.
 *    Fixed-width mono fields mean a shrinking number can't leave a digit
 *    behind without the whole rect flashing.
 */
#define MON_REFRESH_MS 500u
#define MON_BAR_H      10u
#define MON_RH         (GH + 5)   /* row pitch — same rhythm as the Files rows */

/* Mono column grid. AF_MONO advances exactly GW px for every glyph, so a
 * column is just a multiple of GW and the digits line up for free. */
#define MON_C_TID     0u
#define MON_W_TID     2
#define MON_C_NAME    5u          /* NAME field is 15 wide — TASK_NAME_MAX */
#define MON_C_STATE   22u
#define MON_C_SWEND   42u         /* right edge of the switches field */
#define MON_W_SW      11

/* MON_C_SWEND is not just the table's last column, it is the window's right
 * edge: the window is sized to it (size_for), so the header, the heap gauge,
 * both rules, the table and the footer all start at cx and end at cx+cw.
 * One left edge, one right edge, nothing stranded. */
#define MON_COLS      MON_C_SWEND
/* The table's row budget is set at open from the tasks actually present
 * (mon_open_rows), not a constant — so the window fits the machine you have
 * instead of a guessed worst case. These bound it: never shorter than a
 * readable table, never so tall it reaches the dock on a modest screen. */
#define MON_ROWS_MIN  3u
#define MON_ROWS_MAX  10u

/* Vertical layout, as offsets from the top of the content rect. Text sits 8px
 * off a rule — the rhythm files_draw already set — and every y below is
 * derived from these, so the block moves as one if a number changes. */
/* The heap row: three [label][value][unit] groups on one baseline. The value
 * is the data (mono, coloured); the label and the unit are REG13 so the word
 * "used" stops shouting as loud as the number it names. */
#define MON_C_G1      0u          /* group anchors, in mono cells         */
#define MON_C_G2      14u
#define MON_C_G3      28u
#define MON_C_MEMVAL  3u          /* value field, offset within a group   */
#define MON_W_MEM     6           /* six digits of KB = 999 MB of heap    */
#define MON_C_MEMUNIT 9u          /* "KB", offset within a group          */

#define MON_HDR_DY    0u          /* uptime · task count                  */
#define MON_RULE1_DY  24u
#define MON_MEM_DY    32u         /* "Kernel heap"                        */
#define MON_BAR_DY    54u         /* the gauge                            */
#define MON_VAL_DY    70u         /* used / free / peak                   */
#define MON_RULE2_DY  112u
#define MON_COL_DY    120u        /* TID NAME STATE SWITCHES              */
#define MON_ROW0_DY   142u        /* first task row                       */

static uint64_t mon_last_ms;

/* u64 -> decimal. buf needs 21 bytes. Returns the length. */
static int u64_str(uint64_t v, char *buf) {
    char t[24]; int n = 0;
    if (!v) { buf[0] = '0'; buf[1] = 0; return 1; }
    while (v) { t[n++] = (char)('0' + (int)(v % 10)); v /= 10; }
    for (int i = 0; i < n; i++) buf[i] = t[n - 1 - i];
    buf[n] = 0;
    return n;
}
static int str_app(char *d, int at, int cap, const char *s) {
    while (*s && at < cap - 1) d[at++] = *s++;
    d[at] = 0; return at;
}
static int num_app(char *d, int at, int cap, uint64_t v) {
    char b[24]; u64_str(v, b); return str_app(d, at, cap, b);
}

/* Do rects A and B share a pixel? Written in difference form so no
 * coordinate is ever added — nothing can wrap past 2^32. */
static int rects_overlap(uint32_t ax, uint32_t ay, uint32_t aw, uint32_t ah,
                         uint32_t bx, uint32_t by, uint32_t bw, uint32_t bh) {
    if (!aw || !ah || !bw || !bh) return 0;
    if (ax >= bx) { if (ax - bx >= bw) return 0; } else { if (bx - ax >= aw) return 0; }
    if (ay >= by) { if (ay - by >= bh) return 0; } else { if (by - ay >= ah) return 0; }
    return 1;
}

/* Row geometry, derived from the content rect rather than guessed, so the
 * layout follows if the window or the face ever changes size. */
static uint32_t mon_mem_y(void)  { return cy + MON_MEM_DY; }
static uint32_t mon_bar_y(void)  { return cy + MON_BAR_DY; }
static uint32_t mon_val_y(void)  { return cy + MON_VAL_DY; }
static uint32_t mon_rule_y(void) { return cy + MON_RULE2_DY; }
static uint32_t mon_col_y(void)  { return cy + MON_COL_DY; }
static uint32_t mon_row0_y(void) { return cy + MON_ROW0_DY; }
static uint32_t mon_hint_y(void) { return cy + ch - (uint32_t)af_line_height(AF_REG13); }
static uint32_t mon_foot_y(void) { return mon_hint_y() - 8; }

/* Height the content rect needs for the chrome plus n task rows. size_for()
 * asks for mon_open_rows(); mon_fits() checks we still have room for one. */
static uint32_t mon_ch_for(uint32_t rows) {
    return MON_ROW0_DY + rows * MON_RH + 8 + (uint32_t)af_line_height(AF_REG13);
}

/* The content rect has to be big enough for the layout to mean anything.
 * Everything below subtracts from ch/cw, so this is the wrap guard too. */
static int mon_fits(void) { return cw >= MON_COLS * GW && ch >= mon_ch_for(1); }

/* Draw a REG13 label sharing a BASELINE with AF_MONO text drawn at y. af_draw
 * takes the TOP of the line box and the two faces have different ascents, so
 * the smaller face has to drop by the difference or it floats above the digits
 * it belongs to. Labels are the small face on purpose: the number is the data
 * and the word is only there to say which number it is. */
static void mon_label(uint32_t x, uint32_t y, const char *s) {
    af_draw(x, y + (uint32_t)(af_ascent(AF_MONO) - af_ascent(AF_REG13)),
            s, AC_MUTED, AF_REG13);
}

/* Right-align v in a cols-wide mono field, clearing the field first so a
 * number that shrinks can't leave its old leading digits on screen. */
static void mon_num_field(uint32_t x, uint32_t y, int cols, uint64_t v, uint32_t color) {
    char b[24];
    if (cols <= 0) return;
    if (cols > 20) cols = 20;               /* b[] bound: a u64 is <= 20 digits */
    int n = u64_str(v, b);
    fb_rect_x(x, y, (uint32_t)cols * GW, GH, AC_TERM_BG);
    if (n > cols) { n = cols; b[n] = 0; }   /* leading digits beat a blown field */
    af_draw(x + (uint32_t)(cols - n) * GW, y, b, color, AF_MONO);
}

static int mon_task_count(void) {
    struct task_info ti; int n = 0;
    for (int i = 0; i < TASK_MAX; i++) if (task_get_info(i, &ti)) n++;
    return n;
}

/* Header: uptime on the left, task count on the right, spanning the content
 * rect so the rule under it frames something at both ends.
 *
 * No wall clock. It was here, and it was the same string the top bar shows
 * 130px above — read together the two even disagreed by a second, because
 * they refresh on different phases, which reads as a bug and isn't one. The
 * top bar owns the clock. This header says the two things only the Monitor
 * knows: how long the machine has been up, and how many tasks are in the
 * table below. The uptime is also the liveness tell — if it is ticking, the
 * numbers under it are this second's.
 *
 * Variable width, so the whole band clears — it is a line, not a table. */
static void mon_draw_header(void) {
    char s[64]; int k = 0;
    uint32_t secs = (uint32_t)(pit_elapsed_ms() / 1000);
    k = str_app(s, k, sizeof(s), "up ");
    if (secs >= 3600) { k = num_app(s, k, sizeof(s), secs / 3600); k = str_app(s, k, sizeof(s), "h "); }
    if (secs >= 60)   { k = num_app(s, k, sizeof(s), (secs / 60) % 60); k = str_app(s, k, sizeof(s), "m "); }
    k = num_app(s, k, sizeof(s), secs % 60); k = str_app(s, k, sizeof(s), "s");

    int n = mon_task_count();
    char r[24]; int j = num_app(r, 0, sizeof(r), (uint64_t)n);
    j = str_app(r, j, sizeof(r), (n == 1) ? " task" : " tasks");

    uint32_t hy = cy + MON_HDR_DY;
    fb_rect_x(cx, hy, cw, (uint32_t)af_line_height(AF_REG13), AC_TERM_BG);
    af_draw(cx, hy, s, AC_MUTED, AF_REG13);
    uint32_t rw = af_text_width(r, AF_REG13);
    if (cw > rw) af_draw(cx + cw - rw, hy, r, AC_MUTED, AF_REG13);
}

/* Heap: a bar plus the three numbers that matter. The bar is the only
 * thing here that is a picture rather than a digit — used fills from the
 * left, and a 1px teal tick marks the high-water mark, so you can see how
 * close this boot has ever come to the ceiling. It spans the whole content
 * rect, which only reads as a gauge (and not as a third rule) because the
 * table under it now reaches the same right edge. */
static void mon_draw_mem(void) {
    uint64_t tot = heap_total(), used = heap_used(), pk = heap_peak();
    uint32_t by = mon_bar_y(), vy = mon_val_y();

    fb_rect_x(cx, by, cw, MON_BAR_H, AC_PANEL);            /* trough */
    if (tot) {
        /* cw <= screen width and used <= tot < 2^32, so the u64 product
         * cannot overflow; the divide keeps it inside the bar. */
        uint64_t fw = (uint64_t)cw * used / tot;
        if (fw > (uint64_t)cw) fw = cw;
        fb_rect_x(cx, by, (uint32_t)fw, MON_BAR_H, settings_accent());
        uint64_t px = (uint64_t)cw * pk / tot;
        if (px >= (uint64_t)cw) px = cw - 1;      /* cw >= MON_COLS*GW, so no wrap */
        fb_rect_x(cx + (uint32_t)px, by, 1, MON_BAR_H, AC_TEAL);
    }
    /* KB, not bytes: the heap moves in KB and six digits of bytes is noise. */
    mon_num_field(cx + (MON_C_G1 + MON_C_MEMVAL) * GW, vy, MON_W_MEM, used >> 10, AC_WHITE);
    mon_num_field(cx + (MON_C_G2 + MON_C_MEMVAL) * GW, vy, MON_W_MEM, heap_free() >> 10, AC_MUTED);
    mon_num_field(cx + (MON_C_G3 + MON_C_MEMVAL) * GW, vy, MON_W_MEM, pk >> 10, AC_TEAL);
}

/* The scheduler table, straight from task_get_info. */
static void mon_draw_rows(void) {
    uint32_t top = mon_row0_y(), foot = mon_foot_y();
    if (foot <= top) return;
    fb_rect_x(cx, top, cw, foot - top, AC_TERM_BG);

    int cap = (int)((foot - top) / MON_RH);
    int total = mon_task_count();
    int limit = (total > cap) ? cap - 1 : cap;   /* keep a row for "+N more" */
    if (limit < 0) limit = 0;

    int cur = task_current_tid(), shown = 0;
    struct task_info ti;
    for (int i = 0; i < TASK_MAX && shown < limit; i++) {
        if (!task_get_info(i, &ti)) continue;
        uint32_t ry = top + (uint32_t)shown * MON_RH;
        uint32_t ty = ry + (MON_RH - GH) / 2;

        mon_num_field(cx + MON_C_TID * GW, ty, MON_W_TID, (uint64_t)ti.tid, AC_MUTED);
        /* The task we are actually executing on is the only white thing —
         * same rule the Files breadcrumb uses for the folder you're in. */
        af_draw(cx + MON_C_NAME * GW, ty, ti.name,
                (ti.tid == cur) ? AC_WHITE : AC_MUTED, AF_MONO);
        af_draw(cx + MON_C_STATE * GW, ty, task_state_name(ti.state),
                (ti.state == TASK_RUNNING) ? AC_GREEN : AC_MUTED, AF_MONO);
        /* Switches is the column with life in it: state is nearly constant
         * (whoever asks is by definition the one running), but this climbs. */
        mon_num_field(cx + (MON_C_SWEND - MON_W_SW) * GW, ty, MON_W_SW,
                      ti.switches, AC_TEAL);
        shown++;
    }
    if (total > shown) {
        char s[32]; int k = str_app(s, 0, sizeof(s), "+");
        k = num_app(s, k, sizeof(s), (uint64_t)(total - shown));
        k = str_app(s, k, sizeof(s), " more");
        af_draw(cx + MON_C_NAME * GW, top + (uint32_t)shown * MON_RH, s,
                AC_MUTED, AF_MONO);
    }
}

/* Painted once per full paint: rules, labels, column header, footer. */
static void mon_draw_chrome(void) {
    fb_rect_x(cx, cy + MON_RULE1_DY, cw, 1, AC_BORDER);
    af_draw(cx, mon_mem_y(), "Kernel heap", AC_MUTED, AF_REG13);

    uint32_t vy = mon_val_y();
    mon_label(cx + MON_C_G1 * GW, vy, "used");
    mon_label(cx + MON_C_G2 * GW, vy, "free");
    mon_label(cx + MON_C_G3 * GW, vy, "peak");
    mon_label(cx + (MON_C_G1 + MON_C_MEMUNIT) * GW + 4, vy, "KB");
    mon_label(cx + (MON_C_G2 + MON_C_MEMUNIT) * GW + 4, vy, "KB");
    mon_label(cx + (MON_C_G3 + MON_C_MEMUNIT) * GW + 4, vy, "KB");

    fb_rect_x(cx, mon_rule_y(), cw, 1, AC_BORDER);

    uint32_t hy = mon_col_y();
    af_draw(cx + MON_C_TID * GW,   hy, "TID",   AC_MUTED, AF_REG13);
    af_draw(cx + MON_C_NAME * GW,  hy, "NAME",  AC_MUTED, AF_REG13);
    af_draw(cx + MON_C_STATE * GW, hy, "STATE", AC_MUTED, AF_REG13);
    /* Right-aligned to the same edge as the digits below it. */
    uint32_t shw = af_text_width("SWITCHES", AF_REG13);
    if (MON_C_SWEND * GW > shw)
        af_draw(cx + MON_C_SWEND * GW - shw, hy, "SWITCHES", AC_MUTED, AF_REG13);

    /* Same footer rule as Files: content framed top and bottom by one line,
     * and the footer says KEYS — that is the whole job of this row, here and
     * in Files. It used to also carry "live - updates while visible", which
     * was a promise immediately taking itself back. Dropped: the ticking
     * uptime in the header is the liveness proof, a covered window showing
     * its last frame is simply what a covered window is, and raising it
     * repaints it — so there is no moment where the user is shown a stale
     * number and told it is fresh. (A "stale" badge is also unbuildable:
     * painting one is exactly the thing a covered window cannot do.) */
    const char *hint = "Esc closes";
    fb_rect_x(cx, mon_foot_y(), cw, 1, AC_BORDER);
    uint32_t hw = af_text_width(hint, AF_REG13);
    if (cw > hw) af_draw(cx + cw - hw, mon_hint_y(), hint, AC_MUTED, AF_REG13);
}

/* Just the numbers — what a tick redraws. */
static void mon_draw_live(void) {
    mon_draw_header();
    mon_draw_mem();
    mon_draw_rows();
}

static void mon_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    if (!mon_fits()) {                      /* too small to say anything true */
        af_draw(cx, cy, "window too small", AC_MUTED, AF_MONO);
        return;
    }
    mon_draw_chrome();
    mon_draw_live();
}

static void mon_key(char c) {
    if (c == 27) { wm_close(); return; }    /* read-only: ESC is the only key */
}

/* May the monitor paint its own content rect right now without touching a
 * window above it? See the header comment — this is the whole live-update
 * contract in one function. */
static int mon_can_live_paint(void) {
    int s = slot_of(APP_MON);
    if (s < 0 || !wins[s].open) return 0;
    struct window *w = &wins[s];

    int zi = -1;
    for (int i = 0; i < zn; i++) if (zord[i] == s) { zi = i; break; }
    if (zi < 0) return 0;

    /* The rect we are about to touch = our content rect (set_content_rect). */
    uint32_t rx = w->x + PAD, ry = w->y + TITLE_H + 10;
    uint32_t rw = w->w - 2 * PAD, rh = w->h - TITLE_H - 10 - PAD;
    for (int i = zi + 1; i < zn; i++) {
        struct window *o = &wins[zord[i]];
        /* o->sw/sh include the drop shadow, so this errs toward "covered". */
        if (rects_overlap(rx, ry, rw, rh, o->x, o->y, o->sw, o->sh)) return 0;
    }
    return 1;
}

/* Called from wm_tick — task 0, same thread as every other wm draw. */
static void mon_tick(void) {
    int s = slot_of(APP_MON);
    if (s < 0 || !wins[s].open) return;
    uint64_t now = pit_elapsed_ms();
    if (now - mon_last_ms < MON_REFRESH_MS) return;
    /* Note we do NOT stamp mon_last_ms when covered: the first tick after
     * the window is uncovered should refresh it immediately, not wait. */
    if (!mon_can_live_paint()) return;
    mon_last_ms = now;

    set_content_rect(&wins[s]);
    if (!mon_fits()) return;
    mouse_lift();               /* don't bake the cursor into what we redraw */
    mon_draw_live();
}

/* ─── Calculator ───
 *
 * The window and the pixels only; the arithmetic and the state machine live in
 * calc.c, which has no idea a screen exists. Two reasons that split is worth a
 * second file: the maths is the part that has to be exactly right and it is
 * easier to reason about on its own, and this file is already long enough.
 *
 * BOTH keyboard and mouse, through ONE path. A click resolves to a button id
 * and so does a keystroke (calc_key_to_btn), and both then call calc_press().
 * There is no second implementation for the pointer to drift away from — the 7
 * key and the 7 button are the same line of code.
 *
 * There is no hover state. Every button changes the display the instant it is
 * pressed, so the feedback a hover would promise is already there in the thing
 * the button is for; adding hover would mean lifting the cursor and repainting
 * on every mouse move across the window, which is real work for a hint the
 * result already gives.
 */
#define CALC_W       340u
#define CALC_H       440u
#define CALC_GAP     8u
#define CALC_DISP_H  84u    /* the display panel: expression line + big number */
#define CALC_COLS    4u
#define CALC_ROWS    5u

/* Button tiers, borrowed wholesale from the power dialog so the two speak the
 * same language: one accent primary, an outlined alternative, a quiet ghost.
 * Exactly one button here is the accent — desktop.h asks for it to stay
 * scarce, and on a calculator "=" is unarguably the one. */
enum { KB_NUM = 0, KB_FN, KB_OP, KB_EQ };

/* Labels are the characters you would TYPE. No ÷ or ×: the font atlas is ASCII
 * 32..126 (af_font.h) so they aren't available, but more to the point a button
 * that reads "/" and a key that is "/" need no translation between them. */
static const struct calc_key {
    const char *label; short btn;
    unsigned char col, row, span, kind;
} calc_keys[] = {
    { "AC",  CB_CLEAR, 0, 0, 1, KB_FN  },
    { "DEL", CB_BACK,  1, 0, 1, KB_FN  },
    { "+/-", CB_SIGN,  2, 0, 1, KB_FN  },
    { "/",   CB_DIV,   3, 0, 1, KB_OP  },
    { "7",   CB_7,     0, 1, 1, KB_NUM },
    { "8",   CB_8,     1, 1, 1, KB_NUM },
    { "9",   CB_9,     2, 1, 1, KB_NUM },
    { "*",   CB_MUL,   3, 1, 1, KB_OP  },
    { "4",   CB_4,     0, 2, 1, KB_NUM },
    { "5",   CB_5,     1, 2, 1, KB_NUM },
    { "6",   CB_6,     2, 2, 1, KB_NUM },
    { "-",   CB_SUB,   3, 2, 1, KB_OP  },
    { "1",   CB_1,     0, 3, 1, KB_NUM },
    { "2",   CB_2,     1, 3, 1, KB_NUM },
    { "3",   CB_3,     2, 3, 1, KB_NUM },
    { "+",   CB_ADD,   3, 3, 1, KB_OP  },
    { "0",   CB_0,     0, 4, 2, KB_NUM },   /* double width, as a 0 key is */
    { ".",   CB_DOT,   2, 4, 1, KB_NUM },
    { "=",   CB_EQ,    3, 4, 1, KB_EQ  },
};
#define CALC_NKEYS ((int)(sizeof(calc_keys) / sizeof(calc_keys[0])))

/* The pad's origin and cell size, derived from the content rect so the buttons
 * follow the window instead of a table of literals. Returns 0 when the rect is
 * too small for a usable pad — and because everything below subtracts from
 * cw/ch, that check is the wrap guard as well as the layout guard. */
static int calc_grid(uint32_t *gx, uint32_t *gy, uint32_t *bw, uint32_t *bh) {
    uint32_t lh   = (uint32_t)af_line_height(AF_REG13);
    uint32_t top  = CALC_DISP_H + 12;      /* display + air under it      */
    uint32_t bot  = lh + 16;               /* footer rule + the hint line */
    uint32_t need = top + bot + CALC_ROWS * 18;
    if (ch < need) return 0;
    if (cw < CALC_COLS * 28 + (CALC_COLS - 1) * CALC_GAP) return 0;
    uint32_t gh = ch - top - bot;
    *gx = cx;
    *gy = cy + top;
    *bw = (cw - (CALC_COLS - 1) * CALC_GAP) / CALC_COLS;
    *bh = (gh - (CALC_ROWS - 1) * CALC_GAP) / CALC_ROWS;
    return 1;
}

/* One button's rect. Shared by the drawing and the hit-test, the same discipline
 * desktop_dock_hit() keeps with draw_dock() — two copies of a layout is two
 * layouts, and they always eventually disagree. */
static void calc_key_rect(int i, uint32_t gx, uint32_t gy, uint32_t bw, uint32_t bh,
                          uint32_t *rx, uint32_t *ry, uint32_t *rw, uint32_t *rh) {
    const struct calc_key *k = &calc_keys[i];
    *rx = gx + (uint32_t)k->col * (bw + CALC_GAP);
    *ry = gy + (uint32_t)k->row * (bh + CALC_GAP);
    *rw = bw * (uint32_t)k->span + CALC_GAP * (uint32_t)(k->span - 1);
    *rh = bh;
}

static void calc_draw_key(int i, uint32_t gx, uint32_t gy, uint32_t bw, uint32_t bh) {
    uint32_t rx, ry, rw, rh;
    calc_key_rect(i, gx, gy, bw, bh, &rx, &ry, &rw, &rh);
    uint32_t fill, ink;
    int outline = 0;
    switch (calc_keys[i].kind) {
        case KB_OP: fill = AC_TERM_BG;        ink = AC_TEAL;  outline = 1; break;
        case KB_FN: fill = AC_PANEL;          ink = AC_MUTED; break;
        case KB_EQ: fill = settings_accent(); ink = AC_WHITE; break;
        default:    fill = AC_PANEL;          ink = AC_WHITE; break;
    }
    fb_rect_x(rx, ry, rw, rh, fill);
    if (outline) draw_border(rx, ry, rw, rh, AC_BORDER);
    af_draw_center(rx + rw / 2, ry + rh / 2 - (uint32_t)af_line_height(AF_SB16) / 2,
                   calc_keys[i].label, ink, AF_SB16);
}

/* The display: what you are building on top, what it currently equals below.
 * Both right-aligned, the way a calculator has always read.
 *
 * The number takes the biggest face that fits and steps down rather than
 * overflowing the panel — a long answer stays inside its box instead of running
 * out over the buttons. */
static void calc_draw_display(void) {
    fb_rect_x(cx, cy, cw, CALC_DISP_H, AC_PANEL);

    uint32_t pad   = 12;
    uint32_t avail = (cw > 2 * pad) ? cw - 2 * pad : 0;
    char buf[96];

    calc_expr(buf, (int)sizeof(buf));
    if (buf[0]) {
        uint32_t tw = af_text_width(buf, AF_REG13);
        /* Too long to right-align without falling off the left edge? Then pin it
         * left and let the tail sit under the number — the head of a long
         * expression is the part that has scrolled out of reach anyway. */
        af_draw((tw <= avail) ? (cx + cw - pad - tw) : (cx + pad), cy + 10,
                buf, AC_MUTED, AF_REG13);
    }

    calc_value(buf, (int)sizeof(buf));
    int      err  = calc_is_error();
    uint32_t ink  = err ? AC_RED : AC_WHITE;
    int      face = err ? AF_SB16 : AF_SB30;
    uint32_t tw   = af_text_width(buf, face);
    if (tw > avail) { face = AF_SB16; tw = af_text_width(buf, face); }
    if (tw > avail) { face = AF_MONO; tw = af_text_width(buf, face); }
    uint32_t lh = (uint32_t)af_line_height(face);
    uint32_t ty = (CALC_DISP_H > lh + 10) ? (cy + CALC_DISP_H - 10 - lh) : cy;
    af_draw((tw <= avail) ? (cx + cw - pad - tw) : (cx + pad), ty, buf, ink, face);
}

static void calc_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    uint32_t gx, gy, bw, bh;
    if (!calc_grid(&gx, &gy, &bw, &bh)) {
        af_draw(cx, cy, "window too small", AC_MUTED, AF_MONO);
        return;
    }
    calc_draw_display();
    for (int i = 0; i < CALC_NKEYS; i++) calc_draw_key(i, gx, gy, bw, bh);

    /* Same footer convention as Files: a 1px rule with the keys under it. */
    const char *hint = "Enter equals   c clears   Esc closes";
    uint32_t fy = cy + ch - (uint32_t)af_line_height(AF_REG13);
    uint32_t hw = af_text_width(hint, AF_REG13);
    if (hw > cw) { hint = "Esc closes"; hw = af_text_width(hint, AF_REG13); }
    fb_rect_x(cx, fy - 8, cw, 1, AC_BORDER);
    if (cw > hw) af_draw(cx + cw - hw, fy, hint, AC_MUTED, AF_REG13);
}

static void calc_click(int mx, int my) {
    uint32_t gx, gy, bw, bh;
    if (!calc_grid(&gx, &gy, &bw, &bh)) return;
    for (int i = 0; i < CALC_NKEYS; i++) {
        uint32_t rx, ry, rw, rh;
        calc_key_rect(i, gx, gy, bw, bh, &rx, &ry, &rw, &rh);
        if (mx < (int)rx || mx >= (int)(rx + rw)) continue;
        if (my < (int)ry || my >= (int)(ry + rh)) continue;
        calc_press(calc_keys[i].btn);
        calc_draw();
        return;
    }
}

static void calc_key(char c) {
    if (c == 27) { wm_close(); return; }      /* Esc closes, as everywhere else */
    int b = calc_key_to_btn(c);
    if (b == CB_NONE) return;                 /* a key that means nothing here */
    calc_press(b);
    calc_draw();
}

/* ─── Settings ───
 *
 * Three things about the machine you can change, and every one of them is
 * WIRED — the panel walks settings.c's groups and knows nothing about what any
 * of them mean, so there is no place for a control to exist without something
 * behind it. Adding a fourth is a table edit in settings.c and no change here.
 *
 * A change applies the instant you make it: arrow onto another accent and the
 * whole desktop is that colour before you let go of the key. That is what
 * repaint_all() is for and it is why the panel doesn't have an Apply button —
 * an Apply button is what you build when you can't afford to do the thing.
 *
 * It also says out loud that the change lasts until shutdown. Nothing here is
 * written to disk yet, and a setting that quietly forgets overnight is the same
 * broken promise as a switch that does nothing.
 */
#define SET_W         560u
#define SET_H         360u
#define SET_ROW_H     73u    /* label line + chips + the air under them */
#define SET_CHIP_H    30u
#define SET_CHIP_GAP  10u
#define SET_SW_W      52u    /* a colour swatch's width                 */
/* How far the selection ring reaches OUTSIDE the chip it encircles. The row is
 * inset by this much and the last chip must end this far short of the right
 * edge, so the ring always lands inside the content rect. That is not cosmetic:
 * settings_draw() clears exactly cx..cx+cw, so a ring drawn one pixel outside
 * it is a ring nothing ever erases — move the selection and the old one stays
 * on the window body for the rest of the session. */
#define SET_RING      3u

static int st_row;           /* which group has the keyboard */

/* Linear RGB interpolation, so a wallpaper swatch is a small picture of the
 * gradient it selects rather than a label for it. Same maths as desktop.c's
 * lerp_color; it's static there and this is the only other caller. */
static uint32_t set_blend(uint32_t a, uint32_t b, int num, int den) {
    if (den <= 0) return a;
    int ar = (int)((a >> 16) & 0xFF), ag = (int)((a >> 8) & 0xFF), ab = (int)(a & 0xFF);
    int br = (int)((b >> 16) & 0xFF), bg = (int)((b >> 8) & 0xFF), bb = (int)(b & 0xFF);
    int r = ar + (br - ar) * num / den;
    int g = ag + (bg - ag) * num / den;
    int l = ab + (bb - ab) * num / den;
    return ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)l;
}

static uint32_t set_label_h(void) { return (uint32_t)af_line_height(AF_REG13); }
static uint32_t set_group_y(int g) { return cy + (uint32_t)g * SET_ROW_H; }

/* Room for the rows, the note and the hint. Subtractive, so this is the wrap
 * guard too — everything below takes pieces out of cw/ch. */
static int set_fits(void) {
    uint32_t need = (uint32_t)SET_GROUPS * SET_ROW_H + set_label_h() + 8
                    + set_label_h() + 8;
    return cw >= 260 && ch >= need;
}

static uint32_t set_chip_w(int g, int i) {
    uint32_t top, bot;
    if (settings_swatch(g, i, &top, &bot)) return SET_SW_W;
    return af_text_width(settings_label(g, i), AF_REG13) + 24;
}

/* One chip's rect, shared by the drawing and the hit-test. Returns 0 when the
 * chip would run off the right edge, so a chip that isn't drawn also can't be
 * clicked. Written subtractively — cw is not this function's to trust. */
static int set_chip_rect(int g, int i, uint32_t *rx, uint32_t *ry,
                         uint32_t *rw, uint32_t *rh) {
    if (!set_fits()) return 0;
    if (i < 0 || i >= settings_count(g)) return 0;
    uint32_t off = 0;
    for (int k = 0; k < i; k++) off += set_chip_w(g, k) + SET_CHIP_GAP;
    uint32_t w = set_chip_w(g, i);
    /* The usable lane is the content width less the ring's reach on BOTH sides.
     * Subtractive throughout — cw is not this function's to trust. */
    uint32_t avail = (cw > 2 * SET_RING) ? cw - 2 * SET_RING : 0;
    if (w > avail || off > avail - w) return 0;
    *rx = cx + SET_RING + off;
    *ry = set_group_y(g) + set_label_h() + 6;
    *rw = w;
    *rh = SET_CHIP_H;
    return 1;
}

static void set_draw_chip(int g, int i, int selected, int focused_row) {
    uint32_t rx, ry, rw, rh, top, bot;
    if (!set_chip_rect(g, i, &rx, &ry, &rw, &rh)) return;

    if (settings_swatch(g, i, &top, &bot)) {
        if (top == bot) fb_rect_x(rx, ry, rw, rh, top);
        else for (uint32_t r = 0; r < rh; r++)
                 fb_rect_x(rx, ry + r, rw, 1, set_blend(top, bot, (int)r, (int)rh));
    } else {
        fb_rect_x(rx, ry, rw, rh, selected ? AC_PANEL : AC_TERM_BG);
        draw_border(rx, ry, rw, rh, AC_BORDER);
        af_draw_center(rx + rw / 2, ry + rh / 2 - set_label_h() / 2,
                       settings_label(g, i), selected ? AC_WHITE : AC_MUTED, AF_REG13);
    }

    if (!selected) return;
    /* The selection ring is WHITE, not the accent — one of these rows chooses
     * the accent itself, and a ring the same colour as the swatch it encircles
     * disappears exactly when it matters most. White reads on all five
     * wallpapers and all six accents, so one rule covers every row. The
     * unfocused row keeps its ring in muted, so you can still see what is set
     * everywhere while only one row is taking arrows. */
    uint32_t c = focused_row ? AC_WHITE : AC_MUTED;
    fb_rect_x(rx - 3, ry - 3,      rw + 6, 2,      c);
    fb_rect_x(rx - 3, ry + rh + 1, rw + 6, 2,      c);
    fb_rect_x(rx - 3, ry - 3,      2,      rh + 6, c);
    fb_rect_x(rx + rw + 1, ry - 3, 2,      rh + 6, c);
}

static void settings_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    if (!set_fits()) {
        af_draw(cx, cy, "window too small", AC_MUTED, AF_MONO);
        return;
    }

    for (int g = 0; g < SET_GROUPS; g++) {
        uint32_t ly = set_group_y(g);
        int sel = settings_get(g);
        const char *name = settings_group_name(g);
        af_draw(cx, ly, name, (g == st_row) ? AC_WHITE : AC_MUTED, AF_REG13);
        /* The swatch rows have no text on their chips, so the current choice is
         * named beside the group. Teal, not the accent: this is the row telling
         * you what it is set to, and on the accent row an accent-coloured word
         * would change colour with the very thing it is naming. */
        uint32_t nx = cx + af_text_width(name, AF_REG13) + 12;
        if (nx < cx + cw)
            af_draw(nx, ly, settings_label(g, sel),
                    (g == st_row) ? AC_TEAL : AC_MUTED, AF_REG13);
        for (int i = 0; i < settings_count(g); i++)
            set_draw_chip(g, i, i == sel, g == st_row);
    }

    af_draw(cx, cy + (uint32_t)SET_GROUPS * SET_ROW_H,
            "Changes apply at once and last until you shut down.",
            AC_MUTED, AF_REG13);

    const char *hint = "Arrows choose   Esc closes";
    uint32_t fy = cy + ch - set_label_h();
    uint32_t hw = af_text_width(hint, AF_REG13);
    if (hw > cw) { hint = "Esc closes"; hw = af_text_width(hint, AF_REG13); }
    fb_rect_x(cx, fy - 8, cw, 1, AC_BORDER);
    if (cw > hw) af_draw(cx + cw - hw, fy, hint, AC_MUTED, AF_REG13);
}

/* Commit a choice. repaint_all() is the right hammer: an accent or a wallpaper
 * is system-wide, so the desktop, the terminal and every open window all have
 * to be redrawn — including this panel, which repaint_all() reaches through
 * draw_content(). It also lifts the mouse cursor first, so nothing bakes the
 * pointer into the new chrome. Nothing may touch cx/cy after this: repaint_all
 * walks every window and leaves the content rect pointing at the last one. */
static void settings_apply(int g, int idx) {
    settings_set(g, idx);
    repaint_all();
}

static void settings_key(char c) {
    if (c == 27) { wm_close(); return; }
    if (c == (char)KEY_UP)   { if (st_row > 0)               st_row--; settings_draw(); return; }
    if (c == (char)KEY_DOWN) { if (st_row < SET_GROUPS - 1)  st_row++; settings_draw(); return; }
    if (c == (char)KEY_LEFT || c == (char)KEY_RIGHT) {
        int n = settings_count(st_row);
        if (n <= 0) return;
        int cur = settings_get(st_row);
        int nxt = cur + ((c == (char)KEY_RIGHT) ? 1 : -1);
        if (nxt < 0 || nxt >= n) return;        /* already at the end: sit still */
        settings_apply(st_row, nxt);
    }
}

static void settings_click(int mx, int my) {
    for (int g = 0; g < SET_GROUPS; g++)
        for (int i = 0; i < settings_count(g); i++) {
            uint32_t rx, ry, rw, rh;
            if (!set_chip_rect(g, i, &rx, &ry, &rw, &rh)) continue;
            if (mx < (int)rx || mx >= (int)(rx + rw)) continue;
            if (my < (int)ry || my >= (int)(ry + rh)) continue;
            int moved = (settings_get(g) != i);
            st_row = g;
            /* Clicking the chip that is already set still moves the focus ring
             * to that row, but there is nothing system-wide to redraw for it. */
            if (moved) settings_apply(g, i);
            else       settings_draw();
            return;
        }
}

/* ─── Window chrome + lifecycle ─── */

static const char *title_for(enum app_kind a) {
    switch (a) {
        case APP_FILES:  return "Files";
        case APP_EDITOR: return ed_title;
        case APP_ASSIST: return "Assistant";
        case APP_MON:    return "System Monitor";
        case APP_CALC:   return "Calculator";
        case APP_SET:    return "Settings";
        default:         return "App";
    }
}

static void draw_frame(struct window *w) {
    int fg = (w == focused());
    fb_rect_x(w->x + 6, w->y + 6, w->w, w->h, 0x0A0E24u);   /* shadow */
    fb_rect_x(w->x, w->y, w->w, w->h, AC_TERM_BG);          /* body   */
    fb_rect_x(w->x, w->y, w->w, TITLE_H, AC_PANEL);         /* title  */
    fb_rect_x(w->x + w->w - 27, w->y + 9, 16, 16, AC_RED);  /* close  */
    af_draw(w->x + w->w - 23, w->y + 8, "x", AC_WHITE, AF_REG13);
    /* the focused window gets a white title + accent border; others dim */
    af_draw_center(w->x + w->w / 2, w->y + 8, title_for(w->app),
                   fg ? AC_WHITE : AC_MUTED, AF_SB16);
    draw_border(w->x, w->y, w->w, w->h, fg ? settings_accent() : AC_BORDER);
}

static void draw_content(struct window *w) {
    set_content_rect(w);
    switch (w->app) {
        case APP_EDITOR: editor_draw(); break;
        case APP_FILES:  files_draw();  break;
        case APP_ASSIST: assist_draw(); break;
        case APP_MON:    mon_draw();    break;
        case APP_CALC:   calc_draw();     break;
        case APP_SET:    settings_draw(); break;
        default: break;
    }
}

static void set_content_rect(struct window *w) {
    cx = w->x + PAD; cy = w->y + TITLE_H + 10;
    cw = w->w - 2 * PAD; ch = w->h - TITLE_H - 10 - PAD;
}

/* Repaint the world from state: desktop chrome, the terminal (from its
 * backing store), then every window bottom-to-top. Each window's savebuf is
 * snapshotted BEFORE it is drawn, so the top window can later be dragged by
 * restore→move→save without repainting anything else. */
static void repaint_all(void) {
    SW = fb_width_x(); SH = fb_height_x();
    /* FIRST, before a single pixel moves. mouse_lift() paints the cursor's
     * cached background back, and that cache is only true until somebody
     * repaints underneath it — so lifting AFTER the chrome meant stamping
     * pre-repaint pixels on top of freshly drawn chrome. That is precisely how
     * clicking a dock tile bit a 22x2 notch out of the Files active ring: the
     * ring was drawn by desktop_set_active_app(), then the resting cursor
     * restored what had been there before it. Lift while the cache is still
     * true and let the repaint below cover the hole. */
    mouse_lift();
    desktop_repaint_chrome();
    console_redraw();
    struct window *f = focused();
    desktop_set_active_app(f ? icon_of(f->app) : 0);
    for (int i = 0; i < zn; i++) {
        struct window *w = &wins[zord[i]];
        save_rect(w->x, w->y, w->sw, w->sh, w->savebuf);
        draw_frame(w);
        draw_content(w);
    }
}

static void close_window(struct window *w) {
    if (!w || !w->open) return;
    if (w->app == APP_EDITOR) { editor_save(); if (ed_buf) { kfree(ed_buf); ed_buf = 0; } }
    z_remove(slot_of(w->app));
    w->open = 0;
    dragging = 0;
    if (zn == 0) focus_shell = 1;
    repaint_all();
}

static void wm_close(void) {
    struct window *w = focused();
    if (!w) w = topwin();
    close_window(w);
}

/* Rows the Monitor window opens with: the tasks present right now plus one
 * line of headroom. The +1 matters — with a table sized to exactly N, the
 * first task that spawns while you're watching would instantly displace a
 * visible row into "+1 more"; the spare line lets it slot into empty space
 * instead. One empty row reads as "room for the next task"; four empty rows
 * read as a bug, which is the guessed-worst-case sizing this replaces. */
static uint32_t mon_open_rows(void) {
    uint32_t n = (uint32_t)mon_task_count() + 1u;
    if (n < MON_ROWS_MIN) n = MON_ROWS_MIN;
    if (n > MON_ROWS_MAX) n = MON_ROWS_MAX;
    return n;
}

/* How big a window opens. Files / Editor / Assistant hold content of unbounded
 * length, so they take the one generous size and let it fill. The Monitor's
 * content is bounded and known — a MON_COLS-wide mono table and a heap gauge —
 * so it is sized to exactly that: the table's own width sets the window's, and
 * the live task count (mon_open_rows) sets its height. That is what puts the
 * header, both rules, the gauge, the rows and the footer on one shared left and
 * right edge, with no dead band under the last task. */
static void size_for(enum app_kind a, uint32_t *w, uint32_t *h) {
    if (a == APP_MON) {
        *w = MON_COLS * GW + 2 * PAD;
        *h = mon_ch_for(mon_open_rows()) + TITLE_H + 10 + PAD;
        return;
    }
    /* The Calculator and Settings are the other two apps whose content is
     * bounded and known — a 4-column keypad, three rows of chips — so like the
     * Monitor they take a size cut to fit rather than the generous default. A
     * calculator that opened at 860px wide would be 500px of empty panel. */
    if (a == APP_CALC) { *w = CALC_W; *h = CALC_H; return; }
    if (a == APP_SET)  { *w = SET_W;  *h = SET_H;  return; }
    *w = APP_W; *h = APP_H;
}

static void open_common(enum app_kind app) {
    int s = slot_of(app);
    if (s < 0) return;
    struct window *w = &wins[s];
    SW = fb_width_x(); SH = fb_height_x();
    if (!w->open) {
        w->app = app;
        size_for(app, &w->w, &w->h);
        /* cascade so a second window doesn't land exactly on the first */
        w->x = (SW - w->w) / 2 + (uint32_t)(s * 26);
        w->y = WM_TOP + 4 + (uint32_t)(s * 22);
        w->sw = w->w + 6; w->sh = w->h + 6;          /* include shadow */
        /* The savebuf must hold the whole shadow-inclusive rect: save_rect
         * writes exactly sw*sh pixels into it. The Monitor now opens at a
         * task-count-dependent height (size_for -> mon_open_rows), so a slot
         * reopened TALLER than last time needs a bigger buffer than the one
         * cached here — grow it, or save_rect walks off the old end and
         * smashes the heap. sw*sh is bounded by the screen, so *4 can't wrap. */
        uint32_t need = w->sw * w->sh;
        if (need > w->savecap) {
            if (w->savebuf) kfree(w->savebuf);
            w->savebuf = (uint32_t *)kmalloc(need * 4);
            w->savecap = w->savebuf ? need : 0;   /* 0 if OOM: save_rect no-ops on null */
        }
        w->open = 1;
        if (app == APP_ASSIST) assist_reset();
        if (app == APP_FILES)  files_load();
        if (app == APP_MON)    mon_last_ms = pit_elapsed_ms();
        /* A calculator you come back to still holding your last sum is a
         * calculator you have to remember to clear. Open means zero. */
        if (app == APP_CALC)   calc_reset();
        if (app == APP_SET)    st_row = 0;
    }
    z_raise(s);
    focus_shell = 0;
    repaint_all();
}

void wm_open_editor(const char *name) {
    editor_open(name);              /* load the file first so the title is right */
    open_common(APP_EDITOR);
}

static void run_snake(void) {
    snake_play();                   /* takes over the screen until ESC */
    console_clear();
    console_puts("Back from Snake. Type 'help'.\n");
    repaint_all();                  /* restore desktop + any open windows */
}

void wm_open_app(int icon) {
    switch (icon) {
        case 0:   /* Terminal: hand the keyboard back to the shell */
            focus_shell = 1;
            /* desktop_set_active_app() repaints the whole dock strip, and with
             * no windows open nothing else follows to cover a stale restore —
             * so lift before it, not after. (When zn > 0 the repaint_all()
             * below lifts too; mouse_lift() is idempotent between redraws.) */
            mouse_lift();
            desktop_set_active_app(0);
            if (zn) repaint_all();          /* redraw titles/borders as unfocused */
            break;
        case 1: open_common(APP_FILES);  break;
        case 2: wm_open_editor(0);       break;
        case 3: run_snake();             break;
        case 4: open_common(APP_ASSIST); break;
        case 5: open_common(APP_MON);    break;
        case 6: open_common(APP_CALC);   break;
        case 7: open_common(APP_SET);    break;
        default: break;
    }
}

/* ─── Move (drag) ─── */
/* Only ever the TOP window: a click raises before it drags, so restoring this
 * window's savebuf can never erase a window above it. */
static void wm_move(int nx, int ny) {
    struct window *w = topwin();
    if (!w) return;
    if (nx < 0) nx = 0;
    if (ny < (int)WM_TOP) ny = (int)WM_TOP;
    if (nx + (int)w->sw > (int)SW) nx = (int)SW - (int)w->sw;
    if (ny + (int)w->sh > (int)(SH - WM_DOCK)) ny = (int)(SH - WM_DOCK) - (int)w->sh;
    if (nx == (int)w->x && ny == (int)w->y) return;
    mouse_lift();
    restore_rect(w->x, w->y, w->sw, w->sh, w->savebuf);
    w->x = (uint32_t)nx; w->y = (uint32_t)ny;
    save_rect(w->x, w->y, w->sw, w->sh, w->savebuf);
    draw_frame(w);
    draw_content(w);
}

/* ─── Public API ─── */

void wm_init(void) {
    SW = fb_width_x(); SH = fb_height_x();
    /* Seed the content cell from the mono face (same as console.c). */
    GW = af_text_width("M", AF_MONO);
    GH = (uint32_t)af_line_height(AF_MONO);
    LINE = GH + 2;
    for (int i = 0; i < WM_MAX; i++) {
        wins[i].open = 0; wins[i].app = APP_NONE; wins[i].savebuf = 0; wins[i].savecap = 0;
    }
    zn = 0; focus_shell = 1;
    dragging = 0; ed_buf = 0;
    mon_last_ms = 0;
    calc_reset(); st_row = 0;
}

int wm_active(void) { return focused() != 0; }

int wm_handle_key(char c) {
    /* The power dialog is modal: while it's up it swallows every key so nothing
     * leaks to the shell, and Esc is the calm way out. */
    if (desktop_power_is_open()) {
        if (c == 27) { desktop_power_cancel(); repaint_all(); }
        return 1;
    }
    struct window *f = focused();
    if (!f) return 0;               /* nothing focused → the shell gets it */
    /* Every one of these handlers repaints part of its window — an editor line,
     * the Files selection, an assistant reply. If the pointer is resting on that
     * window its cached background goes stale the moment they do, so take the
     * sprite off first, exactly as mon_tick does. The main loop puts it back on
     * the same pass. Free when nothing is on screen (mouse_lift is idempotent
     * between redraws), so holding a key down doesn't repeat the work. */
    mouse_lift();
    set_content_rect(f);            /* app draw fns work off cx/cy/cw/ch */
    switch (f->app) {
        case APP_EDITOR: editor_key(c); return 1;
        case APP_FILES:  files_key(c);  return 1;
        case APP_ASSIST: assist_key(c); return 1;
        case APP_MON:    mon_key(c);    return 1;
        case APP_CALC:   calc_key(c);     return 1;
        case APP_SET:    settings_key(c); return 1;
        default: return 0;
    }
}

/* Before power-off / restart, flush anything the session holds only in RAM. The
 * editor is the one app with unsaved state — Files and the Assistant write
 * through immediately — so saving it is what lets "your session will end" cost
 * the user no work. */
static void wm_prepare_for_power(void) {
    int s = slot_of(APP_EDITOR);
    if (s >= 0 && wins[s].open) editor_save();
}

void wm_tick(void) {
    int mx = mouse_x(), my = mouse_y();
    int down = mouse_left_down();
    int click = mouse_take_left_click();

    /* The power dialog is modal: it owns every click (plus hover feedback) and
     * nothing else in the wm runs while it's up — no dock, no drag, no live
     * monitor repaint that would paint over the card. */
    if (desktop_power_is_open()) {
        if (click) {
            int a = desktop_power_action(mx, my);
            if (a == PWR_OFF)    { wm_prepare_for_power(); desktop_power_shutdown(0); }
            if (a == PWR_REBOOT) { wm_prepare_for_power(); desktop_power_shutdown(1); }
            if (a == PWR_CANCEL) repaint_all();      /* clear the dim */
        } else if (mx != last_mx || my != last_my) {
            /* Hover feedback. Lift the cursor before the buttons repaint beneath
             * it — the same rule mon_tick keeps — so its cached background can't
             * smear; the main loop redraws the cursor fresh right after. */
            last_mx = mx; last_my = my;
            mouse_lift();
            desktop_power_hover(mx, my);             /* repaints only on change */
        }
        return;
    }

    if (click) {
        /* The power button lives in the top bar, not the dock — check it first.
         * mouse_lift() clears the cursor so it isn't baked into the dimmed
         * snapshot the dialog takes. */
        if (desktop_power_hit(mx, my)) { mouse_lift(); desktop_power_open(); return; }
        int icon = desktop_dock_hit(mx, my);
        if (icon >= 0) { wm_open_app(icon); return; }

        /* The topmost window under the pointer takes the click. */
        for (int i = zn - 1; i >= 0; i--) {
            int slot = zord[i];
            struct window *w = &wins[slot];
            if (mx < (int)w->x || mx > (int)(w->x + w->w) ||
                my < (int)w->y || my > (int)(w->y + w->h)) continue;
            if (i != zn - 1 || focus_shell) {   /* click-to-focus: raise it */
                z_raise(slot); focus_shell = 0; repaint_all();
            }
            /* close box */
            if (mx >= (int)(w->x + w->w - 27) && mx <= (int)(w->x + w->w - 11) &&
                my >= (int)(w->y + 9)         && my <= (int)(w->y + 25)) {
                wm_close(); return;
            }
            /* title bar → begin drag */
            if (my >= (int)w->y && my <= (int)(w->y + TITLE_H)) {
                dragging = 1; drag_ox = mx - (int)w->x; drag_oy = my - (int)w->y;
                last_mx = mx; last_my = my;
            } else {
                /* Everything below the title bar belongs to the app. Only the
                 * two apps with things to press take it; the rest are read-only
                 * or keyboard-driven and ignore a click on their page.
                 *
                 * mouse_lift() first, for the same reason wm_handle_key does it:
                 * these handlers repaint part of the window, and a pointer
                 * resting on it holds a cached background that goes stale the
                 * moment they do. The main loop paints the cursor back on the
                 * same pass. (A raise above may already have lifted — it is
                 * idempotent between redraws, so this costs nothing.) */
                mouse_lift();
                set_content_rect(w);
                switch (w->app) {
                    case APP_CALC: calc_click(mx, my);     break;
                    case APP_SET:  settings_click(mx, my); break;
                    default: break;
                }
            }
            return;
        }
        /* clicked the desktop / terminal → give the keyboard to the shell */
        if (!focus_shell) {
            focus_shell = 1;
            mouse_lift();               /* the dock repaints under us — see above */
            desktop_set_active_app(0);
            if (zn) repaint_all();
        }
    }

    if (dragging) {
        if (!down) { dragging = 0; }
        else if (mx != last_mx || my != last_my) {
            wm_move(mx - drag_ox, my - drag_oy);
            last_mx = mx; last_my = my;
        }
        return;                 /* mid-drag: leave the pixels to wm_move */
    }

    /* Live numbers, last: mouse_redraw_if_dirty() runs right after us in the
     * main loop, so the cursor goes back on top of whatever we just drew.
     * The early returns above either end in a full repaint or cost a single
     * ~10ms iteration that the next tick picks up — neither loses an update. */
    mon_tick();
}
