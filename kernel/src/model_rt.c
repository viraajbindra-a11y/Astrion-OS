/*
 * Astrion v2.0 — model runtime (see include/model_rt.h).
 *
 * This is the file that finally CALLS the engine. model.c/model_load.c/tok.c
 * were built and host-tested but nothing in the running kernel ever ran them;
 * this wires them to real boot modules and to the Assistant.
 *
 * ZERO-COPY WEIGHTS. model_load() points struct model_weights straight into the
 * module's mapped pages — we never memcpy the blob (Ember is hundreds of MB).
 * The only heap we take is the layer-pointer table, the forward-pass scratch,
 * the KV cache, and the logits vector; all sized from the loaded config, all
 * freed back if any single allocation fails so a partial init leaves no leak.
 *
 * NO FLOAT. Everything here is integer: the engine is fixed-point (see model.h)
 * and this file adds only pointer bookkeeping and a greedy loop. It builds under
 * -mno-sse -mgeneral-regs-only like the rest of the kernel.
 *
 * NEVER FAULTS AT BOOT. A missing brain module, a malformed one, a header that
 * lies, an out-of-range dimension, or an out-of-memory heap all resolve to the
 * same safe state: g_ready = 0, a serial line saying why, and the kernel carries
 * on. The Assistant then says "no brain loaded" instead of dereferencing NULL.
 */
#include <stdint.h>
#include "model.h"          /* struct model_* + model_forward/argmax/rope_init  */
#include "model_rt.h"
#include "tok.h"            /* tok_init/tok_ready/tok_encode/tok_decode         */
#include "q8.h"             /* struct q8_group, Q8_GROUP                        */
#include "heap.h"           /* kmalloc/kfree                                    */

/* Section magics, little-endian at offset 0 of each module. AMW_MAGIC mirrors
 * the #define in model_load.c (kept local: model.h does not export it); TOK_MAGIC
 * comes from tok.h. Identifying by magic, not filename, means the grub.cfg can
 * name the modules anything. */
#define AMW_MAGIC   0x31574D41u   /* "AMW1" — the brain file            */
#define AMW_HDR     80u           /* header size, matches model_load.c  */

/* Defensive cap for the pre-load n_layers peek (model_load re-validates against
 * its own AMW_MAX_LAYERS too). Bounds the one allocation we size from an
 * unverified header field. */
#define MODEL_RT_MAX_LAYERS   4096u

/* Runtime caps. The prompt buffer upstream is 128 bytes, so 160 token slots
 * covers even the pathological one-token-per-byte fallback with margin. The new
 * token cap and decode buffer bound the generation loop's work and output. */
#define MODEL_RT_MAX_PROMPT   160u
#define MODEL_RT_MAX_NEW       64u
#define MODEL_RT_DECODE_CAP   768u

/* End-of-text. AMW1 does not (yet) carry an EOS id, so this is the well-known
 * Qwen <|endoftext|> id as a sensible default. It is deliberately ABOVE the tiny
 * test brain's vocab (48): model_argmax only ever returns an id in [0, vocab),
 * so on the test brain this check simply never fires and the loop stops on the
 * max_new / max_seq caps instead — which is exactly what we want for a proof
 * run (full-length output, not a one-token stub). On a real model whose vocab
 * includes this id, it ends generation. */
#define MODEL_RT_EOS          151643u

extern void serial_puts_x(const char *s);
extern void serial_put_u64_x(uint64_t v);

extern uint32_t boot_module_count(void);
extern int boot_module(uint32_t i, uint64_t *base, uint64_t *len, const char **name);

/* ── the loaded brain, held for the WM to reach ── */
static struct model_weights g_w;       /* config + weight pointers (into module) */
static struct model_state   g_st;      /* scratch + KV cache pointers            */
static struct model_layer  *g_layers;  /* [n_layers] pointer table (heap)        */
static int64_t             *g_logits;  /* [vocab] decode output (heap)           */
static int                  g_ready;   /* 1 once generation is live              */

/* ── generation scratch. File-scope, not on the stack: generation is inherently
 * single-shot (it drives the one global g_st) and the Assistant calls it from a
 * single task, so a shared static buffer is safe and keeps the kernel stack
 * clear of a ~1 KB frame. ── */
static uint32_t g_ids[MODEL_RT_MAX_PROMPT];
static uint32_t g_gen[MODEL_RT_MAX_NEW];
static uint8_t  g_dec[MODEL_RT_DECODE_CAP];

static uint32_t rt_rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint32_t rt_strlen(const char *s) {
    uint32_t n = 0;
    while (s[n]) n++;
    return n;
}

/* Free every heap buffer we own and null the pointers — the single cleanup path
 * for both a failed init and (in principle) a teardown. kfree(NULL) is a no-op,
 * so calling this on a partially-built state is safe. */
static void rt_free_all(void) {
    kfree(g_st.kcache);   g_st.kcache   = 0;
    kfree(g_st.vcache);   g_st.vcache   = 0;
    kfree(g_st.inv_freq); g_st.inv_freq = 0;
    kfree(g_st.x);        g_st.x        = 0;
    kfree(g_st.xn);       g_st.xn       = 0;
    kfree(g_st.q);        g_st.q        = 0;
    kfree(g_st.heads);    g_st.heads    = 0;
    kfree(g_st.scores);   g_st.scores   = 0;
    kfree(g_st.ff1);      g_st.ff1      = 0;
    kfree(g_st.ff2);      g_st.ff2      = 0;
    kfree(g_st.tmp);      g_st.tmp      = 0;
    kfree(g_st.act_fix);  g_st.act_fix  = 0;
    kfree(g_st.act_q);    g_st.act_q    = 0;
    kfree(g_st.act_qg);   g_st.act_qg   = 0;
    kfree(g_logits);      g_logits      = 0;
    kfree(g_layers);      g_layers      = 0;
}

static int64_t *rt_i64(uint64_t n) { return (int64_t *)kmalloc(n * sizeof(int64_t)); }

/* Allocate the forward-pass scratch + KV cache for `c`. Every field of g_st is
 * sized exactly as model.h documents. Returns 1 on success; on the first failed
 * allocation it frees everything and returns 0 (caller reports OOM). */
static int rt_alloc_scratch(const struct model_config *c) {
    uint64_t kv  = model_kv_len(c);
    uint32_t nin = model_max_nin(c);
    uint32_t HHD = c->n_heads * c->head_dim;

    g_st.kcache   = rt_i64(kv);
    g_st.vcache   = rt_i64(kv);
    g_st.inv_freq = rt_i64(c->head_dim / 2u);
    g_st.x        = rt_i64(c->dim);
    g_st.xn       = rt_i64(c->dim);
    g_st.q        = rt_i64(HHD);
    g_st.heads    = rt_i64(HHD);
    g_st.scores   = rt_i64(c->max_seq);
    g_st.ff1      = rt_i64(c->ffn_dim);
    g_st.ff2      = rt_i64(c->ffn_dim);
    g_st.tmp      = rt_i64(c->dim);
    g_st.act_fix  = rt_i64(nin);
    g_st.act_q    = (int8_t *)kmalloc(nin);
    g_st.act_qg   = (struct q8_group *)kmalloc((nin / Q8_GROUP) * sizeof(struct q8_group));
    g_logits      = rt_i64(c->vocab);

    if (!g_st.kcache || !g_st.vcache || !g_st.inv_freq || !g_st.x || !g_st.xn ||
        !g_st.q || !g_st.heads || !g_st.scores || !g_st.ff1 || !g_st.ff2 ||
        !g_st.tmp || !g_st.act_fix || !g_st.act_q || !g_st.act_qg || !g_logits) {
        rt_free_all();
        return 0;
    }
    return 1;
}

/* Install the tokenizer module if one is present. Non-fatal: the runtime falls
 * back to raw-byte tokenization when none is installed. */
static void rt_install_tok(const void *base, uint64_t len) {
    if (!base) {
        serial_puts_x("MODEL: no tokenizer module (ATK1) — raw-byte fallback\n");
        return;
    }
    if (len > 0xFFFFFFFFu) {          /* tok_init takes a u32 length */
        serial_puts_x("MODEL: tokenizer module too large — ignored\n");
        return;
    }
    const char *err = tok_init(base, (uint32_t)len);
    if (err) {
        serial_puts_x("MODEL: tokenizer rejected: ");
        serial_puts_x(err);
        serial_puts_x("\n");
        return;
    }
    serial_puts_x("MODEL: tokenizer installed (BPE, ATK1)\n");
}

void model_rt_init(void) {
    g_ready = 0;

    /* Scan the modules once, picking the first of each kind by magic. */
    const void *model_base = 0; uint64_t model_len = 0;
    const void *tok_base   = 0; uint64_t tok_len   = 0;

    uint32_t nmod = boot_module_count();
    for (uint32_t i = 0; i < nmod; i++) {
        uint64_t base, len; const char *name;
        if (!boot_module(i, &base, &len, &name)) continue;
        if (len < 4) continue;                         /* need a magic to read   */
        uint32_t magic = rt_rd32((const uint8_t *)(uintptr_t)base);
        if (magic == AMW_MAGIC && !model_base) { model_base = (const void *)(uintptr_t)base; model_len = len; }
        else if (magic == TOK_MAGIC && !tok_base) { tok_base = (const void *)(uintptr_t)base; tok_len = len; }
    }

    rt_install_tok(tok_base, tok_len);

    if (!model_base) {
        serial_puts_x("MODEL: no brain module (AMW1) found — generation disabled\n");
        return;
    }
    if (model_len < AMW_HDR) {
        serial_puts_x("MODEL: brain module header truncated — generation disabled\n");
        return;
    }

    /* Peek n_layers to size the caller-owned layer table model_load() needs
     * BEFORE it can report the count. The magic was already matched above, so
     * this field is real; model_load() re-validates it against its own cap. */
    uint32_t nl = rt_rd32((const uint8_t *)model_base + 12);
    if (nl == 0 || nl > MODEL_RT_MAX_LAYERS) {
        serial_puts_x("MODEL: brain n_layers out of range — generation disabled\n");
        return;
    }
    g_layers = (struct model_layer *)kmalloc((uint64_t)nl * sizeof(struct model_layer));
    if (!g_layers) {
        serial_puts_x("MODEL: out of memory for layer table — generation disabled\n");
        return;
    }

    const char *err = model_load(model_base, model_len, &g_w, g_layers, nl);
    if (err) {
        serial_puts_x("MODEL: model_load failed: ");
        serial_puts_x(err);
        serial_puts_x("\n");
        kfree(g_layers); g_layers = 0;
        return;
    }

    if (!rt_alloc_scratch(&g_w.cfg)) {
        serial_puts_x("MODEL: out of memory for forward-pass scratch — generation disabled\n");
        kfree(g_layers); g_layers = 0;      /* rt_alloc_scratch freed the rest   */
        return;
    }

    g_st.mode  = MODEL_Q8;                   /* the file carries int8-only codes  */
    g_st.pos   = 0;
    g_st.trace = 0;                          /* no op-trace in the kernel         */
    model_rope_init(&g_st, &g_w.cfg);

    g_ready = 1;

    /* Proof line: model_load ran on the real module and produced this config. */
    const struct model_config *c = &g_w.cfg;
    serial_puts_x("MODEL: brain loaded — dim=");    serial_put_u64_x(c->dim);
    serial_puts_x(" n_layers=");                    serial_put_u64_x(c->n_layers);
    serial_puts_x(" n_heads=");                     serial_put_u64_x(c->n_heads);
    serial_puts_x(" n_kv_heads=");                  serial_put_u64_x(c->n_kv_heads);
    serial_puts_x(" head_dim=");                    serial_put_u64_x(c->head_dim);
    serial_puts_x(" ffn=");                         serial_put_u64_x(c->ffn_dim);
    serial_puts_x(" vocab=");                       serial_put_u64_x(c->vocab);
    serial_puts_x(" max_seq=");                     serial_put_u64_x(c->max_seq);
    serial_puts_x(" qk_norm=");                     serial_put_u64_x(c->qk_norm);
    serial_puts_x("\n");
}

int model_rt_ready(void) { return g_ready; }

const struct model_config *model_rt_config(void) {
    return g_ready ? &g_w.cfg : 0;
}

/* Emit `v` as decimal through emit(). No libc; small local itoa. */
static void rt_emit_u32(uint32_t v, void (*emit)(char)) {
    char b[10];
    int i = 0;
    if (v == 0) { emit('0'); return; }
    while (v) { b[i++] = (char)('0' + (v % 10u)); v /= 10u; }
    while (i) emit(b[--i]);
}

int model_rt_generate(const char *prompt, uint32_t max_new, void (*emit)(char)) {
    if (!g_ready) return -1;

    const struct model_config *c = &g_w.cfg;
    uint32_t V = c->vocab;

    if (max_new > MODEL_RT_MAX_NEW) max_new = MODEL_RT_MAX_NEW;

    /* Fresh context every call: greedy decode from position 0, no carry-over
     * KV state between prompts (the test brain's cache is only max_seq deep). */
    g_st.pos = 0;

    /* ── tokenize ── */
    int n = 0;
    if (tok_ready()) {
        n = tok_encode(prompt, rt_strlen(prompt), g_ids, MODEL_RT_MAX_PROMPT);
        if (n < 0) n = 0;
    }
    if (n == 0) {
        /* No tokenizer, or the encoder produced nothing: one token per byte. */
        for (const char *s = prompt; *s && n < (int)MODEL_RT_MAX_PROMPT; s++)
            g_ids[n++] = (uint8_t)*s;
    }
    /* Reduce every id into [0, vocab) so it cannot index past the embedding
     * table — the load-bearing safety step when the tokenizer's vocab (Qwen:
     * ~151k) is larger than the model's (test brain: 48). For a matched pair
     * this is the identity on valid ids. */
    for (int i = 0; i < n; i++) g_ids[i] %= V;

    /* ── prime the KV cache with the prompt ── */
    int fed = 0;
    for (int i = 0; i < n; i++) {
        if (g_st.pos >= c->max_seq) break;
        model_forward(&g_w, &g_st, g_ids[i], g_logits);
        fed++;
    }
    if (fed == 0) {
        /* Empty prompt: still run one real step (token 0) so the forward pass
         * executes and there is something to decode. */
        if (g_st.pos < c->max_seq) { model_forward(&g_w, &g_st, 0, g_logits); fed = 1; }
        else return 0;
    }

    /* ── greedy generate ── */
    uint32_t gcount = 0;
    for (uint32_t step = 0; step < max_new && gcount < MODEL_RT_MAX_NEW; step++) {
        if (g_st.pos >= c->max_seq) break;              /* KV cache full          */
        uint32_t next = model_argmax(g_logits, V);
        if (step == 0) {
            /* Proof line: the forward pass produced logits and argmax picked a
             * token from them — not a canned string. */
            serial_puts_x("MODEL: first-step argmax=");
            serial_put_u64_x(next);
            serial_puts_x(" of vocab ");
            serial_put_u64_x(V);
            serial_puts_x("\n");
        }
        g_gen[gcount++] = next;
        if (next == MODEL_RT_EOS) break;
        model_forward(&g_w, &g_st, next, g_logits);     /* advance; new logits    */
    }

    /* ── detokenize + stream out ── */
    if (tok_ready()) {
        int m = tok_decode(g_gen, gcount, g_dec, MODEL_RT_DECODE_CAP);
        if (m < 0) m = 0;
        for (int i = 0; i < m; i++) emit((char)g_dec[i]);
        serial_puts_x("MODEL: generated ");
        serial_put_u64_x(gcount);
        serial_puts_x(" tokens, decoded ");
        serial_put_u64_x((uint64_t)m);
        serial_puts_x(" bytes\n");
    } else {
        /* No tokenizer installed: show the raw token ids so the output is still
         * real, visible proof rather than nothing. */
        for (uint32_t i = 0; i < gcount; i++) {
            emit('[');
            rt_emit_u32(g_gen[i], emit);
            emit(']');
        }
        serial_puts_x("MODEL: generated ");
        serial_put_u64_x(gcount);
        serial_puts_x(" tokens (no tokenizer — shown as ids)\n");
    }

    return (int)gcount;
}
