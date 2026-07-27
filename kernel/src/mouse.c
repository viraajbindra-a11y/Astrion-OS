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
#include "ps2_delta.h"
#include "idt.h"

#define PS2_DATA   0x60
#define PS2_STATUS 0x64
#define PS2_CMD    0x64

#define COL_NAVY    0x1E2761u
#define COL_WHITE   0xFFFFFFu
#define COL_BLACK   0x000000u
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
/* The sprite's footprint in real pixels — the rect saved_bg mirrors. */
#define CUR_PW (CUR_W * CUR_SCALE)
#define CUR_PH (CUR_H * CUR_SCALE)

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

/* Erase the sprite WITHOUT trusting the whole cached rect.
 *
 * restore_bg_at() paints all 22x36 pixels back, which is right only while
 * saved_bg is still true. Once something has repainted underneath us it is not:
 * most of that rect now holds NEW content (the console blends glyph ink into
 * the gaps around the arrow without filling the cell background first), and
 * stamping the cache over it is exactly the bug. So walk the sprite bitmap and
 * write back only the pixels the arrow itself covered — those are the only ones
 * the sprite is still sitting on, and every pixel we never covered keeps
 * whatever the repaint left there. */
static void erase_cursor_at(int x, int y) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    for (int row = 0; row < CUR_H; row++) {
        for (int col = 0; col < CUR_W; col++) {
            if (!CURSOR_BMP[row][col]) continue;      /* transparent: leave it */
            for (int sy = 0; sy < CUR_SCALE; sy++) {
                for (int sx = 0; sx < CUR_SCALE; sx++) {
                    int sr = row * CUR_SCALE + sy;
                    int sc = col * CUR_SCALE + sx;
                    int px = x + sc, py = y + sr;
                    if (px < 0 || py < 0 || (uint32_t)px >= sw || (uint32_t)py >= sh) continue;
                    fb[py * pitch_px + px] = saved_bg[sr * CUR_PW + sc];
                }
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

/* There used to be a paint_ink_at() here: holding the left button and moving
 * stamped a 4x4 accent dot at every position the cursor visited (f8800d1,
 * "drag-to-paint trail"). It was removed deliberately.
 *
 * It was not a bug in the usual sense — it did exactly what it was written to
 * do — but it made the desktop behave like a whiteboard nobody asked for. The
 * dots went straight into the framebuffer and were then baked into saved_bg,
 * so they were PERMANENT: no eraser, no undo, no app that owned them, and no
 * way back except making some other painter happen to repaint that exact rect.
 * Any ordinary drag — press, move, release — vandalised the wallpaper, which
 * is why it read to a user as "the cursor smears everywhere."
 *
 * Dragging belongs to whoever the drag is over. The window manager already
 * reads mouse_left_down() to move windows; the mouse driver's job is to draw a
 * cursor and get out of the way. If a paint app ever wants ink, it asks for the
 * button state and draws inside its own window, where it can be cleared.
 *
 * The cursor interior still turns accent-coloured while the button is held —
 * that affordance is honest (the button IS down) and costs nothing. */

void mouse_redraw_if_dirty(void) {
    if (!dirty) return;
    /* The WHOLE redraw runs with interrupts masked, not just the snapshot.
     * Two hazards, one guard.
     *
     * LOCAL: without masking, IRQ12 could update mx/my between save_bg_at()
     * and draw_cursor_at() - we'd cache the background at one spot and stamp
     * the sprite at another.
     *
     * CROSS-TASK (this is the one that trailed the cursor): mouse_invalidate_
     * rect() runs from OTHER tasks - the clock and any spawned ticker paint the
     * top bar, and a ring-3 program's SYS_PUTS drives console damage() anywhere
     * in the terminal body - and it mutates the very state this function walks:
     * lx/ly, saved_bg, first_paint. The old code left the save/restore/draw and
     * the lx/ly commit OUTSIDE the masked region, so a timer tick could preempt
     * task 0 right after save_bg_at(cx,cy) and let one of those painters call
     * invalidate against a stale (lx,ly)/saved_bg pair: it stamps a sprite-
     * shaped rectangle of the NEW background at the OLD spot, and flips
     * first_paint so the next redraw bakes the drawn cursor into saved_bg - a
     * ghost that outlives the move and only clears if a painter happens to
     * repaint that exact rect.
     *
     * Masking the entire body makes the redraw and every cross-task invalidate
     * mutually exclusive: on one CPU an invalidate can only run when interrupts
     * are enabled, i.e. never inside here. The cost is ~2000 framebuffer ops
     * with interrupts off - console.c's writer lock already masks a whole
     * ~480k-pixel scroll blit in this same idiom, so this is two orders of
     * magnitude under the latency the machine already accepts. Only ever called
     * from task 0's main loop with interrupts on, so the bare cli/sti is safe:
     * there is no interrupts-off caller whose flag we would clobber. Clearing
     * `dirty` here can't drop an update either - a move that arrives after the
     * sti sets it again and the next iteration catches it. */
    __asm__ volatile("cli");
    int cx = mx, cy = my;
    dirty = 0;

    if (first_paint) {
        save_bg_at(cx, cy);
        draw_cursor_at(cx, cy);
        lx = cx; ly = cy;
        first_paint = 0;
    } else if (cx != lx || cy != ly) {
        restore_bg_at(lx, ly);
        save_bg_at(cx, cy);
        draw_cursor_at(cx, cy);
        lx = cx; ly = cy;
    } else {
        /* Same position - just repaint to reflect button-color change. */
        draw_cursor_at(cx, cy);
    }
    __asm__ volatile("sti");
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

/* ─── Stale-background invalidation (see mouse.h) ─────────── */

/* Save/restore rather than bare cli/sti: mouse_invalidate_rect() is called from
 * console.c with interrupts ALREADY masked, and a bare sti there would hand the
 * console's critical section back to the timer half-finished. Same idiom
 * console.c uses for its writer lock, and it nests for the same reason.
 * mouse_redraw_if_dirty() and mouse_take_left_click() keep bare cli/sti on
 * purpose — they only ever run on task 0, with interrupts already on. */
static inline uint64_t m_irq_save(void) {
    uint64_t f;
    __asm__ volatile("pushfq; pop %0; cli" : "=r"(f) :: "memory");
    return f;
}
static inline void m_irq_restore(uint64_t f) {
    __asm__ volatile("push %0; popfq" :: "r"(f) : "memory", "cc");
}

/* Does (x,y,w,h) touch the sprite's drawn footprint? Written subtractively —
 * `lx - x >= w` rather than `x + w <= lx` — so a caller passing a nonsense
 * width can't wrap the comparison into a false "no overlap". Both coordinates
 * are framebuffer-bounded, so the differences themselves can't overflow. */
static int rect_hits_cursor(int x, int y, int w, int h) {
    if (w <= 0 || h <= 0) return 0;
    if (lx - x >= w || x - lx >= CUR_PW) return 0;
    if (ly - y >= h || y - ly >= CUR_PH) return 0;
    return 1;
}

/* Do the pixels we are NOT covering still match what we cached?
 *
 * The tripwire for this whole bug family. Every caller of
 * mouse_invalidate_rect() is contracted to call it BEFORE it writes, so at this
 * instant saved_bg must still describe the framebuffer exactly. Only the
 * transparent pixels are checked — the opaque ones hold arrow ink, which is
 * supposed to differ.
 *
 * A non-zero count means some painter wrote first and announced afterwards,
 * which silently reintroduces the stale-cache class. It is a convention that
 * cannot be enforced by the type system, so it is at least measured. */
static unsigned long bg_faults;

static void bg_check_at(int x, int y) {
    if (!fb_present_x()) return;
    volatile uint32_t *fb = (volatile uint32_t *)fb_addr_x();
    uint32_t pitch_px = fb_pitch_x() / 4;
    for (int row = 0; row < CUR_H; row++)
        for (int col = 0; col < CUR_W; col++) {
            if (CURSOR_BMP[row][col]) continue;         /* ink: expected to differ */
            for (int sy = 0; sy < CUR_SCALE; sy++)
                for (int sx = 0; sx < CUR_SCALE; sx++) {
                    int sr = row * CUR_SCALE + sy, sc = col * CUR_SCALE + sx;
                    int px = x + sc, py = y + sr;
                    if (px < 0 || py < 0 || (uint32_t)px >= sw || (uint32_t)py >= sh)
                        continue;
                    if (fb[py * pitch_px + px] != saved_bg[sr * CUR_PW + sc]) {
                        bg_faults++;
                        return;                          /* one report per lift */
                    }
                }
        }
}

unsigned long mouse_bg_faults(void) { return bg_faults; }

/* Take the sprite off the screen NOW, rather than noting that it will need
 * repairing later.
 *
 * WHY EAGER, AND WHY THIS IS THE STRUCTURAL FIX:
 *
 * The old contract was "repair afterwards". That can work for a painter which
 * OVERWRITES a rectangle — the stray pixels stay where we left them, so we can
 * go back and clean them. It cannot work for a painter which MOVES pixels.
 * console.c's scroll_one_line() blits the whole console region up one row,
 * cursor included, and afterwards there is a copy of the arrow at a position
 * the cursor code has never heard of. Repairing "where the cursor is" cleans
 * the live copy and leaves every scrolled-away copy on screen forever. Five
 * `pwd`s after a full screen left five stacked arrows; only `clear` removed
 * them.
 *
 * Lifting at damage time fixes moves and overwrites with one rule: the sprite
 * is never composited into the framebuffer while another painter is touching
 * its footprint. A scroll then copies clean console pixels, because there is
 * nothing of ours there to copy.
 *
 * WHAT MAKES IT EXACT: every damage() call site in console.c precedes the write
 * it describes (verified at all seven), so saved_bg is still true right here.
 * That is the difference between restoring accurate pixels and stamping the
 * stale rectangle that started this whole family — the deferred path had to use
 * the sprite-shaped erase precisely because by then the cache was a lie.
 *
 * WHAT IT COSTS: mouse.h used to promise this function touched no pixels,
 * because ~800 framebuffer writes inside console.c's interrupt-masked section
 * is real latency. That promise is now broken deliberately, and the arithmetic
 * is why. It is the sprite-shaped erase, so ~300 writes, not 800. It happens at
 * most ONCE per burst of output — first_paint short-circuits every subsequent
 * damage() until task 0 puts the cursor back — so a 3200-glyph `help` pays for
 * one erase and 3199 compares. And the case it exists for, a scroll, already
 * moves several hundred thousand pixels of its own inside that same critical
 * section; adding 0.1% to it to make it correct is a trade worth taking. */
void mouse_invalidate_rect(int x, int y, int w, int h) {
    uint64_t f = m_irq_save();
    /* first_paint means nothing of ours is on the screen: no pixels to lift,
     * no cache to go stale, and the next redraw captures fresh either way. */
    if (!first_paint && rect_hits_cursor(x, y, w, h)) {
        bg_check_at(lx, ly);          /* the caller wrote first? count it */
        erase_cursor_at(lx, ly);
        first_paint = 1;              /* re-anchors on a clean background */
        dirty       = 1;              /* wake task 0 to put us back */
    }
    m_irq_restore(f);
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

    /* 9-bit two's complement, sign bit in byte 0 — see ps2_delta.h. Shared with
     * kernel/tests/test_ps2_delta.c, which covers all 512 combinations. */
    int dx = ps2_delta9(packet[1], packet[0], PS2_SIGN_X);
    int dy = ps2_delta9(packet[2], packet[0], PS2_SIGN_Y);

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
