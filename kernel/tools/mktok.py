#!/usr/bin/env python3
"""Convert a Qwen byte-level BPE tokenizer into a flat binary the kernel maps.

WHY THIS RUNS ON THE HOST. vocab.json is 2.7 MB of JSON carrying \\u escapes and
the GPT-2 byte<->unicode mapping, and resolving each merge to its result token
needs string concatenation plus a vocab lookup. Doing that in freestanding C, at
boot, over a file we did not write, is precisely the untrusted-parser class that
has bitten this kernel repeatedly. So it happens once, here, where there is a
JSON parser and a hash map, and the kernel receives something it can validate
with bounds checks alone.

OUTPUT LAYOUT (little-endian, every section 8-byte aligned):

    header    64 B    magic/version/counts/section offsets
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


def main(vocab_path, merges_path, out_path):
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

    # Sorted by key so the kernel can binary-search without a hash allocator.
    merges.sort(key=lambda m: (m[0] << 32) | m[1])

    blob = bytearray()
    offsets = []
    for b in id_bytes:
        offsets.append(len(blob))
        blob += b
    offsets.append(len(blob))

    byte2id = [0] * 256
    for b in range(256):
        byte2id[b] = vocab[byte_enc[b]]

    def pad8(n):
        return (8 - (n % 8)) % 8

    off_b2i = 64
    off_mrg = off_b2i + 1024
    off_ofs = off_mrg + 16 * len(merges)
    off_blb = off_ofs + 4 * len(offsets)
    off_blb += pad8(off_blb)

    hdr = struct.pack("<8I", MAGIC, 1, n_tokens, len(merges),
                      off_mrg, off_ofs, off_blb, len(blob)) + b"\0" * 32

    with open(out_path, "wb") as f:
        f.write(hdr)
        f.write(struct.pack("<256I", *byte2id))
        for left, right, rank, res in merges:
            f.write(struct.pack("<QII", (left << 32) | right, rank, res))
        f.write(struct.pack("<%dI" % len(offsets), *offsets))
        f.write(b"\0" * pad8(off_ofs + 4 * len(offsets)))
        f.write(bytes(blob))

    total = off_blb + len(blob)
    print("tokens        %8d" % n_tokens)
    print("merges        %8d  (%.2f MB)" % (len(merges), 16 * len(merges) / 1e6))
    print("offsets       %8d  (%.2f MB)" % (len(offsets), 4 * len(offsets) / 1e6))
    print("blob          %8d B (%.2f MB)  avg %.2f B/token"
          % (len(blob), len(blob) / 1e6, len(blob) / n_tokens))
    print("byte2id           1024 B")
    print("-" * 46)
    print("TOTAL         %8d B (%.2f MB)" % (total, total / 1e6))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: mktok.py vocab.json merges.txt out.bin")
    main(*sys.argv[1:])
