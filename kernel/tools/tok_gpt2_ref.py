#!/usr/bin/env python3
"""Generate the GPT-2 tokenizer reference fixture for kernel/tests/test_tok_gpt2.c.

THE REFERENCE is tiktoken's "gpt2" encoding — the exact object Ember is trained
and chatted with (custom-model/train_best.py, finetune.py, chat.py all call
tiktoken.get_encoding("gpt2")). tok.c's GPT-2 mode is held to its ids over a
corpus, the same discipline tok_ref.py applies to the Qwen mode: a tokenizer
that is off by one token feeds the model ids it never saw, which reads as a bad
model — the failure mode that costs a week.

Same two tiers as tok_ref.py:

  TIER 1 (committed, hermetic, runs in `make test`): a SMALL embedded table,
  kind = gpt2, holding only the merges tiktoken actually applies over the
  corpus, ids remapped to a compact range by one bijection applied to both the
  table and the reference ids. A subset only ever REMOVES candidates, and the
  full encoder chose the lowest-rank (leftmost on ties) candidate at every step,
  so no removed candidate could have won: the subset reproduces tiktoken's exact
  segmentation and merge order. The BPE walk that records "applied" is a Python
  twin of tok.c's loop over mktok.py's all-splits rule set, and its ids are
  cross-checked against tiktoken.encode_ordinary for every string — if the twin
  ever disagrees with tiktoken, this script refuses to write a fixture.

  TIER 2 (literal, run when TOK_GPT2_BIN points at the full table from
  `mktok.py --gpt2`): the fixture also carries the LITERAL tiktoken ids, and the
  test matches tok.c over the full 50257-token table against them, no remap.

Needs tiktoken on the host (pip install tiktoken; it is a tokenizer library,
not a model). Run from anywhere:
    python3 kernel/tools/tok_gpt2_ref.py
writes: kernel/tools/tok_gpt2_fixture.h
"""
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAGIC = 0x314B5441  # "ATK1"
KIND_GPT2 = 2       # tok.h TOK_KIND_GPT2

# The corpus. ASCII only (kbd.c cannot enter anything else). Chosen so that
# between them every branch of the GPT-2 split fires, INCLUDING every place it
# differs from Qwen's: digit runs (GPT-2 keeps "2025" together, Qwen splits per
# digit), case-sensitive contractions ("DON'T" is DON ' T here, one contraction
# under Qwen), punctuation that may NOT lead a word ("(hello" is two pretokens
# here, one under Qwen), newlines that a punctuation run does not absorb, and
# Ember's own "User: ...\nEmber:" turn. corpus[0] must fire merges (the control
# corrupts one of them).
CORPUS = [
    "hello world programming",             # 0 — plain words, real merges (control target)
    " the quick brown fox",                # leading-space words
    "Don't and can't won't I'll we've",    # contractions, lower case
    "DON'T SHOUT I'M HERE WE'LL SEE",      # upper case: NOT contractions in GPT-2
    "the year is 2025 already",            # digit run stays one pretoken
    "1234567890 and 3.14159",              # long digit run, decimal point
    "(hello) [world] {code} <tag>",        # punctuation cannot lead a word
    "int main(void) { return 0; }",        # code
    "a+b*c - d/e = 42",                    # operators and a number
    "email: user@example.com",             # punctuation cluster
    "tab\tseparated\tvalues",              # literal tabs
    "line one\nline two\n",                # newlines incl. trailing
    "para one\n\npara two",                # blank line
    "x  \n y",                             # mixed whitespace run before a word
    "end!!!\n\nnext",                      # punctuation run does not absorb newlines
    "trailing spaces here    ",            # trailing run of spaces
    "   leading spaces",                   # leading run of spaces
    "double  spaced  words",               # interior double spaces
    "UPPER lower MiXeD CaSe",              # case mix
    "rock 'n' roll",                       # lone apostrophe, not a contraction
    "!!!???...,,,;;;",                     # pure punctuation runs
    "path/to/some/file.txt",               # slashes + a dot-extension
    "print('hi'); x = 3.14",               # quotes, decimal
    "internationalization",                # a long word, many merge steps
    "User: who are you?\nEmber:",          # Ember's turn template (emberfmt.py)
    "User: what is 2+2?\nEmber: It's 4.<|endoftext|>",  # the eot TEXT stays text
    "I'm Ember, a small AI built into Astrion OS.",
]

CTRL_STR = 0  # the corpus index the control test re-encodes after corrupting a merge


def load_gpt2():
    """tiktoken gpt2 -> (enc, n_tokens, id_bytes, rule, byte2id, splitter).
    rule maps (left_id, right_id) -> (rank, result_id) over EVERY two-token
    split of every token — mktok.py's rule set, i.e. tiktoken's byte-hash merge
    expressed as pair rules. The splitter is tiktoken's own pattern under the
    `regex` module it depends on, so segmentation is the engine's, not ours."""
    import regex
    import tiktoken
    import tiktoken_ext.openai_public as pub

    enc = tiktoken.get_encoding("gpt2")
    ranks = enc._mergeable_ranks
    n_tokens = enc.n_vocab
    id_bytes = [b""] * n_tokens
    for tok, tid in ranks.items():
        id_bytes[tid] = tok
    for tok, tid in enc._special_tokens.items():
        id_bytes[tid] = tok.encode("utf-8")

    rule = {}
    for tok, tid in ranks.items():
        for k in range(1, len(tok)):
            left, right = ranks.get(tok[:k]), ranks.get(tok[k:])
            if left is not None and right is not None:
                rule[(left, right)] = (tid, tid)
    byte2id = [ranks[bytes([b])] for b in range(256)]
    splitter = regex.compile(pub.gpt2()["pat_str"])
    return enc, n_tokens, id_bytes, rule, byte2id, splitter


def bpe_segment(seg_bytes, byte2id, rule, applied):
    """tok.c's bpe_merge, in Python: lowest rank wins, leftmost on ties. Records
    every applied (left,right) pair; returns (ids, lowest-rank merge fired)."""
    ids = [byte2id[b] for b in seg_bytes]
    pivot = None
    while True:
        best = None
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


def encode_ref(s, splitter, byte2id, rule, applied):
    ids, pivot = [], None
    for m in splitter.finditer(s):
        sids, spiv = bpe_segment(m.group().encode("utf-8"), byte2id, rule, applied)
        ids += sids
        if spiv is not None and (pivot is None or spiv[0] < pivot[0]):
            pivot = spiv
    return ids, pivot


def pad8(n):
    return (8 - (n % 8)) % 8


def build_table(n_tokens, byte2id, merges, id_bytes):
    """Serialise a table in mktok.py's exact binary layout, kind = gpt2."""
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
                       off_mrg, off_ofs, off_blb, len(blob))
    out += struct.pack("<I", KIND_GPT2) + b"\0" * 28
    out += struct.pack("<256I", *byte2id)
    for (l, r, rank, res) in merges:
        out += struct.pack("<QII", (l << 32) | r, rank, res)
    out += struct.pack("<%dI" % len(offsets), *offsets)
    out += b"\0" * pad8(off_ofs + 4 * len(offsets))
    out += bytes(blob)
    return bytes(out), merges, off_mrg


def cstr(s):
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
    enc, n_tokens, id_bytes, rule, byte2id, splitter = load_gpt2()

    applied = set()
    real_ids = []
    pivots = []
    for s in CORPUS:
        ids, pivot = encode_ref(s, splitter, byte2id, rule, applied)
        ref = enc.encode_ordinary(s)
        # The twin must agree with tiktoken itself, or the reference is not one.
        if ids != ref:
            sys.exit("MISMATCH vs tiktoken on %r\n  ours:     %s\n  tiktoken: %s"
                     % (s, ids, ref))
        real_ids.append(ids)
        pivots.append(pivot)

    # ── the compact remapped subset ──
    used = set(byte2id)
    for (l, r) in applied:
        used.add(l); used.add(r); used.add(rule[(l, r)][1])
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
    ref_ids = [[remap[i] for i in ids] for ids in real_ids]

    # ── control: corpus[CTRL_STR]'s pivotal merge, located in the sorted subset ──
    piv = pivots[CTRL_STR]
    if piv is None:
        sys.exit("corpus[%d] fires no merge; pick a control string that does" % CTRL_STR)
    _, pl, pr = piv
    key = (remap[pl] << 32) | remap[pr]
    idx = next(i for i, m in enumerate(sorted_merges) if ((m[0] << 32) | m[1]) == key)
    ctrl_rank_off = off_mrg + idx * 16 + 8

    out = os.path.join(HERE, "tok_gpt2_fixture.h")
    with open(out, "w") as f:
        f.write("/* GENERATED by kernel/tools/tok_gpt2_ref.py — do not edit by hand.\n"
                " *\n"
                " * Reference for tests/test_tok_gpt2.c. Ids are tiktoken's \"gpt2\"\n"
                " * encoding's — Ember's tokenizer — produced by tiktoken itself.\n"
                " *   TOK_G2_REF_*  : ids remapped into the embedded subset table below\n"
                " *                   (tier 1, hermetic — the committed gate).\n"
                " *   TOK_G2_REAL_* : the LITERAL tiktoken ids (tier 2 — matched against\n"
                " *                   the full table from `mktok.py --gpt2` when\n"
                " *                   TOK_GPT2_BIN is set).\n"
                " * The subset holds only the %d merges tiktoken applies over the corpus,\n"
                " * which reproduces its exact segmentation and merge order. */\n"
                % len(sub_merges))
        f.write("#ifndef TOK_GPT2_FIXTURE_H\n#define TOK_GPT2_FIXTURE_H\n\n")
        f.write("#define TOK_G2_REF_N %d\n" % len(CORPUS))
        f.write("#define TOK_G2_REF_CTRL_STR %d\n" % CTRL_STR)
        f.write("#define TOK_G2_REF_CTRL_RANK_OFF %d\n" % ctrl_rank_off)
        f.write("#define TOK_G2_REAL_VOCAB %d\n" % n_tokens)
        f.write("#define TOK_G2_REAL_EOT %d\n\n" % enc.eot_token)

        f.write("static const char *const TOK_G2_REF_STR[TOK_G2_REF_N] = {\n")
        for s in CORPUS:
            f.write("  %s,\n" % cstr(s))
        f.write("};\n")
        f.write("static const int TOK_G2_REF_STRLEN[TOK_G2_REF_N] = { %s };\n\n"
                % ", ".join(str(len(s.encode("utf-8"))) for s in CORPUS))

        for i, ids in enumerate(ref_ids):
            carr_u(f, "TOK_G2_REF_IDS_%d" % i, ids)
        f.write("static const unsigned *const TOK_G2_REF_IDS[TOK_G2_REF_N] = { %s };\n"
                % ", ".join("TOK_G2_REF_IDS_%d" % i for i in range(len(ref_ids))))
        f.write("static const int TOK_G2_REF_NID[TOK_G2_REF_N] = { %s };\n\n"
                % ", ".join(str(len(ids)) for ids in ref_ids))

        for i, ids in enumerate(real_ids):
            carr_u(f, "TOK_G2_REAL_IDS_%d" % i, ids)
        f.write("static const unsigned *const TOK_G2_REAL_IDS[TOK_G2_REF_N] = { %s };\n"
                % ", ".join("TOK_G2_REAL_IDS_%d" % i for i in range(len(real_ids))))
        f.write("static const int TOK_G2_REAL_NID[TOK_G2_REF_N] = { %s };\n\n"
                % ", ".join(str(len(ids)) for ids in real_ids))

        f.write("#define TOK_G2_TABLE_LEN %d\n" % len(table))
        f.write("static const unsigned char TOK_G2_TABLE[TOK_G2_TABLE_LEN] = {\n")
        for i in range(0, len(table), 16):
            f.write("  " + ",".join("%d" % x for x in table[i:i + 16]) + ",\n")
        f.write("};\n\n")
        f.write("#endif /* TOK_GPT2_FIXTURE_H */\n")

    print("corpus strings %d" % len(CORPUS))
    print("gpt2 vocab     %d tokens, %d pair rules, eot %d" % (n_tokens, len(rule), enc.eot_token))
    print("subset         %d tokens, %d merges  -> table %d bytes (%.1f KB)"
          % (K, len(sub_merges), len(table), len(table) / 1024))
    print("control        corpus[%d] pivot merge at rank offset %d" % (CTRL_STR, ctrl_rank_off))
    print("wrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
