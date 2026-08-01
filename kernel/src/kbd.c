/*
 * Astrion v2.0 - keyboard input: PS/2 (IRQ1) + serial console (IRQ4)
 *
 * TWO producers, ONE event stream. Everything that reads the keyboard -
 * shell, WM, editor, Snake - drains the same ring buffer and cannot tell
 * which wire a key came in on.
 *
 * PS/2 (IRQ1): scancode set 1 (the default for the legacy PS/2 controller
 * QEMU emulates). On every IRQ1, read one byte from port 0x60:
 *   - byte & 0x80  → key release; we ignore for now (no auto-repeat,
 *                    no held-key tracking).
 *   - otherwise    → press; look up the ASCII code, push to ring
 *                    buffer. Shift status latches across press/release.
 * Extended scancodes (0xE0 prefix) are decoded for the four arrow keys
 * and right-Ctrl; the rest are dropped.
 *
 * Serial (IRQ4): bytes off COM1, translated in the second half of this
 * file. This is the input path that still works on a machine whose
 * firmware gives us no i8042 emulation.
 *
 * Ring buffer is 64 bytes. Drops the newest if full (the main loop is
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

static inline void outb_(uint16_t port, uint8_t v) {
    __asm__ volatile("outb %0, %1" : : "a"(v), "Nd"(port));
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
static int ctrl_held   = 0;  /* left or right Ctrl, latched across press/release */
static int is_extended = 0;  /* set after a 0xE0 byte, cleared after the next byte */

static void rb_push(char c) {
    /* One producer at a time / single consumer (kbd_getchar runs only in
     * task context). There are now THREE callers of this - the IRQ1 PS/2
     * ISR, the IRQ4 serial ISR, and the IRQ0 timer tick that flushes a held
     * Esc - and they are all interrupt handlers. Every IRQ vector is a
     * 64-bit INTERRUPT gate (idt.c sets type 0x8E), which clears IF on
     * entry, and nothing in isr.S's irq_common or in irq_handler turns it
     * back on. On one core that makes the three mutually exclusive: none
     * can start while another is inside rb_push, so rb_head still has
     * exactly one writer at any instant.
     *
     * The producers must NEVER write rb_tail - that's the consumer's field.
     * An ISR preempts the consumer between its read and write of rb_tail,
     * so if both touched it we'd lose updates / corrupt the index. When the
     * buffer is full we drop the NEWEST char (this one) instead. Only
     * rb_head is written here; only rb_tail in kbd_getchar. Race-free. */
    uint8_t next = (rb_head + 1) & (sizeof(rb) - 1);
    if (next == rb_tail) return;   /* full - drop this char */
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

static volatile uint32_t kbd_irqs;      /* scancodes seen since boot */
static int kbd_ctrl_present = 1;        /* until proven otherwise */

int kbd_controller_present(void) { return kbd_ctrl_present; }
uint32_t kbd_scancodes_seen(void) { return kbd_irqs; }

static void kbd_isr(struct registers *r) {
    (void)r;
    /* If the controller says this byte is mouse (AUX) data, it doesn't
     * belong to us - read it to ack the line, but don't treat it as a
     * scancode (that would inject a phantom keypress + desync the mouse
     * packet stream). On QEMU IRQ1 only ever carries keyboard bytes, so
     * this is belt-and-suspenders for real hardware. */
    uint8_t st = inb_(KBD_STATUS_PORT);
    uint8_t sc = inb_(KBD_DATA_PORT);
    if (st & KBD_STAT_AUX) return;
    kbd_irqs++;   /* proof that keys are really reaching us on this machine */

    /* 0xE0 = "extended prefix". The next byte is an extended scancode
     * (arrow keys, numpad navigation, right-ctrl, etc.). */
    if (sc == 0xE0) { is_extended = 1; return; }

    if (is_extended) {
        is_extended = 0;
        /* Right Ctrl arrives as 0xE0 0x1D (press) / 0xE0 0x9D (release).
         * Catch it before the release-drop below so we see the release. */
        if (sc == 0x1D) { ctrl_held = 1; return; }
        if (sc == 0x9D) { ctrl_held = 0; return; }
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
    /* Left Ctrl: press 0x1D, release 0x9D. Tracked before the release-drop
     * below so we still see the release (high bit set). */
    if (sc == 0x1D)                          { ctrl_held = 1; return; }
    if (sc == 0x9D)                          { ctrl_held = 0; return; }

    /* Drop key-release events (high bit set), drop scancodes outside
     * our normal table. */
    if (sc & 0x80)                           return;
    if (sc >= 128)                           return;

    /* Ctrl held: fold the two clipboard chords into their ASCII control
     * codes and swallow every other Ctrl+<key>, so a held Ctrl can never
     * leak a stray letter into whatever has focus. */
    if (ctrl_held) {
        if (sc == 0x2E)      rb_push(KEY_CTRL_C);   /* Ctrl+C (C key) */
        else if (sc == 0x2F) rb_push(KEY_CTRL_V);   /* Ctrl+V (V key) */
        return;
    }

    int upper = shift_held ^ caps_lock;
    char c = upper ? SC_TO_ASCII_SHIFT[sc] : SC_TO_ASCII[sc];
    if (c) rb_push(c);
}

/* ─── is there actually a keyboard controller here? ───
 *
 * Written for the first boot on real hardware, which has never happened.
 *
 * Astrion talks to the keyboard through the PS/2 ports at 0x60/0x64. Almost no
 * machine built in the last decade HAS PS/2 ports — your keyboard is USB, and
 * what makes this work at all is the firmware pretending otherwise. Most
 * machines do. Some, especially newer UEFI ones with legacy support switched
 * off, do not. On those Astrion boots to a perfect desktop where nothing you
 * type does anything, and says nothing about why.
 *
 * A dead machine that explains itself is worth a great deal more than a dead
 * machine that doesn't, so: read the status port. An absent controller leaves
 * the ISA bus floating and every read comes back 0xFF. That is the one case we
 * can be SURE about, and it is checked without writing a single command.
 *
 * Deliberately no controller self-test (0xAA) or port test (0xAB). Those reset
 * state on some chipsets and can disable a port that was working fine, which
 * would mean the diagnostic caused the failure it went looking for. Not on the
 * one boot path nobody has ever run.
 *
 * The ambiguous case — controller present, no keys ever arrive — cannot be told
 * apart from "the user hasn't typed yet", so it is reported as a count and
 * judged by a human, not guessed at here. */
void kbd_install(void) {
    rb_head = rb_tail = 0;
    kbd_irqs = 0;

    /* 0xFF from the status port means nothing is driving the bus. A real
     * controller always has at least one status bit clear, so 0xFF is not a
     * value a working one can return. */
    kbd_ctrl_present = (inb_(KBD_STATUS_PORT) != 0xFF);

    irq_register(1, kbd_isr);
    pic_unmask_irq(1);
}

/* ─── Serial-console keyboard (COM1, IRQ4) ────────────────────────────
 *
 * A second producer for the ring buffer above, so a terminal on the far end
 * of a null-modem cable drives the shell, the WM, the editor and Snake
 * exactly the way the PS/2 keyboard does. This is the input path that keeps
 * working on hardware whose firmware hands us no i8042 emulation, and it
 * doubles as a debugger console for every hardware bug after this one.
 *
 * The UART is already brought up for OUTPUT by serial_init() in
 * kernel_mb2.c, and the kernel log shares the port - so we touch exactly
 * two registers here, and neither one affects transmit:
 *
 *   FCR (base+2) ← 0x01   The same FIFO-enable serial_init() set, with the
 *                         receive trigger level dropped from 14 bytes to 1,
 *                         so a single keystroke raises IRQ4 immediately
 *                         instead of waiting on the character timeout. The
 *                         FIFO-reset strobes (bits 1,2) are deliberately
 *                         left at 0: re-firing them here would flush a byte
 *                         of the boot log out of the transmit FIFO.
 *   IER (base+1) ← 0x01   ERBFI (received-data-available) ONLY. Bit 1,
 *                         transmit-holding-register-empty, stays off, so
 *                         serial_putc keeps polling LSR exactly as it does
 *                         today. Output behaviour is byte-for-byte unchanged.
 *
 * MCR already has OUT2 set (serial_init writes 0x0B) - on a PC that bit is
 * what gates the UART's interrupt line onto the PIC, so there is nothing to
 * change there either.
 */

#define COM1_BASE       0x3F8
#define COM1_RBR        (COM1_BASE + 0)   /* receive buffer (read) */
#define COM1_IER        (COM1_BASE + 1)   /* interrupt enable */
#define COM1_FCR        (COM1_BASE + 2)   /* FIFO control (write) */
#define COM1_LSR        (COM1_BASE + 5)   /* line status */
#define LSR_DATA_READY  0x01              /* LSR bit 0: a byte is waiting */
#define IER_RX_AVAIL    0x01              /* IER bit 0: ERBFI */
#define FCR_TRIGGER_1   0x01              /* FIFO on, trigger 1 byte, no reset */

/* ─── Esc disambiguation ───
 *
 * Arrow keys arrive as three bytes: ESC '[' 'A'. A lone Esc - which the WM
 * uses to close a window - is one byte that looks exactly like the start of
 * one of those. Nothing in the first byte tells them apart, so we hold the
 * Esc back and decide once we see what follows.
 *
 * The whole risk in that trick is getting stuck holding a byte forever, so
 * the machine has one hard rule: it is back in ESC_NONE within
 * ESC_TIMEOUT_TICKS of the LAST byte received, whatever that byte was.
 * esc_ticks_left is reloaded ONLY by an arriving byte and counted down ONLY
 * by the 100 Hz timer, so with no input it always reaches zero.
 *
 *   ESC_NONE  --0x1B------→ ESC_GOT   hold the Esc, arm the countdown
 *   ESC_GOT   --'[' or 'O'→ ESC_SEQ   CSI / SS3 - an arrow may be coming
 *   ESC_GOT   --0x1B------→ ESC_GOT   emit the held Esc, hold the new one
 *   ESC_GOT   --anything--→ ESC_NONE  emit the held Esc, then re-handle
 *                                     this byte as an ordinary key. The
 *                                     byte is never swallowed.
 *   ESC_SEQ   --A/B/C/D---→ ESC_NONE  emit KEY_UP/DOWN/RIGHT/LEFT
 *   ESC_SEQ   --0x20..0x3F→ ESC_SEQ   parameter byte ('1', ';', ...) - eat
 *   ESC_SEQ   --0x40..0x7E→ ESC_NONE  any other final byte ends the
 *                                     sequence and we drop it (Home, End,
 *                                     PgUp, F-keys have no code here yet)
 *   ESC_SEQ   --anything--→ ESC_NONE  a control character can't appear
 *                                     inside a CSI, so the sequence was
 *                                     garbage: abandon it and re-handle
 *                                     this byte
 *   timeout in ESC_GOT      emit the held Esc - it really was a lone Esc
 *   timeout in ESC_SEQ      drop the partial sequence. The user was clearly
 *                           mid-sequence; a stray Esc here would close a
 *                           window they never asked to close.
 *
 * So the worst case for a real Esc keypress is ESC_TIMEOUT_TICKS = 30 ms
 * before the WM sees it - under one frame, and the same order terminal
 * emulators use. The worst case for a stuck state is that same 30 ms.
 */

#define ESC_NONE  0
#define ESC_GOT   1
#define ESC_SEQ   2
#define ESC_TIMEOUT_TICKS 3    /* PIT runs at 100 Hz → 20..30 ms */
#define SEQ_MAX   16           /* parameter bytes tolerated inside one CSI */
#define ESC_BYTE  0x1B         /* what wm.c matches as `c == 27` to close */

static volatile uint8_t esc_state;        /* ESC_NONE / ESC_GOT / ESC_SEQ */
static volatile uint8_t esc_ticks_left;   /* countdown to forced ESC_NONE */
static volatile uint8_t seq_len;          /* parameter bytes eaten in ESC_SEQ */
static volatile uint8_t last_was_cr;      /* for the CRLF collapse below */

static void serial_feed(uint8_t b) {
    /* At most two passes. Pass 0 can flush a held Esc and drop us back to
     * ESC_NONE so the SAME byte is re-read as an ordinary key in pass 1;
     * both paths that loop set ESC_NONE first, so pass 1 always falls
     * straight through. The bound of 2 is belt-and-suspenders: this runs in
     * an ISR and must terminate no matter what state we are in. */
    for (int pass = 0; pass < 2; pass++) {
        if (esc_state == ESC_GOT) {
            esc_ticks_left = ESC_TIMEOUT_TICKS;
            if (b == '[' || b == 'O') { esc_state = ESC_SEQ; seq_len = 0; return; }
            if (b == ESC_BYTE)        { rb_push((char)ESC_BYTE);          return; }
            rb_push((char)ESC_BYTE);  /* the held Esc was a real Esc */
            esc_state = ESC_NONE;
            continue;                 /* now handle b on its own merits */
        }

        if (esc_state == ESC_SEQ) {
            esc_ticks_left = ESC_TIMEOUT_TICKS;
            if (b >= 0x40 && b <= 0x7E) {          /* final byte: sequence ends */
                esc_state = ESC_NONE;
                switch (b) {
                    case 'A': rb_push(KEY_UP);    break;
                    case 'B': rb_push(KEY_DOWN);  break;
                    case 'C': rb_push(KEY_RIGHT); break;
                    case 'D': rb_push(KEY_LEFT);  break;
                    default:  break;               /* no code for this key */
                }
                return;
            }
            if (b >= 0x20 && b <= 0x3F && seq_len < SEQ_MAX) {
                seq_len++;             /* parameter / intermediate byte */
                return;
            }
            esc_state = ESC_NONE;      /* garbage, or absurdly long */
            continue;
        }

        break;                         /* ESC_NONE - ordinary byte */
    }

    if (b == ESC_BYTE) {               /* start holding an Esc */
        esc_state      = ESC_GOT;
        esc_ticks_left = ESC_TIMEOUT_TICKS;
        seq_len        = 0;
        last_was_cr    = 0;
        return;
    }

    /* CR and LF both mean Enter, because which one a terminal sends depends
     * on its line settings. The CRLF collapse below stops a terminal that
     * sends "\r\n" for one Return from producing two. Cost: a Ctrl+J typed
     * immediately after Return is eaten - nothing in Astrion binds Ctrl+J. */
    if (b == '\r') { last_was_cr = 1; rb_push('\n'); return; }
    if (b == '\n') {
        uint8_t swallow = last_was_cr;
        last_was_cr = 0;
        if (!swallow) rb_push('\n');
        return;
    }
    last_was_cr = 0;

    /* Both erase codes mean Backspace. Which one you get depends on the
     * terminal's erase setting, so accept either. */
    if (b == 0x7F || b == 0x08) { rb_push('\b'); return; }
    if (b == '\t')              { rb_push('\t'); return; }

    /* Ctrl+C / Ctrl+V arrive over serial as the bare control codes 0x03 and
     * 0x16 - which are EXACTLY what kbd_isr folds the PS/2 chords into - so
     * they reach the clipboard without any special handling. */
    if (b == (uint8_t)KEY_CTRL_C || b == (uint8_t)KEY_CTRL_V) {
        rb_push((char)b);
        return;
    }

    /* Everything else is a whitelist, and this is the load-bearing line for
     * a noisy cable: KEY_UP..KEY_RIGHT are 128..131, so one high-bit byte of
     * line noise pushed through raw would land in the stream as a phantom
     * arrow key. Only printable ASCII gets through; the rest is dropped. */
    if (b >= 0x20 && b <= 0x7E) rb_push((char)b);
}

static void serial_isr(struct registers *r) {
    (void)r;
    /* Drain what the FIFO holds, with a hard cap. The 16550 FIFO is 16 deep,
     * so 32 is generous - the cap is the point. A UART wedged with Data
     * Ready stuck high would otherwise spin here forever with IF=0, which is
     * a dead machine. Anything still pending keeps IRQ4 asserted and we come
     * straight back in.
     *
     * Reading LSR each time also clears the overrun / parity / framing
     * latches, so a line error can't leave an interrupt permanently
     * asserted. This handler touches nothing but I/O ports and the ring
     * buffer - no console, no heap, no lock - so there is no path from here
     * into anything a task could be holding. */
    for (int i = 0; i < 32; i++) {
        if ((inb_(COM1_LSR) & LSR_DATA_READY) == 0) break;
        serial_feed(inb_(COM1_RBR));
    }
}

/* Heartbeat for the Esc state machine, called once per PIT tick from IRQ0.
 * Without it a lone Esc would sit held until the NEXT byte arrived, and
 * "press Esc to close the window" would appear to do nothing. Runs in IRQ
 * context like the other two producers, so rb_push keeps its one-writer
 * guarantee. No-op unless a sequence is actually in flight - which is why
 * pit.c can call it unconditionally even if serial input was never
 * installed (esc_state starts at ESC_NONE in BSS). */
void serial_kbd_tick(void) {
    if (esc_state == ESC_NONE) return;
    if (esc_ticks_left && --esc_ticks_left) return;
    if (esc_state == ESC_GOT) rb_push((char)ESC_BYTE);
    esc_state = ESC_NONE;
    seq_len   = 0;
}

void serial_kbd_install(void) {
    esc_state      = ESC_NONE;
    esc_ticks_left = 0;
    seq_len        = 0;
    last_was_cr    = 0;

    outb_(COM1_FCR, FCR_TRIGGER_1);

    /* Throw away whatever is already sitting in the receive FIFO - line
     * noise from plugging the cable in, or a terminal's own handshake - so
     * the first thing the shell sees is something a person actually typed.
     * Same bounded-drain shape as the ISR, same reason. */
    for (int i = 0; i < 32 && (inb_(COM1_LSR) & LSR_DATA_READY); i++) {
        (void)inb_(COM1_RBR);
    }

    irq_register(4, serial_isr);
    outb_(COM1_IER, IER_RX_AVAIL);
    pic_unmask_irq(4);
}
