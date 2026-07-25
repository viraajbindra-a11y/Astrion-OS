/* Gate for the weight converter + the C loader (M6): tools/mkweights.py against
 * src/model_load.c, closing the loop the whole engine hangs on.
 *
 * SELF-CHECKING BY CONSTRUCTION. The path is: mkweights.py quantises the oracle's
 * weights and serialises a blob -> model_load() deserialises it zero-copy ->
 * model_forward() runs it. Any byte-layout disagreement between the Python
 * producer and the C consumer lands as a logit mismatch, so a format bug on
 * EITHER side fails this test — the same discipline q8_dot and the forward pass
 * met. The loaded weights are int8-only, so this exercises MODEL_Q8 (the shipped
 * path); the reference is the float64 oracle (RF_LOGITS / RF_QK_LOGITS).
 *
 * FOUR THINGS, each with a control that must fail against the bug it guards:
 *   1. ROUND TRIP, qk-norm OFF  — loaded logits match RF_LOGITS within the Q8
 *      budget, and the greedy argmax matches the oracle at every position.
 *   2. ROUND TRIP, qk-norm ON   — same, against RF_QK_LOGITS, so the Ember-shape
 *      config round-trips too (qk_g sections present).
 *   3. CONTROLS — corrupt one byte and prove it is caught: a weight byte ->
 *      logits diverge; a length byte -> the loader rejects.
 *   4. MALFORMED — truncated / bad magic / bad version / a section past the end /
 *      a mismatched matrix self-header / a bad matrix count / an unaligned base:
 *      each returns a reason, zeroes *out, and reads nothing past an EXACT-size
 *      buffer (run under -fsanitize=address to prove the last clause).
 *
 * Host program (full libc); it shells out to mkweights.py to produce the blob,
 * then #includes the freestanding engine + loader as one TU so it exercises the
 * EXACT source the kernel ships. Runs from kernel/ (as `make test` does).
 *
 *   cc -std=c11 -Wall -Wextra -Werror -Iinclude tests/test_model_load.c
 *   cc ... -fsanitize=address -g tests/test_model_load.c   (the over-read proof)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "model.h"
#include "q8.h"
#include "../tools/ref_forward_fixture.h"
#include "../src/model.c"           /* the engine under test, as one TU */
#include "../src/model_load.c"      /* the loader under test           */

#define TOL_Q8    5.0e-2            /* same Q8 budget test_model.c gates at */
#define MK        "python3 tools/mkweights.py"
#define BLOB_OFF  "build/_amw_test_off.bin"
#define BLOB_ON   "build/_amw_test_on.bin"
#define MAXL      64                /* caller layer storage; oracle uses 2 */

static int failures;

static double dabs(double x) { return x < 0.0 ? -x : x; }
static double fix2d(int64_t v) { return (double)v / (double)(1LL << Q8_SCALE_SHIFT); }

/* Run mkweights.py; hard-fail (never skip) if it cannot — a check that cannot
 * run must say so. */
static void gen_blob(const char *mode, const char *out)
{
    char cmd[256];
    snprintf(cmd, sizeof cmd, "%s %s %s >/dev/null", MK, mode, out);
    int rc = system(cmd);
    if (rc != 0) {
        printf("  FAIL could not run mkweights.py (%s) rc=%d — is python3+numpy present?\n", mode, rc);
        failures++;
    }
}

/* Read a whole file into an EXACTLY-sized malloc buffer (so ASan bounds the
 * loader's reads to the real blob). */
static uint8_t *read_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n <= 0) { fclose(f); return NULL; }
    uint8_t *buf = malloc((size_t)n);
    size_t got = fread(buf, 1, (size_t)n, f);
    fclose(f);
    if (got != (size_t)n) { free(buf); return NULL; }
    *out_len = (size_t)n;
    return buf;
}

/* Caller-owned scratch + KV cache from a loaded config (mirrors test_model.c). */
static void build_state(struct model_state *st, const struct model_config *c)
{
    memset(st, 0, sizeof *st);
    st->kcache   = malloc(model_kv_len(c) * sizeof(int64_t));
    st->vcache   = malloc(model_kv_len(c) * sizeof(int64_t));
    st->inv_freq = malloc((size_t)(c->head_dim / 2) * sizeof(int64_t));
    st->x   = malloc((size_t)c->dim * sizeof(int64_t));
    st->xn  = malloc((size_t)c->dim * sizeof(int64_t));
    st->q   = malloc((size_t)c->n_heads * c->head_dim * sizeof(int64_t));
    st->heads = malloc((size_t)c->n_heads * c->head_dim * sizeof(int64_t));
    st->scores = malloc((size_t)c->max_seq * sizeof(int64_t));
    st->ff1 = malloc((size_t)c->ffn_dim * sizeof(int64_t));
    st->ff2 = malloc((size_t)c->ffn_dim * sizeof(int64_t));
    st->tmp = malloc((size_t)c->dim * sizeof(int64_t));
    uint32_t mn = model_max_nin(c);
    st->act_fix = malloc((size_t)mn * sizeof(int64_t));
    st->act_q   = malloc((size_t)mn * sizeof(int8_t));
    st->act_qg  = malloc((size_t)(mn / Q8_GROUP) * sizeof(struct q8_group));
    model_rope_init(st, c);
}

static void free_state(struct model_state *st)
{
    free(st->kcache); free(st->vcache); free(st->inv_freq);
    free(st->x); free(st->xn); free(st->q); free(st->heads); free(st->scores);
    free(st->ff1); free(st->ff2); free(st->tmp);
    free(st->act_fix); free(st->act_q); free(st->act_qg);
}

/* Load `blob`, run the whole RF_TOKENS sequence in MODEL_Q8, and report the max
 * absolute logit deviation from `ref` plus the number of positions whose greedy
 * argmax disagrees with the oracle's. Returns the load-error string (NULL = ok).
 * `qk` selects whether qk-norm is expected on (it comes from the file, but the
 * caller knows which blob it handed us and this cross-checks the header). */
static const char *load_and_run(const uint8_t *blob, uint64_t len, int qk_expect,
                                const double *ref, double *maxdev, int *argmax_bad)
{
    struct model_weights w;
    struct model_layer layers[MAXL];
    const char *e = model_load(blob, len, &w, layers, MAXL);
    if (e) return e;

    if (w.cfg.qk_norm != (uint32_t)qk_expect) { printf("  FAIL header qk_norm %u, expected %d\n", w.cfg.qk_norm, qk_expect); failures++; }
    if (w.embed == NULL || w.layers == NULL)  { printf("  FAIL loaded weights have NULL sections\n"); failures++; }

    struct model_state st;
    build_state(&st, &w.cfg);
    st.mode = MODEL_Q8; st.pos = 0; st.trace = NULL; model_ctrl = 0;

    int64_t logits[RF_VOCAB];
    double md = 0.0;
    int bad = 0;
    for (int p = 0; p < RF_NTOK; p++) {
        model_forward(&w, &st, (uint32_t)RF_TOKENS[p], logits);
        for (int i = 0; i < RF_VOCAB; i++) {
            double d = dabs(fix2d(logits[i]) - ref[(size_t)p * RF_VOCAB + i]);
            if (d > md) md = d;
        }
        uint32_t am = model_argmax(logits, RF_VOCAB);
        int refmax = 0;
        for (int i = 1; i < RF_VOCAB; i++)
            if (ref[(size_t)p * RF_VOCAB + i] > ref[(size_t)p * RF_VOCAB + refmax]) refmax = i;
        if ((int)am != refmax) bad++;
    }
    free_state(&st);
    *maxdev = md;
    *argmax_bad = bad;
    return NULL;
}

static void want_below(const char *what, double got, double tol)
{
    if (got > tol) { printf("  FAIL %-42s %.3e > tol %.3e\n", what, got, tol); failures++; }
}
static void want_above(const char *what, double got, double tol)
{
    if (got <= tol) { printf("  FAIL %-42s %.3e <= tol %.3e (control did not fire)\n", what, got, tol); failures++; }
}
/* A malformed input must be REJECTED with the exact reason, and *out zeroed. */
static void want_reject(const char *what, const uint8_t *blob, uint64_t len, const char *want)
{
    struct model_weights w;
    struct model_layer layers[MAXL];
    const char *e = model_load(blob, len, &w, layers, MAXL);
    if (e == NULL) { printf("  FAIL %-38s ACCEPTED a malformed blob\n", what); failures++; return; }
    if (strcmp(e, want) != 0) { printf("  FAIL %-38s rejected \"%s\", expected \"%s\"\n", what, e, want); failures++; return; }
    if (w.embed != NULL || w.layers != NULL) { printf("  FAIL %-38s left *out non-zero after reject\n", what); failures++; return; }
    printf("reject     %-30s -> \"%s\"\n", what, e);
}

/* Little-endian field pokes into a mutable copy of the blob. */
static void put32(uint8_t *b, size_t off, uint32_t v)
{
    b[off] = v & 0xff; b[off+1] = (v>>8)&0xff; b[off+2] = (v>>16)&0xff; b[off+3] = (v>>24)&0xff;
}

int main(void)
{
    printf("config: %dL %dd %dh/%dkv head_dim %d ffn %d vocab %d  (%d tokens)\n",
           RF_NL, RF_DIM, RF_H, RF_KV, RF_HD, RF_FFN, RF_VOCAB, RF_NTOK);

    gen_blob("--oracle",    BLOB_OFF);
    gen_blob("--oracle-qk", BLOB_ON);
    if (failures) { printf("\nfailures  %d\nFAILED (blob generation)\n", failures); return 1; }

    size_t off_len = 0, on_len = 0;
    uint8_t *off = read_file(BLOB_OFF, &off_len);
    uint8_t *on  = read_file(BLOB_ON,  &on_len);
    if (!off || !on) { printf("  FAIL could not read generated blob(s)\n\nfailures 1\nFAILED\n"); return 1; }

    /* ── 1. round trip, qk-norm OFF ── */
    double md; int bad;
    const char *e = load_and_run(off, off_len, 0, RF_LOGITS, &md, &bad);
    if (e) { printf("  FAIL qk-off blob rejected: %s\n", e); failures++; }
    else {
        printf("qk-off     round-trip logits max|d| %.2e   argmax mismatches %d/%d\n", md, bad, RF_NTOK);
        want_below("qk-off round-trip logits vs oracle", md, TOL_Q8);
        if (bad) { printf("  FAIL qk-off argmax diverged from oracle at %d position(s)\n", bad); failures++; }
    }

    /* ── 2. round trip, qk-norm ON (Ember shape) ── */
    e = load_and_run(on, on_len, 1, RF_QK_LOGITS, &md, &bad);
    if (e) { printf("  FAIL qk-on blob rejected: %s\n", e); failures++; }
    else {
        printf("qk-on      round-trip logits max|d| %.2e   argmax mismatches %d/%d\n", md, bad, RF_NTOK);
        want_below("qk-on round-trip logits vs oracle", md, TOL_Q8);
        if (bad) { printf("  FAIL qk-on argmax diverged from oracle at %d position(s)\n", bad); failures++; }
    }

    /* ── 3a. control: corrupt one WEIGHT byte -> logits must diverge ──
     * Flip a high byte of embed[RF_TOKENS[0]] (used at position 0, so it
     * propagates through the whole sequence via the residual + KV cache). The
     * structure is untouched, so the loader still accepts it — the DIVERGENCE is
     * the catch, proving the round trip is reading real weight bytes. */
    {
        uint8_t *bad_blob = malloc(off_len);
        memcpy(bad_blob, off, off_len);
        /* embed section starts at the 80-byte header; [tok][0] is tok*dim int64s
         * in; corrupt byte 6 of that int64 (bits 48..55) — a large, safe change. */
        size_t idx = AMW_HDR + ((size_t)RF_TOKENS[0] * RF_DIM + 0) * sizeof(int64_t) + 6;
        bad_blob[idx] ^= 0xFF;
        double cmd_dev; int cmd_bad;
        const char *ce = load_and_run(bad_blob, off_len, 0, RF_LOGITS, &cmd_dev, &cmd_bad);
        if (ce) { printf("  FAIL corrupted-weight blob unexpectedly rejected: %s\n", ce); failures++; }
        else { printf("control    corrupt embed byte -> logits max|d| %.2e\n", cmd_dev);
               want_above("control: corrupt weight moves logits", cmd_dev, TOL_Q8); }
        free(bad_blob);
    }

    /* ── 3b. control: corrupt one LENGTH byte -> loader must reject ── */
    {
        uint8_t *bad_blob = malloc(off_len);
        memcpy(bad_blob, off, off_len);
        bad_blob[64] ^= 0x01;                       /* file_len low byte */
        want_reject("control: corrupt file_len", bad_blob, off_len, "length field mismatch");
        free(bad_blob);
    }

    /* ── 4. malformed inputs, each on an EXACT-size buffer ── */

    /* truncated below the header */
    {
        uint8_t *t = malloc(40); memcpy(t, off, 40);
        want_reject("truncated header", t, 40, "truncated header");
        free(t);
    }
    /* header ok, but the first section cannot fit */
    {
        uint8_t *t = malloc(200); memcpy(t, off, 200);
        want_reject("section past end (truncated body)", t, 200, "embed past end");
        free(t);
    }
    /* bad magic */
    {
        uint8_t *t = malloc(off_len); memcpy(t, off, off_len);
        t[0] ^= 0xFF;
        want_reject("bad magic", t, off_len, "bad magic");
        free(t);
    }
    /* bad version */
    {
        uint8_t *t = malloc(off_len); memcpy(t, off, off_len);
        put32(t, 4, 2);
        want_reject("bad version", t, off_len, "bad version");
        free(t);
    }
    /* a dimension inflated so a section runs past the (full-size) buffer */
    {
        uint8_t *t = malloc(off_len); memcpy(t, off, off_len);
        put32(t, 32, 5000);                         /* vocab 48 -> 5000: embed overflows */
        want_reject("dimension inflated past end", t, off_len, "embed past end");
        free(t);
    }
    /* a matrix self-header that disagrees with the config-derived layout (the
     * directory-free analog of an overlapping section). All vector sections are
     * multiples of 8 bytes and 8-aligned, so no padding sits between them: the
     * first matrix (layer-0 wq) header lands at a computable offset. */
    {
        uint8_t *t = malloc(off_len); memcpy(t, off, off_len);
        uint64_t vecs = (uint64_t)RF_VOCAB * RF_DIM + 2u * RF_DIM + RF_HHD + 2u * RF_KVD;
        size_t wq_hdr = AMW_HDR + (size_t)vecs * sizeof(int64_t);   /* rows @ wq_hdr, cols @ +4 */
        put32(t, wq_hdr + 4, 999);                  /* cols 64 -> 999 (mismatch, not /64) */
        want_reject("matrix self-header mismatch", t, off_len, "matrix cols mismatch");
        free(t);
    }
    /* a bad matrix count */
    {
        uint8_t *t = malloc(off_len); memcpy(t, off, off_len);
        put32(t, 72, 14);                           /* n_matrices 15 -> 14 */
        want_reject("matrix count mismatch", t, off_len, "matrix count mismatch");
        free(t);
    }
    /* an unaligned base: offset the pointer by one, shrink len to match */
    {
        struct model_weights w; struct model_layer layers[MAXL];
        const char *ue = model_load(off + 1, off_len - 1, &w, layers, MAXL);
        if (ue == NULL || strcmp(ue, "unaligned base") != 0) {
            printf("  FAIL unaligned base not rejected (got \"%s\")\n", ue ? ue : "NULL"); failures++;
        } else printf("reject     %-30s -> \"%s\"\n", "unaligned base", ue);
    }

    free(off); free(on);
    printf("\nfailures  %d\n", failures);
    printf(failures ? "FAILED\n" : "PASS\n");
    return failures ? 1 : 0;
}
