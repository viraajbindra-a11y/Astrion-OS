/*
 * Astrion v2.0 — on-device char-level GPT inference (see gpt.h).
 *
 * Forward pass mirrors train_gpt.py exactly: token+pos embed, then NLAYER ×
 * [LayerNorm, single-head causal self-attention (+residual), LayerNorm,
 * ReLU MLP (+residual)], final LayerNorm, linear head. Generation is
 * incremental: each step computes ONLY the new token's q/k/v, appends k/v to
 * a per-layer cache, and attends over the cache — so per-token cost is O(T)
 * instead of O(T^2), which is what makes soft-float inference fast enough to
 * watch live on bare metal.
 *
 * No SSE: float arithmetic lowers to libgcc soft-float. expf/sqrtf are ours
 * (no libm). Sampling uses a small xorshift PRNG seeded from the PIT.
 */
#include <stdint.h>
#include "gpt.h"
#include "gpt_weights.h"
#include "heap.h"
#include "pit.h"
#include "task.h"

#define C   GPT_NEMBD
#define L   GPT_NLAYER
#define V   GPT_VOCAB
#define BLK GPT_BLOCK

/* ---- tiny freestanding math (no libm) ---- */
static float f_sqrt(float x) {
    if (x <= 0.0f) return 0.0f;
    float r = x > 1.0f ? x : 1.0f;
    for (int i = 0; i < 24; i++) r = 0.5f * (r + x / r);
    return r;
}
static float f_exp(float x) {
    if (x < -30.0f) return 0.0f;
    if (x >  30.0f) x = 30.0f;
    /* exp(x) = 2^k * exp(f), f = x - k*ln2, |f| <= ln2/2 */
    float t = x * 1.4426950408889634f;             /* x / ln2 */
    int k = (int)(t >= 0.0f ? t + 0.5f : t - 0.5f);
    float f = x - (float)k * 0.6931471805599453f;
    float e = 1.0f + f * (1.0f + f * (0.5f + f * (0.16666667f
              + f * (0.041666667f + f * 0.008333333f))));
    float s = 1.0f;
    if (k >= 0) { for (int i = 0; i < k; i++)  s *= 2.0f; }
    else        { for (int i = 0; i < -k; i++) s *= 0.5f; }
    return e * s;
}

/* ---- xorshift PRNG for sampling ---- */
static uint32_t rng_state = 0x2545F491u;
static inline uint32_t xrand(void) {
    uint32_t x = rng_state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    rng_state = x; return x;
}

/* ---- KV cache: [layer][pos][C] ---- */
static float *kcache;   /* L*BLK*C */
static float *vcache;   /* L*BLK*C */
static int    cache_pos;

static inline float *kslot(int l, int p) { return kcache + ((l * BLK) + p) * C; }
static inline float *vslot(int l, int p) { return vcache + ((l * BLK) + p) * C; }

/* ---- scratch vectors (small; live in BSS) ---- */
static float xv[C], av[C], qv[C], yv[C], hv[C], mv[C];
static float qkv[3 * C];
static float fcv[4 * C];
static float att[BLK];
static float logits[V];
static float attn_scale;   /* 1/sqrt(C) */

void gpt_init(void) {
    kcache = (float *)kmalloc((uint32_t)(sizeof(float) * (uint32_t)L * BLK * C));
    vcache = (float *)kmalloc((uint32_t)(sizeof(float) * (uint32_t)L * BLK * C));
    cache_pos = 0;
    attn_scale = 1.0f / f_sqrt((float)C);
}

/* out[nout] = in[nin] @ W[nin*nout] (+ bias). W is row-major [nin][nout]. */
static void linear(float *out, const float *in, const float *W,
                   const float *b, int nin, int nout) {
    for (int j = 0; j < nout; j++) out[j] = b ? b[j] : 0.0f;
    for (int i = 0; i < nin; i++) {
        float xi = in[i];
        const float *Wr = W + (long)i * nout;
        for (int j = 0; j < nout; j++) out[j] += xi * Wr[j];
    }
}

static void lnorm(float *out, const float *in, const float *g, const float *b) {
    float mu = 0.0f;
    for (int i = 0; i < C; i++) mu += in[i];
    mu /= (float)C;
    float var = 0.0f;
    for (int i = 0; i < C; i++) { float d = in[i] - mu; var += d * d; }
    var /= (float)C;
    float inv = 1.0f / f_sqrt(var + 1e-5f);
    for (int i = 0; i < C; i++) out[i] = (in[i] - mu) * inv * g[i] + b[i];
}

/* One transformer step for `token` at the current cache position; fills
 * logits[] with the next-token distribution and advances the cache. */
static void gpt_step(int token) {
    int p = cache_pos;                     /* this token's position */
    for (int i = 0; i < C; i++)
        xv[i] = w_wte[token * C + i] + w_wpe[p * C + i];

    for (int l = 0; l < L; l++) {
        /* --- attention block --- */
        lnorm(av, xv, T_ln1_g[l], T_ln1_b[l]);
        linear(qkv, av, T_qkv_w[l], T_qkv_b[l], C, 3 * C);
        for (int i = 0; i < C; i++) {
            qv[i] = qkv[i];
            kslot(l, p)[i] = qkv[C + i];
            vslot(l, p)[i] = qkv[2 * C + i];
        }
        /* scores over cached keys 0..p, softmax, weighted sum of values */
        float mx = -1e30f;
        for (int j = 0; j <= p; j++) {
            const float *kj = kslot(l, j);
            float s = 0.0f;
            for (int i = 0; i < C; i++) s += qv[i] * kj[i];
            s *= attn_scale;
            att[j] = s;
            if (s > mx) mx = s;
        }
        float sum = 0.0f;
        for (int j = 0; j <= p; j++) { att[j] = f_exp(att[j] - mx); sum += att[j]; }
        float invs = 1.0f / sum;
        for (int i = 0; i < C; i++) {
            float acc = 0.0f;
            for (int j = 0; j <= p; j++) acc += att[j] * vslot(l, j)[i];
            yv[i] = acc * invs;
        }
        linear(av, yv, T_proj_w[l], T_proj_b[l], C, C);
        for (int i = 0; i < C; i++) xv[i] += av[i];      /* residual */

        /* --- MLP block --- */
        lnorm(hv, xv, T_ln2_g[l], T_ln2_b[l]);
        linear(fcv, hv, T_fc_w[l], T_fc_b[l], C, 4 * C);
        for (int i = 0; i < 4 * C; i++) if (fcv[i] < 0.0f) fcv[i] = 0.0f;  /* ReLU */
        linear(mv, fcv, T_mproj_w[l], T_mproj_b[l], 4 * C, C);
        for (int i = 0; i < C; i++) xv[i] += mv[i];      /* residual */
    }

    lnorm(av, xv, w_lnf_g, w_lnf_b);
    linear(logits, av, w_head_w, w_head_b, C, V);
    cache_pos = p + 1;
}

/* Sample an index from logits[] with temperature. Reuses fcv (size 4*C) as a
 * probability scratch buffer — valid because V <= 4*C for our config. */
static int sample_logits(float temp) {
    float mx = logits[0];
    for (int i = 1; i < V; i++) if (logits[i] > mx) mx = logits[i];
    float psum = 0.0f;
    for (int i = 0; i < V; i++) { fcv[i] = f_exp((logits[i] - mx) / temp); psum += fcv[i]; }
    float r = ((float)(xrand() & 0xFFFFFF) / (float)0x1000000) * psum;
    float acc = 0.0f;
    for (int i = 0; i < V; i++) { acc += fcv[i]; if (r <= acc) return i; }
    return V - 1;
}

static int char_to_id(char c) {
    for (int i = 0; i < V; i++) if (gpt_vocab[i] == c) return i;
    return -1;
}

#ifdef GPT_HOST_TEST
/* Host-only hooks so a numpy reference can validate the forward pass. */
void        gpt_test_reset(void)  { cache_pos = 0; }
void        gpt_test_step(int t)  { gpt_step(t); }
const float *gpt_test_logits(void){ return logits; }
int         gpt_test_argmax(void) { int b = 0; for (int i = 1; i < V; i++) if (logits[i] > logits[b]) b = i; return b; }
#endif

void gpt_generate(const char *prompt, int max_out, void (*emit)(char c)) {
    rng_state ^= (uint32_t)pit_elapsed_ms() * 2654435761u;
    if (rng_state == 0) rng_state = 0x1234567u;
    cache_pos = 0;

    /* Prefill the prompt (skip chars outside the vocab). */
    int last = char_to_id('\n');
    for (const char *s = prompt; *s && cache_pos < BLK - 1; s++) {
        int id = char_to_id(*s);
        if (id < 0) continue;
        gpt_step(id);
        last = id;
    }
    if (cache_pos == 0) { gpt_step(char_to_id('\n')); last = char_to_id('\n'); }

    /* Generate. Stop early after a paragraph break for a tidy answer. */
    int nl_run = 0;
    for (int n = 0; n < max_out && cache_pos < BLK; n++) {
        int id = sample_logits(0.8f);
        char ch = gpt_vocab[id];
        emit(ch);
        if (ch == '\n') { if (++nl_run >= 2 && n > 8) break; } else nl_run = 0;
        gpt_step(id);
        last = id;
        task_yield();          /* let the clock tick between tokens */
    }
    (void)last;
}
