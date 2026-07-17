/*
 * Astrion v2.0 - System clipboard
 *
 * One machine-wide text clipboard: copy in one place (editor line),
 * paste in another (editor cursor, Assistant prompt, shell input).
 * Fixed 4 KiB buffer, integer-only, no allocation - it lives in BSS
 * for the life of the kernel and is always NUL-terminated so the
 * contents can be handed straight to any string consumer.
 */

#ifndef ASTRION_CLIPBOARD_H
#define ASTRION_CLIPBOARD_H

#include <stdint.h>

#define CLIPBOARD_MAX 4096u   /* buffer size incl. the trailing NUL */

/* Replace the clipboard with the first `len` bytes of `data`. Copy is
 * bounded to CLIPBOARD_MAX-1 (one byte reserved for the terminator); a
 * NULL `data` clears the clipboard. */
void        clipboard_set(const char *data, uint32_t len);

/* The current clipboard text, always NUL-terminated (never NULL). */
const char *clipboard_get(void);

/* Length of the current clipboard text, in bytes (excludes the NUL). */
uint32_t    clipboard_len(void);

#endif
