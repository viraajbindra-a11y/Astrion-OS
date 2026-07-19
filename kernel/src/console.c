/*
 * Astrion v2.0 - Scrolling framebuffer console
 *
 * Backed by the kernel_mb2.c framebuffer wrappers (fb_putchar_x,
 * fb_rect_x, etc.) so we don't duplicate pixel-poke code. The
 * "console region" is a rectangle anchored at (x0,y0) with width
 * w_px and height h_px in pixels.
 *
 * Scrolling: when a newline would push the cursor past h_px,
 * memmove the existing pixels up by FONT_HEIGHT*scale + 2 rows,
 * and fill the freed bottom strip with the background color. We
 * walk the framebuffer row-by-row so this works regardless of
 * pitch != width*4.
 */

#include <stdint.h>
#include "console.h"
#include "fb_font.h"
#include "af.h"
#include "mouse.h"      /* damage(): tell the cursor its cached pixels changed */

/* MUST match AC_TERM_BG in desktop.h — the console draws INSIDE the terminal
 * window body that desktop.c/wm.c fill with AC_TERM_BG, so if these two
 * disagree the same surface has two colors and whoever paints last wins.
 * That was a real bug: the comment here used to read "same navy as the boot
 * screen" and held 0x1E2761 from before desktop.h moved to 0x171B2E, so the
 * Terminal permanently kept its inactive background the moment any window
 * overlapped it — including the mandatory Esc before the ring-3 demo beat,
 * which put the red kill line on the wrong background (4.90:1 instead of the
 * intended 6.04:1). Change both or neither. */
#define COL_BG       0x171B2Eu   /* == AC_TERM_BG (desktop.h) */
#define COL_FG_DEFLT 0xFFFFFFu   /* white */

/* Terminal cell geometry — seeded from the antialiased mono face (JetBrains
 * Mono) in console_init(). Kept as variables (not macros) with the SAME names
 * the cursor/scroll/wrap/tab code below already uses, so that logic is
 * unchanged: it still works one glyph cell at a time. */
static uint32_t GW = 12, GH = 27, LINE_STRIDE = 29;   /* real values set at init */

/* From kernel_mb2.c (exported _x wrappers). */
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);
extern uint32_t fb_put_hex64_x(uint32_t x, uint32_t y, uint64_t v, uint32_t color, int scale);
extern uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern int      fb_present_x(void);

/* From kernel_mb2.c - needed for direct fb-memmove during scroll. */
extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);

static uint32_t x0, y0, w_px, h_px;
static uint32_t cx, cy;
static uint32_t color = COL_FG_DEFLT;

/* ─── Cursor damage ───
 * The mouse cursor caches the pixels under itself and paints them back when it
 * moves. Everything below that writes pixels has to say so, or the cursor keeps
 * a snapshot from before the write and stamps it back over the text later —
 * that is how three `help`s under an untouched pointer ended with a block of
 * boot-era background sitting on the console, eating a letter.
 *
 * Deliberately NOT mouse_lift(): a lift does ~800 framebuffer writes, and every
 * caller below is inside the writer lock with interrupts masked. This is a
 * rectangle test and a flag write — nothing to wait on, no pixel traffic, safe
 * with interrupts off, and it costs a still cursor parked elsewhere one
 * compare. The actual repair happens on task 0 (see mouse.h). */
static void damage(uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
    mouse_invalidate_rect((int)x, (int)y, (int)w, (int)h);
}

/* ─── Writer lock ───
 * The console has more than one writer: the shell (task context), a ring-3
 * program printing through SYS_PUTS, and the ring-3 fault handler in idt.c.
 * On a single CPU the ONLY way two of them interleave is an interrupt — the
 * timer preempting a task part-way through a print — so masking interrupts IS
 * the lock. Same idiom heap.c uses for the free list and rtc.c uses for CMOS.
 *
 * What it protects, as ONE unit: the cursor (cx, cy), the backing store, and
 * the scroll's pixel move. That last one is the bug this exists for.
 * scroll_one_line() copies the whole console region up by one row; get
 * preempted inside that copy, let another writer draw a glyph into the region,
 * and the rest of the copy reads source rows that have already changed. That
 * is how `exec hello.elf` occasionally duplicated one row and dropped another
 * while the shell prompt came back underneath it.
 *
 * Save/restore, never bare cli/sti, so it NESTS: the ring-3 fault handler can
 * print while interrupts are already off and it puts back exactly what it
 * found. And because nothing here ever WAITS on the lock — there is no lock
 * word, only the interrupt flag — there is nothing to deadlock on. That is the
 * whole reason to mask interrupts instead of spinning on a flag: a fault
 * arriving mid-print can't wedge on state the faulting task was holding. */
static inline uint64_t irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void irq_restore(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}

uint64_t console_lock(void)          { return irq_save(); }
void     console_unlock(uint64_t f)  { irq_restore(f); }

/* ─── Backing store ───
 * Every drawn cell is also recorded here so the console can be repainted from
 * state (console_redraw). Needed as soon as windows can overlap the terminal:
 * pixels alone can't be recovered once something is drawn on top of them. */
#define CON_MAX_COLS 160
#define CON_MAX_ROWS 48
static char     g_ch[CON_MAX_ROWS][CON_MAX_COLS];
static uint32_t g_fg[CON_MAX_ROWS][CON_MAX_COLS];

static void grid_clear(void) {
    for (uint32_t r = 0; r < CON_MAX_ROWS; r++)
        for (uint32_t c = 0; c < CON_MAX_COLS; c++) g_ch[r][c] = 0;
}
/* Record c at the current cursor cell (call before cx advances). */
static void grid_put(char c) {
    if (!GW || !LINE_STRIDE) return;
    uint32_t col = (cx - x0) / GW, row = (cy - y0) / LINE_STRIDE;
    if (row < CON_MAX_ROWS && col < CON_MAX_COLS) { g_ch[row][col] = c; g_fg[row][col] = color; }
}
static void grid_scroll(void) {
    for (uint32_t r = 0; r + 1 < CON_MAX_ROWS; r++)
        for (uint32_t c = 0; c < CON_MAX_COLS; c++) {
            g_ch[r][c] = g_ch[r + 1][c]; g_fg[r][c] = g_fg[r + 1][c];
        }
    for (uint32_t c = 0; c < CON_MAX_COLS; c++) g_ch[CON_MAX_ROWS - 1][c] = 0;
}
static void grid_clear_cell(void) {
    if (!GW || !LINE_STRIDE) return;
    uint32_t col = (cx - x0) / GW, row = (cy - y0) / LINE_STRIDE;
    if (row < CON_MAX_ROWS && col < CON_MAX_COLS) g_ch[row][col] = 0;
}

/* Repaint the whole console region from the backing store.
 *
 * Deliberately NOT under the writer lock. This is a pure reader — it never
 * touches cx/cy or the grid — and a full repaint is thousands of blended
 * glyphs. Holding interrupts off across that would cost milliseconds and start
 * eating timer ticks and keystrokes, which is a worse bug than the one it would
 * fix. Worst case if a writer scrolls mid-repaint is one stale-looking frame,
 * and the very next write or window event paints over it. No state corruption. */
void console_redraw(void) {
    if (!fb_present_x() || !w_px) return;
    damage(x0, y0, w_px, h_px);
    fb_rect_x(x0, y0, w_px, h_px, COL_BG);
    for (uint32_t r = 0; r < CON_MAX_ROWS; r++)
        for (uint32_t c = 0; c < CON_MAX_COLS; c++) {
            char ch = g_ch[r][c];
            if (!ch) continue;
            uint32_t px = x0 + c * GW, py = y0 + r * LINE_STRIDE;
            if (px + GW > x0 + w_px || py + GH > y0 + h_px) continue;
            char s[2] = { ch, 0 };
            af_draw(px, py, s, g_fg[r][c], AF_MONO);
        }
}

/* Repaint just the cells that intersect (x,y,w,h) — the counterpart to
 * console_redraw() for one small patch.
 *
 * This exists for exactly one caller: the main loop, after it has lifted the
 * mouse cursor off a region the console painted underneath. The cursor can give
 * back the pixels it covered, but not the ink the console blended into them
 * while it sat there (af_draw blends onto whatever it finds, and putchar never
 * fills a cell background), so only the console can restore that patch exactly.
 * A cursor is ~3 columns by ~2 rows, so this is a handful of glyphs.
 *
 * Fill-then-draw per cell, the same order console_redraw() uses region-wide, so
 * a repaired cell is bit-identical to a fully repainted one and the blend never
 * accumulates. Clips to the console region and no-ops outside it, so passing a
 * rect that is really over the dock or a window costs nothing.
 *
 * MUST NOT call damage(): it is reached FROM the staleness repair, so arming the
 * flag here would re-arm the repair that called it, every single frame. Nothing
 * in here goes through putchar/puts, which is what keeps that true.
 *
 * Unlocked, for the same reason console_redraw() is: a pure reader of the grid,
 * and the worst a writer racing it can do is leave one cell looking a frame old. */
void console_repaint_rect(uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
    if (!fb_present_x() || !w_px || !h_px) return;
    if (!w || !h || !GW || !GH || !LINE_STRIDE) return;
    if (w_px < GW || h_px < GH) return;   /* region too small to hold a cell */

    uint32_t rgt = x0 + w_px, bot = y0 + h_px;   /* console's right/bottom edge */
    if (x >= rgt || y >= bot) return;            /* wholly right of / below us  */
    /* Clip to the region. Subtractive throughout (`w > rgt - x`, never
     * `x + w > rgt`) — w and h come from a caller measuring a sprite, so they
     * are not this file's to trust. */
    if (w > rgt - x) w = rgt - x;
    if (h > bot - y) h = bot - y;
    if (x < x0) { uint32_t d = x0 - x; if (d >= w) return; x += d; w -= d; }
    if (y < y0) { uint32_t d = y0 - y; if (d >= h) return; y += d; h -= d; }

    uint32_t c0 = (x - x0) / GW,          c1 = (x - x0 + w - 1) / GW;
    uint32_t r0 = (y - y0) / LINE_STRIDE, r1 = (y - y0 + h - 1) / LINE_STRIDE;
    if (r0 >= CON_MAX_ROWS || c0 >= CON_MAX_COLS) return;
    if (c1 >= CON_MAX_COLS) c1 = CON_MAX_COLS - 1;
    if (r1 >= CON_MAX_ROWS) r1 = CON_MAX_ROWS - 1;

    for (uint32_t r = r0; r <= r1; r++)
        for (uint32_t c = c0; c <= c1; c++) {
            uint32_t px = x0 + c * GW, py = y0 + r * LINE_STRIDE;
            if (px > rgt - GW || py > bot - GH) continue;   /* same guard as console_redraw */
            /* One cell slot is LINE_STRIDE tall (glyph box + its leading), so
             * filling that height repairs the row without touching its
             * neighbours. Clamp anyway: the last row's slot can overhang h_px. */
            uint32_t fh = LINE_STRIDE;
            if (fh > bot - py) fh = bot - py;
            fb_rect_x(px, py, GW, fh, COL_BG);
            char ch = g_ch[r][c];
            if (!ch) continue;
            char s[2] = { ch, 0 };
            af_draw(px, py, s, g_fg[r][c], AF_MONO);
        }
}

/* Capture (for '>' redirection). When buf is non-NULL, putchar
 * appends there instead of drawing pixels. */
static uint8_t  *cap_buf;
static uint32_t  cap_cap;
static uint32_t *cap_len_out;

static void scroll_one_line(void) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    /* The whole region moves, including whatever the cursor is sitting on. */
    damage(x0, y0, w_px, h_px);

    /* Move pixels in the console region up by LINE_STRIDE rows.
     * Source: y0 + LINE_STRIDE .. y0 + h_px. Dest: y0 .. y0 + h_px - LINE_STRIDE. */
    for (uint32_t y = 0; y + LINE_STRIDE < h_px; y++) {
        volatile uint32_t *dst = &fb[(y0 + y)              * pitch_px + x0];
        volatile uint32_t *src = &fb[(y0 + y + LINE_STRIDE)* pitch_px + x0];
        for (uint32_t x = 0; x < w_px; x++) dst[x] = src[x];
    }
    /* Clear the freed bottom strip. */
    fb_rect_x(x0, y0 + h_px - LINE_STRIDE, w_px, LINE_STRIDE, COL_BG);
    grid_scroll();
    cy -= LINE_STRIDE;
}

void console_init(uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
    /* Derive the cell from the mono face: advance = one column, line height =
     * one row. +2 px of leading keeps rows from touching. */
    GW = af_text_width("M", AF_MONO);
    GH = (uint32_t)af_line_height(AF_MONO);
    LINE_STRIDE = GH + 2;

    x0 = x; y0 = y; w_px = w; h_px = h;
    cx = x0; cy = y0;
    color = COL_FG_DEFLT;
    /* Don't clear here - caller may want the boot screen painted above
     * the console region. */
}

void console_clear(void) {
    uint64_t f = irq_save();
    damage(x0, y0, w_px, h_px);
    fb_rect_x(x0, y0, w_px, h_px, COL_BG);
    grid_clear();
    cx = x0;
    cy = y0;
    irq_restore(f);
}

void console_set_color(uint32_t c) { color = c; }
uint32_t console_color(void)       { return color; }

/* ─── Unlocked cores ───
 * These assume the writer lock is already held. Everything below calls THESE,
 * never the public wrappers, so the lock is taken exactly once at whichever
 * entry point the caller came in through. That is what keeps the scroll path
 * from re-entering a locked function on its way through newline. */
static void newline_nolock(void) {
    cx = x0;
    cy += LINE_STRIDE;
    while (cy + GH > y0 + h_px) scroll_one_line();
}

static void backspace_nolock(void) {
    if (cx <= x0) return;
    cx -= GW;
    damage(cx, cy, GW, GH);
    fb_rect_x(cx, cy, GW, GH, COL_BG);
    grid_clear_cell();
}

void console_newline(void) {
    uint64_t f = irq_save();
    newline_nolock();
    irq_restore(f);
}

void console_backspace(void) {
    uint64_t f = irq_save();
    backspace_nolock();
    irq_restore(f);
}

void console_set_capture(uint8_t *buf, uint32_t cap, uint32_t *len_out) {
    /* Locked: putchar reads all three of these together. Swapping them in
     * one at a time could hand a preempting writer a live buf with a stale
     * len pointer. */
    uint64_t f = irq_save();
    cap_buf = buf;
    cap_cap = cap;
    cap_len_out = len_out;
    if (cap_len_out) *cap_len_out = 0;
    irq_restore(f);
}

void console_clear_capture(void) {
    uint64_t f = irq_save();
    cap_buf = 0; cap_cap = 0; cap_len_out = 0;
    irq_restore(f);
}

int console_capture_active(void) { return cap_buf != 0; }

static void putchar_nolock(char c) {
    /* Output redirect: append to capture buffer + skip pixel writes. */
    if (cap_buf) {
        if (cap_len_out && *cap_len_out + 1 < cap_cap) {
            cap_buf[(*cap_len_out)++] = (uint8_t)c;
            cap_buf[*cap_len_out] = 0;
        }
        return;
    }

    if (c == '\n') { newline_nolock(); return; }
    if (c == '\b') { backspace_nolock(); return; }
    if (c == '\r') { cx = x0; return; }
    if (c == '\t') {
        /* Tab to next multiple of 4 chars. */
        do {
            char buf[2] = {' ', 0};
            damage(cx, cy, GW, GH);
            af_draw(cx, cy, buf, color, AF_MONO);
            grid_put(' ');
            cx += GW;
            if (cx + GW > x0 + w_px) newline_nolock();
        } while (((cx - x0) / GW) % 4);
        return;
    }
    if (c < 32 || c > 126) c = '?';

    /* Wrap before drawing if needed. */
    if (cx + GW > x0 + w_px) newline_nolock();

    char buf[2] = {c, 0};
    damage(cx, cy, GW, GH);
    af_draw(cx, cy, buf, color, AF_MONO);
    grid_put(c);
    cx += GW;
}

void console_putchar(char c) {
    uint64_t f = irq_save();
    putchar_nolock(c);
    irq_restore(f);
}

/* One lock for the WHOLE string, not one per character — a line printed in a
 * single puts() lands intact instead of being cut in half by whoever else is
 * writing. Callers are kernel code with bounded strings; the ring-3 path comes
 * in through console_putchar a byte at a time, so a user program can't hold
 * interrupts off for as long as it likes by printing something enormous. */
void console_puts(const char *s) {
    uint64_t f = irq_save();
    while (*s) putchar_nolock(*s++);
    irq_restore(f);
}

void console_put_u32(uint32_t v) {
    char buf[11]; int i = 0;
    if (v == 0) buf[i++] = '0';
    else { while (v) { buf[i++] = '0' + (v % 10); v /= 10; } }
    uint64_t f = irq_save();
    while (i > 0) putchar_nolock(buf[--i]);
    irq_restore(f);
}

void console_put_u64(uint64_t v) {
    char buf[21]; int i = 0;
    if (v == 0) buf[i++] = '0';
    else { while (v) { buf[i++] = '0' + (v % 10); v /= 10; } }
    uint64_t f = irq_save();
    while (i > 0) putchar_nolock(buf[--i]);
    irq_restore(f);
}

void console_put_hex64(uint64_t v) {
    static const char hex[] = "0123456789abcdef";
    uint64_t f = irq_save();
    putchar_nolock('0'); putchar_nolock('x');
    for (int i = 15; i >= 0; i--) {
        putchar_nolock(hex[(v >> (i * 4)) & 0xF]);
    }
    irq_restore(f);
}
