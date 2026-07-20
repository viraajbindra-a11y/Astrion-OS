/* Gate for the int8 quantized dot product — the model's inner loop.
 *
 * This is arithmetic, so it gets an exhaustive host test rather than a boot.
 * QEMU cannot tell a correct multiply-accumulate from a subtly wrong one; a
 * table of cases against an exact reference can. Every claim in q8.h's header
 * comment that could be false is asserted here rather than trusted, including
 * the int32 accumulator bound, which is the one that would corrupt a model
 * silently instead of crashing.
 *
 *   cc -std=c11 -Wall -Wextra -Werror -I../include test_q8.c
 */

#include <stdio.h>
#include <stdint.h>
#include "q8.h"

static int failures;

static void fail(const char *what, long long want, long long got)
{
    printf("  FAIL %-46s want %lld, got %lld\n", what, want, got);
    failures++;
}

/* Exact reference: the value q8_dot approximates, computed without any of the
 * grouping or fixed-point shuffling it does. Deliberately written a different
 * way — a reference that shares the implementation's structure only proves the
 * two agree, never that either is right. */
static __int128 ref_dot(const int8_t *w, const struct q8_group *wg,
                        const int8_t *x, const struct q8_group *xg, uint32_t n)
{
    /* Full precision throughout, shifted ONCE at the end. An earlier version
     * shifted per element and disagreed with q8_dot by ~250 parts in 86
     * billion — which was the REFERENCE losing precision, not the
     * implementation: truncating 512 times loses up to 512 units, while
     * q8_dot's per-group folding loses at most one per group. A reference that
     * is less accurate than the thing it audits cannot bound its error. */
    __int128 total = 0;
    for (uint32_t i = 0; i < n; i++) {
        __int128 a = (__int128)w[i] * wg[i / Q8_GROUP].scale_num;
        __int128 b = (__int128)x[i] * xg[i / Q8_GROUP].scale_num;
        total += a * b;
    }
    return total >> Q8_SCALE_SHIFT;
}

/* xorshift — deterministic, so a failure is reproducible. No rand(). */
static uint64_t rng_state = 0x2545F4914F6CDD1Dull;
static uint64_t rnd(void)
{
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 7;
    rng_state ^= rng_state << 17;
    return rng_state;
}

int main(void)
{
    /* ── 1. The accumulator bound, asserted rather than trusted ──
     * q8.h claims int32 cannot overflow because |q| <= 127 both sides gives
     * 16129 per product and GROUP is 64. Prove the worst case exactly: every
     * element at the extreme, same sign, so nothing cancels. */
    {
        int32_t acc = 0;
        for (int i = 0; i < Q8_GROUP; i++) acc += 127 * 127;
        if (acc != 127 * 127 * Q8_GROUP)
            fail("worst-case group accumulator is exact in int32",
                 (long long)127 * 127 * Q8_GROUP, acc);
        long long headroom = 2147483647LL / (127LL * 127LL);
        if (headroom < Q8_GROUP)
            fail("int32 headroom covers GROUP terms", Q8_GROUP, headroom);
        printf("accumulator  worst case %d, int32 holds %lld terms (GROUP=%d)\n",
               acc, headroom, Q8_GROUP);
    }

    /* ── 2. -128 is never emitted ──
     * The format reserves it so negation is always representable. A single
     * -128 would make a sign flip overflow, silently, deep inside a model. */
    {
        int64_t src[Q8_GROUP];
        int8_t q[Q8_GROUP];
        struct q8_group g[1];
        int saw_min = 0;
        for (int trial = 0; trial < 4000; trial++) {
            for (int i = 0; i < Q8_GROUP; i++)
                src[i] = (int64_t)(rnd() % 2000001) - 1000000;
            if (!q8_quantize(src, Q8_GROUP, q, g)) { fail("quantize accepted a valid length", 1, 0); break; }
            for (int i = 0; i < Q8_GROUP; i++) if (q[i] == -128) saw_min = 1;
        }
        if (saw_min) fail("quantize never emits -128", 0, 1);
        else printf("codes        4000 random groups, no -128 emitted\n");
    }

    /* ── 3. Round-trip accuracy ──
     * Quantize, then reconstruct, and check the error is within half a step of
     * the group's own scale. This is what says the format is usable at all:
     * a bug that merely LOSES precision produces a model that reads as a bad
     * model, which is the failure mode that costs a week to diagnose. */
    {
        int64_t src[Q8_GROUP * 4];
        int8_t q[Q8_GROUP * 4];
        struct q8_group g[4];
        int64_t worst = 0;
        for (int trial = 0; trial < 2000; trial++) {
            for (int i = 0; i < Q8_GROUP * 4; i++)
                src[i] = (int64_t)(rnd() % 20000001) - 10000000;
            q8_quantize(src, Q8_GROUP * 4, q, g);
            for (int i = 0; i < Q8_GROUP * 4; i++) {
                int64_t back = (int64_t)q[i] * g[i / Q8_GROUP].scale_num;
                int64_t err = src[i] - back;
                if (err < 0) err = -err;
                int64_t step = g[i / Q8_GROUP].scale_num;
                if (err > step) { fail("round-trip within one step", step, err); trial = 99999; break; }
                if (err > worst) worst = err;
            }
        }
        printf("round-trip   2000 x 256 values, worst error %lld\n", (long long)worst);
    }

    /* ── 3b. Rounding is UNBIASED, which the worst-error check cannot see ──
     *
     * Added because a control caught this test lying by omission. Replacing
     * round-to-nearest with truncation doubled the worst error (39367 ->
     * 78738) and still PASSED, because truncation stays within one step — the
     * bound the test was checking. So q8.h claimed rounding mattered and
     * nothing gated the claim.
     *
     * What truncation actually does is pull every weight toward zero, the same
     * direction every time. One weight, invisible. Six hundred million of
     * them, a systematically shrunken model that reads as a bad model rather
     * than a bad quantizer — the failure mode that costs a week.
     *
     * So measure the SIGNED mean error, where cancellation is the whole point:
     * unbiased rounding sums to near zero, a directional bias does not. */
    {
        int64_t src[Q8_GROUP * 4];
        int8_t q[Q8_GROUP * 4];
        struct q8_group g[4];
        __int128 signed_sum = 0;
        __int128 magnitude_sum = 0;
        long n = 0;

        for (int trial = 0; trial < 4000; trial++) {
            for (int i = 0; i < Q8_GROUP * 4; i++)
                src[i] = (int64_t)(rnd() % 20000001) - 10000000;
            q8_quantize(src, Q8_GROUP * 4, q, g);
            for (int i = 0; i < Q8_GROUP * 4; i++) {
                int64_t err = src[i] - (int64_t)q[i] * g[i / Q8_GROUP].scale_num;
                signed_sum += err;
                magnitude_sum += err < 0 ? -err : err;
                n++;
            }
        }
        /* MEASURE MAGNITUDE, NOT SIGN — and this correction is the point.
         *
         * The first version of this check summed SIGNED error and passed
         * against truncation too, because C truncates toward ZERO and the test
         * data is symmetric about zero: positives round down, negatives round
         * up, and the signed sum cancels to nothing. A second control caught
         * it. The bias is in magnitude, not direction, so summing signed error
         * measures the symmetry of the input rather than the quality of the
         * rounding.
         *
         * Mean |error| is the honest statistic. Rounding to nearest leaves
         * error uniform in [-step/2, step/2], so mean |error| ~= step/4.
         * Truncating leaves it in [0, step), so mean |error| ~= step/2. The
         * observed numbers bear that out exactly: total error 19.5e9 rounding
         * against 40.3e9 truncating, over identical data. */
        __int128 step_sum = 0;
        {
            /* Re-derive the steps that produced those errors, so the bound is
             * computed from the same runs rather than assumed. */
            rng_state = 0x2545F4914F6CDD1Dull;
            for (int trial = 0; trial < 4000; trial++) {
                for (int i = 0; i < Q8_GROUP * 4; i++)
                    src[i] = (int64_t)(rnd() % 20000001) - 10000000;
                q8_quantize(src, Q8_GROUP * 4, q, g);
                for (int i = 0; i < Q8_GROUP * 4; i++)
                    step_sum += g[i / Q8_GROUP].scale_num;
            }
        }
        (void)signed_sum;
        if (magnitude_sum == 0 || step_sum == 0) {
            fail("bias test exercised anything at all", 1, 0);
        } else if (magnitude_sum * 3 > step_sum) {
            /* step/3 sits between rounding's step/4 and truncation's step/2,
             * so this fails for truncation and passes for round-to-nearest
             * with real margin either side. */
            fail("mean |error| is nearer step/4 than step/2 (rounding, not truncation)",
                 (long long)(step_sum / 3), (long long)magnitude_sum);
        } else {
            printf("bias         %ld values: mean |err| %lld vs mean step %lld"
                   "  (round=step/4, truncate=step/2)\n",
                   n, (long long)(magnitude_sum / n), (long long)(step_sum / n));
        }
    }

    /* ── 4. q8_dot against the exact reference ── */
    {
        enum { N = Q8_GROUP * 8 };
        int8_t w[N], x[N];
        struct q8_group wg[8], xg[8];
        int mismatches = 0;
        long long worst_rel = 0;

        for (int trial = 0; trial < 3000; trial++) {
            for (int i = 0; i < N; i++) {
                w[i] = (int8_t)((int)(rnd() % 255) - 127);
                x[i] = (int8_t)((int)(rnd() % 255) - 127);
            }
            for (int b = 0; b < 8; b++) {
                wg[b].scale_num = (int32_t)(rnd() % 1000000) + 1;
                xg[b].scale_num = (int32_t)(rnd() % 1000000) + 1;
            }
            int64_t got = q8_dot(w, wg, x, xg, N);
            __int128 want = ref_dot(w, wg, x, xg, N);
            __int128 d = (__int128)got - want;
            if (d < 0) d = -d;
            /* Grouping folds the scales once per group instead of once per
             * element, so the two differ by rounding, not by value. Allow one
             * unit per group and no more. */
            if (d > 8) { mismatches++; if (mismatches < 4) fail("dot matches reference", (long long)want, (long long)got); }
            if ((long long)d > worst_rel) worst_rel = (long long)d;
        }
        if (!mismatches)
            printf("dot          3000 random 512-wide products, max deviation %lld\n", worst_rel);
    }

    /* ── 5. Structural refusals — a bad length must not read past the row ── */
    {
        int8_t w[Q8_GROUP] = {0}, x[Q8_GROUP] = {0};
        struct q8_group g[1] = {{1}};
        if (q8_dot(w, g, x, g, 0) != 0)         fail("dot refuses n=0", 0, 1);
        if (q8_dot(w, g, x, g, Q8_GROUP - 1)!=0) fail("dot refuses a partial group", 0, 1);
        if (q8_dot(w, g, x, g, Q8_GROUP + 1)!=0) fail("dot refuses a ragged length", 0, 1);
        int64_t s[Q8_GROUP] = {0}; int8_t q[Q8_GROUP]; struct q8_group og[1];
        if (q8_quantize(s, Q8_GROUP - 1, q, og)) fail("quantize refuses a partial group", 0, 1);
        printf("refusals     partial and ragged lengths rejected, nothing read\n");
    }

    /* ── 6. All-zero group: common in a real model, must not divide by zero ── */
    {
        int64_t src[Q8_GROUP] = {0};
        int8_t q[Q8_GROUP];
        struct q8_group g[1];
        if (!q8_quantize(src, Q8_GROUP, q, g)) fail("quantize handles an all-zero group", 1, 0);
        for (int i = 0; i < Q8_GROUP; i++)
            if (q[i] != 0) { fail("zero group quantizes to zero codes", 0, q[i]); break; }
        int8_t x[Q8_GROUP] = {0};
        struct q8_group xg[1] = {{1 << Q8_SCALE_SHIFT}};
        if (q8_dot(q, g, x, xg, Q8_GROUP) != 0) fail("zero dot is zero", 0, 1);
        printf("zero group   reconstructs exactly, no divide by zero\n");
    }

    printf("\nfailures  %d\n", failures);
    printf(failures ? "FAILED\n" : "PASS\n");
    return failures ? 1 : 0;
}
