#!/usr/bin/env python3
"""Generate the tokenizer reference fixture for kernel/tests/test_tok.c.

THE REFERENCE. tok.c's encoder is checked against the HuggingFace `tokenizers`
library running the REAL Qwen2.5 tokenizer, the same discipline q8_dot and the
forward pass met — a tokenizer that runs without crashing and disagrees with the
reference by one token reads as a subtly worse model, the failure mode that
costs a week.

Two things come out of here, and the split matters:

  TIER 1 (committed, hermetic, runs in `make test`): a SMALL embedded table that
  is behaviour-identical to Qwen over the corpus. It contains only the merges
  Qwen actually applies while encoding these strings; that subset provably
  reproduces Qwen's exact segmentation and merge order (a subset only ever
  REMOVES merges, and the full encoder already chose the lowest-rank present
  merge at every step, so no removed merge could have won — proof in the code
  below). Token ids are remapped to a compact range so the whole table fits in a
  header; the remap is one bijection applied to BOTH the table and the reference
  ids, so `tok_encode == reference` proves EXACT parity with Qwen, only the
  integer labels are relabelled. The real table is 151643 tokens / 4 MB — far too
  big to commit, which is why the subset exists.

  TIER 2 (literal, run wherever the real 4 MB tok.bin is present): the fixture
  also carries the LITERAL real Qwen ids. test_tok.c, run with TOK_REAL_DIR set,
  loads the real tok.bin from disk and asserts tok_encode == those literal ids —
  the same tok.c parse+encode over the full real merge table, matched against the
  real integers, no remap. That is the end-to-end gate; it just can't be a
  committed CI asset.

Run from the repo root (or anywhere; paths are resolved to this file):
    python3 kernel/tools/tok_ref.py [path-to-qwen-tokenizer-dir]
default dir: scratchpad/qwentok  (tokenizer.json + vocab.json + merges.txt)
writes:      kernel/tools/tok_ref_fixture.h
"""
import json, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
MAGIC = 0x314B5441  # "ATK1"

# The corpus. ASCII only (kbd.c cannot enter anything else), chosen so that
# BETWEEN them every branch of the pretokenizer regex and multi-step BPE fires:
# leading-space words, the case-insensitive contractions, multi-digit numbers
# (which Qwen splits per-digit), punctuation runs, tabs/newlines/trailing space,
# an apostrophe that is NOT a contraction, code, and mixed case. corpus[0] must
# trigger merges (the control corrupts one of them).
CORPUS = [
    "hello world programming",          # 0 — plain words, real merges (control target)
    " the quick brown fox",             # leading-space words
    "Don't and can't won't I'll we've", # contractions, case-insensitive, apostrophes
    "Astrion OS v2.0 kernel",           # mixed case + version number
    "the year is 2025 already",         # multi-digit -> per-digit split
    "int main(void) { return 0; }",     # code: braces, parens, semicolons
    "a+b*c - d/e = 42",                 # operators and a number
    "email: user@example.com",          # punctuation cluster, no spaces around @
    "tab\tseparated\tvalues",           # literal tabs
    "line one\nline two\n",             # newlines incl. trailing
    "trailing spaces here    ",         # trailing run of spaces
    "double  spaced  words",            # interior double spaces
    "UPPER lower MiXeD CaSe",           # case mix
    "rock 'n' roll",                    # a lone apostrophe that is not a contraction
    "1234567890",                       # a long digit run
    "!!!???...,,,;;;",                  # pure punctuation runs
    "path/to/some/file.txt",            # slashes + a dot-extension
    "print('hi'); x = 3.14",            # quotes, decimal
    "   leading spaces",                # leading run of spaces then a word
    "AI is the product.",               # a short sentence with a period
]

CTRL_STR = 0  # the corpus index the control test re-encodes after corrupting a merge


def bytes_to_unicode():
    """GPT-2's byte<->printable-codepoint map; Qwen uses it unchanged. Same as
    mktok.py — the table the kernel maps is built with exactly this."""
    bs = (list(range(ord("!"), ord("~") + 1)) +
          list(range(ord("¡"), ord("¬") + 1)) +
          list(range(ord("®"), ord("ÿ") + 1)))
    cs, n = bs[:], 0
    for b in range(256):
        if b not in bs:
            bs.append(b); cs.append(256 + n); n += 1
    return dict(zip(bs, [chr(c) for c in cs]))


def load_qwen(tokdir):
    from tokenizers import Tokenizer
    from tokenizers.pre_tokenizers import Split
    from tokenizers import Regex

    tok = Tokenizer.from_file(os.path.join(tokdir, "tokenizer.json"))

    with open(os.path.join(tokdir, "vocab.json"), encoding="utf-8") as f:
        vocab = json.load(f)
    n_tokens = max(vocab.values()) + 1

    byte_enc = bytes_to_unicode()
    uni_to_byte = {v: k for k, v in byte_enc.items()}

    # id -> raw bytes (for decode / blob), exactly as mktok.py resolves them.
    id_bytes = [b""] * n_tokens
    for t, tid in vocab.items():
        id_bytes[tid] = bytes(uni_to_byte[c] for c in t)

    # merges list, filtered + ordered exactly like mktok.py: (left,right,rank,result).
    merges = []
    with open(os.path.join(tokdir, "merges.txt"), encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#version"):
                continue
            a, b = line.split(" ")
            if a not in vocab or b not in vocab or (a + b) not in vocab:
                continue
            merges.append((vocab[a], vocab[b], len(merges), vocab[a + b]))

    # (left,right) -> (rank, result), the map BPE consults.
    rule = {(l, r): (rank, res) for (l, r, rank, res) in merges}

    byte2id = [vocab[byte_enc[b]] for b in range(256)]

    # Qwen's real Split regex, as a standalone pre-tokenizer, so segmentation is
    # the engine's own — not a Python re-implementation that could drift from it.
    pat = ("(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}"
           "| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+")
    split = Split(Regex(pat), behavior="isolated")

    return tok, vocab, n_tokens, id_bytes, rule, byte2id, split


def bpe_segment(seg_bytes, byte2id, rule, applied):
    """Byte-level BPE on one pretoken. Records every applied (left,right) in
    `applied`, and returns (ids, first_pivot) where first_pivot is the (l,r) of
    the lowest-rank merge this segment fired (or None)."""
    ids = [byte2id[b] for b in seg_bytes]
    pivot = None  # (rank, l, r) of the first merge fired in this segment
    while True:
        best = None  # (rank, i, result, l, r)
        for i in range(len(ids) - 1):
            hit = rule.get((ids[i], ids[i + 1]))
            if hit is not None and (best is None or hit[0] < best[0]):
                best = (hit[0], i, hit[1], ids[i], ids[i + 1])
        if best is None:
            break
        rank, i, res, l, r = best
        applied.add((l, r))
        if pivot is None or rank < pivot[0]:
            pivot = (rank, l, r)
        ids[i:i + 2] = [res]
    return ids, pivot


def encode_ref(s, split, byte2id, rule, applied):
    """Encode `s` by Qwen's real segmentation + byte-level BPE. Returns (ids,
    pivot) where pivot is the globally lowest-rank merge fired for this string."""
    ids, pivot = [], None
    for seg, _ in split.pre_tokenize_str(s):
        seg_bytes = seg.encode("utf-8")
        sids, spiv = bpe_segment(seg_bytes, byte2id, rule, applied)
        ids += sids
        if spiv is not None and (pivot is None or spiv[0] < pivot[0]):
            pivot = spiv
    return ids, pivot


def pad8(n):
    return (8 - (n % 8)) % 8


def build_table(n_tokens, byte2id, merges, id_bytes):
    """Serialise a table in mktok.py's exact binary layout."""
    merges = sorted(merges, key=lambda m: (m[0] << 32) | m[1])
    blob = bytearray()
    offsets = []
    for i in range(n_tokens):
        offsets.append(len(blob))
        blob += id_bytes[i]
    offsets.append(len(blob))

    off_mrg = 64 + 1024
    off_ofs = off_mrg + 16 * len(merges)
    off_blb = off_ofs + 4 * len(offsets)
    off_blb += pad8(off_blb)

    out = bytearray()
    out += struct.pack("<8I", MAGIC, 1, n_tokens, len(merges),
                       off_mrg, off_ofs, off_blb, len(blob)) + b"\0" * 32
    out += struct.pack("<256I", *byte2id)
    for (l, r, rank, res) in merges:
        out += struct.pack("<QII", (l << 32) | r, rank, res)
    out += struct.pack("<%dI" % len(offsets), *offsets)
    out += b"\0" * pad8(off_ofs + 4 * len(offsets))
    out += bytes(blob)
    return bytes(out), merges, off_mrg


def cstr(s):
    """A C string literal for an ASCII string (escaping the awkward bytes)."""
    out = ['"']
    for ch in s:
        b = ord(ch)
        if ch == '\\': out.append('\\\\')
        elif ch == '"': out.append('\\"')
        elif ch == '\t': out.append('\\t')
        elif ch == '\n': out.append('\\n')
        elif ch == '\r': out.append('\\r')
        elif 0x20 <= b < 0x7f: out.append(ch)
        else: out.append('\\x%02x' % b)
    out.append('"')
    return "".join(out)


def carr_u(f, name, vals):
    f.write("static const unsigned %s[] = {" % name)
    f.write(", ".join(str(v) for v in vals) if vals else "0")
    f.write("};\n")


def main():
    tokdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "scratchpad", "qwentok")
    if not os.path.isdir(tokdir):
        sys.exit("tokenizer dir not found: %s\n(need tokenizer.json, vocab.json, merges.txt)" % tokdir)

    tok, vocab, n_tokens, id_bytes, rule, byte2id, split = load_qwen(tokdir)

    applied = set()
    real_ids = []
    pivots = []
    for s in CORPUS:
        ids, pivot = encode_ref(s, split, byte2id, rule, applied)
        # Cross-check our byte-level BPE against the HF library end-to-end. If
        # this ever fires, the reference is not trustworthy and nothing below is.
        ref = tok.encode(s, add_special_tokens=False).ids
        if ids != ref:
            sys.exit("MISMATCH vs HF tokenizers on %r\n  ours: %s\n  hf:   %s"
                     % (s, ids, ref))
        real_ids.append(ids)
        pivots.append(pivot)

    # ── build the compact remapped subset ──
    used = set(byte2id)                     # all 256 base ids are always present
    for (l, r) in applied:
        used.add(l); used.add(r)
    for (l, r) in applied:
        used.add(rule[(l, r)][1])           # results
    for ids in real_ids:
        used.update(ids)
    used = sorted(used)
    remap = {old: new for new, old in enumerate(used)}
    K = len(used)

    sub_byte2id = [remap[b] for b in byte2id]
    sub_merges = [(remap[l], remap[r], rule[(l, r)][0], remap[rule[(l, r)][1]])
                  for (l, r) in applied]
    sub_id_bytes = [id_bytes[old] for old in used]
    table, sorted_merges, off_mrg = build_table(K, sub_byte2id, sub_merges, sub_id_bytes)

    ref_ids = [[remap[i] for i in ids] for ids in real_ids]   # tier-1 (remapped)

    # ── control: the pivotal merge for corpus[CTRL_STR], located in the sorted
    # subset, so the test can bump its rank and watch the encoding change. ──
    piv = pivots[CTRL_STR]
    if piv is None:
        sys.exit("corpus[%d] fires no merge; pick a control string that does" % CTRL_STR)
    _, pl, pr = piv
    key = (remap[pl] << 32) | remap[pr]
    idx = next(i for i, m in enumerate(sorted_merges) if ((m[0] << 32) | m[1]) == key)
    ctrl_rank_off = off_mrg + idx * 16 + 8   # byte offset of that merge's rank u32

    # ── emit the fixture ──
    out = os.path.join(HERE, "tok_ref_fixture.h")
    with open(out, "w") as f:
        f.write("/* GENERATED by kernel/tools/tok_ref.py — do not edit by hand.\n"
                " *\n"
                " * Reference for tests/test_tok.c. Ids are the real Qwen2.5\n"
                " * tokenizer's, produced by the HuggingFace `tokenizers` library.\n"
                " *   TOK_REF_*  : ids remapped into the embedded subset table below\n"
                " *                (tier 1, hermetic — the committed gate).\n"
                " *   TOK_REAL_* : the LITERAL real Qwen ids (tier 2 — matched against\n"
                " *                the real 4 MB tok.bin when TOK_REAL_DIR is set).\n"
                " * The subset holds only the %d merges Qwen applies over the corpus,\n"
                " * which reproduces its exact segmentation and merge order. */\n"
                % len(sub_merges))
        f.write("#ifndef TOK_REF_FIXTURE_H\n#define TOK_REF_FIXTURE_H\n\n")
        f.write("#define TOK_REF_N %d\n" % len(CORPUS))
        f.write("#define TOK_REF_CTRL_STR %d\n" % CTRL_STR)
        f.write("#define TOK_REF_CTRL_RANK_OFF %d\n\n" % ctrl_rank_off)

        f.write("static const char *const TOK_REF_STR[TOK_REF_N] = {\n")
        for s in CORPUS:
            f.write("  %s,\n" % cstr(s))
        f.write("};\n")
        f.write("static const int TOK_REF_STRLEN[TOK_REF_N] = { %s };\n\n"
                % ", ".join(str(len(s.encode("utf-8"))) for s in CORPUS))

        for i, ids in enumerate(ref_ids):
            carr_u(f, "TOK_REF_IDS_%d" % i, ids)
        f.write("static const unsigned *const TOK_REF_IDS[TOK_REF_N] = { %s };\n"
                % ", ".join("TOK_REF_IDS_%d" % i for i in range(len(ref_ids))))
        f.write("static const int TOK_REF_NID[TOK_REF_N] = { %s };\n\n"
                % ", ".join(str(len(ids)) for ids in ref_ids))

        for i, ids in enumerate(real_ids):
            carr_u(f, "TOK_REAL_IDS_%d" % i, ids)
        f.write("static const unsigned *const TOK_REAL_IDS[TOK_REF_N] = { %s };\n"
                % ", ".join("TOK_REAL_IDS_%d" % i for i in range(len(real_ids))))
        f.write("static const int TOK_REAL_NID[TOK_REF_N] = { %s };\n\n"
                % ", ".join(str(len(ids)) for ids in real_ids))

        f.write("#define TOK_TABLE_LEN %d\n" % len(table))
        f.write("static const unsigned char TOK_TABLE[TOK_TABLE_LEN] = {\n")
        for i in range(0, len(table), 16):
            f.write("  " + ",".join("%d" % x for x in table[i:i + 16]) + ",\n")
        f.write("};\n\n")
        f.write("#endif /* TOK_REF_FIXTURE_H */\n")

    print("corpus strings %d" % len(CORPUS))
    print("real vocab     %d tokens, %d merges" % (n_tokens, len(rule)))
    print("subset         %d tokens, %d merges  -> table %d bytes (%.1f KB)"
          % (K, len(sub_merges), len(table), len(table) / 1024))
    print("control        corpus[%d] pivot merge at rank offset %d" % (CTRL_STR, ctrl_rank_off))
    print("wrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
