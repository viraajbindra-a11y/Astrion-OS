/**
 * NOVA OS Kernel — PS/2 Mouse Driver
 * Communicates with the PS/2 controller to read mouse packets.
 */

#include "mouse.h"

static inline uint8_t inb(uint16_t port) {
    uint8_t val;
    __asm__ volatile("inb %1, %0" : "=a"(val) : "Nd"(port));
    return val;
}

static inline void outb(uint16_t port, uint8_t val) {
    __asm__ volatile("outb %0, %1" : : "a"(val), "Nd"(port));
}

static MouseState state;
static uint32_t max_x, max_y;
static uint8_t mouse_cycle = 0;
static uint8_t mouse_packet[3];
static bool prev_left = false;
static bool prev_right = false;

// Wait for PS/2 controller to be ready
static void mouse_wait(uint8_t type) {
    uint32_t timeout = 100000;
    if (type == 0) {
        while (timeout--) {
            if (inb(0x64) & 1) return;
        }
    } else {
        while (timeout--) {
            if (!(inb(0x64) & 2)) return;
        }
    }
}

static void mouse_write(uint8_t data) {
    mouse_wait(1);
    outb(0x64, 0xD4);  // tell controller we're talking to mouse
    mouse_wait(1);
    outb(0x60, data);
}

static uint8_t mouse_read(void) {
    mouse_wait(0);
    return inb(0x60);
}

void mouse_init(uint32_t screen_width, uint32_t screen_height) {
    max_x = screen_width;
    max_y = screen_height;
    state.x = screen_width / 2;
    state.y = screen_height / 2;

    // Enable the auxiliary (mouse) device
    mouse_wait(1);
    outb(0x64, 0xA8);  // enable auxiliary device

    // Enable interrupts
    mouse_wait(1);
    outb(0x64, 0x20);  // get compaq status byte
    uint8_t status = (mouse_read() | 2);  // enable IRQ12
    mouse_wait(1);
    outb(0x64, 0x60);  // set compaq status
    mouse_wait(1);
    outb(0x60, status);

    // Tell the mouse to use default settings
    mouse_write(0xF6);
    mouse_read();  // acknowledge

    // Enable data reporting
    mouse_write(0xF4);
    mouse_read();  // acknowledge
}

void mouse_poll(void) {
    // Save previous button state for click detection
    prev_left = state.left_button;
    prev_right = state.right_button;
    state.left_clicked = false;
    state.right_clicked = false;
    state.left_released = false;
    state.dx = 0;
    state.dy = 0;

    // Read available mouse packets
    while (inb(0x64) & 1) {
        uint8_t data = inb(0x60);

        switch (mouse_cycle) {
            case 0:
                // First byte must have bit 3 set (sync bit)
                if (data & 0x08) {
                    mouse_packet[0] = data;
                    mouse_cycle = 1;
                }
                break;
            case 1:
                mouse_packet[1] = data;
                mouse_cycle = 2;
                break;
            case 2:
                mouse_packet[2] = data;
                mouse_cycle = 0;

                // Decode the packet
                state.left_button = (mouse_packet[0] & 1) != 0;
                state.right_button = (mouse_packet[0] & 2) != 0;
                state.middle_button = (mouse_packet[0] & 4) != 0;

                // X movement (signed)
                int16_t dx = mouse_packet[1];
                if (mouse_packet[0] & 0x10) dx |= 0xFF00;  // sign extend

                // Y movement (signed, inverted)
                int16_t dy = mouse_packet[2];
                if (mouse_packet[0] & 0x20) dy |= 0xFF00;  // sign extend

                // Update position
                state.dx = dx;
                state.dy = -dy;  // Y is inverted in PS/2
                state.x += dx;
                state.y -= dy;

                // Clamp to screen bounds
                if (state.x < 0) state.x = 0;
                if (state.y < 0) state.y = 0;
                if (state.x >= (int32_t)max_x) state.x = max_x - 1;
                if (state.y >= (int32_t)max_y) state.y = max_y - 1;

                // Detect clicks
                if (state.left_button && !prev_left) state.left_clicked = true;
                if (!state.left_button && prev_left) state.left_released = true;
                if (state.right_button && !prev_right) state.right_clicked = true;

                break;
        }
    }
}

MouseState mouse_get_state(void) {
    return state;
}
