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
#include "heap.h"       /* kmalloc/kfree (ksize_t) */
#include "console.h"    /* console_clear/console_puts */
#include "snake.h"      /* snake_play */
#include "mouse.h"      /* mouse_x/y/left_down/take_left_click/lift */
#include "gpt.h"        /* on-device GPT for the Assistant */
#include "af.h"         /* antialiased Inter text */
#include "task.h"       /* task_get_info — the assistant reports what's running */
#include "ata.h"        /* ata_present — disk / persistence status */
#include "rtc.h"        /* rtc_read — the assistant knows the real date */

/* Framebuffer wrappers live in kernel_mb2.c with no header — declare them
 * here the same way console.c / mouse.c do. */
extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);
extern int      fb_present_x(void);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);

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

enum app_kind { APP_NONE = 0, APP_FILES, APP_EDITOR, APP_ASSIST, APP_MON };

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
#define WM_MAX 4

struct window {
    int           open;
    enum app_kind app;
    uint32_t      x, y, w, h;     /* outer rect */
    uint32_t      sw, sh;         /* saved-rect dims (incl. shadow) */
    uint32_t     *savebuf;        /* pixels beneath this window at paint time */
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

static int slot_of(enum app_kind a) {
    switch (a) { case APP_FILES: return 0; case APP_EDITOR: return 1;
                 case APP_ASSIST: return 2; case APP_MON: return 3;
                 default: return -1; }
}
static int icon_of(enum app_kind a) {   /* dock icon index */
    switch (a) { case APP_FILES: return 1; case APP_EDITOR: return 2;
                 case APP_ASSIST: return 4; case APP_MON: return 5;
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
    ed_len = 0; ed_cursor = 0;
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
        fb_rect_x(caret_x, caret_y, 2, GH, AC_ORANGE);   /* text caret */
}

static void editor_key(char c) {
    if (c == 27) { wm_close(); return; }   /* ESC: save + close */
    if (c == (char)KEY_LEFT)  { if (ed_cursor > 0)      ed_cursor--; editor_draw(); return; }
    if (c == (char)KEY_RIGHT) { if (ed_cursor < ed_len) ed_cursor++; editor_draw(); return; }
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
static int     fl_count, fl_sel;

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
    fl_count = 0; fl_sel = 0;
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
    uint32_t rh = GH + 5;
    uint32_t top = cy + 32;
    for (int i = 0; i < fl_count; i++) {
        uint32_t ry = top + (uint32_t)i * rh;
        if (ry + rh > foot) break;
        int sel = (i == fl_sel);
        if (sel) {
            fb_rect_x(cx, ry, cw, rh, AC_PANEL);
            fb_rect_x(cx, ry, 2, rh, AC_ACCENT);   /* the selection's edge */
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

static void assist_reset(void) { as_plen = 0; as_prompt[0] = 0; as_olen = 0; }

static void assist_prompt_line(void) {
    uint32_t py = cy + 60;
    fb_rect_x(cx, py, cw, GH + 2, AC_TERM_BG);
    af_draw(cx, py, ">", AC_TEAL, AF_MONO);
    af_draw(cx + GW + 6, py, as_prompt, AC_WHITE, AF_MONO);
    uint32_t caret = cx + GW + 6 + (uint32_t)as_plen * GW;
    fb_rect_x(caret, py, 2, GH, AC_ORANGE);
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

static char lc(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

/* case-insensitive substring test */
static int has(const char *h, const char *n) {
    for (int i = 0; h[i]; i++) {
        int j = 0;
        while (n[j] && lc(h[i + j]) == lc(n[j])) j++;
        if (!n[j]) return 1;
    }
    return 0;
}

/* last whitespace-delimited token of s, trailing punctuation trimmed */
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

/* Try to handle the prompt as a real, safe, LOCAL action — the whole thesis:
 * you talk to the OS and it DOES things, offline. Returns 1 if handled; 0
 * falls through to the GPT for open-ended text. */
static int try_intent(const char *p) {
    /* ─── talk about the machine: real numbers, straight from the kernel ─── */

    /* who/what are you — the honest pitch */
    if ((has(p, "who are you") || has(p, "what are you") || has(p, "who made") ||
         has(p, "who built") || has(p, "what is this") || has(p, "introduce")) &&
        !has(p, "running") && !has(p, "doing")) {
        assist_begin_output();
        assist_say("I'm Astrion's assistant. I live inside a kernel written from\n");
        assist_say("scratch in C - no Linux under me, no internet anywhere.\n");
        assist_say("I don't just chat: I run this machine for you. Ask me your\n");
        assist_say("memory, what's running, or your files - or tell me to make,\n");
        assist_say("write, append, copy, read or delete them.\n");
        return 1;
    }

    /* memory — real heap numbers */
    if (has(p, "memory") || has(p, "memor") || has(p, "how much ram") ||
        has(p, "free ram") || has(p, "heap")) {
        uint32_t usedkb = (uint32_t)(heap_used() >> 10);
        uint32_t freekb = (uint32_t)(heap_free() >> 10);
        assist_begin_output();
        assist_say("memory: ");
        assist_num(usedkb); assist_say(" KB used, ");
        assist_num(freekb); assist_say(" KB free (");
        assist_num(usedkb + freekb); assist_say(" KB kernel heap).\n");
        assist_say("all on this machine - nothing in a cloud.\n");
        return 1;
    }

    /* what's running — the real scheduler table */
    if (has(p, "running") || has(p, "processes") || has(p, "process") ||
        has(p, "tasks") || has(p, "what are you doing") || has(p, "jobs")) {
        assist_begin_output();
        assist_say("running right now:\n");
        struct task_info ti;
        for (int i = 0; i < TASK_MAX; i++) {
            if (!task_get_info(i, &ti)) continue;
            assist_say("  "); assist_num((uint32_t)ti.tid);
            assist_say("  "); assist_say(ti.name);
            assist_say("  ("); assist_say(task_state_name(ti.state)); assist_say(")\n");
        }
        assist_say("preemptive - no runaway task can freeze me.\n");
        return 1;
    }

    /* disk / persistence */
    if (has(p, "disk") || has(p, "storage") || has(p, "persist")) {
        assist_begin_output();
        if (ata_present())
            assist_say("disk: attached. your files persist across reboots -\nsaved to the ATA disk on every change.\n");
        else
            assist_say("no disk this boot - files live in RAM. attach one and\nthey survive reboots.\n");
        return 1;
    }

    /* help / capabilities */
    if (has(p, "what can you") || has(p, "help") || has(p, "command")) {
        assist_begin_output();
        assist_say("I run this machine, all offline:\n\n");
        assist_say("  ask:    how much memory / what's running / who are you\n");
        assist_say("  files:  list my files / make notes.txt / read notes.txt\n");
        assist_say("  write:  write hi to notes.txt / append bye to notes.txt\n");
        assist_say("  copy:   copy notes.txt to backup.txt / delete notes.txt\n");
        assist_say("  open:   open the editor / snake / files\n\n");
        assist_say("or just type anything and I'll write it. No internet, ever.\n");
        return 1;
    }

    /* date / time — the real wall clock, not uptime */
    if (has(p, "date") || has(p, "what day") ||
        (has(p, "time") && !has(p, "uptime"))) {
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
        return 1;
    }

    /* uptime */
    if (has(p, "uptime") || (has(p, "how long") && has(p, "been"))) {
        uint32_t secs = (uint32_t)(pit_elapsed_ms() / 1000);
        assist_begin_output();
        assist_say("up ");
        if (secs >= 60) { assist_num(secs / 60); assist_say(" min ");
                          assist_num(secs % 60); assist_say(" sec"); }
        else            { assist_num(secs); assist_say(" seconds"); }
        assist_say(" - on this kernel, no network.\n");
        return 1;
    }

    /* list files — now with sizes + totals, and "how many files" */
    if ((has(p, "list") || has(p, "what") || has(p, "show") || has(p, "how many")) &&
        has(p, "file")) {
        assist_begin_output();
        if (has(p, "how many")) {
            assist_say("you have "); assist_num(fs_count());
            assist_say(" files, "); assist_num(fs_total_bytes());
            assist_say(" bytes total.\n");
            return 1;
        }
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
        return 1;
    }
    /* write TEXT to FILE — gated so creative "write a poem in X" still hits GPT */
    if (has(p, "write") || has(p, "put ") || has(p, "save ")) {
        int sl; const char *sep = find_to(p, &sl);
        if (sep) {
            char file[64]; const char *fp = sep + sl;
            while (*fp == ' ') fp++;
            int fk = 0; while (*fp && *fp != ' ' && fk < 63) file[fk++] = *fp++;
            while (fk > 0 && (file[fk-1]=='.'||file[fk-1]=='!'||file[fk-1]=='?'||file[fk-1]==',')) fk--;
            file[fk] = 0;
            int looks_like_file = has(p, "file") || name_has_ext(file) || (fs_find(file) != 0);
            const char *tp = p; while (*tp && *tp != ' ') tp++;   /* skip the verb */
            while (*tp == ' ') tp++;
            char text[128]; int tk = 0;
            for (const char *q = tp; q < sep && tk < 127; q++) text[tk++] = *q;
            text[tk] = 0;
            if (file[0] && text[0] && looks_like_file) {
                if (!name_has_ext(file)) {
                    const char *e = ".txt"; int j = 0;
                    while (e[j] && fk < 63) file[fk++] = e[j++];
                    file[fk] = 0;
                }
                fs_write(file, (const uint8_t *)text, (uint32_t)tk);
                fs_sync();
                assist_begin_output();
                assist_say("wrote to "); assist_say(file); assist_say(":\n  ");
                assist_say(text); assist_emit('\n');
                return 1;
            }
        }
    }
    /* copy FILE to NEWNAME — a real duplicate on disk */
    if (has(p, "copy") || has(p, "duplicate")) {
        int sl; const char *sep = find_to(p, &sl);
        char src[64];
        if (sep && (word_after(p, "copy", src, sizeof(src)) ||
                    word_after(p, "duplicate", src, sizeof(src)))) {
            char dst[64]; const char *fp = sep + sl; while (*fp == ' ') fp++;
            int k = 0; while (*fp && *fp != ' ' && k < 63) dst[k++] = *fp++;
            while (k > 0 && (dst[k-1]=='.'||dst[k-1]=='!'||dst[k-1]=='?'||dst[k-1]==',')) k--;
            dst[k] = 0;
            fs_node *sn = resolve_file(src, sizeof(src));
            assist_begin_output();
            if (sn && sn->kind == FS_FILE && dst[0]) {
                static uint8_t cbuf[1024];
                uint32_t len = sn->size < 1024 ? sn->size : 1024;
                for (uint32_t i = 0; i < len; i++) cbuf[i] = sn->data[i];
                if (!name_has_ext(dst)) { const char *e = ".txt"; int j = 0;
                    while (e[j] && k < 63) dst[k++] = e[j++]; dst[k] = 0; }
                fs_create(dst, FS_FILE);
                fs_write(dst, cbuf, len);
                fs_sync();
                assist_say("copied "); assist_say(src); assist_say(" -> ");
                assist_say(dst); assist_say(" ("); assist_num(len); assist_say(" B)\n");
            } else {
                assist_say("copy needs: copy <file> to <newname>\n");
            }
            return 1;
        }
    }

    /* append TEXT to FILE — grow an existing note */
    if (has(p, "append")) {
        int sl; const char *sep = find_to(p, &sl);
        if (sep) {
            char file[64]; const char *fp = sep + sl; while (*fp == ' ') fp++;
            int fk = 0; while (*fp && *fp != ' ' && fk < 63) file[fk++] = *fp++;
            while (fk > 0 && (file[fk-1]=='.'||file[fk-1]=='!'||file[fk-1]=='?'||file[fk-1]==',')) fk--;
            file[fk] = 0;
            const char *tp = p; while (*tp && *tp != ' ') tp++;   /* skip the verb */
            while (*tp == ' ') tp++;
            char text[128]; int tk = 0;
            for (const char *q = tp; q < sep && tk < 127; q++) text[tk++] = *q;
            text[tk] = 0;
            if (file[0] && text[0]) {
                if (!name_has_ext(file)) { const char *e = ".txt"; int j = 0;
                    while (e[j] && fk < 63) file[fk++] = e[j++]; file[fk] = 0; }
                int existed = (fs_find(file) != 0);
                if (!existed) fs_create(file, FS_FILE);
                if (existed) fs_append(file, (const uint8_t *)" ", 1);
                fs_append(file, (const uint8_t *)text, (uint32_t)tk);
                fs_sync();
                assist_begin_output();
                assist_say("appended to "); assist_say(file); assist_say(":\n  ");
                assist_say(text); assist_emit('\n');
                return 1;
            }
        }
    }

    if ((has(p, "make") || has(p, "create") || has(p, "new")) && has(p, "file")) {
        char name[64];
        if (!word_after(p, "called", name, sizeof(name)) &&
            !word_after(p, "named", name, sizeof(name)))
            last_word(p, name, sizeof(name));
        int dot = 0; for (int i = 0; name[i]; i++) if (name[i] == '.') dot = 1;
        if (!dot && name[0]) {
            int k = 0; while (name[k]) k++;
            const char *ext = ".txt"; int e = 0;
            while (ext[e] && k < (int)sizeof(name) - 1) name[k++] = ext[e++];
            name[k] = 0;
        }
        if (name[0]) { fs_create(name, FS_FILE); fs_sync(); }
        assist_begin_output();
        assist_say("made "); assist_say(name[0] ? name : "(no name)");
        assist_say("\nsay 'open the editor' to write in it.\n");
        return 1;
    }
    if (has(p, "delete") || has(p, "remove") || has(p, "rm ")) {
        char name[64]; last_word(p, name, sizeof(name));
        fs_node *n = resolve_file(name, sizeof(name));
        assist_begin_output();
        if (n && n->kind == FS_FILE) {
            fs_unlink(name); fs_sync();
            assist_say("deleted "); assist_say(name); assist_emit('\n');
        } else {
            assist_say("no file called "); assist_say(name); assist_emit('\n');
        }
        return 1;
    }
    if (has(p, "read") || has(p, "cat ") || has(p, "contents") ||
        (has(p, "show") && !has(p, "file")) ||
        ((has(p, "what") || has(p, "whats")) && has(p, "in "))) {
        char name[64]; last_word(p, name, sizeof(name));
        fs_node *n = resolve_file(name, sizeof(name));
        if (n && n->kind == FS_FILE) {
            assist_begin_output();
            assist_say("contents of "); assist_say(name); assist_say(":\n");
            for (uint32_t i = 0; i < n->size && i < 1024; i++) assist_emit((char)n->data[i]);
            assist_emit('\n');
            return 1;
        }
        /* no such file -> fall through (probably a chat request) */
    }
    if (has(p, "open") || has(p, "launch") || has(p, "start") ||
        has(p, "play") || has(p, "go to")) {
        if (has(p, "editor"))  { wm_open_editor(0); return 1; }
        if (has(p, "snake"))   { wm_open_app(3);    return 1; }
        if (has(p, "files"))   { wm_open_app(1);    return 1; }
        if (has(p, "terminal") || has(p, "shell")) { wm_close(); return 1; }
    }
    return 0;   /* -> GPT */
}

static void assist_run(void) {
    if (try_intent(as_prompt)) return;   /* did a real action, offline */
    assist_begin_output();               /* open-ended text -> on-device GPT */
    gpt_generate(as_prompt, 220, assist_emit);
}

static void assist_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    af_draw(cx, cy, "Astrion Assistant", AC_ACCENT, AF_SB16);
    af_draw(cx, cy + 24, "on-device - try:  write hi to notes.txt  /  read notes.txt  /  open snake  /  help  /  or just chat",
            AC_MUTED, AF_REG13);
    assist_prompt_line();
    assist_render_output();      /* redraw the last answer from its buffer */
}

static void assist_key(char c) {
    if (c == 27) { wm_close(); return; }
    if (c == '\n') {
        if (as_plen > 0) {
            assist_run();
            /* Reset the prompt for the next command — but only if the
             * Assistant still has focus (an "open X" command may have raised
             * another window, which also moves the cx/cy content rect). */
            struct window *f = focused();
            if (f && f->app == APP_ASSIST) {
                set_content_rect(f);
                as_plen = 0; as_prompt[0] = 0;
                assist_prompt_line();
            }
        }
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
        fb_rect_x(cx, by, (uint32_t)fw, MON_BAR_H, AC_ACCENT);
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

/* ─── Window chrome + lifecycle ─── */

static const char *title_for(enum app_kind a) {
    switch (a) {
        case APP_FILES:  return "Files";
        case APP_EDITOR: return ed_title;
        case APP_ASSIST: return "Assistant";
        case APP_MON:    return "System Monitor";
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
    draw_border(w->x, w->y, w->w, w->h, fg ? AC_ACCENT : AC_BORDER);
}

static void draw_content(struct window *w) {
    set_content_rect(w);
    switch (w->app) {
        case APP_EDITOR: editor_draw(); break;
        case APP_FILES:  files_draw();  break;
        case APP_ASSIST: assist_draw(); break;
        case APP_MON:    mon_draw();    break;
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
    desktop_repaint_chrome();
    console_redraw();
    struct window *f = focused();
    desktop_set_active_app(f ? icon_of(f->app) : 0);
    mouse_lift();
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
        if (!w->savebuf) w->savebuf = (uint32_t *)kmalloc(w->sw * w->sh * 4);
        w->open = 1;
        if (app == APP_ASSIST) assist_reset();
        if (app == APP_FILES)  files_load();
        if (app == APP_MON)    mon_last_ms = pit_elapsed_ms();
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
            desktop_set_active_app(0);
            if (zn) repaint_all();          /* redraw titles/borders as unfocused */
            break;
        case 1: open_common(APP_FILES);  break;
        case 2: wm_open_editor(0);       break;
        case 3: run_snake();             break;
        case 4: open_common(APP_ASSIST); break;
        case 5: open_common(APP_MON);    break;
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
        wins[i].open = 0; wins[i].app = APP_NONE; wins[i].savebuf = 0;
    }
    zn = 0; focus_shell = 1;
    dragging = 0; ed_buf = 0;
    mon_last_ms = 0;
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
    set_content_rect(f);            /* app draw fns work off cx/cy/cw/ch */
    switch (f->app) {
        case APP_EDITOR: editor_key(c); return 1;
        case APP_FILES:  files_key(c);  return 1;
        case APP_ASSIST: assist_key(c); return 1;
        case APP_MON:    mon_key(c);    return 1;
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
            }
            return;
        }
        /* clicked the desktop / terminal → give the keyboard to the shell */
        if (!focus_shell) {
            focus_shell = 1;
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
