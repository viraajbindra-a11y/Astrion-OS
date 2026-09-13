#!/usr/bin/env python3
"""Convert a byte-level BPE tokenizer into a flat binary the kernel maps.

TWO SOURCES, one table format:
    mktok.py vocab.json merges.txt out.bin     a HuggingFace Qwen2.5 tokenizer
    mktok.py --gpt2 out.bin                    tiktoken's "gpt2" — Ember's tokenizer

Ember (custom-model/train_best.py, finetune.py, chat.py) tokenizes with
tiktoken.get_encoding("gpt2"): 50257 tokens, <|endoftext|> = 50256, and the
GPT-2 split regex — NOT Qwen's. The kernel's tok.c carries both splits and
picks one by the KIND written into this header (byte 32), which the brain file
(AMW2) cross-checks at boot so a Qwen table can never be run in front of a
GPT-2 model. tiktoken has no merges.txt: it holds bytes -> rank, and merges by
looking up the concatenated BYTES of any adjacent pair (its _byte_pair_merge).
That is reproduced exactly by listing, for every token, every split into two
tokens as a merge rule whose priority is the result's rank — tests/test_tok_gpt2.c
holds tok.c to tiktoken's ids over a corpus, so the equivalence is gated, not
assumed.

WHY THIS RUNS ON THE HOST. vocab.json is 2.7 MB of JSON carrying \\u escapes and
the GPT-2 byte<->unicode mapping, and resolving each merge to its result token
needs string concatenation plus a vocab lookup. Doing that in freestanding C, at
boot, over a file we did not write, is precisely the untrusted-parser class that
has bitten this kernel repeatedly. So it happens once, here, where there is a
JSON parser and a hash map, and the kernel receives something it can validate
with bounds checks alone.

OUTPUT LAYOUT (little-endian, every section 8-byte aligned):

    header    64 B    magic/version/counts/section offsets; byte 32 = KIND
                      (tok.h TOK_KIND_*: 1 qwen2, 2 gpt2; 0 in older tables)
    byte2id  1024 B   the 256 single-byte tokens, the BPE starting alphabet
    merges     16 B * n_merges, SORTED BY KEY so the kernel binary-searches
                      key u64 = (left_id << 32) | right_id
                      rank u32   lower wins; the merge order from merges.txt
                      result u32 the token the pair becomes
    offsets     4 B * (n_tokens + 1)   into blob; [i]..[i+1] is token i
    blob                              raw token bytes, for DECODING

The kernel never needs string->id: BPE starts from the 256 byte tokens and only
ever combines ids. Strings are carried solely so generated ids can be turned
back into text.
"""
import json, struct, sys

MAGIC = 0x314B5441          # "ATK1"
KIND_QWEN2 = 1              # tok.h TOK_KIND_QWEN2
KIND_GPT2 = 2               # tok.h TOK_KIND_GPT2


def bytes_to_unicode():
    """GPT-2's byte<->printable-codepoint map. Qwen uses it unchanged."""
    bs = (list(range(ord("!"), ord("~") + 1)) +
          list(range(ord("¡"), ord("¬") + 1)) +
          list(range(ord("®"), ord("ÿ") + 1)))
    cs, n = bs[:], 0
    for b in range(256):
        if b not in bs:
            bs.append(b); cs.append(256 + n); n += 1
    return dict(zip(bs, [chr(c) for c in cs]))


def load_gpt2():
    """tiktoken's gpt2 encoding -> (n_tokens, id_bytes, merges, byte2id).

    _mergeable_ranks is {token bytes: id} for the 50256 ordinary tokens; the
    one special token <|endoftext|> (50256) is appended so decode is faithful
    and the table's vocab is the full 50257. Merge rules are every (left, right)
    token pair whose concatenation is a token, priority = the result's id, which
    is exactly the pair tiktoken would merge at that step (it hashes the bytes,
    and ranks are ids). Ties between positions resolve leftmost in both."""
    import tiktoken
    enc = tiktoken.get_encoding("gpt2")
    ranks = enc._mergeable_ranks
    n_tokens = enc.n_vocab                                   # 50257
    id_bytes = [b""] * n_tokens
    for tok, tid in ranks.items():
        id_bytes[tid] = tok
    for tok, tid in enc._special_tokens.items():
        id_bytes[tid] = tok.encode("utf-8")
    merges = []
    for tok, tid in ranks.items():
        for k in range(1, len(tok)):
            left, right = ranks.get(tok[:k]), ranks.get(tok[k:])
            if left is not None and right is not None:
                merges.append((left, right, tid, tid))
    byte2id = [ranks[bytes([b])] for b in range(256)]
    return n_tokens, id_bytes, merges, byte2id


def load_hf(vocab_path, merges_path):
    """A HuggingFace vocab.json + merges.txt (Qwen2.5) -> the same tuple."""
    byte_enc = bytes_to_unicode()
    uni_to_byte = {v: k for k, v in byte_enc.items()}

    with open(vocab_path, encoding="utf-8") as f:
        vocab = json.load(f)
    n_tokens = max(vocab.values()) + 1

    # id -> raw bytes. Every character of a token maps back to exactly one byte;
    # anything that does not is a vocab we do not understand, and guessing at it
    # would produce a tokenizer that silently disagrees with the reference.
    id_bytes = [b""] * n_tokens
    for tok, tid in vocab.items():
        try:
            id_bytes[tid] = bytes(uni_to_byte[c] for c in tok)
        except KeyError:
            sys.exit("token %r at id %d has a character outside the byte map" % (tok, tid))

    merges = []
    with open(merges_path, encoding="utf-8") as f:
        for rank, line in enumerate(f):
            line = line.rstrip("\n")
            if not line or line.startswith("#version"):
                continue
            a, b = line.split(" ")
            # A merge naming a token the vocab does not have is unusable: we
            # would have nothing to replace the pair WITH.
            if a not in vocab or b not in vocab or (a + b) not in vocab:
                continue
            merges.append((vocab[a], vocab[b], len(merges), vocab[a + b]))

    byte2id = [vocab[byte_enc[b]] for b in range(256)]
    return n_tokens, id_bytes, merges, byte2id


def write_table(out_path, kind, n_tokens, id_bytes, merges, byte2id):
    # Sorted by key so the kernel can binary-search without a hash allocator.
    merges.sort(key=lambda m: (m[0] << 32) | m[1])
    assert len({(m[0], m[1]) for m in merges}) == len(merges), "duplicate merge pair"

    blob = bytearray()
    offsets = []
    for b in id_bytes:
        offsets.append(len(blob))
        blob += b
    offsets.append(len(blob))

    def pad8(n):
        return (8 - (n % 8)) % 8

    off_b2i = 64
    off_mrg = off_b2i + 1024
    off_ofs = off_mrg + 16 * len(merges)
    off_blb = off_ofs + 4 * len(offsets)
    off_blb += pad8(off_blb)

    hdr = struct.pack("<8I", MAGIC, 1, n_tokens, len(merges),
                      off_mrg, off_ofs, off_blb, len(blob))
    hdr += struct.pack("<I", kind) + b"\0" * 28              # byte 32: KIND

    with open(out_path, "wb") as f:
        f.write(hdr)
        f.write(struct.pack("<256I", *byte2id))
        for left, right, rank, res in merges:
            f.write(struct.pack("<QII", (left << 32) | right, rank, res))
        f.write(struct.pack("<%dI" % len(offsets), *offsets))
        f.write(b"\0" * pad8(off_ofs + 4 * len(offsets)))
        f.write(bytes(blob))

    total = off_blb + len(blob)
    print("kind          %8d  (1 qwen2, 2 gpt2)" % kind)
    print("tokens        %8d" % n_tokens)
    print("merges        %8d  (%.2f MB)" % (len(merges), 16 * len(merges) / 1e6))
    print("offsets       %8d  (%.2f MB)" % (len(offsets), 4 * len(offsets) / 1e6))
    print("blob          %8d B (%.2f MB)  avg %.2f B/token"
          % (len(blob), len(blob) / 1e6, len(blob) / n_tokens))
    print("byte2id           1024 B")
    print("-" * 46)
    print("TOTAL         %8d B (%.2f MB)" % (total, total / 1e6))


def main(argv):
    if len(argv) == 3 and argv[1] == "--gpt2":
        write_table(argv[2], KIND_GPT2, *load_gpt2())
    elif len(argv) == 4:
        write_table(argv[3], KIND_QWEN2, *load_hf(argv[1], argv[2]))
    else:
        sys.exit("usage: mktok.py vocab.json merges.txt out.bin   (Qwen2.5, HF files)\n"
                 "       mktok.py --gpt2 out.bin                  (tiktoken gpt2, Ember)")


if __name__ == "__main__":
    main(sys.argv)
