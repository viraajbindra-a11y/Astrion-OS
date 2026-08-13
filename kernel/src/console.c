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
#include "serial.h"     /* every console byte is mirrored to COM1 — see below */

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
static uint32_t GW = 10, GH = 22, LINE_STRIDE = 24;   /* real values set at init */

/* From kernel_mb2.c (exported _x wrappers). */
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);
extern uint32_t fb_puts_x(uint32_t x, uint32_t y, const char *s, uint32_t color, int scale);
extern uint32_t fb_put_hex64_x(uint32_t x, uint32_t y, uint64_t v, uint32_t color, int scale);
extern uint32_t fb_put_u32_x(uint32_t x, uint32_t y, uint32_t v, uint32_t color, int scale);
extern uint32_t fb_width_x(void);
extern uint32_t fb_height_x(void);
extern int      fb_present_x(void);

/* From kernel_mb2.c - needed for direct fb-memmove during scroll. */
/* Base + stride together or not at all — the single validated way to reach
 * framebuffer memory. Returns 0 unless the mode is one we can drive; see
 * fb_validate() in kernel_mb2.c for the out-of-bounds bug that motivated it. */
extern volatile uint32_t *fb_pixels_x(uint32_t *stride_px);

static uint32_t x0, y0, w_px, h_px;
static uint32_t cx, cy;
static uint32_t color = COL_FG_DEFLT;

/* ─── attached ───
 * 0 while the Terminal window is closed: the grid below still records every
 * character, the cursor still advances and lines still scroll, but not one
 * pixel is written. Reopening the window calls console_attach(), which
 * re-anchors and repaints the whole store — so closing the Terminal loses
 * nothing and the shell never has to know it happened.
 *
 * Every function in this file that writes pixels checks this. That is the
 * complete contract: writers call console_puts() the same way in both states. */
static int attached = 1;

/* Installed by the window manager — see console.h. Null means "nothing is ever
 * on top of us", which is the right answer before wm_init runs. */
static console_occlusion_fn g_occluded;

void console_set_occlusion_test(console_occlusion_fn fn) { g_occluded = fn; }

/* 1 if we must not paint into this rectangle because a window covers it. */
static int hidden(uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
    return g_occluded && g_occluded(x, y, w, h);
}

/* Set when a write could not put its pixels down and the region now disagrees
 * with the backing store. console_service() on task 0 repairs it. */
static int g_stale;

/* ─── Cursor damage ───
 * The mouse cursor caches the pixels under itself and paints them back when it
 * moves. Everything below that writes pixels has to say so, or the cursor keeps
 * a snapshot from before the write and stamps it back over the text later —
 * that is how three `help`s under an untouched pointer ended with a block of
 * boot-era background sitting on the console, eating a letter.
 *
 * Deliberately NOT mouse_lift(): a lift does ~800 framebuffer writes, and every
 * caller below is inside the writer lock with interrupts masked. This is a
 * rectangle test that lifts the sprite ONLY if the damage actually touches it,
 * so a cursor parked elsewhere costs one compare. Safe with interrupts off: it
 * takes no lock and cannot wait.
 *
 * ANNOUNCE BEFORE YOU PAINT — every call below comes before its write, never
 * after. There is no repair step any more: mouse_invalidate_rect() lifts
 * eagerly using a cache that is still true, and mouse_redraw_if_dirty() on
 * task 0 puts the cursor back on whatever we left, capturing a fresh
 * background. (This comment used to say "the actual repair happens on task 0";
 * that path was deleted when the lift became eager, precisely because a
 * deferred repair cannot work for a painter that MOVES pixels — see the
 * "WHY NOT REPAIR AFTERWARDS" note in mouse.h.) */
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
/* CONSOLE_HOST_TEST: the render harness runs this file as an ordinary user
 * process to exercise attach/detach/scroll against real pixels, and `cli` is a
 * privileged instruction that faults there. The harness is single-threaded
 * with no interrupts to mask, so the lock is genuinely a no-op for it — same
 * arrangement DESKTOP_HOST_TEST already makes for the power calls. It changes
 * nothing in the kernel build. */
#ifdef CONSOLE_HOST_TEST
static inline uint64_t irq_save(void)          { return 0; }
static inline void     irq_restore(uint64_t f) { (void)f; }
#else
static inline uint64_t irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void irq_restore(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}
#endif

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

/* Highest row index that has ever held ink. A repaint only has to walk this
 * far, which matters now that the Terminal is a window you can drag: every
 * drag step repaints the console, and scanning all 48x160 cells when the shell
 * has printed six lines is 7,600 pointless compares per mouse move. */
static uint32_t g_maxrow;

static void grid_clear(void) {
    for (uint32_t r = 0; r < CON_MAX_ROWS; r++)
        for (uint32_t c = 0; c < CON_MAX_COLS; c++) g_ch[r][c] = 0;
    g_maxrow = 0;
}
/* Record c at the current cursor cell (call before cx advances). */
static void grid_put(char c) {
    if (!GW || !LINE_STRIDE) return;
    uint32_t col = (cx - x0) / GW, row = (cy - y0) / LINE_STRIDE;
    if (row < CON_MAX_ROWS && col < CON_MAX_COLS) {
        g_ch[row][col] = c; g_fg[row][col] = color;
        if (row > g_maxrow) g_maxrow = row;
    }
}
static void grid_scroll(void) {
    for (uint32_t r = 0; r + 1 < CON_MAX_ROWS; r++)
        for (uint32_t c = 0; c < CON_MAX_COLS; c++) {
            g_ch[r][c] = g_ch[r + 1][c]; g_fg[r][c] = g_fg[r + 1][c];
        }
    for (uint32_t c = 0; c < CON_MAX_COLS; c++) g_ch[CON_MAX_ROWS - 1][c] = 0;
    if (g_maxrow) g_maxrow--;
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
    if (!fb_present_x() || !w_px || !attached) return;
    damage(x0, y0, w_px, h_px);
    /* One occlusion test for the whole region decides which path to take. When
     * nothing covers us — the common case, and always true while the Terminal
     * is the focused window — the background goes down as ONE fill and the
     * per-cell test is skipped entirely. Only a genuinely overlapped console
     * pays for cell-by-cell clipping. */
    int occ = hidden(x0, y0, w_px, h_px);
    if (!occ) fb_rect_x(x0, y0, w_px, h_px, COL_BG);
    g_stale = 0;

    if (!GW || !LINE_STRIDE) return;
    uint32_t rows = (h_px >= GH) ? (h_px - GH) / LINE_STRIDE + 1 : 0;
    uint32_t cols = w_px / GW;
    if (rows > CON_MAX_ROWS) rows = CON_MAX_ROWS;
    if (cols > CON_MAX_COLS) cols = CON_MAX_COLS;

    for (uint32_t r = 0; r < rows; r++) {
        /* On the fast path the single fill above already cleared every row, so
         * there is nothing to do past the last row that holds ink. On the
         * occluded path each cell carries its own background, so we have to
         * walk the whole region to clear it. */
        if (!occ && r > g_maxrow) break;
        for (uint32_t c = 0; c < cols; c++) {
            uint32_t px = x0 + c * GW, py = y0 + r * LINE_STRIDE;
            char ch = g_ch[r][c];
            if (occ) {
                uint32_t fh = LINE_STRIDE;
                if (py + fh > y0 + h_px) fh = y0 + h_px - py;
                if (hidden(px, py, GW, fh)) continue;   /* a window owns it */
                fb_rect_x(px, py, GW, fh, COL_BG);
            }
            if (!ch) continue;
            if (px + GW > x0 + w_px || py + GH > y0 + h_px) continue;
            char s[2] = { ch, 0 };
            af_draw(px, py, s, g_fg[r][c], AF_MONO);
        }
    }
}

/* Repaint if a write had to skip its pixels.
 *
 * Called from the main loop on task 0, where a full repaint is legal. It exists
 * for one case that clipping alone cannot fix: scrolling while a window covers
 * part of the console. Scroll is a pixel MOVE, so a clipped scroll would drag
 * the covering window's pixels down into the visible rows — there is no
 * per-cell version of it that is correct. The scroll therefore does its grid
 * work, skips the blit, and leaves this flag; the next pass through the main
 * loop redraws the visible part from the backing store, about 10ms later.
 *
 * MUST NOT be called with the writer lock held: console_redraw() is thousands
 * of blended glyphs and interrupts must be on. */
void console_service(void) {
    /* Before the guard, deliberately. The serial log has to keep flowing when
     * nothing is stale (the common case) and when the Terminal window is shut
     * (detached — the console still records, so the transcript still matters). */
    console_serial_drain();
    if (!g_stale || !attached || !fb_present_x()) return;
    console_redraw();          /* clears g_stale */
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
    if (!fb_present_x() || !w_px || !h_px || !attached) return;
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

/* Scroll the region up one line.
 *
 * The GRID scroll and the cursor step happen in both states; only the pixel
 * move is conditional. That ordering is the whole point of the detached mode:
 * a shell printing into a closed Terminal must scroll its scrollback exactly
 * as it would on screen, or reopening the window would show text that never
 * lined up with what the shell thinks it wrote. */
static void scroll_one_line(void) {
    uint32_t pitch_px = 0;
    /* NB: no early return if fb is null — the grid scroll and cursor step at
     * the bottom of this function must happen whether or not we can paint.
     * Returning here would leave the shell's idea of the cursor a line below
     * where its text actually is, permanently. */
    volatile uint32_t *fb = attached ? fb_pixels_x(&pitch_px) : 0;
    /* A scroll is a pixel MOVE, not an overwrite, so it cannot be clipped:
     * copying rows up under a window that covers part of us would drag that
     * window's pixels into the console. Skip the blit and let task 0 repaint
     * the visible part from the backing store instead. */
    if (fb && hidden(x0, y0, w_px, h_px)) { g_stale = 1; fb = 0; }
    if (fb) {
        /* The whole region moves, including whatever the cursor is sitting on.
         * MUST come before the move, not after — this is a painter that copies
         * pixels rather than overwriting them, so a cursor still on the
         * framebuffer gets duplicated into the destination and nothing has a
         * record of the copy. See the "WHY NOT REPAIR AFTERWARDS" note in
         * mouse.h; that is the bug this ordering exists for. */
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
    }
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
    attached = 1;
    /* Don't clear here - caller may want the boot screen painted above
     * the console region. */
}

/* ─── Attach / detach (see console.h) ─── */

void console_detach(void) {
    uint64_t f = irq_save();
    attached = 0;
    irq_restore(f);
}

int console_is_attached(void) { return attached; }

void console_attach(uint32_t x, uint32_t y, uint32_t w, uint32_t h) {
    uint64_t f = irq_save();
    /* Carry the LOGICAL cursor across, not the pixel one. The window may have
     * been dragged anywhere between detach and attach, so the only thing that
     * survives a move is which row and column we were on. */
    uint32_t col = (GW && w_px) ? (cx - x0) / GW : 0;
    uint32_t row = (LINE_STRIDE && h_px) ? (cy - y0) / LINE_STRIDE : 0;

    x0 = x; y0 = y; w_px = w; h_px = h;

    /* A shorter region than we left can put the cursor past the bottom. Scroll
     * the GRID (never the pixels — there is nothing on screen yet, and the
     * region we are about to paint is not ours until the caller has drawn the
     * window body) until the cursor's row fits. */
    uint32_t rows = (LINE_STRIDE && h_px >= GH) ? (h_px - GH) / LINE_STRIDE + 1 : 1;
    while (row + 1 > rows) { grid_scroll(); row--; }

    cx = x0 + col * GW;
    cy = y0 + row * LINE_STRIDE;
    attached = 1;
    irq_restore(f);

    /* Outside the lock on purpose: a full repaint is thousands of blended
     * glyphs and holding interrupts off across it would eat timer ticks and
     * keystrokes. console_redraw() is a pure reader — the same reasoning it
     * already documents for itself. */
    console_redraw();
}

void console_clear(void) {
    uint64_t f = irq_save();
    grid_clear();
    cx = x0;
    cy = y0;
    int paint = attached;
    irq_restore(f);
    /* Painted OUTSIDE the lock, and by console_redraw() rather than one big
     * fill, so a window sitting over the console does not get erased by a
     * clear. With an empty grid this is just the (possibly clipped) background,
     * so it stays cheap. */
    if (paint) console_redraw();
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
    if (attached && !hidden(cx, cy, GW, GH)) {
        damage(cx, cy, GW, GH);
        fb_rect_x(cx, cy, GW, GH, COL_BG);
    }
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

/* ─── COM1 mirror ───
 *
 * Everything the console shows also goes out the serial port, so a headless
 * boot has a readable transcript: real hardware bring-up with no working
 * display, and the QEMU test scripts in tools/, which can then assert on the
 * shell's actual words instead of counting changed pixels.
 *
 * The problem is timing. putchar_nolock runs with interrupts OFF (every public
 * entry point wraps it in irq_save), and serial_putc SPINS until the UART is
 * ready — ~260us per byte at 38400 baud. Writing straight through would hold
 * interrupts off for ~20ms on a single 80-column line, which starves the
 * scheduler, stalls the PIT, and drops mouse packets. The fix is not to make
 * serial faster; it is to not do it here.
 *
 * So the locked path stores ONE byte into a ring and returns. console_service()
 * drains the ring on task 0 with interrupts on, where a slow UART costs only
 * some of task 0's slice and nothing else.
 *
 * Boot is the exception: there is no scheduler yet and nothing to starve, and
 * panic output must reach the wire before the machine stops, so writes go
 * straight through until kernel_mb2.c flips console_serial_async(1) just before
 * entering the main loop. Boot is also the burstiest phase, so this is what
 * keeps the early log complete instead of overflowing a ring nobody is draining.
 *
 * Single-producer/single-consumer: every producer holds the irq lock so they
 * serialise against each other, producers only ever advance head, and the sole
 * consumer only ever advances tail. */
#define SER_RING 4096
static volatile char     ser_ring[SER_RING];
static volatile uint32_t ser_head, ser_tail;
static volatile uint32_t ser_dropped;     /* bytes lost to a full ring */
static volatile int      ser_async;       /* 0 = write through, 1 = buffer */

void console_serial_async(int on) { ser_async = on ? 1 : 0; }

static void ser_emit(char c);

/* For keystrokes the console never sees. The main loop hands a key to the
 * window manager first, and an open app (Editor, Assistant, Snake) draws it
 * itself without going anywhere near console.c — so those keys would vanish
 * from the serial log entirely, and "what did they type before it died" is
 * exactly what you want a headless log for.
 *
 * It goes through the same ring rather than straight to the UART on purpose.
 * A direct write would jump ahead of everything still queued and interleave
 * the log out of order, which is worse than the gap it fixes. */
void console_serial_echo(char c) { ser_emit(c); }

static void ser_emit(char c) {
    if (!ser_async) {                     /* boot / panic: straight to the wire */
        if (c == '\n') serial_putc('\r');
        serial_putc(c);
        return;
    }
    uint32_t next = (ser_head + 1) % SER_RING;
    if (next == ser_tail) { ser_dropped++; return; }   /* full: drop, count it */
    ser_ring[ser_head] = c;
    ser_head = next;
}

/* Drain on task 0, interrupts ON. Bounded per call so one enormous burst of
 * output cannot turn a main-loop pass into a multi-second stall — the rest
 * goes out on the next pass, a few milliseconds later. */
void console_serial_drain(void) {
    for (int budget = 0; budget < 256 && ser_tail != ser_head; budget++) {
        char c = ser_ring[ser_tail];
        ser_tail = (ser_tail + 1) % SER_RING;
        if (c == '\n') serial_putc('\r');
        serial_putc(c);
    }
    /* A gap in the log must announce itself. Silently missing bytes is worse
     * than no log at all: it reads as "the kernel printed exactly this". */
    if (ser_dropped && ser_tail == ser_head) {
        uint32_t n = ser_dropped;
        ser_dropped = 0;
        serial_puts("\n[serial: dropped ");
        char buf[12]; int i = 0;
        if (!n) buf[i++] = '0';
        while (n) { buf[i++] = (char)('0' + n % 10); n /= 10; }
        while (i) serial_putc(buf[--i]);
        serial_puts(" bytes — ring full]\n");
    }
}

static void putchar_nolock(char c) {
    /* Output redirect: append to capture buffer + skip pixel writes.
     * Deliberately BEFORE the serial mirror: captured output is going to a
     * file, not to the console, and the mirror's contract is "what the console
     * showed". Echoing redirected text would make `cmd > file` look like it
     * printed to the screen. */
    if (cap_buf) {
        if (cap_len_out && *cap_len_out + 1 < cap_cap) {
            cap_buf[(*cap_len_out)++] = (uint8_t)c;
            cap_buf[*cap_len_out] = 0;
        }
        return;
    }

    ser_emit(c);

    if (c == '\n') { newline_nolock(); return; }
    if (c == '\b') { backspace_nolock(); return; }
    if (c == '\r') { cx = x0; return; }
    if (c == '\t') {
        /* Tab to next multiple of 4 chars. */
        do {
            if (attached && !hidden(cx, cy, GW, GH)) {
                char buf[2] = {' ', 0};
                damage(cx, cy, GW, GH);
                af_draw(cx, cy, buf, color, AF_MONO);
            }
            grid_put(' ');
            cx += GW;
            if (cx + GW > x0 + w_px) newline_nolock();
        } while (((cx - x0) / GW) % 4);
        return;
    }
    if (c < 32 || c > 126) c = '?';

    /* Wrap before drawing if needed. */
    if (cx + GW > x0 + w_px) newline_nolock();

    /* The occlusion test is what stops the shell's next prompt painting
     * straight across the Files window's border. The grid_put below happens
     * either way, so raising the Terminal brings back everything that was
     * skipped. */
    if (attached && !hidden(cx, cy, GW, GH)) {
        char buf[2] = {c, 0};
        damage(cx, cy, GW, GH);
        af_draw(cx, cy, buf, color, AF_MONO);
    }
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

/* Two digits, no "0x". A MAC address is written as six of these joined by
 * colons, and every other width turns 52:54:00:12:34:56 into something a
 * person cannot compare against what their router is showing them. */
void console_put_hex8(uint8_t v) {
    static const char hex[] = "0123456789abcdef";
    uint64_t f = irq_save();
    putchar_nolock(hex[(v >> 4) & 0xF]);
    putchar_nolock(hex[v & 0xF]);
    irq_restore(f);
}

/* Four digits, no "0x". For 16-bit identifiers that are conventionally written
 * bare and in pairs — a PCI vendor:device is "8086:100e", and rendering it
 * through put_hex64 gives "0x0000000000008086:0x000000000000100e", which is
 * the same information with the four meaningful digits hidden in it. */
void console_put_hex16(uint16_t v) {
    static const char hex[] = "0123456789abcdef";
    uint64_t f = irq_save();
    for (int i = 3; i >= 0; i--) {
        putchar_nolock(hex[(v >> (i * 4)) & 0xF]);
    }
    irq_restore(f);
}
