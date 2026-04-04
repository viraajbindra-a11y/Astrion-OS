/**
 * NOVA OS Kernel — PS/2 Mouse Driver
 * Reads mouse movement and button state from PS/2 controller.
 */

#ifndef NOVA_MOUSE_H
#define NOVA_MOUSE_H

#include "../include/types.h"

typedef struct {
    int32_t  x, y;           // absolute position
    int32_t  dx, dy;          // delta since last event
    bool     left_button;
    bool     right_button;
    bool     middle_button;
    bool     left_clicked;    // just pressed this frame
    bool     right_clicked;
    bool     left_released;
} MouseState;

void mouse_init(uint32_t screen_width, uint32_t screen_height);
void mouse_poll(void);
MouseState mouse_get_state(void);

#endif
