/* Exhaustive host-side gate for the PS/2 9-bit delta decode.
 *
 * Why this exists rather than a QEMU test: QEMU's PS/2 model clamps every
 * movement packet to +/-127 and splits larger moves into a stream of small
 * ones. The buggy decode and the correct one agree on every packet QEMU can
 * emit, so booting the ISO cannot tell a fixed kernel from a broken one — a
 * QEMU "pass" here is vacuous. This walks all 512 real packet shapes instead.
 *
 *   cc -std=c11 -Wall -Wextra -Werror -I../include test_ps2_delta.c
 *
 * Includes the shipped header, not a copy of the formula, so the test cannot
 * drift away from the kernel it is supposed to be gating.
 */

#include <stdio.h>
#include <stdint.h>
#include "ps2_delta.h"

/* The decode this replaced. Kept so the test can prove it has teeth: a gate
 * that cannot fail is not a gate. */
static int old_decode(uint8_t data, uint8_t flags, unsigned sign_bit)
{
    (void)flags; (void)sign_bit;
    return (int8_t)data;
}

static int failures;

static void fail(const char *what, int truth, int got, uint8_t data, uint8_t flags)
{
    printf("  FAIL %-6s truth=%-5d got=%-5d  (data=0x%02X flags=0x%02X)\n",
           what, truth, got, data, flags);
    failures++;
}

int main(void)
{
    /* A PS/2 mouse encodes a true delta D in [-256, 255] as: the low 8 bits in
     * the data byte, and a sign bit in the flags byte set when D is negative.
     * Decoding must recover D exactly. Note this is checked against the
     * hardware spec, not against another implementation — comparing two
     * formulas would only prove they agree, not that either is right. */
    int checked = 0, old_wrong = 0;

    for (int axis = 0; axis < 2; axis++) {
        unsigned sign_bit  = axis ? PS2_SIGN_Y : PS2_SIGN_X;
        unsigned other_bit = axis ? PS2_SIGN_X : PS2_SIGN_Y;
        const char *name   = axis ? "Y" : "X";

        for (int truth = -256; truth <= 255; truth++) {
            uint8_t data  = (uint8_t)(truth & 0xFF);
            uint8_t flags = 0x08;                       /* always-1 sync bit */
            if (truth < 0) flags |= (uint8_t)sign_bit;

            /* The other axis's sign bit must not leak into this axis. Set it
             * on every case so a mixed-up mask shows up as a failure. */
            flags |= (uint8_t)other_bit;

            int got = ps2_delta9(data, flags, sign_bit);
            if (got != truth) fail(name, truth, got, data, flags);
            checked++;

            if (old_decode(data, flags, sign_bit) != truth) old_wrong++;
        }
    }

    printf("checked   %d combinations (%d per axis, both axes)\n", checked, checked / 2);
    printf("failures  %d\n", failures);

    /* Positive control. The old decode is right for |D| <= 127 (256 values per
     * axis) and wrong for the other 256 — the fast-flick regime. If this count
     * is not exactly 512 across both axes, the test is not exercising what it
     * claims to and its pass means nothing. */
    printf("old decode wrong on %d of %d — expected 512\n", old_wrong, checked);
    if (old_wrong != 512) {
        printf("  FAIL control: this test would not have caught the original bug\n");
        failures++;
    }

    /* The specific case from the bug report: a fast flick right. */
    int flick = ps2_delta9(0xC8, 0x08, PS2_SIGN_X);
    if (flick != 200) { fail("flick", 200, flick, 0xC8, 0x08); }
    else printf("flick     +200 decodes as +200 (old decode gave %d)\n",
                old_decode(0xC8, 0x08, PS2_SIGN_X));

    printf(failures ? "\nFAILED\n" : "\nPASS\n");
    return failures ? 1 : 0;
}
