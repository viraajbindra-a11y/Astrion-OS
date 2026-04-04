/**
 * NOVA OS Kernel — PS/2 Keyboard Driver
 * Reads scancodes from port 0x60 and translates to key events.
 */

#include "keyboard.h"

// Port I/O — inline assembly to read/write hardware ports
static inline uint8_t inb(uint16_t port) {
    uint8_t val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

static inline void outb(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

// Keyboard state
static bool shift_held = false;
static bool ctrl_held = false;
static bool alt_held = false;
static bool caps_lock = false;

// Event buffer (circular)
#define KEY_BUFFER_SIZE 64
static KeyEvent key_buffer[KEY_BUFFER_SIZE];
static int key_head = 0;
static int key_tail = 0;

// Scancode to ASCII lookup (US QWERTY)
static const char scancode_ascii[128] = {
    0, 0, '1','2','3','4','5','6','7','8','9','0','-','=', 0, 0,
    'q','w','e','r','t','y','u','i','o','p','[',']', 0, 0,
    'a','s','d','f','g','h','j','k','l',';','\'','`', 0, '\\',
    'z','x','c','v','b','n','m',',','.','/', 0, '*', 0, ' ',
};

static const char scancode_ascii_shift[128] = {
    0, 0, '!','@','#','$','%','^','&','*','(',')','_','+', 0, 0,
    'Q','W','E','R','T','Y','U','I','O','P','{','}', 0, 0,
    'A','S','D','F','G','H','J','K','L',':','"','~', 0, '|',
    'Z','X','C','V','B','N','M','<','>','?', 0, '*', 0, ' ',
};

void keyboard_init(void) {
    // Flush the keyboard buffer
    while (inb(0x64) & 1) {
        inb(0x60);
    }
}

// Called from the main loop to poll keyboard
static void keyboard_poll(void) {
    // Check if data is available (bit 0 of status register)
    if (!(inb(0x64) & 1)) return;

    uint8_t scancode = inb(0x60);
    bool released = (scancode & 0x80) != 0;
    uint8_t key = scancode & 0x7F;

    // Update modifier state
    if (key == KEY_LSHIFT || key == KEY_RSHIFT) {
        shift_held = !released;
        return;
    }
    if (key == KEY_LCTRL) {
        ctrl_held = !released;
        return;
    }
    if (key == KEY_LALT) {
        alt_held = !released;
        return;
    }
    if (key == KEY_CAPSLOCK && !released) {
        caps_lock = !caps_lock;
        return;
    }

    // Translate to ASCII
    bool use_shift = shift_held ^ caps_lock;
    char ascii = 0;
    if (key < 128) {
        ascii = use_shift ? scancode_ascii_shift[key] : scancode_ascii[key];
    }

    // Special keys
    if (key == KEY_ENTER) ascii = '\n';
    if (key == KEY_BACKSPACE) ascii = '\b';
    if (key == KEY_TAB) ascii = '\t';
    if (key == KEY_SPACE) ascii = ' ';

    // Push event to buffer
    KeyEvent event = {
        .scancode = key,
        .ascii = ascii,
        .pressed = !released,
        .shift = shift_held,
        .ctrl = ctrl_held,
        .alt = alt_held,
    };

    int next = (key_head + 1) % KEY_BUFFER_SIZE;
    if (next != key_tail) {
        key_buffer[key_head] = event;
        key_head = next;
    }
}

bool keyboard_has_event(void) {
    keyboard_poll();
    return key_head != key_tail;
}

KeyEvent keyboard_get_event(void) {
    keyboard_poll();
    KeyEvent event = key_buffer[key_tail];
    key_tail = (key_tail + 1) % KEY_BUFFER_SIZE;
    return event;
}
