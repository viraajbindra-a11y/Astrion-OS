#ifndef Q8_H
#define Q8_H

#include <stdint.h>

/* Int8 quantized matrix-vector multiply — the inner loop of the model.
 *
 * WHY INTEGER, when the obvious thing is float: the kernel builds
 * -mno-sse -mgeneral-regs-only, so every float operation lowers to a libgcc
 * soft-float CALL. Measured against the model sizes we care about that is
 * roughly 40 s/token at 0.6B — a short answer would take ten minutes. Integer
 * multiply-accumulate needs no SSE, no FPU state, and no XSAVE work in the
 * context switch, so this path runs TODAY on the kernel exactly as it builds.
 * Turning on AVX2 later makes this faster; it is not required to make it work.
 *
 * THE FORMAT: weights are grouped along the input axis, GROUP values per group,
 * each group carrying one scale. A weight is w = q * scale, q in [-127, 127].
 * -128 is never emitted so negation is always representable. Activations are
 * quantized the same way at runtime, per row.
 *
 * The accumulator is int32 and that bound is load-bearing rather than
 * incidental: |q| <= 127 on both sides gives 16129 per product, so int32
 * overflows only past 133,150 terms in a group. GROUP is 64. The margin is
 * three orders of magnitude, and the test asserts it rather than trusting this
 * comment.
 *
 * Every routine here is pure arithmetic over caller-owned memory: no
 * allocation, no globals, no kernel headers. That is deliberate — it means
 * kernel/tests/test_q8.c exercises the SAME source the kernel ships, on the
 * host, exhaustively. QEMU cannot meaningfully test arithmetic; a table of
 * cases can. */

#define Q8_GROUP 64

/* One quantization group: the scale its 64 weights share.
 *
 * Scale is itself an integer — a numerator over a fixed shift — because a
 * float scale would drag soft-float back into the hot loop through the back
 * door, which is the entire thing this format exists to avoid.
 * real_value = q * scale_num / (1 << Q8_SCALE_SHIFT) */
#define Q8_SCALE_SHIFT 20

struct q8_group {
    int32_t scale_num;
};

/* Dot product of one int8 row against one int8 vector, both grouped.
 *
 * Returns a fixed-point result at Q8_SCALE_SHIFT, i.e. the true value times
 * (1 << Q8_SCALE_SHIFT). The caller keeps it in that domain — converting to
 * anything float-shaped here would defeat the point.
 *
 * n must be a multiple of Q8_GROUP. Rows are padded at conversion time rather
 * than handled here, because a tail branch in the hot loop costs more than the
 * padding does and gives one more thing to get wrong.
 *
 * Returns 0 and touches nothing if n is not a multiple of Q8_GROUP — a caller
 * that gets this wrong has a layout bug, and reading past a row would be a
 * fault a long way from its cause. */
static inline int64_t q8_dot(const int8_t *w, const struct q8_group *wg,
                             const int8_t *x, const struct q8_group *xg,
                             uint32_t n)
{
    if (n == 0 || (n % Q8_GROUP) != 0) return 0;

    int64_t total = 0;
    uint32_t groups = n / Q8_GROUP;

    for (uint32_t g = 0; g < groups; g++) {
        const int8_t *wp = w + (uint64_t)g * Q8_GROUP;
        const int8_t *xp = x + (uint64_t)g * Q8_GROUP;

        /* int32 is deliberate and sufficient: see the bound above. This is the
         * loop an AVX2 rewrite replaces — 64 lanes of int8 multiply-accumulate
         * is exactly one vpmaddubsw plus a vpmaddwd, and keeping the scalar
         * version here as the reference is what makes that rewrite checkable. */
        int32_t acc = 0;
        for (uint32_t i = 0; i < Q8_GROUP; i++)
            acc += (int32_t)wp[i] * (int32_t)xp[i];

        /* Both scales fold in once per group rather than once per element,
         * which is the whole reason for grouping. The product of two
         * Q8_SCALE_SHIFT fixed-point numbers is at 2*shift, so shift back once.
         * Rounding is nearest-away-from-zero rather than truncation: 64 groups
         * of consistent downward bias is a real drift, not a rounding detail. */
        int64_t p = (int64_t)acc * wg[g].scale_num;
        p = (int64_t)((__int128)p * xg[g].scale_num >> Q8_SCALE_SHIFT);
        total += p;
    }
    return total;
}

/* Quantize n floats-as-fixed-point into int8 + per-group scales.
 *
 * Input is already fixed-point at Q8_SCALE_SHIFT: the caller is the host
 * converter or a previous layer's output, never a float. Writes ceil(n/GROUP)
 * groups.
 *
 * Returns 0 on a bad length, 1 on success. */
static inline int q8_quantize(const int64_t *src, uint32_t n,
                              int8_t *q, struct q8_group *g)
{
    if (n == 0 || (n % Q8_GROUP) != 0) return 0;

    for (uint32_t b = 0; b < n / Q8_GROUP; b++) {
        const int64_t *s = src + (uint64_t)b * Q8_GROUP;

        /* Largest magnitude in the group sets the scale. Taken as unsigned so
         * INT64_MIN cannot flip sign under negation — it cannot arise from our
         * own pipeline, but this reads data a converter produced and a value
         * that only appears in malformed input is exactly the one nobody
         * tests. */
        uint64_t peak = 0;
        for (uint32_t i = 0; i < Q8_GROUP; i++) {
            uint64_t m = s[i] < 0 ? (uint64_t)(-(s[i] + 1)) + 1u : (uint64_t)s[i];
            if (m > peak) peak = m;
        }

        if (peak == 0) {
            /* An all-zero group is common in a trained model and must not
             * divide by zero. Scale 0 with zero codes reconstructs exactly. */
            g[b].scale_num = 0;
            for (uint32_t i = 0; i < Q8_GROUP; i++) q[(uint64_t)b * Q8_GROUP + i] = 0;
            continue;
        }

        /* scale_num = peak / 127, and NOT (peak << SHIFT) / 127.
         *
         * The shift is already in the input. src is fixed-point at SHIFT, so
         * src = v * 2^SHIFT for a real v; we want q * scale ~= v with
         * scale_num = scale * 2^SHIFT, which makes q * scale_num ~= src
         * directly. Shifting again here scales by 2^SHIFT twice: the first
         * version of this overflowed int32 on any input above ~2000 and
         * clamped, silently flattening every large group to the same scale.
         * The round-trip test caught it as a 5.7-million error against a
         * tolerance of 2048.
         *
         * Rounded UP so the largest magnitude maps to at most 127 and can
         * never wrap to -128. */
        uint64_t num = (peak + 126) / 127;
        if (num == 0) num = 1;
        g[b].scale_num = (int32_t)(num > 0x7FFFFFFFull ? 0x7FFFFFFFull : num);

        for (uint32_t i = 0; i < Q8_GROUP; i++) {
            /* Round to nearest; truncation biases every weight toward zero and
             * across 600M of them that is a measurable accuracy loss. */
            int64_t v = s[i];
            int64_t den = g[b].scale_num;
            int64_t r = v >= 0 ? (v + den / 2) / den
                               : (v - den / 2) / den;
            if (r >  127) r =  127;
            if (r < -127) r = -127;   /* never -128: negation stays representable */
            q[(uint64_t)b * Q8_GROUP + i] = (int8_t)r;
        }
    }
    return 1;
}

#endif /* Q8_H */
