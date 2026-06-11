/*
 * Astrion v2.0 - Snake game on the framebuffer
 *
 * Blocking call: takes over the screen, runs the game loop, returns
 * the final score when the player dies or presses ESC. Caller is
 * expected to repaint whatever was on screen before.
 */

#ifndef ASTRION_SNAKE_H
#define ASTRION_SNAKE_H

int snake_play(void);   /* returns final score */

#endif
