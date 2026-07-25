/*
 * Astrion v2.0 — byte-level BPE tokenizer (Qwen2.5), kernel side.
 *
 * The flat table is built on the host by tools/mktok.py from the real Qwen2.5
 * vocab.json + merges.txt and handed to the kernel as a multiboot2 module.
 * tok_parse() MAPS and VALIDATES those bytes — it is an untrusted parser, same
 * discipline as elf.c/fs.c: every offset is bounded wrap-safely (`a > cap - b`,
 * never `a + b > cap`, lesson #200/#202) BEFORE any read, the header magic and
 * version are checked, and every section is proven to lie inside the module.
 * On anything malformed it returns a short reason string and reads nothing past
 * the buffer; the kernel then runs with the tokenizer unavailable rather than
 * crashing.
 *
 * ENCODE is byte-level BPE. An ASCII pretokenizer (a hand port of Qwen2's Split
 * regex, restricted to ASCII — pretok_len below) splits the text; then within
 * each segment every byte starts as a base token and the highest-priority
 * adjacent merge is applied until none remains. Merge lookup is a binary search
 * over the key-sorted merge table (~18 probes over 151k merges), no allocator.
 *
 * ASCII ONLY, on purpose: kbd.c is a 128-entry US table and the serial path
 * allow-lists 0x20..0x7E, so non-ASCII cannot be entered. Over ASCII input the
 * result is bit-identical to the HuggingFace reference (gated in
 * tests/test_tok.c against the real Qwen table + the `tokenizers` library).
 * Bytes >= 0x80 are handled as "other" (non-letter/digit/space) — self-
 * consistent and safe, but NOT the Unicode reference; that divergence is stated
 * in the test.
 *
 * No allocation, no libc, no kernel headers: just <stdint.h> and every buffer is
 * caller-owned, so the host test exercises this exact source as one TU.
 */
#include <stdint.h>
#include "tok.h"

/* A pretoken longer than this is processed in TOK_SEG_MAX-byte slices. A real
 * ASCII pretoken (a word, a number-digit, a punctuation run) is tiny; only a
 * pathological input — hundreds of identical punctuation chars on one line —
 * comes near it, and slicing bounds both the O(L^2) merge work and the one
 * stack buffer below. Slicing changes the tokenization only at slice edges of
 * such pathological runs; over the reference corpus nothing is ever sliced. */
#define TOK_SEG_MAX 512u

/* ── little-endian byte reads. The module base is page-aligned by GRUB, but the
 * host test embeds the table as a plain byte array, so read byte-wise to be free
 * of any alignment/aliasing assumption. Callers prove the span is in-bounds
 * first — these do no checking themselves. ── */
static uint32_t rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t rd64(const uint8_t *p) {
    return (uint64_t)rd32(p) | ((uint64_t)rd32(p + 4) << 32);
}

/* ── ASCII character classes (the Unicode props of Qwen2's regex, ASCII-only) ──
 * A byte >= 0x80 is none of letter/digit/space, so is_other() is true for it —
 * it flows through the same paths as ASCII punctuation. That is the documented
 * ASCII divergence, not Unicode coverage. */
static int lc(int c)        { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }
static int is_letter(int c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
static int is_digit(int c)  { return c >= '0' && c <= '9'; }
static int is_space(int c)  { return c == ' ' || c == '\t' || c == '\n' ||
                                     c == '\r' || c == '\v' || c == '\f'; }
static int is_other(int c)  { return !is_space(c) && !is_letter(c) && !is_digit(c); }

/*
 * Length of the next pretoken at t[pos..len). A hand port of Qwen2's Split regex
 *
 *   (?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}
 *     | ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+
 *
 * restricted to ASCII. `tokenizers` runs this under fancy-regex, i.e. ordered
 * (leftmost-first, PCRE-style) alternation with greedy quantifiers — so the
 * alternatives are tried in order and the first that matches wins, each with its
 * own greedy/backtracking behaviour. That is exactly the control flow below.
 * Always returns >= 1 (every ASCII byte is covered), and never reads past `len`.
 */
static uint32_t pretok_len(const uint8_t *t, uint32_t len, uint32_t pos) {
    int c = t[pos];
    uint32_t i;

    /* Alt 1: (?i:'s|'t|'re|'ve|'m|'ll|'d) — contractions, case-insensitive. */
    if (c == '\'' && pos + 1 < len) {
        int a = lc(t[pos + 1]);
        if (a == 's' || a == 't' || a == 'm' || a == 'd') return 2;
        if (a == 'r' && pos + 2 < len && lc(t[pos + 2]) == 'e') return 3;
        if (a == 'v' && pos + 2 < len && lc(t[pos + 2]) == 'e') return 3;
        if (a == 'l' && pos + 2 < len && lc(t[pos + 2]) == 'l') return 3;
        /* an apostrophe that starts no contraction falls through to Alt 4 */
    }

    /* Alt 2: [^\r\n\p{L}\p{N}]? \p{L}+ — an optional single leading char that is
     * not CR/LF/letter/digit (so a space or punctuation may lead a word), then a
     * run of letters. The optional is greedy: take it only if a letter follows. */
    {
        int matched = 0;
        uint32_t p = pos;
        if (is_letter(c)) {
            p = pos; matched = 1;
        } else if (c != '\r' && c != '\n' && !is_digit(c) &&
                   pos + 1 < len && is_letter(t[pos + 1])) {
            p = pos + 1; matched = 1;
        }
        if (matched) {
            uint32_t q = p;
            while (q < len && is_letter(t[q])) q++;   /* q > p, so return >= 1 */
            return q - pos;
        }
    }

    /* Alt 3: \p{N} — a single digit. Qwen splits digits individually (no `+`),
     * which is why "2025" becomes four pretokens. */
    if (is_digit(c)) return 1;

    /* Alt 4: ' '? [^\s\p{L}\p{N}]+ [\r\n]* — an optional single leading space,
     * then a run of non-space/letter/digit chars, then trailing CR/LFs. */
    {
        int ok = 0;
        uint32_t p = pos;
        if (c == ' ') {
            if (pos + 1 < len && is_other(t[pos + 1])) { p = pos + 1; ok = 1; }
        } else if (is_other(c)) {
            p = pos; ok = 1;
        }
        if (ok) {
            uint32_t q = p;
            while (q < len && is_other(t[q])) q++;                       /* [^\s\p{L}\p{N}]+ */
            while (q < len && (t[q] == '\r' || t[q] == '\n')) q++;       /* [\r\n]*          */
            return q - pos;
        }
    }

    /* Alts 5-7 all consume whitespace; c is guaranteed whitespace here (it was
     * not a letter, digit, other, or a contraction, and Alt 4 rejected only a
     * space-not-followed-by-other). Find the contiguous whitespace run once.
     *   Alt 5: \s*[\r\n]+  — a run containing a CR/LF: consume up to the last one.
     *   Alt 6: \s+(?!\S)   — a run at end of string (whole run), or a run of >= 2
     *                        before non-whitespace (leave its last char for the
     *                        following word, which is what (?!\S) backtracks to).
     *   Alt 7: \s+         — the leftover: a lone whitespace char before non-ws. */
    {
        uint32_t wend = pos;
        while (wend < len && is_space(t[wend])) wend++;   /* wend > pos */
        int last_nl = -1;
        for (i = pos; i < wend; i++)
            if (t[i] == '\r' || t[i] == '\n') last_nl = (int)i;
        if (last_nl >= 0)          return (uint32_t)last_nl + 1 - pos;   /* Alt 5 */
        if (wend == len)           return wend - pos;                    /* Alt 6 (EOF) */
        if (wend - pos >= 2)       return (wend - 1) - pos;              /* Alt 6 (leave one) */
        return 1;                                                        /* Alt 7 */
    }
}

/* Binary search the key-sorted merge table for `key = (left<<32)|right`. On a
 * hit, writes rank+result and returns 1; else returns 0. Keys are strictly
 * increasing (proven at parse), so a plain lower-bound search is exact. */
static int merge_lookup(const struct tok_table *t, uint64_t key,
                        uint32_t *rank, uint32_t *result) {
    uint32_t lo = 0, hi = t->n_merges;      /* [lo, hi) */
    while (lo < hi) {
        uint32_t mid = lo + (hi - lo) / 2;
        const uint8_t *m = t->merges + (uint64_t)mid * 16u;
        uint64_t k = rd64(m);
        if (k == key) { if (rank) *rank = rd32(m + 8); if (result) *result = rd32(m + 12); return 1; }
        if (k < key) lo = mid + 1; else hi = mid;
    }
    return 0;
}

/*
 * Byte-level BPE over one pretoken slice held in ids[0..n). Repeatedly applies
 * the lowest-rank adjacent merge until none applies. In place; returns the new
 * length. O(L^2) in the slice length, which TOK_SEG_MAX bounds.
 */
static uint32_t bpe_merge(const struct tok_table *t, uint32_t *ids, uint32_t n) {
    for (;;) {
        uint32_t best_rank = 0xFFFFFFFFu;   /* nothing real reaches this (ranks < n_merges) */
        uint32_t best_pos = 0;
        uint32_t best_res = 0;
        int found = 0;
        for (uint32_t i = 0; i + 1 < n; i++) {
            uint64_t key = ((uint64_t)ids[i] << 32) | ids[i + 1];
            uint32_t rank, res;
            if (merge_lookup(t, key, &rank, &res) && rank < best_rank) {
                best_rank = rank; best_pos = i; best_res = res; found = 1;
            }
        }
        if (!found) break;
        ids[best_pos] = best_res;                       /* pair -> result token */
        for (uint32_t i = best_pos + 1; i + 1 < n; i++) /* close the gap */
            ids[i] = ids[i + 1];
        n--;
    }
    return n;
}

int tok_encode_tab(const struct tok_table *t, const char *text, uint32_t text_len,
                   uint32_t *out_ids, uint32_t max) {
    if (!t || !text) return -1;
    if (!out_ids || max == 0) return 0;

    const uint8_t *b = (const uint8_t *)text;
    uint32_t nout = 0;
    uint32_t pos = 0;

    while (pos < text_len) {
        uint32_t seg = pretok_len(b, text_len, pos);    /* >= 1, so pos advances */

        for (uint32_t off = 0; off < seg; ) {
            uint32_t chunk = seg - off;
            if (chunk > TOK_SEG_MAX) chunk = TOK_SEG_MAX;

            uint32_t ids[TOK_SEG_MAX];
            for (uint32_t i = 0; i < chunk; i++)
                ids[i] = rd32(t->byte2id + (uint32_t)b[pos + off + i] * 4u);
            uint32_t n = bpe_merge(t, ids, chunk);

            /* Stop at a slice boundary once max is reached — drop the tail rather
             * than write a partial pretoken. Wrap-safe: nout <= max always. */
            if (n > max - nout) return (int)nout;
            for (uint32_t i = 0; i < n; i++) out_ids[nout++] = ids[i];

            off += chunk;
        }
        pos += seg;
    }
    return (int)nout;
}

int tok_decode_tab(const struct tok_table *t, const uint32_t *ids, uint32_t n,
                   uint8_t *out, uint32_t cap) {
    if (!t || !out) return -1;
    if (!ids) return 0;

    uint32_t nout = 0;
    for (uint32_t i = 0; i < n; i++) {
        uint32_t id = ids[i];
        if (id >= t->n_tokens) continue;                /* skip, produce no bytes */
        uint32_t s = rd32(t->offsets + (uint64_t)id * 4u);
        uint32_t e = rd32(t->offsets + ((uint64_t)id + 1u) * 4u);
        if (e < s || e > t->blob_len) continue;         /* parse proved this; belt-and-braces */
        uint32_t tl = e - s;
        if (tl > cap - nout) break;                     /* won't fit; stop. wrap-safe: nout <= cap */
        for (uint32_t k = 0; k < tl; k++) out[nout++] = t->blob[s + k];
    }
    return (int)nout;
}

/*
 * Validate `len` bytes at `base` and fill `out`. The layout is fixed by
 * mktok.py, so it is recomputed here from the counts and the header's own
 * offsets must match it exactly (tight packing) — then every section is proven
 * to fit inside `len` BEFORE a single section byte is read. All arithmetic is in
 * uint64_t so an attacker-supplied count cannot wrap a bound.
 */
const char *tok_parse(const void *base, uint32_t len, struct tok_table *out) {
    if (out) {
        struct tok_table zero = {0};
        *out = zero;                                    /* left zeroed on any failure */
    }
    if (!base || !out) return "null args";

    const uint8_t *b = (const uint8_t *)base;

    /* Header first, and only after proving it is present — never read a field
     * before the length that guards it. */
    if (len < 64) return "truncated header";
    uint32_t magic    = rd32(b + 0);
    uint32_t version  = rd32(b + 4);
    uint32_t n_tokens = rd32(b + 8);
    uint32_t n_merges = rd32(b + 12);
    uint32_t off_mrg  = rd32(b + 16);
    uint32_t off_ofs  = rd32(b + 20);
    uint32_t off_blb  = rd32(b + 24);
    uint32_t blob_len = rd32(b + 28);

    if (magic != TOK_MAGIC)     return "bad magic";
    if (version != TOK_VERSION) return "bad version";
    if (n_tokens == 0)          return "no tokens";

    /* Recompute the deterministic layout (mktok.py: byte2id at 64, then merges,
     * offsets, an 8-aligned blob). uint64_t throughout so the products cannot
     * overflow a uint32_t and understate a section's size. */
    uint64_t exp_mrg = 64u + 1024u;                                  /* 1088 */
    uint64_t exp_ofs = exp_mrg + (uint64_t)n_merges * 16u;
    uint64_t exp_blb = exp_ofs + ((uint64_t)n_tokens + 1u) * 4u;
    exp_blb += (8u - (exp_blb % 8u)) % 8u;                           /* pad8 */
    uint64_t total   = exp_blb + (uint64_t)blob_len;

    if (off_mrg != exp_mrg) return "bad merges offset";
    if (off_ofs != exp_ofs) return "bad offsets offset";
    if (off_blb != exp_blb) return "bad blob offset";
    if (total > len)        return "table exceeds module";          /* everything fits */

    const uint8_t *byte2id = b + exp_mrg - 1024u;                   /* b + 64  */
    const uint8_t *merges  = b + off_mrg;
    const uint8_t *offsets = b + off_ofs;
    const uint8_t *blob    = b + off_blb;

    /* byte2id: 256 base-token ids, each a valid token. */
    for (int i = 0; i < 256; i++)
        if (rd32(byte2id + i * 4) >= n_tokens) return "byte2id out of range";

    /* merges: strictly-increasing keys (so binary search is exact and no pair is
     * duplicated), every result a valid token. */
    uint64_t prev_key = 0;
    for (uint32_t i = 0; i < n_merges; i++) {
        const uint8_t *m = merges + (uint64_t)i * 16u;
        uint64_t key = rd64(m);
        if (i > 0 && key <= prev_key) return "merges not strictly increasing";
        prev_key = key;
        if (rd32(m + 12) >= n_tokens)  return "merge result out of range";
    }

    /* offsets: zero-based, monotonic non-decreasing, none past the blob, and the
     * last exactly covering it — so every token's byte range is in-bounds. */
    if (rd32(offsets) != 0) return "offsets not zero-based";
    uint32_t prev_off = 0;
    for (uint32_t i = 1; i <= n_tokens; i++) {
        uint32_t o = rd32(offsets + (uint64_t)i * 4u);
        if (o < prev_off)   return "offsets not monotonic";
        if (o > blob_len)   return "offset past blob";
        prev_off = o;
    }
    if (prev_off != blob_len) return "offsets do not cover blob";

    out->base = b;         out->len = len;
    out->n_tokens = n_tokens; out->n_merges = n_merges;
    out->byte2id = byte2id; out->merges = merges;
    out->offsets = offsets; out->blob = blob; out->blob_len = blob_len;
    return 0;
}

/* ── Singleton front door: one mapped tokenizer for the whole kernel ── */

static struct tok_table g_tab;
static int g_ready;

const char *tok_init(const void *base, uint32_t len) {
    struct tok_table tmp;
    const char *e = tok_parse(base, len, &tmp);
    if (e) { g_ready = 0; return e; }
    g_tab = tmp;
    g_ready = 1;
    return 0;
}

int tok_ready(void) { return g_ready; }

int tok_encode(const char *text, uint32_t text_len, uint32_t *out_ids, uint32_t max) {
    if (!g_ready) return -1;
    return tok_encode_tab(&g_tab, text, text_len, out_ids, max);
}

int tok_decode(const uint32_t *ids, uint32_t n, uint8_t *out, uint32_t cap) {
    if (!g_ready) return -1;
    return tok_decode_tab(&g_tab, ids, n, out, cap);
}
