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

#define COL_BG       0x1E2761u   /* same navy as the boot screen */
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

/* Repaint the whole console region from the backing store. */
void console_redraw(void) {
    if (!fb_present_x() || !w_px) return;
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

/* Capture (for '>' redirection). When buf is non-NULL, putchar
 * appends there instead of drawing pixels. */
static uint8_t  *cap_buf;
static uint32_t  cap_cap;
static uint32_t *cap_len_out;

static void scroll_one_line(void) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;

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
    fb_rect_x(x0, y0, w_px, h_px, COL_BG);
    grid_clear();
    cx = x0;
    cy = y0;
}

void console_set_color(uint32_t c) { color = c; }
uint32_t console_color(void)       { return color; }

void console_newline(void) {
    cx = x0;
    cy += LINE_STRIDE;
    while (cy + GH > y0 + h_px) scroll_one_line();
}

void console_backspace(void) {
    if (cx <= x0) return;
    cx -= GW;
    fb_rect_x(cx, cy, GW, GH, COL_BG);
    grid_clear_cell();
}

void console_set_capture(uint8_t *buf, uint32_t cap, uint32_t *len_out) {
    cap_buf = buf;
    cap_cap = cap;
    cap_len_out = len_out;
    if (cap_len_out) *cap_len_out = 0;
}

void console_clear_capture(void) {
    cap_buf = 0; cap_cap = 0; cap_len_out = 0;
}

int console_capture_active(void) { return cap_buf != 0; }

void console_putchar(char c) {
    /* Output redirect: append to capture buffer + skip pixel writes. */
    if (cap_buf) {
        if (cap_len_out && *cap_len_out + 1 < cap_cap) {
            cap_buf[(*cap_len_out)++] = (uint8_t)c;
            cap_buf[*cap_len_out] = 0;
        }
        return;
    }

    if (c == '\n') { console_newline(); return; }
    if (c == '\b') { console_backspace(); return; }
    if (c == '\r') { cx = x0; return; }
    if (c == '\t') {
        /* Tab to next multiple of 4 chars. */
        do {
            char buf[2] = {' ', 0};
            af_draw(cx, cy, buf, color, AF_MONO);
            grid_put(' ');
            cx += GW;
            if (cx + GW > x0 + w_px) console_newline();
        } while (((cx - x0) / GW) % 4);
        return;
    }
    if (c < 32 || c > 126) c = '?';

    /* Wrap before drawing if needed. */
    if (cx + GW > x0 + w_px) console_newline();

    char buf[2] = {c, 0};
    af_draw(cx, cy, buf, color, AF_MONO);
    grid_put(c);
    cx += GW;
}

void console_puts(const char *s) {
    while (*s) console_putchar(*s++);
}

void console_put_u32(uint32_t v) {
    char buf[11]; int i = 0;
    if (v == 0) buf[i++] = '0';
    else { while (v) { buf[i++] = '0' + (v % 10); v /= 10; } }
    while (i > 0) console_putchar(buf[--i]);
}

void console_put_u64(uint64_t v) {
    char buf[21]; int i = 0;
    if (v == 0) buf[i++] = '0';
    else { while (v) { buf[i++] = '0' + (v % 10); v /= 10; } }
    while (i > 0) console_putchar(buf[--i]);
}

void console_put_hex64(uint64_t v) {
    static const char hex[] = "0123456789abcdef";
    console_putchar('0'); console_putchar('x');
    for (int i = 15; i >= 0; i--) {
        console_putchar(hex[(v >> (i * 4)) & 0xF]);
    }
}
