/*
 * Astrion v2.0 — PS/2 keyboard driver
 *
 * Scancode set 1 (the default for the legacy PS/2 controller QEMU
 * emulates). On every IRQ1, read one byte from port 0x60:
 *   - byte & 0x80  → key release; we ignore for now (no auto-repeat,
 *                    no held-key tracking).
 *   - otherwise    → press; look up the ASCII code, push to ring
 *                    buffer. Shift status latches across press/release.
 *
 * Multi-byte scancodes (0xE0 prefix for arrows / numpad etc.) are
 * dropped for now — only printable + Enter + Backspace + Tab are wired.
 *
 * Ring buffer is 64 bytes. Drops the oldest if full (the main loop is
 * expected to drain it every frame).
 */

#include <stdint.h>
#include "kbd.h"
#include "idt.h"

#define KBD_DATA_PORT   0x60
#define KBD_STATUS_PORT 0x64
#define KBD_STAT_AUX    0x20   /* status bit 5: data is from the mouse */

static inline uint8_t inb_(uint16_t port) {
    uint8_t v;
    __asm__ volatile("inb %1, %0" : "=a"(v) : "Nd"(port));
    return v;
}

/* US-layout scancode set 1 → ASCII (no shift). Index = scancode. */
static const char SC_TO_ASCII[128] = {
    0,    0x1B, '1', '2', '3', '4', '5', '6',     /* 0x00..0x07  esc, digits */
    '7',  '8',  '9', '0', '-', '=', '\b', '\t',   /* 0x08..0x0F  backspace, tab */
    'q',  'w',  'e', 'r', 't', 'y', 'u', 'i',     /* 0x10..0x17 */
    'o',  'p',  '[', ']', '\n', 0,  'a', 's',     /* 0x18..0x1F  enter, lctrl */
    'd',  'f',  'g', 'h', 'j', 'k', 'l', ';',     /* 0x20..0x27 */
    '\'', '`',  0,   '\\','z', 'x', 'c', 'v',     /* 0x28..0x2F  lshift */
    'b',  'n',  'm', ',', '.', '/', 0,   '*',     /* 0x30..0x37  rshift, *kp */
    0,    ' ',  0,   0,   0,   0,   0,   0,       /* 0x38..0x3F  lalt, space, caps */
};

static const char SC_TO_ASCII_SHIFT[128] = {
    0,    0x1B, '!', '@', '#', '$', '%', '^',
    '&',  '*',  '(', ')', '_', '+', '\b', '\t',
    'Q',  'W',  'E', 'R', 'T', 'Y', 'U', 'I',
    'O',  'P',  '{', '}', '\n', 0,  'A', 'S',
    'D',  'F',  'G', 'H', 'J', 'K', 'L', ':',
    '"',  '~',  0,   '|', 'Z', 'X', 'C', 'V',
    'B',  'N',  'M', '<', '>', '?', 0,   '*',
    0,    ' ',  0,   0,   0,   0,   0,   0,
};

static volatile char    rb[64];
static volatile uint8_t rb_head;
static volatile uint8_t rb_tail;

static int shift_held  = 0;
static int caps_lock   = 0;
static int is_extended = 0;  /* set after a 0xE0 byte, cleared after the next byte */

static void rb_push(char c) {
    /* Single-producer (this runs only in the IRQ1 ISR) / single-consumer
     * (kbd_getchar runs only in task context). The ISR must NEVER write
     * rb_tail — that's the consumer's field. On a single core the ISR
     * preempts the consumer between its read and write of rb_tail, so
     * if both touched it we'd lose updates / corrupt the index. When the
     * buffer is full we drop the NEWEST char (this one) instead. Only
     * rb_head is written here; only rb_tail in kbd_getchar. Race-free. */
    uint8_t next = (rb_head + 1) & (sizeof(rb) - 1);
    if (next == rb_tail) return;   /* full — drop this char */
    rb[rb_head] = c;
    rb_head = next;
}

int kbd_available(void) { return rb_head != rb_tail; }

char kbd_getchar(void) {
    if (rb_head == rb_tail) return 0;
    char c = rb[rb_tail];
    rb_tail = (rb_tail + 1) & (sizeof(rb) - 1);
    return c;
}

static void kbd_isr(struct registers *r) {
    (void)r;
    /* If the controller says this byte is mouse (AUX) data, it doesn't
     * belong to us — read it to ack the line, but don't treat it as a
     * scancode (that would inject a phantom keypress + desync the mouse
     * packet stream). On QEMU IRQ1 only ever carries keyboard bytes, so
     * this is belt-and-suspenders for real hardware. */
    uint8_t st = inb_(KBD_STATUS_PORT);
    uint8_t sc = inb_(KBD_DATA_PORT);
    if (st & KBD_STAT_AUX) return;

    /* 0xE0 = "extended prefix". The next byte is an extended scancode
     * (arrow keys, numpad navigation, right-ctrl, etc.). */
    if (sc == 0xE0) { is_extended = 1; return; }

    if (is_extended) {
        is_extended = 0;
        /* Drop release events. */
        if (sc & 0x80) return;
        /* Map known extended keys → KEY_* codes (>127). */
        char c = 0;
        switch (sc) {
            case 0x48: c = KEY_UP;    break;
            case 0x50: c = KEY_DOWN;  break;
            case 0x4B: c = KEY_LEFT;  break;
            case 0x4D: c = KEY_RIGHT; break;
            default: return;
        }
        rb_push(c);
        return;
    }

    /* Track shift press/release explicitly. lshift=0x2A rshift=0x36 */
    if (sc == 0x2A || sc == 0x36)            { shift_held = 1; return; }
    if (sc == 0xAA || sc == 0xB6)            { shift_held = 0; return; }
    if (sc == 0x3A)                          { caps_lock ^= 1; return; }

    /* Drop key-release events (high bit set), drop scancodes outside
     * our normal table. */
    if (sc & 0x80)                           return;
    if (sc >= 128)                           return;

    int upper = shift_held ^ caps_lock;
    char c = upper ? SC_TO_ASCII_SHIFT[sc] : SC_TO_ASCII[sc];
    if (c) rb_push(c);
}

void kbd_install(void) {
    rb_head = rb_tail = 0;
    irq_register(1, kbd_isr);
    pic_unmask_irq(1);
}
