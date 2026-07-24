#ifndef MODEL_H
#define MODEL_H

#include <stdint.h>
#include "q8.h"

/* Transformer forward pass — the engine that turns a token id into next-token
 * logits. A Qwen2 block, ported operation-for-operation from the numpy oracle
 * (tools/ref_forward.py), which is the spec AND the gate: the C output is
 * checked layer-by-layer against it, the same discipline q8_dot met, because a
 * transformer that runs without crashing and produces subtly wrong numbers
 * reads as a bad model — the failure mode that costs a week.
 *
 * EVERYTHING IS INTEGER — no float anywhere, the same discipline as q8.h, and
 * it is the whole point. On x86-64 there is no software floating point: gcc with
 * -mno-sse cannot lower a double at all (it falls back to x87, live FPU state),
 * and -mgeneral-regs-only — which the kernel builds with — forbids even that,
 * failing with "SSE register return with SSE disabled" on the first double. So:
 *   - The heavy matmuls (the four attention projections, the three MLP
 *     matrices, the logit head) run through q8_dot — int8, no SSE.
 *   - The light math that a GPU would do in float — RMSNorm's 1/sqrt, RoPE's
 *     sin/cos, softmax's exp, SwiGLU's sigmoid, the residual stream itself — is
 *     int64 FIXED-POINT at Q8_SCALE_SHIFT, with the transcendentals evaluated by
 *     integer polynomial (see model.c). O(dim)/O(seq), noise beside the matmuls.
 * So model.c emits ZERO xmm, needs no XSAVE and no FPU state, and runs on the
 * kernel exactly as it builds today — the same codegen check q8.h passed.
 *
 * Every activation, weight, cache entry and logit is int64 fixed-point:
 * real value = fixed / 2^Q8_SCALE_SHIFT. The host test converts back to double
 * only to diff against the float64 oracle.
 *
 * CONFIG-DRIVEN, and this is load-bearing (tasks/ai-is-the-product/TWO-TRACKS.md):
 * every dimension is a field in struct model_config, read from the weight
 * file's header at load, never a #define. That one hook is what makes swapping
 * Qwen for a custom Astrion model a file-swap instead of a kernel rewrite.
 *
 * ALLOCATION-FREE, same discipline as q8.h: model.c allocates nothing and holds
 * no globals of consequence. The caller owns every buffer — the kernel points
 * them at kmalloc'd memory, the host test at malloc'd memory, and the SAME
 * source runs on both. */

/* RMS epsilon is carried as fixed-point at this shift so struct model_config
 * stays pure integer — a float field would be the one place soft-float leaked
 * into the struct the loader reads from a file. 40 bits represents 1e-8..1e-5
 * epsilons to better than 1e-6 relative, far tighter than eps ever needs. */
#define MODEL_EPS_SHIFT 40

/* Activations and full-precision weights share q8's fixed-point domain
 * (real = fixed / 2^Q8_SCALE_SHIFT) so a fixed-point activation feeds straight
 * into q8_quantize with no rescale. */

struct model_config {
    uint32_t dim;          /* model / residual width                          */
    uint32_t n_layers;     /* transformer blocks                              */
    uint32_t n_heads;      /* query heads                                     */
    uint32_t n_kv_heads;   /* key/value heads (< n_heads for grouped-query)   */
    uint32_t head_dim;     /* per-head width; n_heads*head_dim need not == dim */
    uint32_t ffn_dim;      /* SwiGLU inner width                              */
    uint32_t vocab;        /* logit count                                     */
    uint32_t max_seq;      /* KV-cache capacity in positions                  */
    int64_t  rope_theta;   /* integer RoPE base (Qwen2: 10000, Qwen3: 1e6)    */
    int64_t  rms_eps_fp;   /* RMS epsilon, fixed-point at MODEL_EPS_SHIFT      */
};

/* q8_dot requires the contraction length be a multiple of Q8_GROUP, so every
 * matmul's input axis is padded to one; the pad columns are zero in both the
 * weight and the activation copy, contributing nothing. */
static inline uint32_t model_pad(uint32_t n)
{
    return (n + (Q8_GROUP - 1u)) & ~(uint32_t)(Q8_GROUP - 1u);
}

enum model_mode {
    MODEL_FULL = 0,  /* int64 fixed-point weights: "is the forward-pass math right" */
    MODEL_Q8   = 1   /* int8 q8_dot weights:       "does quantization keep it right" */
};

/* One projection matrix, row-major [rows=out][cols=padded in]. It may carry the
 * full-precision form, the quantized form, or both; the kernel ships only Q8,
 * the host test builds both to separate math error from quantization error. */
struct model_matrix {
    uint32_t rows;                 /* output features                          */
    uint32_t cols;                 /* input features, padded to a Q8_GROUP mult */
    const int64_t         *full;   /* rows*cols int64 fixed-point, or NULL     */
    const int8_t          *q;      /* rows*cols int8 codes, or NULL            */
    const struct q8_group *qg;     /* rows*(cols/Q8_GROUP) scales, or NULL     */
};

/* Per-layer weights. Norm weights and QKV biases are int64 fixed-point vectors:
 * O(dim), so they never go through q8. wo, the MLP matrices and the lm head
 * carry no bias in Qwen2, matching the oracle. */
struct model_layer {
    const int64_t *ln1;            /* [dim]                                    */
    const int64_t *ln2;            /* [dim]                                    */
    struct model_matrix wq, wk, wv, wo;
    const int64_t *bq;             /* [n_heads*head_dim]                       */
    const int64_t *bk;             /* [n_kv_heads*head_dim]                    */
    const int64_t *bv;             /* [n_kv_heads*head_dim]                    */
    struct model_matrix w_gate, w_up, w_down;
};

struct model_weights {
    struct model_config cfg;
    const int64_t *embed;                 /* [vocab*dim] fixed-point           */
    const struct model_layer *layers;     /* [n_layers]                        */
    const int64_t *final_ln;              /* [dim] fixed-point                 */
    struct model_matrix lm_head;
};

/* Optional per-position op trace for the host test; NULL in the kernel. Every
 * field is int64 fixed-point at Q8_SCALE_SHIFT, like the rest of the pipeline.
 * model_forward fills these as it runs, so every op is checked in its real
 * integrated context (actual pipeline inputs, not re-fed oracle values) — a
 * mid-layer sign error shows up at its own op and the first op to diverge
 * localizes it. Each array is laid out [n_layers][...] by the caller. */
struct model_trace {
    int64_t *ln1;        /* [n_layers][dim]                RMSNorm before attn */
    int64_t *qrope;      /* [n_layers][n_heads*head_dim]   Q after RoPE        */
    int64_t *krope;      /* [n_layers][n_kv_heads*head_dim] K after RoPE       */
    int64_t *attn;       /* [n_layers][dim]                attn out, pre-resid */
    int64_t *ln2;        /* [n_layers][dim]                RMSNorm before MLP  */
    int64_t *mlp;        /* [n_layers][dim]                MLP out, pre-resid  */
    int64_t *xout;       /* [n_layers][dim]                layer out           */
    int64_t *final_norm; /* [dim]                          RMSNorm before head */
};

/* Caller-owned scratch + KV cache, all int64 fixed-point at Q8_SCALE_SHIFT.
 * Point every field at a buffer of the size the comment gives before the first
 * forward; call model_rope_init once. */
struct model_state {
    enum model_mode mode;
    uint32_t pos;              /* next cache slot / sequence position          */

    int64_t *kcache;          /* [n_layers*max_seq*n_kv_heads*head_dim]        */
    int64_t *vcache;          /* same                                          */
    int64_t *inv_freq;        /* [head_dim/2] RoPE inverse frequencies         */

    int64_t *x;               /* [dim] residual stream                         */
    int64_t *xn;              /* [dim] RMSNorm output                          */
    int64_t *q;               /* [n_heads*head_dim] (K and V go to the cache)  */
    int64_t *heads;           /* [n_heads*head_dim] attention out per head     */
    int64_t *scores;          /* [max_seq]                                     */
    int64_t *ff1;             /* [ffn_dim]                                     */
    int64_t *ff2;             /* [ffn_dim]                                     */
    int64_t *tmp;             /* [dim] op output (attn out / mlp out)          */

    int64_t         *act_fix; /* [model_max_nin(cfg)] matmul activation, fixed */
    int8_t          *act_q;   /* [model_max_nin(cfg)] matmul activation, int8  */
    struct q8_group *act_qg;  /* [model_max_nin(cfg)/Q8_GROUP]                 */

    struct model_trace *trace;  /* NULL unless the host test is watching       */
};

/* Test-only fault injection. Zero in the kernel; the host test flips exactly
 * one bit, runs, and asserts the gate CATCHES the resulting divergence — a gate
 * that cannot fail is not a gate. RoPE and the GQA head-grouping are the two
 * ops most likely to be subtly wrong, so each has its own control. */
extern unsigned model_ctrl;
#define MODEL_CTRL_NO_RESIDUAL   1u   /* drop the residual adds               */
#define MODEL_CTRL_NO_ROPE       2u   /* skip RoPE on Q and K                 */
#define MODEL_CTRL_GQA_MISGROUP  4u   /* map Q head -> KV head as h%KV, not h/group */

/* Precompute RoPE inverse frequencies into st->inv_freq. Call once after the
 * config is set and before the first forward. */
void model_rope_init(struct model_state *st, const struct model_config *cfg);

/* One decode step: consume `token` at position st->pos, write logits[vocab]
 * (int64 fixed-point at Q8_SCALE_SHIFT), advance st->pos. Attention reads the KV
 * cache over positions 0..pos. The caller must keep st->pos < cfg.max_seq (the
 * cache capacity); at or past it this is a no-op that leaves logits untouched,
 * so the caller owns the stop-or-slide policy. */
void model_forward(const struct model_weights *w, struct model_state *st,
                   uint32_t token, int64_t *logits);

/* ── size helpers (pure arithmetic; the caller allocates) ── */

/* Longest matmul contraction axis, padded — the size act_fix/act_q must be. */
static inline uint32_t model_max_nin(const struct model_config *c)
{
    uint32_t a = c->dim;
    uint32_t b = c->n_heads * c->head_dim;
    uint32_t d = c->ffn_dim;
    uint32_t m = a > b ? a : b;
    if (d > m) m = d;
    return model_pad(m);
}

/* Total doubles in one KV cache (kcache and vcache are each this long). */
static inline uint64_t model_kv_len(const struct model_config *c)
{
    return (uint64_t)c->n_layers * c->max_seq * c->n_kv_heads * c->head_dim;
}

#endif /* MODEL_H */
