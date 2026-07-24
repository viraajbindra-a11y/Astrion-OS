/* Gate for the transformer forward pass — model.c against the numpy oracle.
 *
 * QEMU cannot tell a correct transformer from a subtly wrong one; a numeric diff
 * against tools/ref_forward.py can, the same discipline q8_dot met. This checks
 * op-by-op, not just at the logits, because a mid-layer sign error hides behind
 * a plausible-looking output — the first op to diverge past tolerance localizes
 * the bug.
 *
 * TWO GATES, deliberately separate:
 *   1. MODEL_FULL — int64 fixed-point weights, no int8. Isolates "is the
 *      forward-pass MATH right" from quantization. The only error vs the float64
 *      oracle is fixed-point rounding at Q8_SCALE_SHIFT (~1e-6 per value) and
 *      our soft-float transcendentals (~1e-8), so the bound is tight.
 *   2. MODEL_Q8 — the same weights quantized to int8. Measures the error int8
 *      ADDS on top of a forward pass already proven correct.
 *
 * Plus CONTROLS: flip one thing that must matter and prove the gate catches it.
 * RoPE and the GQA head-grouping are the two ops most likely to be subtly wrong,
 * so each has a dedicated control aimed at its own op's trace.
 *
 * This is a host program (full libc); it #includes the freestanding engine as
 * one TU so it exercises the EXACT source the kernel ships.
 *
 *   cc -std=c11 -Wall -Wextra -Werror -Iinclude tests/test_model.c
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "model.h"
#include "q8.h"
#include "../tools/ref_forward_fixture.h"
#include "../src/model.c"           /* the engine under test, as one TU */

/* ── tolerances, from the error budget and confirmed by the printed maxes ──
 *
 * The engine is all integer. The error vs the float64 oracle is Q20 fixed-point
 * rounding (~1e-6 per value) accumulated across two layers of matmuls, plus the
 * Q30 integer-polynomial transcendentals (~1e-8, so negligible beside the
 * interchange rounding).
 * FULL: measured worst op is 3.9e-5 (final RMSNorm), logits 1.6e-5; gated at
 *   1.5e-4, ~4x margin and >100x below the SMALLEST control effect (2e-2), so
 *   the band that passes cannot also hide a real bug.
 * Q8: int8 resolves a weight to ~1/127 = 0.8%, and the activation is quantized
 *   too, so ~1-2% per matmul is expected. Measured worst logit dev 2.0e-2;
 *   gated at 5e-2, with the argmax-invariance check below as the stronger gate.
 * These are deterministic: model.c is integer-only, so the numbers do not move
 * across platforms or compilers (unlike float rounding would). */
#define TOL_FULL   1.5e-4
#define TOL_Q8     5.0e-2

static int failures;

static double dabs(double x) { return x < 0.0 ? -x : x; }

/* The engine works entirely in int64 fixed-point at Q8_SCALE_SHIFT; the test
 * converts back to double ONLY to diff against the float64 oracle. */
static double fix2d(int64_t v) { return (double)v / (double)(1LL << Q8_SCALE_SHIFT); }

/* Weight converter's job (the host analog of M6): double -> int64 fixed-point at
 * Q8_SCALE_SHIFT, round to nearest so the "full precision" reference is unbiased. */
static int64_t w2fix(double v)
{
    return (int64_t)(v * (double)(1LL << Q8_SCALE_SHIFT) + (v >= 0.0 ? 0.5 : -0.5));
}

static int64_t *vecfix(const double *src, uint32_t n)
{
    int64_t *d = malloc((size_t)n * sizeof(int64_t));
    for (uint32_t i = 0; i < n; i++) d[i] = w2fix(src[i]);
    return d;
}

/* [rows][nin] doubles -> a model_matrix carrying BOTH the int64 fixed-point form
 * and the int8 q8 form, input axis zero-padded to a multiple of Q8_GROUP. */
static void build_matrix(struct model_matrix *M, const double *src,
                         uint32_t rows, uint32_t nin)
{
    uint32_t cols = model_pad(nin);
    uint32_t groups = cols / Q8_GROUP;
    int64_t *full = malloc((size_t)rows * cols * sizeof(int64_t));
    int8_t  *q    = malloc((size_t)rows * cols * sizeof(int8_t));
    struct q8_group *qg = malloc((size_t)rows * groups * sizeof(struct q8_group));
    for (uint32_t r = 0; r < rows; r++) {
        for (uint32_t c = 0; c < nin;  c++) full[(size_t)r * cols + c] = w2fix(src[(size_t)r * nin + c]);
        for (uint32_t c = nin; c < cols; c++) full[(size_t)r * cols + c] = 0;
        q8_quantize(&full[(size_t)r * cols], cols, &q[(size_t)r * cols], &qg[(size_t)r * groups]);
    }
    M->rows = rows; M->cols = cols; M->full = full; M->q = q; M->qg = qg;
}

static void build_weights(struct model_weights *w)
{
    struct model_config *c = &w->cfg;
    c->dim = RF_DIM;   c->n_layers = RF_NL;   c->n_heads = RF_H;   c->n_kv_heads = RF_KV;
    c->head_dim = RF_HD; c->ffn_dim = RF_FFN; c->vocab = RF_VOCAB; c->max_seq = RF_MAX_SEQ;
    c->rope_theta = RF_ROPE_THETA;            c->rms_eps_fp = RF_RMS_EPS_FP;

    w->embed    = vecfix(RF_EMBED, RF_VOCAB * RF_DIM);
    w->final_ln = vecfix(RF_FINAL_LN, RF_DIM);

    struct model_layer *layers = malloc(RF_NL * sizeof(struct model_layer));
    for (int l = 0; l < RF_NL; l++) {
        struct model_layer *L = &layers[l];
        L->ln1 = vecfix(RF_LN1 + (size_t)l * RF_DIM, RF_DIM);
        L->ln2 = vecfix(RF_LN2 + (size_t)l * RF_DIM, RF_DIM);
        build_matrix(&L->wq, RF_WQ + (size_t)l * RF_HHD * RF_DIM, RF_HHD, RF_DIM);
        L->bq  = vecfix(RF_BQ + (size_t)l * RF_HHD, RF_HHD);
        build_matrix(&L->wk, RF_WK + (size_t)l * RF_KVD * RF_DIM, RF_KVD, RF_DIM);
        L->bk  = vecfix(RF_BK + (size_t)l * RF_KVD, RF_KVD);
        build_matrix(&L->wv, RF_WV + (size_t)l * RF_KVD * RF_DIM, RF_KVD, RF_DIM);
        L->bv  = vecfix(RF_BV + (size_t)l * RF_KVD, RF_KVD);
        build_matrix(&L->wo, RF_WO + (size_t)l * RF_DIM * RF_HHD, RF_DIM, RF_HHD);
        build_matrix(&L->w_gate, RF_WGATE + (size_t)l * RF_FFN * RF_DIM, RF_FFN, RF_DIM);
        build_matrix(&L->w_up,   RF_WUP   + (size_t)l * RF_FFN * RF_DIM, RF_FFN, RF_DIM);
        build_matrix(&L->w_down, RF_WDOWN + (size_t)l * RF_DIM * RF_FFN, RF_DIM, RF_FFN);
    }
    w->layers = layers;
    build_matrix(&w->lm_head, RF_LMHEAD, RF_VOCAB, RF_DIM);
}

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

static void build_trace(struct model_trace *t, const struct model_config *c)
{
    size_t D = c->dim, NL = c->n_layers;
    t->ln1   = malloc(NL * D * sizeof(int64_t));
    t->qrope = malloc(NL * (size_t)c->n_heads * c->head_dim * sizeof(int64_t));
    t->krope = malloc(NL * (size_t)c->n_kv_heads * c->head_dim * sizeof(int64_t));
    t->attn  = malloc(NL * D * sizeof(int64_t));
    t->ln2   = malloc(NL * D * sizeof(int64_t));
    t->mlp   = malloc(NL * D * sizeof(int64_t));
    t->xout  = malloc(NL * D * sizeof(int64_t));
    t->final_norm = malloc(D * sizeof(int64_t));
}

/* Per-op max absolute deviation from the oracle, accumulated over the run. */
struct diffs { double ln1, qrope, krope, attn, ln2, mlp, xout, final, logits; };

static void upd(double *m, const int64_t *got, const double *ref, int n)
{
    for (int i = 0; i < n; i++) { double d = dabs(fix2d(got[i]) - ref[i]); if (d > *m) *m = d; }
}

/* Replay the whole token sequence and diff every captured op against the
 * oracle's dump for that (position, layer). */
static void run_sequence(struct model_weights *w, struct model_state *st,
                         struct model_trace *tr, struct diffs *df)
{
    int64_t logits[RF_VOCAB];
    memset(df, 0, sizeof *df);
    st->pos = 0;
    st->trace = tr;
    for (int p = 0; p < RF_NTOK; p++) {
        model_forward(w, st, (uint32_t)RF_TOKENS[p], logits);
        for (int l = 0; l < RF_NL; l++) {
            int op = (p * RF_NL + l);
            upd(&df->ln1,   tr->ln1   + (size_t)l * RF_DIM, RF_T_LN1   + (size_t)op * RF_DIM, RF_DIM);
            upd(&df->qrope, tr->qrope + (size_t)l * RF_HHD, RF_T_QROPE + (size_t)op * RF_HHD, RF_HHD);
            upd(&df->krope, tr->krope + (size_t)l * RF_KVD, RF_T_KROPE + (size_t)op * RF_KVD, RF_KVD);
            upd(&df->attn,  tr->attn  + (size_t)l * RF_DIM, RF_T_ATTN  + (size_t)op * RF_DIM, RF_DIM);
            upd(&df->ln2,   tr->ln2   + (size_t)l * RF_DIM, RF_T_LN2   + (size_t)op * RF_DIM, RF_DIM);
            upd(&df->mlp,   tr->mlp   + (size_t)l * RF_DIM, RF_T_MLP   + (size_t)op * RF_DIM, RF_DIM);
            upd(&df->xout,  tr->xout  + (size_t)l * RF_DIM, RF_T_XOUT  + (size_t)op * RF_DIM, RF_DIM);
        }
        upd(&df->final,  tr->final_norm, RF_T_FINAL  + (size_t)p * RF_DIM,   RF_DIM);
        upd(&df->logits, logits,         RF_LOGITS   + (size_t)p * RF_VOCAB, RF_VOCAB);
    }
}

static void print_diffs(const char *tag, const struct diffs *d)
{
    printf("%-10s ln1 %.2e  qrope %.2e  krope %.2e  attn %.2e  ln2 %.2e  "
           "mlp %.2e  xout %.2e  final %.2e  LOGITS %.2e\n",
           tag, d->ln1, d->qrope, d->krope, d->attn, d->ln2, d->mlp,
           d->xout, d->final, d->logits);
}

static void want_below(const char *what, double got, double tol)
{
    if (got > tol) { printf("  FAIL %-40s %.3e > tol %.3e\n", what, got, tol); failures++; }
}
static void want_above(const char *what, double got, double tol)
{
    if (got <= tol) { printf("  FAIL %-40s %.3e <= tol %.3e (control did not fire)\n",
                             what, got, tol); failures++; }
}

int main(void)
{
    struct model_weights w;
    struct model_state st;
    struct model_trace tr;
    build_weights(&w);
    build_state(&st, &w.cfg);
    build_trace(&tr, &w.cfg);

    printf("config: %uL %ud %uh/%ukv head_dim %u ffn %u vocab %u  (%d tokens)\n",
           w.cfg.n_layers, w.cfg.dim, w.cfg.n_heads, w.cfg.n_kv_heads,
           w.cfg.head_dim, w.cfg.ffn_dim, w.cfg.vocab, RF_NTOK);

    /* ── Gate 1: MODEL_FULL — is the math right ── */
    struct diffs full;
    st.mode = MODEL_FULL; model_ctrl = 0;
    run_sequence(&w, &st, &tr, &full);
    print_diffs("FULL", &full);
    want_below("full ln1",    full.ln1,    TOL_FULL);
    want_below("full qrope",  full.qrope,  TOL_FULL);
    want_below("full krope",  full.krope,  TOL_FULL);
    want_below("full attn",   full.attn,   TOL_FULL);
    want_below("full ln2",    full.ln2,    TOL_FULL);
    want_below("full mlp",    full.mlp,    TOL_FULL);
    want_below("full xout",   full.xout,   TOL_FULL);
    want_below("full final",  full.final,  TOL_FULL);
    want_below("full logits", full.logits, TOL_FULL);

    /* ── Gate 2: MODEL_Q8 — does quantization keep it right ── */
    struct diffs q8;
    st.mode = MODEL_Q8; model_ctrl = 0;
    run_sequence(&w, &st, &tr, &q8);
    print_diffs("Q8", &q8);
    want_below("q8 logits", q8.logits, TOL_Q8);

    /* argmax must survive quantization — the property sampling actually needs */
    {
        int64_t logits[RF_VOCAB];
        int argmax_ok = 1;
        st.mode = MODEL_Q8; st.pos = 0; st.trace = NULL;
        for (int p = 0; p < RF_NTOK; p++) {
            model_forward(&w, &st, (uint32_t)RF_TOKENS[p], logits);
            int am = 0;
            for (int i = 1; i < RF_VOCAB; i++) if (logits[i] > logits[am]) am = i;
            int ref = 0;
            for (int i = 1; i < RF_VOCAB; i++)
                if (RF_LOGITS[p * RF_VOCAB + i] > RF_LOGITS[p * RF_VOCAB + ref]) ref = i;
            if (am != ref) { argmax_ok = 0; printf("  argmax pos %d: q8 %d, oracle %d\n", p, am, ref); }
        }
        if (!argmax_ok) { printf("  FAIL q8 argmax diverged from oracle\n"); failures++; }
        else printf("argmax     q8 matches the oracle at all %d positions\n", RF_NTOK);
    }

    /* ── Controls: a gate that cannot fail is not a gate ── */
    st.mode = MODEL_FULL;

    /* drop the residual adds -> the residual stream and logits must break */
    struct diffs c_res;
    model_ctrl = MODEL_CTRL_NO_RESIDUAL;
    run_sequence(&w, &st, &tr, &c_res);
    model_ctrl = 0;
    print_diffs("noResid", &c_res);
    want_above("control: no-residual moves xout",   c_res.xout,   TOL_FULL);
    want_above("control: no-residual moves logits", c_res.logits, TOL_FULL);

    /* drop RoPE -> Q and K past position 0 must break (its own op, specifically) */
    struct diffs c_rope;
    model_ctrl = MODEL_CTRL_NO_ROPE;
    run_sequence(&w, &st, &tr, &c_rope);
    model_ctrl = 0;
    print_diffs("noRoPE", &c_rope);
    want_above("control: no-rope moves qrope", c_rope.qrope, TOL_FULL);
    want_above("control: no-rope moves krope", c_rope.krope, TOL_FULL);

    /* mis-map Q heads to KV heads (h%KV not h/group) -> attention must break */
    struct diffs c_gqa;
    model_ctrl = MODEL_CTRL_GQA_MISGROUP;
    run_sequence(&w, &st, &tr, &c_gqa);
    model_ctrl = 0;
    print_diffs("misGQA", &c_gqa);
    want_above("control: GQA mis-group moves attn", c_gqa.attn, TOL_FULL);

    printf("\nfailures  %d\n", failures);
    printf(failures ? "FAILED\n" : "PASS\n");
    return failures ? 1 : 0;
}
