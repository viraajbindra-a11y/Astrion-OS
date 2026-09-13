/*
 * Astrion v2.0 — byte-level BPE tokenizer (Qwen2.5 / GPT-2), kernel side.
 *
 * The flat table is built on the host by tools/mktok.py — from a Qwen2.5
 * vocab.json + merges.txt, or from tiktoken's gpt2 encoding (the tokenizer
 * Ember is trained with) — and handed to the kernel as a multiboot2 module. tok_init() MAPS and VALIDATES those bytes — it is an untrusted
 * parser, same discipline as elf.c/fs.c: every offset is bounded wrap-safely
 * (`a > cap - b`, never `a + b > cap`) BEFORE any read, the header magic and
 * version are checked, and every section is proven to lie inside the module.
 * On anything malformed it returns an error string and reads nothing past the
 * buffer; the kernel then runs with the tokenizer unavailable rather than
 * crashing.
 *
 * ENCODE is byte-level BPE: an ASCII pretokenizer (a hand port of the Qwen2 or
 * the GPT-2 Split regex, restricted to ASCII — see tok.c; which one is the
 * table's KIND, below) splits the text, then within each segment every byte
 * starts as a base token and the highest-priority adjacent merge is applied
 * until none remains. Merge lookup is a binary
 * search over the key-sorted merge table (~18 probes), no hash allocator.
 *
 * ASCII ONLY, on purpose: kbd.c is a 128-entry US table and the serial path
 * allow-lists 0x20..0x7E, so non-ASCII cannot be entered. Over ASCII input the
 * output is bit-identical to the HuggingFace reference (gated in
 * tests/test_tok.c against the `tokenizers` library). Bytes >= 0x80 are handled
 * as "other" (non-letter/digit/space) — self-consistent and safe, but NOT the
 * Unicode reference; that divergence is stated in the test.
 *
 * No allocation, no libc, no kernel headers: every buffer is caller-owned, so
 * the host test exercises this exact source as one translation unit.
 */
#ifndef ASTRION_TOK_H
#define ASTRION_TOK_H

#include <stdint.h>

#define TOK_MAGIC   0x314B5441u   /* "ATK1" */
#define TOK_VERSION 1u

/* The tokenizer KIND: which pretokenizer regex the merge table was trained
 * under. Byte-level BPE is the same algorithm for both; the SPLIT differs
 * (GPT-2 keeps digit runs together and is case-sensitive on contractions;
 * Qwen2 splits digits one per token and lets punctuation lead a word), and
 * running a table under the wrong split yields ids the model never saw. The
 * kind is written into the ATK header at byte 32 by mktok.py, and the brain
 * file (AMW2, model_load.c) names the kind IT was trained with so the runtime
 * can refuse a mismatched pair. UNSPEC is a table from before the field
 * existed: those are all Qwen tables, and are encoded as Qwen. */
#define TOK_KIND_UNSPEC 0u
#define TOK_KIND_QWEN2  1u
#define TOK_KIND_GPT2   2u
#define TOK_KIND_MAX    2u

/* A validated view onto the flat table. tok_parse() fills it with pointers
 * INTO the module (zero-copy); the module must outlive it. Every pointer/count
 * here has been proven in-bounds, so encode/decode need no further bounds math
 * on the table itself. */
struct tok_table {
    const uint8_t *base;      /* module base */
    uint32_t       len;       /* module length in bytes */
    uint32_t       kind;      /* TOK_KIND_*: selects the pretokenizer in encode */
    uint32_t       n_tokens;  /* vocab size; valid ids are 0..n_tokens-1 */
    uint32_t       n_merges;  /* number of merge rules */
    const uint8_t *byte2id;   /* 256 * u32 : the byte -> base-token map */
    const uint8_t *merges;    /* n_merges * (u64 key, u32 rank, u32 result), key-sorted */
    const uint8_t *offsets;   /* (n_tokens+1) * u32 : token i is blob[offsets[i]..offsets[i+1]] */
    const uint8_t *blob;      /* raw token bytes, for decoding */
    uint32_t       blob_len;  /* size of blob in bytes */
};

/* Validate `len` bytes at `base` and fill `out`. Returns NULL on success, or a
 * short human-readable reason on failure (the caller logs it on serial). On
 * failure `out` is left zeroed and nothing past the buffer is read. */
const char *tok_parse(const void *base, uint32_t len, struct tok_table *out);

/* Encode `text_len` bytes of `text` into base-token ids, byte-level BPE under
 * the pretokenizer `t->kind` names (GPT2, or the Qwen2 split for anything
 * else), up to `max` ids. Returns the number of ids written (0..max), or -1 if `t` is NULL.
 * Output stops at a segment boundary once `max` is reached; the tail is dropped
 * rather than half-encoded. A single pretoken longer than TOK_SEG_MAX bytes is
 * processed in TOK_SEG_MAX-byte slices (bounds worst-case work; see tok.c). */
int tok_encode_tab(const struct tok_table *t, const char *text, uint32_t text_len,
                   uint32_t *out_ids, uint32_t max);

/* Decode `n` ids back into at most `cap` bytes. Returns bytes written (0..cap),
 * or -1 if `t` is NULL. Ids >= n_tokens are skipped (produce no bytes); a token
 * whose bytes do not fit in the remaining space stops the decode. */
int tok_decode_tab(const struct tok_table *t, const uint32_t *ids, uint32_t n,
                   uint8_t *out, uint32_t cap);

/* ── Singleton front door for the kernel (one mapped tokenizer) ── */

/* Validate + install the module as the process-wide tokenizer. NULL on success,
 * else the reason (and tok_ready() stays 0). */
const char *tok_init(const void *base, uint32_t len);

/* 1 once tok_init() has succeeded, else 0. */
int tok_ready(void);

/* The installed table's kind (TOK_KIND_*), or TOK_KIND_UNSPEC if none. */
uint32_t tok_kind(void);

/* Select the pretokenizer for the installed table: the brain file names the
 * kind it was trained with (AMW2 tok_kind) and the runtime applies it here.
 * Returns 0 on success; -1 if no table is installed, `kind` is not a known
 * TOK_KIND_*, or the table declares a DIFFERENT kind (a mismatched pair — the
 * ids would be ones the model never saw, so refusing beats gibberish). A table
 * of kind UNSPEC accepts any kind. */
int tok_set_kind(uint32_t kind);

/* Singleton wrappers over the installed table; return -1 if none is installed. */
int tok_encode(const char *text, uint32_t text_len, uint32_t *out_ids, uint32_t max);
int tok_decode(const uint32_t *ids, uint32_t n, uint8_t *out, uint32_t cap);

#endif /* ASTRION_TOK_H */
