/*
 * Astrion v2.0 — model weight-file loader (see include/model.h, model_load()).
 *
 * The "brain file": a trained transformer converted host-side by
 * tools/mkweights.py into one flat little-endian blob, handed to the kernel as a
 * multiboot2 module. model_load() MAPS and VALIDATES those bytes — it is an
 * untrusted parser, held to the tok.c/elf.c/fs.c standard: every offset is
 * bounded wrap-safely (`a > cap - b`, never `a + b > cap`, lesson #200/#202) in
 * uint64 BEFORE any read, the header magic and version are checked, every
 * dimension is range-checked, and every section is proven to lie inside the blob
 * BEFORE a single weight byte is read. On anything malformed it returns a short
 * reason string, leaves *out zeroed, and reads nothing past the buffer.
 *
 * ZERO-COPY, like tok_parse(): the weight arrays are NOT copied. model_load()
 * points struct model_weights straight into the mapped blob (M->q, M->qg, embed,
 * ln1, …). The blob must outlive the weights. The only caller-owned storage is a
 * small array of `n_layers` struct model_layer (the pointers have to live
 * somewhere); the multi-hundred-MB weight bytes stay in the module.
 *
 * INT8-ONLY MATRICES. Every projection comes back with full == NULL and q/qg
 * pointed into the blob, so a loaded model runs in MODEL_Q8 (the shipped path).
 * MODEL_FULL is a host-test-only mode that needs the int64 form, which the file
 * does not carry — the kernel ships int8, exactly as q8.h intends.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ON-DISK FORMAT  "AMW1"  (v1)  — THE SHARED CONTRACT with tools/mkweights.py.
 * Both files reference THIS block; if you change one, change the other, or the
 * round-trip gate (tests/test_model_load.c) fails as a logit mismatch.
 *
 * Little-endian, fixed-width. The layout is FULLY DETERMINISTIC from the config
 * in the header — there is NO directory of file-supplied offsets, so an attacker
 * controls only the dimensions (range-checked first) and the buffer length. Every
 * section starts 8-byte aligned so the zero-copy typed pointers are aligned:
 * int64 vectors 8-aligned, q8_group scales 4-aligned (covered by 8), int8 codes
 * need none. Fixed-point weights are at Q8_SCALE_SHIFT (=20); rms_eps at
 * MODEL_EPS_SHIFT (=40). All of this mirrors model.h's structs exactly.
 *
 *   HEADER (80 bytes, at offset 0)
 *     u32 magic        0x31574D41  "AMW1"
 *     u32 version      1
 *     u32 dim
 *     u32 n_layers
 *     u32 n_heads
 *     u32 n_kv_heads
 *     u32 head_dim
 *     u32 ffn_dim
 *     u32 vocab
 *     u32 max_seq
 *     u32 qk_norm      (0 or 1)
 *     u32 reserved     (0)
 *     i64 rope_theta
 *     i64 rms_eps_fp   (fixed-point @ MODEL_EPS_SHIFT)
 *     u64 file_len     (total bytes; must equal the recomputed layout size)
 *     u32 n_matrices   (must equal 7*n_layers + 1)
 *     u32 reserved2    (0)
 *
 *   Then, in this fixed order, each section 8-aligned:
 *     EMBED        int64[vocab * dim]
 *     for l in 0 .. n_layers-1:
 *       LN1        int64[dim]
 *       LN2        int64[dim]
 *       BQ         int64[n_heads    * head_dim]     (zero vector if the model has
 *       BK         int64[n_kv_heads * head_dim]      no QKV bias — Qwen2 has one)
 *       BV         int64[n_kv_heads * head_dim]
 *       QK_G       int64[head_dim]                  (ONLY if qk_norm == 1)
 *       WQ         MATRIX(rows = n_heads*head_dim,    cols_in = dim)
 *       WK         MATRIX(rows = n_kv_heads*head_dim, cols_in = dim)
 *       WV         MATRIX(rows = n_kv_heads*head_dim, cols_in = dim)
 *       WO         MATRIX(rows = dim,                 cols_in = n_heads*head_dim)
 *       W_GATE     MATRIX(rows = ffn_dim,             cols_in = dim)
 *       W_UP       MATRIX(rows = ffn_dim,             cols_in = dim)
 *       W_DOWN     MATRIX(rows = dim,                 cols_in = ffn_dim)
 *     FINAL_LN     int64[dim]
 *     LM_HEAD      MATRIX(rows = vocab, cols_in = dim)
 *
 *   MATRIX(rows, cols_in), 8-aligned start:
 *     u32 rows                              (== the rows above; self-check)
 *     u32 cols                              (== pad64(cols_in); multiple of 64)
 *     int8    q[rows * cols]                row-major, input axis zero-padded
 *     <pad to 8>
 *     q8grp   scales[rows * (cols/64)]      one int32 scale_num per (row, group)
 *     <pad to 8>
 *
 * Each int8 matrix is q8_quantize()'d EXACTLY as q8.h does (group of 64 along the
 * padded input axis, scale = ceil(peak/127), round-to-nearest-away, never -128).
 * ────────────────────────────────────────────────────────────────────────────
 */
#include <stdint.h>
#include "model.h"
#include "q8.h"

#define AMW_MAGIC   0x31574D41u   /* "AMW1" */
#define AMW_VERSION 1u
#define AMW_HDR     80u           /* header size, a multiple of 8 */

/* Dimension caps. Two jobs: reject nonsense, and keep every product below well
 * within uint64 so the layout arithmetic cannot wrap (the take() cursor is
 * additionally overflow-safe, but a capped input means each section size is a
 * product of small factors — <= ~2^42 bytes — long before it is added). These
 * are generous next to Qwen-0.6B (dim 1024, vocab 151936) and Ember-341M
 * (dim 1024, 24 layers, vocab 50304); a real model sits far under them. */
#define AMW_MAX_DIM      65536u
#define AMW_MAX_LAYERS   4096u
#define AMW_MAX_HEADS    4096u
#define AMW_MAX_HEADDIM  4096u
#define AMW_MAX_FFN      262144u
#define AMW_MAX_VOCAB    2097152u   /* 1<<21 */
#define AMW_MAX_SEQ      1048576u   /* 1<<20 */

/* ── little-endian byte reads. The module base is page-aligned by GRUB and the
 * host test hands an aligned malloc buffer, but the HEADER is read byte-wise so
 * header-field alignment never matters; the bulk weight arrays are reached by
 * typed pointer (see the alignment argument above). Callers prove the span is
 * in-bounds first — these do no checking. ── */
static uint32_t amw_rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t amw_rd64(const uint8_t *p) {
    return (uint64_t)amw_rd32(p) | ((uint64_t)amw_rd32(p + 4) << 32);
}

/* Zero *out byte-wise (volatile so -O2 cannot fold it into a memset call — the
 * kernel is freestanding and defines no libc mem*; model.c uses the same trick).
 * Leaves the caller with an all-NULL view on any failure. */
static void amw_zero(void *p, uint64_t n) {
    volatile uint8_t *d = p;
    for (uint64_t i = 0; i < n; i++) d[i] = 0;
}

/* Forward cursor over the blob. Invariant: off <= len at all times, so
 * `len - off` never wraps and every claim is checked `a > cap - b`-style. */
struct amw_cur { const uint8_t *base; uint64_t len; uint64_t off; };

/* Claim `n` bytes at the cursor; return the pointer and advance, or NULL if they
 * do not fit. `n` is always a product of capped dims, so it cannot overflow. */
static const uint8_t *amw_take(struct amw_cur *c, uint64_t n) {
    if (n > c->len - c->off) return 0;      /* wrap-safe: off <= len */
    const uint8_t *p = c->base + c->off;
    c->off += n;                             /* off <= len preserved */
    return p;
}

/* Advance the cursor to the next multiple of 8, checking the padding fits. */
static int amw_align8(struct amw_cur *c) {
    uint64_t rem = c->off & 7u;
    if (rem == 0) return 1;
    uint64_t pad = 8u - rem;
    if (pad > c->len - c->off) return 0;
    c->off += pad;
    return 1;
}

/* Claim `n` int64 values, 8-aligned; typed pointer into the blob, or NULL. */
static const int64_t *amw_take_i64(struct amw_cur *c, uint64_t n) {
    if (!amw_align8(c)) return 0;
    const uint8_t *p = amw_take(c, n * (uint64_t)sizeof(int64_t));
    return (const int64_t *)p;
}

/* Claim one MATRIX section and point M at it (full = NULL; q/qg into the blob).
 * The file's rows/cols self-header is validated against the config-derived
 * expected values, so a corrupted dimension cannot enlarge the section — it is
 * rejected before the codes/scales are claimed. Returns NULL, or a reason. */
static const char *amw_take_matrix(struct amw_cur *c, struct model_matrix *M,
                                   uint32_t rows_exp, uint32_t cols_in) {
    if (!amw_align8(c)) return "matrix header past end";
    const uint8_t *h = amw_take(c, 8u);
    if (!h) return "matrix header past end";
    uint32_t rows = amw_rd32(h);
    uint32_t cols = amw_rd32(h + 4);
    uint32_t cols_exp = model_pad(cols_in);
    if (rows != rows_exp) return "matrix rows mismatch";
    if (cols != cols_exp) return "matrix cols mismatch";
    if (cols == 0 || (cols % Q8_GROUP) != 0) return "matrix cols not group-aligned";

    uint64_t nq = (uint64_t)rows * cols;                 /* int8 codes */
    const uint8_t *q = amw_take(c, nq);
    if (!q) return "matrix codes past end";

    if (!amw_align8(c)) return "matrix scales past end";
    uint64_t ng = (uint64_t)rows * (cols / Q8_GROUP);    /* one scale per group */
    const uint8_t *g = amw_take(c, ng * (uint64_t)sizeof(struct q8_group));
    if (!g) return "matrix scales past end";

    M->rows = rows;
    M->cols = cols;
    M->full = 0;
    M->q  = (const int8_t *)q;
    M->qg = (const struct q8_group *)g;
    return 0;
}

const char *model_load(const void *base, uint64_t len,
                       struct model_weights *out,
                       struct model_layer *layers, uint32_t max_layers) {
    if (out) amw_zero(out, sizeof *out);       /* left all-NULL on any failure */
    if (!base || !out || !layers) return "null args";
    /* Typed int64/int32 reads below require an aligned base; GRUB page-aligns
     * modules and the host test uses malloc, so this only rejects a caller that
     * hands us a genuinely misaligned pointer — never a valid module. */
    if (((uintptr_t)base & 7u) != 0) return "unaligned base";
    if (len < AMW_HDR) return "truncated header";

    const uint8_t *b = (const uint8_t *)base;
    if (amw_rd32(b + 0) != AMW_MAGIC)   return "bad magic";
    if (amw_rd32(b + 4) != AMW_VERSION) return "bad version";

    struct model_config cfg;
    cfg.dim        = amw_rd32(b + 8);
    cfg.n_layers   = amw_rd32(b + 12);
    cfg.n_heads    = amw_rd32(b + 16);
    cfg.n_kv_heads = amw_rd32(b + 20);
    cfg.head_dim   = amw_rd32(b + 24);
    cfg.ffn_dim    = amw_rd32(b + 28);
    cfg.vocab      = amw_rd32(b + 32);
    cfg.max_seq    = amw_rd32(b + 36);
    cfg.qk_norm    = amw_rd32(b + 40);
    /* b + 44: reserved */
    cfg.rope_theta = (int64_t)amw_rd64(b + 48);
    cfg.rms_eps_fp = (int64_t)amw_rd64(b + 56);
    uint64_t file_len   = amw_rd64(b + 64);
    uint32_t n_matrices = amw_rd32(b + 72);
    /* b + 76: reserved2 */

    /* Range-check every dimension BEFORE it is used in any size arithmetic. */
    if (cfg.dim == 0        || cfg.dim > AMW_MAX_DIM)          return "bad dim";
    if (cfg.n_layers == 0   || cfg.n_layers > AMW_MAX_LAYERS)  return "bad n_layers";
    if (cfg.n_heads == 0    || cfg.n_heads > AMW_MAX_HEADS)    return "bad n_heads";
    if (cfg.n_kv_heads == 0 || cfg.n_kv_heads > cfg.n_heads)   return "bad n_kv_heads";
    if (cfg.head_dim == 0   || cfg.head_dim > AMW_MAX_HEADDIM) return "bad head_dim";
    if ((cfg.head_dim & 1u) != 0)                             return "head_dim must be even";
    if ((cfg.n_heads % cfg.n_kv_heads) != 0)                  return "n_heads not a multiple of n_kv_heads";
    if (cfg.ffn_dim == 0    || cfg.ffn_dim > AMW_MAX_FFN)      return "bad ffn_dim";
    if (cfg.vocab == 0      || cfg.vocab > AMW_MAX_VOCAB)      return "bad vocab";
    if (cfg.max_seq == 0    || cfg.max_seq > AMW_MAX_SEQ)      return "bad max_seq";
    if (cfg.qk_norm > 1u)                                     return "bad qk_norm";
    if (cfg.rope_theta < 1)                                   return "bad rope_theta";
    if (cfg.rms_eps_fp <= 0)                                  return "bad rms_eps";
    if (cfg.n_layers > max_layers)                           return "too many layers for caller buffer";
    if ((uint64_t)n_matrices != (uint64_t)cfg.n_layers * 7u + 1u) return "matrix count mismatch";

    uint32_t HHD = cfg.n_heads * cfg.head_dim;      /* <= 2^24, fits u32 */
    uint32_t KVD = cfg.n_kv_heads * cfg.head_dim;   /* <= 2^24 */

    struct amw_cur c = { b, len, AMW_HDR };

    const int64_t *embed = amw_take_i64(&c, (uint64_t)cfg.vocab * cfg.dim);
    if (!embed) return "embed past end";

    for (uint32_t l = 0; l < cfg.n_layers; l++) {
        struct model_layer *L = &layers[l];
        const char *e;
        if (!(L->ln1 = amw_take_i64(&c, cfg.dim))) return "ln1 past end";
        if (!(L->ln2 = amw_take_i64(&c, cfg.dim))) return "ln2 past end";
        if (!(L->bq  = amw_take_i64(&c, HHD)))     return "bq past end";
        if (!(L->bk  = amw_take_i64(&c, KVD)))     return "bk past end";
        if (!(L->bv  = amw_take_i64(&c, KVD)))     return "bv past end";
        if (cfg.qk_norm) {
            if (!(L->qk_g = amw_take_i64(&c, cfg.head_dim))) return "qk_g past end";
        } else {
            L->qk_g = 0;
        }
        if ((e = amw_take_matrix(&c, &L->wq, HHD, cfg.dim)))         return e;
        if ((e = amw_take_matrix(&c, &L->wk, KVD, cfg.dim)))         return e;
        if ((e = amw_take_matrix(&c, &L->wv, KVD, cfg.dim)))         return e;
        if ((e = amw_take_matrix(&c, &L->wo, cfg.dim, HHD)))         return e;
        if ((e = amw_take_matrix(&c, &L->w_gate, cfg.ffn_dim, cfg.dim))) return e;
        if ((e = amw_take_matrix(&c, &L->w_up,   cfg.ffn_dim, cfg.dim))) return e;
        if ((e = amw_take_matrix(&c, &L->w_down, cfg.dim, cfg.ffn_dim))) return e;
    }

    const int64_t *final_ln = amw_take_i64(&c, cfg.dim);
    if (!final_ln) return "final_ln past end";

    const char *e = amw_take_matrix(&c, &out->lm_head, cfg.vocab, cfg.dim);
    if (e) { amw_zero(out, sizeof *out); return e; }   /* re-zero: lm_head was written */

    /* Everything fit inside the buffer. The file's own length field must equal
     * exactly what the deterministic layout consumed — a last cross-check that
     * the converter and this loader agree byte-for-byte (a truncated module,
     * caught earlier as a section past end; a lying header, caught here). */
    if (c.off != file_len) { amw_zero(out, sizeof *out); return "length field mismatch"; }

    /* Commit. cfg copied field-by-field (no aggregate assignment -> no memcpy
     * call the kernel would fail to link). Matrices already written in place. */
    out->cfg.dim        = cfg.dim;
    out->cfg.n_layers   = cfg.n_layers;
    out->cfg.n_heads    = cfg.n_heads;
    out->cfg.n_kv_heads = cfg.n_kv_heads;
    out->cfg.head_dim   = cfg.head_dim;
    out->cfg.ffn_dim    = cfg.ffn_dim;
    out->cfg.vocab      = cfg.vocab;
    out->cfg.max_seq    = cfg.max_seq;
    out->cfg.qk_norm    = cfg.qk_norm;
    out->cfg.rope_theta = cfg.rope_theta;
    out->cfg.rms_eps_fp = cfg.rms_eps_fp;
    out->embed    = embed;
    out->layers   = layers;
    out->final_ln = final_ln;
    return 0;
}
