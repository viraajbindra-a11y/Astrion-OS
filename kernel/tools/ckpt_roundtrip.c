/* ckpt_roundtrip.c — run ANY converted brain file through the real C engine and
 * diff it against an external reference. This is the gate the whole two-track
 * plan hangs on: it proves a model exported by tools/mkweights.py (from the
 * numpy oracle now, from a real Ember torch checkpoint later) computes, under
 * the kernel's int8 fixed-point engine, the SAME thing the model itself does.
 *
 * WHY A FILE-DRIVEN HARNESS, not a baked fixture like test_model_load.c: the
 * checkpoint path's reference logits come from torch (custom-model/train.py's
 * GPT), which does not run on this Mac. So the reference is handed in as a file
 * produced wherever torch lives (the training PC). The config is read from the
 * blob's own header, so ONE harness verifies any shape — the tiny oracle model
 * today, the 341M Ember tomorrow — with no recompile.
 *
 * It #includes the freestanding engine + loader as one TU, so it exercises the
 * EXACT source src/model_load.c and src/model.c the kernel ships — a format or
 * convention bug on either side lands as a logit blow-up here, the same
 * self-checking discipline as test_model_load.c.
 *
 *   usage:  ckpt_roundtrip <blob.astrion> <ref.txt> [tol]
 *   ref.txt:  first two ints  = ntok vocab
 *             next ntok ints  = the input token ids
 *             then ntok*vocab doubles = reference logits, position-major
 *             (whitespace-separated throughout; '#' begins a comment to EOL)
 *
 *   cc -std=c11 -Wall -Wextra -Werror -Iinclude tools/ckpt_roundtrip.c -o build/ckpt_roundtrip
 *
 * Exit 0 and "PASS" iff every position's argmax matches the reference AND the
 * max absolute logit deviation is within tol (default 5e-2, the Q8 budget the
 * rest of the engine gates at). Anything else prints why and exits non-zero.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>

#include "model.h"
#include "q8.h"
#include "../src/model.c"           /* the engine under test, as one TU */
#include "../src/model_load.c"      /* the loader under test           */

#define MAXL 128                    /* caller layer storage; Ember is 24 */

/* THE PRIMARY GATE IS ARGMAX, not the logit deviation. A convention or format
 * bug (RoPE, GQA head-grouping, QK-norm placement, a byte-layout slip) corrupts
 * the computation and flips the greedy pick — argmax mismatches AND a deviation
 * of ~0.5+ (the QK-norm toggle alone moves logits 0.76). Quantization error, by
 * contrast, preserves argmax and its ABSOLUTE size grows with model depth/width:
 * the dim-32/2-layer oracle sits at ~5e-2, a dim-64/3-layer model at ~6e-2, and
 * the 24-layer Ember will be larger still. So the deviation bound is a coarse
 * guard against gross corruption, set well below bug-scale but above honest deep
 * quantization; override it per-model with argv[3] when you want it tight. The
 * CKPT_CTRL env var ORs a MODEL_CTRL_* bit in to prove this harness actually
 * fails on a planted bug — a gate that cannot fail is not a gate.
 *
 * USE A SHALLOW MODEL FOR A CLEAN ARGMAX GATE. On RANDOM weights at depth, int8
 * quantization ALONE flips near-tied argmaxes: a dim-256/16-layer/vocab-4096
 * random model diverges from the float oracle at ~13/64 positions — but that is
 * NOT a bug. A numpy weight-only int8 simulation reproduces it (11/64, the SAME
 * positions), so the engine is faithfully tracking quantization, not miscomputing.
 * Convention/format bugs are layer-count-independent — they show at 2-3 layers
 * just as loudly (the controls prove it). So verify the CONVERTER with a shallow
 * model, where argmax is decisive; a trained model's confident logits (not random
 * near-ties) are what keep argmax robust at Ember's real depth. */
#define DEF_TOL 3.0e-1

static double dabs(double x) { return x < 0.0 ? -x : x; }
static double fix2d(int64_t v) { return (double)v / (double)(1LL << Q8_SCALE_SHIFT); }

/* Read a whole file into an exactly-sized malloc buffer. malloc is 16-aligned on
 * this platform, so model_load's "unaligned base" check passes. */
static uint8_t *read_blob(const char *path, uint64_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open blob %s\n", path); return NULL; }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n <= 0) { fclose(f); fprintf(stderr, "empty blob %s\n", path); return NULL; }
    uint8_t *buf = malloc((size_t)n);
    size_t got = fread(buf, 1, (size_t)n, f);
    fclose(f);
    if (got != (size_t)n) { free(buf); fprintf(stderr, "short read on %s\n", path); return NULL; }
    *out_len = (uint64_t)n;
    return buf;
}

/* Whitespace-separated scan that skips '#'..EOL comments, so a reference file
 * can annotate itself. Returns 0 on clean EOF, 1 on a value read. */
static int next_double(FILE *f, double *v)
{
    int c;
    for (;;) {
        c = fgetc(f);
        if (c == EOF) return 0;
        if (c == '#') { while ((c = fgetc(f)) != EOF && c != '\n') {} continue; }
        if (isspace(c)) continue;
        ungetc(c, f);
        return fscanf(f, "%lf", v) == 1;
    }
}

/* Caller-owned scratch + KV cache from a loaded config (mirrors test_model_load.c). */
static void build_state(struct model_state *st, const struct model_config *c)
{
    memset(st, 0, sizeof *st);
    st->kcache   = malloc(model_kv_len(c) * sizeof(int64_t));
    st->vcache   = malloc(model_kv_len(c) * sizeof(int64_t));
    st->inv_freq = malloc((size_t)(c->head_dim / 2) * sizeof(int64_t));
    st->x   = malloc((size_t)c->dim * sizeof(int64_t));
    st->xn  = malloc((size_t)c->dim * sizeof(int64_t));
    st->q   = malloc((size_t)c->n_heads * c->head_dim * sizeof(int64_t));
    st->heads  = malloc((size_t)c->n_heads * c->head_dim * sizeof(int64_t));
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

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s <blob.astrion> <ref.txt> [tol]\n", argv[0]);
        return 2;
    }
    double tol = (argc >= 4) ? atof(argv[3]) : DEF_TOL;

    /* ── load the brain file through the real loader ── */
    uint64_t len = 0;
    uint8_t *blob = read_blob(argv[1], &len);
    if (!blob) return 2;

    struct model_weights w;
    struct model_layer layers[MAXL];
    const char *e = model_load(blob, len, &w, layers, MAXL);
    if (e) { fprintf(stderr, "model_load rejected %s: %s\n", argv[1], e); free(blob); return 2; }

    printf("loaded %s: %uL dim %u  %uh/%ukv  head_dim %u  ffn %u  vocab %u  max_seq %u  qk_norm %u\n",
           argv[1], w.cfg.n_layers, w.cfg.dim, w.cfg.n_heads, w.cfg.n_kv_heads,
           w.cfg.head_dim, w.cfg.ffn_dim, w.cfg.vocab, w.cfg.max_seq, w.cfg.qk_norm);

    /* ── read the reference: ntok, vocab, tokens, then the logit grid ── */
    FILE *rf = fopen(argv[2], "r");
    if (!rf) { fprintf(stderr, "cannot open ref %s\n", argv[2]); free(blob); return 2; }
    double dv;
    if (!next_double(rf, &dv)) { fprintf(stderr, "ref: missing ntok\n"); goto ref_err; }
    int ntok = (int)dv;
    if (!next_double(rf, &dv)) { fprintf(stderr, "ref: missing vocab\n"); goto ref_err; }
    int vocab = (int)dv;

    if (ntok <= 0 || vocab <= 0) { fprintf(stderr, "ref: bad ntok/vocab %d/%d\n", ntok, vocab); goto ref_err; }
    if ((uint32_t)vocab != w.cfg.vocab) {
        fprintf(stderr, "ref vocab %d != blob vocab %u — mismatched model\n", vocab, w.cfg.vocab);
        goto ref_err;
    }
    if ((uint32_t)ntok > w.cfg.max_seq) {
        fprintf(stderr, "ref ntok %d > blob max_seq %u — cache too small\n", ntok, w.cfg.max_seq);
        goto ref_err;
    }

    uint32_t *toks = malloc((size_t)ntok * sizeof(uint32_t));
    for (int p = 0; p < ntok; p++) {
        if (!next_double(rf, &dv)) { fprintf(stderr, "ref: missing token %d\n", p); free(toks); goto ref_err; }
        if (dv < 0 || (uint32_t)dv >= w.cfg.vocab) {
            fprintf(stderr, "ref: token %d = %d out of range\n", p, (int)dv); free(toks); goto ref_err;
        }
        toks[p] = (uint32_t)dv;
    }
    double *ref = malloc((size_t)ntok * (size_t)vocab * sizeof(double));
    for (long i = 0; i < (long)ntok * vocab; i++) {
        if (!next_double(rf, &ref[i])) {
            fprintf(stderr, "ref: missing logit %ld of %ld\n", i, (long)ntok * vocab);
            free(toks); free(ref); goto ref_err;
        }
    }
    fclose(rf);

    /* ── run the whole sequence in the shipped int8 path, diff each position ── */
    struct model_state st;
    build_state(&st, &w.cfg);
    st.mode = MODEL_Q8; st.pos = 0; st.trace = NULL;
    /* Test-only: CKPT_CTRL=<bits> plants a MODEL_CTRL_* fault so a self-check can
     * prove a real convention bug is caught. Zero (unset) in every real run. */
    const char *ctrl_env = getenv("CKPT_CTRL");
    model_ctrl = ctrl_env ? (unsigned)strtoul(ctrl_env, NULL, 0) : 0u;
    if (model_ctrl) fprintf(stderr, "CKPT_CTRL planted: model_ctrl=%u\n", model_ctrl);

    int64_t *logits = malloc((size_t)vocab * sizeof(int64_t));
    double maxdev = 0.0, maxref = 0.0;
    int argmax_bad = 0;
    for (int p = 0; p < ntok; p++) {
        model_forward(&w, &st, toks[p], logits);
        for (int i = 0; i < vocab; i++) {
            double r = ref[(size_t)p * vocab + i];
            if (dabs(r) > maxref) maxref = dabs(r);
            double d = dabs(fix2d(logits[i]) - r);
            if (d > maxdev) maxdev = d;
        }
        uint32_t am = model_argmax(logits, (uint32_t)vocab);
        int refmax = 0;
        for (int i = 1; i < vocab; i++)
            if (ref[(size_t)p * vocab + i] > ref[(size_t)p * vocab + refmax]) refmax = i;
        if ((int)am != refmax) {
            argmax_bad++;
            fprintf(stderr, "  pos %d: engine argmax %u, reference %d\n", p, am, refmax);
        }
    }
    free(logits); free_state(&st); free(toks); free(ref); free(blob);

    double rel = maxref > 0.0 ? maxdev / maxref : maxdev;
    printf("%d tokens  argmax mismatches %d/%d  max|d| %.3e  (rel %.2f%% of peak |logit| %.3e, tol %.3e)\n",
           ntok, argmax_bad, ntok, maxdev, 100.0 * rel, maxref, tol);

    int ok = (argmax_bad == 0) && (maxdev <= tol);
    if (argmax_bad)     printf("FAIL — greedy pick diverged: a convention or format bug corrupts the computation\n");
    else if (maxdev > tol) printf("FAIL — argmax held but deviation %.3e exceeds gross-corruption guard %.3e\n", maxdev, tol);
    else                printf("PASS — engine reproduces the reference (argmax exact, deviation within quantization)\n");
    return ok ? 0 : 1;

ref_err:
    fclose(rf);
    free(blob);
    return 2;
}
