/*
 * Astrion v2.0 - In-kernel shell
 *
 * Drives the console + keyboard. Reads chars, echoes them, on Enter
 * parses the line into argv-style tokens and dispatches to a built-in
 * command. No external commands, no scripting - pure kernel debug
 * surface for now.
 */

#ifndef ASTRION_SHELL_H
#define ASTRION_SHELL_H

void shell_install(void);   /* paints prompt, registers cmd table */
void shell_on_key(char c);  /* feed one keystroke from the main loop */
void shell_tick(void);      /* called from main loop - repaint clock etc. */

#endif
