/**
 * NOVA OS Kernel — PS/2 Keyboard Driver
 * Reads keyboard input from the PS/2 controller (port 0x60/0x64).
 */

#ifndef NOVA_KEYBOARD_H
#define NOVA_KEYBOARD_H

#include "../include/types.h"

// Key event
typedef struct {
    uint8_t scancode;
    char    ascii;       // printable character, or 0
    bool    pressed;     // true = key down, false = key up
    bool    shift;
    bool    ctrl;
    bool    alt;
} KeyEvent;

// Special key codes
#define KEY_ESC       0x01
#define KEY_BACKSPACE 0x0E
#define KEY_TAB       0x0F
#define KEY_ENTER     0x1C
#define KEY_LCTRL     0x1D
#define KEY_LSHIFT    0x2A
#define KEY_RSHIFT    0x36
#define KEY_LALT      0x38
#define KEY_SPACE     0x39
#define KEY_CAPSLOCK  0x3A
#define KEY_F1        0x3B
#define KEY_F2        0x3C
#define KEY_F3        0x3D
#define KEY_F4        0x3E
#define KEY_UP        0x48
#define KEY_LEFT      0x4B
#define KEY_RIGHT     0x4D
#define KEY_DOWN      0x50
#define KEY_DELETE    0x53

void keyboard_init(void);
bool keyboard_has_event(void);
KeyEvent keyboard_get_event(void);

#endif
