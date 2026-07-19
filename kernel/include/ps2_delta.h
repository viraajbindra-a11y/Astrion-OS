#ifndef PS2_DELTA_H
#define PS2_DELTA_H

#include <stdint.h>

/* PS/2 movement deltas are 9-bit two's complement. The low 8 bits ride in the
 * data byte; the sign bit lives in byte 0 of the packet — bit 4 for X, bit 5
 * for Y. Casting the data byte to int8_t instead reads ITS bit 7 as the sign,
 * which agrees with the real sign only while |delta| <= 127, i.e. only while
 * the mouse is moved slowly. Past that the sign inverts: a real +200 arrives
 * as 0xC8, int8_t reads it as -56, and the cursor darts backwards.
 *
 * This lives in its own header, free of kernel headers, so that
 * kernel/tests/test_ps2_delta.c can include the SAME source the kernel ships
 * rather than a transcription of it that can silently drift.
 *
 * QEMU cannot exercise the difference: its PS/2 model clamps every packet to
 * +/-127 and splits larger moves into a stream, so the two decodes agree on
 * every packet it will ever emit. The exhaustive host test is the real gate;
 * booting it proves nothing about this particular line. */

#define PS2_SIGN_X 0x10u
#define PS2_SIGN_Y 0x20u

static inline int ps2_delta9(uint8_t data, uint8_t flags, unsigned sign_bit)
{
    return (int)data - ((flags & sign_bit) ? 256 : 0);
}

#endif /* PS2_DELTA_H */
