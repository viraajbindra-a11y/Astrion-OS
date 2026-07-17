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

enum app_kind { APP_NONE = 0, APP_FILES, APP_EDITOR, APP_ASSIST };

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
 * console needs a backing store (console_redraw). */
#define WM_MAX 3

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
                 case APP_ASSIST: return 2; default: return -1; }
}
static int icon_of(enum app_kind a) {   /* dock icon index */
    switch (a) { case APP_FILES: return 1; case APP_EDITOR: return 2;
                 case APP_ASSIST: return 4; default: return 0; }
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
static char     ed_name[64];
static char     ed_title[80];
static uint8_t *ed_buf;
static uint32_t ed_len, ed_cap, ed_cursor;

static void editor_open(const char *name) {
    if (ed_buf) { kfree(ed_buf); ed_buf = 0; }   /* reopening: don't leak */
    ed_cap = 8192;
    ed_buf = (uint8_t *)kmalloc(ed_cap);
    ed_len = 0; ed_cursor = 0;
    str_copy(ed_name, (name && name[0]) ? name : "untitled.txt", sizeof(ed_name));
    str_copy(ed_title, "Editor: ", sizeof(ed_title));
    /* append the name to the title */
    {
        int t = str_len(ed_title), i = 0;
        while (ed_name[i] && t < (int)sizeof(ed_title) - 1) ed_title[t++] = ed_name[i++];
        ed_title[t] = 0;
    }
    if (!ed_buf) return;
    fs_node *n = (name && name[0]) ? fs_find(name) : 0;
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

/* ─── Files state ─── */
#define FL_MAX 64
static char fl_names[FL_MAX][64];
static int  fl_count, fl_sel;

static void files_load(void) {
    fl_count = 0; fl_sel = 0;
    for (fs_node *n = fs_first(); n && fl_count < FL_MAX; n = fs_next(n)) {
        str_copy(fl_names[fl_count], n->name, 64);
        fl_count++;
    }
}
static void files_draw(void) {
    fb_rect_x(cx, cy, cw, ch, AC_TERM_BG);
    af_draw(cx, cy, "Files in /  (up/down, Enter opens, ESC closes)", AC_MUTED, AF_REG13);
    uint32_t top = cy + 24;
    for (int i = 0; i < fl_count; i++) {
        uint32_t ry = top + (uint32_t)i * 30;
        if (ry + 28 > cy + ch) break;
        if (i == fl_sel) fb_rect_x(cx, ry, cw, 28, AC_PANEL);
        af_draw(cx + 8, ry + 3, fl_names[i], (i == fl_sel) ? AC_WHITE : AC_MUTED, AF_MONO);
    }
}
static void files_key(char c) {
    if (c == 27) { wm_close(); return; }
    if (c == (char)KEY_UP)   { if (fl_sel > 0)             fl_sel--; files_draw(); return; }
    if (c == (char)KEY_DOWN) { if (fl_sel < fl_count - 1)  fl_sel++; files_draw(); return; }
    if (c == '\n' && fl_count > 0) {
        char nm[64]; str_copy(nm, fl_names[fl_sel], sizeof(nm));
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

    /* uptime */
    if (has(p, "uptime") || (has(p, "how long") && has(p, "been")) ||
        (has(p, "what") && has(p, "time"))) {
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
        for (fs_node *n = fs_first(); n; n = fs_next(n)) {
            assist_say("  "); assist_say(n->name);
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

/* ─── Window chrome + lifecycle ─── */

static const char *title_for(enum app_kind a) {
    switch (a) {
        case APP_FILES:  return "Files";
        case APP_EDITOR: return ed_title;
        case APP_ASSIST: return "Assistant";
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

static void open_common(enum app_kind app) {
    int s = slot_of(app);
    if (s < 0) return;
    struct window *w = &wins[s];
    SW = fb_width_x(); SH = fb_height_x();
    if (!w->open) {
        w->app = app;
        w->w = APP_W; w->h = APP_H;
        /* cascade so a second window doesn't land exactly on the first */
        w->x = (SW - APP_W) / 2 + (uint32_t)(s * 26);
        w->y = WM_TOP + 4 + (uint32_t)(s * 22);
        w->sw = w->w + 6; w->sh = w->h + 6;          /* include shadow */
        if (!w->savebuf) w->savebuf = (uint32_t *)kmalloc(w->sw * w->sh * 4);
        w->open = 1;
        if (app == APP_ASSIST) assist_reset();
        if (app == APP_FILES)  files_load();
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
}

int wm_active(void) { return focused() != 0; }

int wm_handle_key(char c) {
    struct window *f = focused();
    if (!f) return 0;               /* nothing focused → the shell gets it */
    set_content_rect(f);            /* app draw fns work off cx/cy/cw/ch */
    switch (f->app) {
        case APP_EDITOR: editor_key(c); return 1;
        case APP_FILES:  files_key(c);  return 1;
        case APP_ASSIST: assist_key(c); return 1;
        default: return 0;
    }
}

void wm_tick(void) {
    int mx = mouse_x(), my = mouse_y();
    int down = mouse_left_down();
    int click = mouse_take_left_click();

    if (click) {
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
    }
}
