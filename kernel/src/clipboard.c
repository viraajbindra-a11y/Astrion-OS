/*
 * Astrion v2.0 - System clipboard
 *
 * A single global text buffer shared by every app that copies or pastes.
 * No allocation: the buffer is a fixed BSS array, zero-initialised at
 * boot (so clipboard_get() is a valid empty string before anything has
 * been copied - no init call needed). Every write is bounded wrap-safe
 * against the buffer size, leaving room for the trailing NUL.
 */

#include <stdint.h>
#include "clipboard.h"

static char     clip[CLIPBOARD_MAX];
static uint32_t clip_len;

void clipboard_set(const char *data, uint32_t len) {
    if (!data) { clip_len = 0; clip[0] = 0; return; }
    /* Reserve one byte for the terminator. Wrap-safe: CLIPBOARD_MAX > 1,
     * so CLIPBOARD_MAX-1 never underflows and the compare can't wrap. */
    if (len > CLIPBOARD_MAX - 1) len = CLIPBOARD_MAX - 1;
    for (uint32_t i = 0; i < len; i++) clip[i] = data[i];
    clip[len] = 0;
    clip_len = len;
}

const char *clipboard_get(void) { return clip; }
uint32_t    clipboard_len(void) { return clip_len; }
