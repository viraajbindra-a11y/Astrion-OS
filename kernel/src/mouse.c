/*
 * Astrion v2.0 - PS/2 mouse driver
 *
 * Setup sequence (standard 8042 + PS/2 aux):
 *   1. Send 0xA8 to 0x64 - enable aux device.
 *   2. Read controller config (0x20 cmd to 0x64, read at 0x60).
 *      Set bit 1 (enable IRQ12), clear bit 5 (enable aux clock).
 *      Write back via 0x60 cmd to 0x64.
 *   3. To talk to mouse: send 0xD4 to 0x64 (next byte to 0x60 goes
 *      to the mouse), then send the actual mouse command to 0x60.
 *   4. Reset (0xFF) + set sample rate to 80 Hz (0xF3 80) + enable
 *      data reporting (0xF4). Each mouse command should ACK with
 *      0xFA on the data port.
 *
 * After setup, IRQ12 fires whenever the mouse moves or a button
 * changes. Each event is 3 bytes:
 *   byte 0: y_overflow | x_overflow | y_sign | x_sign | 1 | mid | right | left
 *   byte 1: signed x-delta low 8 bits (sign extended via byte0)
 *   byte 2: signed y-delta low 8 bits (sign extended via byte0)
 *
 * IRQ12 is the slave PIC (IRQ8..15). Need to send EOI to both
 * master + slave; the kernel's irq_handler already does that.
 */

#include <stdint.h>
#include "mouse.h"
#include "idt.h"

#define PS2_DATA   0x60
#define PS2_STATUS 0x64
#define PS2_CMD    0x64

#define COL_NAVY    0x1E2761u
#define COL_WHITE   0xFFFFFFu
#define COL_BLACK   0x000000u
#define COL_ORANGE  0xFF7A00u
#define COL_ACCENT  0x0A84FFu   /* systemBlue - matches the polished chrome */

/* Forward decls from kernel_mb2.c. */
extern uint64_t fb_addr_x(void);
extern uint32_t fb_pitch_x(void);
extern int      fb_present_x(void);
extern void     fb_rect_x(uint32_t x, uint32_t y, uint32_t w, uint32_t h, uint32_t color);

static inline void outb_(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}
static inline uint8_t inb_(uint16_t port) {
    uint8_t v; __asm__ volatile("inb %1, %0" : "=a"(v) : "Nd"(port)); return v;
}

/* Wait until input/output buffer is ready. */
static void ps2_wait_input(void) {
    /* Bit 1 of status = "input full" - wait for it to clear before
     * we can send another command. */
    for (int i = 0; i < 100000; i++) {
        if ((inb_(PS2_STATUS) & 0x02) == 0) return;
    }
}
static int ps2_wait_output(void) {
    /* Bit 0 of status = "output full" - wait for it to set before
     * reading. Bit 5 distinguishes mouse data from keyboard. */
    for (int i = 0; i < 100000; i++) {
        uint8_t s = inb_(PS2_STATUS);
        if (s & 0x01) return 1;
    }
    return 0;
}

static void mouse_write(uint8_t b) {
    ps2_wait_input();
    outb_(PS2_CMD, 0xD4);
    ps2_wait_input();
    outb_(PS2_DATA, b);
}

static uint8_t mouse_read(void) {
    if (!ps2_wait_output()) return 0;
    return inb_(PS2_DATA);
}

/* ─── State ─────────────────────────────────────────────── */

#define CUR_W 11
#define CUR_H 18

/* Arrow sprite: 0 = transparent, 1 = white interior, 2 = black border. */
static const uint8_t CURSOR_BMP[CUR_H][CUR_W] = {
    {2,0,0,0,0,0,0,0,0,0,0},
    {2,2,0,0,0,0,0,0,0,0,0},
    {2,1,2,0,0,0,0,0,0,0,0},
    {2,1,1,2,0,0,0,0,0,0,0},
    {2,1,1,1,2,0,0,0,0,0,0},
    {2,1,1,1,1,2,0,0,0,0,0},
    {2,1,1,1,1,1,2,0,0,0,0},
    {2,1,1,1,1,1,1,2,0,0,0},
    {2,1,1,1,1,1,1,1,2,0,0},
    {2,1,1,1,1,1,1,1,1,2,0},
    {2,1,1,1,1,1,2,2,2,2,2},
    {2,1,1,2,1,1,2,0,0,0,0},
    {2,1,2,0,2,1,1,2,0,0,0},
    {2,2,0,0,2,1,1,2,0,0,0},
    {0,0,0,0,0,2,1,1,2,0,0},
    {0,0,0,0,0,2,1,1,2,0,0},
    {0,0,0,0,0,0,2,2,2,0,0},
    {0,0,0,0,0,0,0,0,0,0,0},
};

static int      mx, my;
static int      lx, ly;            /* last drawn position */
static int      first_paint;
static int      packet_phase;
static uint8_t  packet[3];
static int      btn_left, btn_right;
static volatile int dirty;
static volatile int left_click_latch;
static uint32_t sw, sh;

/* Sized for 2x cursor (CUR_W * CUR_H * scale^2 = 11*18*4 = 792 dwords). */
static uint32_t saved_bg[CUR_W * 2 * CUR_H * 2];

/* ─── Cursor draw/erase ─────────────────────────────────── */

/* Cursor is drawn at 2x - sprite is 11x18, rendered as 22x36 px so
 * it's clearly visible against the dense bitmap-font text on screen.
 * saved_bg is sized for 2x already. */
#define CUR_SCALE 2

static void save_bg_at(int x, int y) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    int w = CUR_W * CUR_SCALE, h = CUR_H * CUR_SCALE;
    for (int row = 0; row < h; row++) {
        for (int col = 0; col < w; col++) {
            int px = x + col, py = y + row;
            uint32_t v = 0;
            if (px >= 0 && py >= 0 && (uint32_t)px < sw && (uint32_t)py < sh) {
                v = fb[py * pitch_px + px];
            }
            saved_bg[row * w + col] = v;
        }
    }
}

static void restore_bg_at(int x, int y) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    int w = CUR_W * CUR_SCALE, h = CUR_H * CUR_SCALE;
    for (int row = 0; row < h; row++) {
        for (int col = 0; col < w; col++) {
            int px = x + col, py = y + row;
            if (px >= 0 && py >= 0 && (uint32_t)px < sw && (uint32_t)py < sh) {
                fb[py * pitch_px + px] = saved_bg[row * w + col];
            }
        }
    }
}

static void draw_cursor_at(int x, int y) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    uint32_t interior = btn_left ? COL_ACCENT : COL_WHITE;
    for (int row = 0; row < CUR_H; row++) {
        for (int col = 0; col < CUR_W; col++) {
            uint8_t v = CURSOR_BMP[row][col];
            if (!v) continue;
            uint32_t color = (v == 2) ? COL_BLACK : interior;
            for (int sy = 0; sy < CUR_SCALE; sy++) {
                for (int sx = 0; sx < CUR_SCALE; sx++) {
                    int px = x + col * CUR_SCALE + sx;
                    int py = y + row * CUR_SCALE + sy;
                    if (px < 0 || py < 0 || (uint32_t)px >= sw || (uint32_t)py >= sh) continue;
                    fb[py * pitch_px + px] = color;
                }
            }
        }
    }
}

/* When the left button is held while moving, drop a small accent-blue dot
 * at the cursor tip. The dot is written directly to the framebuffer
 * BEFORE we save_bg at the new position, so it gets captured and
 * persists through subsequent cursor moves. */
static void paint_ink_at(int x, int y) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    int dot = 4;
    /* Center the dot near the cursor tip (top-left of the arrow). */
    for (int dy = 0; dy < dot; dy++) {
        for (int dx = 0; dx < dot; dx++) {
            int px = x + dx;
            int py = y + dy;
            if (px < 0 || py < 0 || (uint32_t)px >= sw || (uint32_t)py >= sh) continue;
            fb[py * pitch_px + px] = COL_ACCENT;
        }
    }
}

void mouse_redraw_if_dirty(void) {
    if (!dirty) return;
    /* Snapshot the ISR-owned position + button atomically. Without the
     * cli/sti, IRQ12 could update mx/my BETWEEN save_bg_at(mx,my) and
     * draw_cursor_at(mx,my) - we'd save the background at one spot and
     * stamp the sprite at another, then the next restore_bg would paint
     * stale pixels and trail garbage across the screen. Clearing `dirty`
     * inside the critical section also avoids dropping an update that
     * lands mid-redraw. */
    __asm__ volatile("cli");
    int cx = mx, cy = my, held = btn_left;
    dirty = 0;
    __asm__ volatile("sti");

    if (first_paint) {
        save_bg_at(cx, cy);
        draw_cursor_at(cx, cy);
        lx = cx; ly = cy;
        first_paint = 0;
    } else if (cx != lx || cy != ly) {
        restore_bg_at(lx, ly);
        /* Paint trail BEFORE saving the new bg, so the dot gets baked
         * into saved_bg and persists across future moves. */
        if (held) paint_ink_at(lx, ly);
        save_bg_at(cx, cy);
        draw_cursor_at(cx, cy);
        lx = cx; ly = cy;
    } else {
        /* Same position - just repaint to reflect button-color change. */
        draw_cursor_at(cx, cy);
    }
}

/* Lift the cursor: restore the pixels under it and arm a fresh save+draw on
 * the next redraw. The window manager calls this before it repaints (open /
 * move / close a window) so the cursor's cached background can't be baked in
 * at a stale spot and smear when the scene under it changes. */
void mouse_lift(void) {
    if (!first_paint) restore_bg_at(lx, ly);
    first_paint = 1;
    dirty = 1;
}

int mouse_x(void)          { return mx; }
int mouse_y(void)          { return my; }
int mouse_left_down(void)  { return btn_left; }
int mouse_right_down(void) { return btn_right; }

int mouse_take_left_click(void) {
    /* Read-and-clear must be atomic vs IRQ12 setting the latch between
     * the two statements (that click would be lost). */
    __asm__ volatile("cli");
    int c = left_click_latch;
    left_click_latch = 0;
    __asm__ volatile("sti");
    return c;
}

/* ─── IRQ12 handler ────────────────────────────────────── */

static void mouse_isr(struct registers *r) {
    (void)r;
    /* Confirm this byte is from the mouse: status bit 5 set. */
    uint8_t status = inb_(PS2_STATUS);
    if (!(status & 0x20)) {
        (void)inb_(PS2_DATA);  /* drop stray keyboard byte */
        return;
    }
    uint8_t b = inb_(PS2_DATA);

    /* Re-sync: first byte must have bit 3 set. */
    if (packet_phase == 0 && !(b & 0x08)) return;

    packet[packet_phase++] = b;
    if (packet_phase < 3) return;
    packet_phase = 0;

    /* Bits 6/7 of byte 0 are X/Y overflow. When set, the 8-bit delta is
     * meaningless - drop the packet's movement (keep the button state)
     * rather than jumping the cursor by garbage. */
    if (packet[0] & 0xC0) {
        int nl = (packet[0] >> 0) & 1;
        int nr = (packet[0] >> 1) & 1;
        if (nl && !btn_left) left_click_latch = 1;
        btn_left = nl; btn_right = nr;
        dirty = 1;
        return;
    }

    int new_left  = (packet[0] >> 0) & 1;
    int new_right = (packet[0] >> 1) & 1;
    if (new_left && !btn_left) left_click_latch = 1;
    btn_left  = new_left;
    btn_right = new_right;

    int dx = (int8_t)packet[1];
    int dy = (int8_t)packet[2];

    int nx = mx + dx;
    int ny = my - dy;   /* PS/2 Y is +up, screen Y is +down - invert */
    if (nx < 0) nx = 0;
    if (ny < 0) ny = 0;
    if ((uint32_t)nx >= sw) nx = sw - 1;
    if ((uint32_t)ny >= sh) ny = sh - 1;
    mx = nx; my = ny;
    dirty = 1;
}

void mouse_install(uint32_t screen_w, uint32_t screen_h) {
    sw = screen_w;
    sh = screen_h;
    mx = sw / 2;
    my = sh / 2;
    first_paint = 1;
    dirty = 1;
    packet_phase = 0;

    /* 1. Enable aux. */
    ps2_wait_input();
    outb_(PS2_CMD, 0xA8);

    /* 2. Read controller config, set IRQ12 bit + clear aux-disable. */
    ps2_wait_input();
    outb_(PS2_CMD, 0x20);
    uint8_t config = mouse_read();
    config |= 0x02;     /* bit 1: enable IRQ12 */
    config &= ~0x20;    /* bit 5: 0 = enable aux clock */
    ps2_wait_input();
    outb_(PS2_CMD, 0x60);
    ps2_wait_input();
    outb_(PS2_DATA, config);

    /* 3. Reset mouse → expect 0xFA ACK + 0xAA self-test pass + device id. */
    mouse_write(0xFF);
    (void)mouse_read();  /* 0xFA */
    (void)mouse_read();  /* 0xAA */
    (void)mouse_read();  /* device id (0x00 standard) */

    /* 4. Set defaults + enable data reporting. */
    mouse_write(0xF6);   /* set defaults */
    (void)mouse_read();
    mouse_write(0xF4);   /* enable data reporting */
    (void)mouse_read();

    irq_register(12, mouse_isr);
    pic_unmask_irq(2);   /* must enable cascade for IRQ8..15 */
    pic_unmask_irq(12);
}
