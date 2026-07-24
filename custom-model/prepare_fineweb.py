#!/usr/bin/env python3
"""
prepare_fineweb.py — download REAL internet text and turn it into a token file
train_internet.py can learn from.

It streams FineWeb-Edu (a cleaned, education-filtered slice of the actual web —
Common Crawl, run through a quality classifier so you get real articles, not
spam and boilerplate), tokenizes it with the GPT-2 byte-pair tokenizer, and
writes the token ids as raw 16-bit numbers to two files:

    data/fineweb.bin       <- training tokens
    data/fineweb_val.bin   <- a small held-out slice, to measure honesty

    pip install datasets tiktoken           # one-time
    python prepare_fineweb.py --mb 700       # ~300M tokens  (Tier A, tonight)
    python prepare_fineweb.py --mb 20000     # ~10B tokens   (Tier B, weekend)
    python train_internet.py                 # then train

"Streaming" means it pulls the data over the network in small pieces and never
downloads the whole 44-terabyte dataset — it stops as soon as it has the amount
you asked for with --mb. Nothing about this needs a login or a paid account.
"""
import argparse, os, sys, numpy as np

# FineWeb-Edu: the educational-quality subset (score >= 3). Higher signal per
# token than raw FineWeb, which is exactly what a small model wants. ODC-By 1.0.
REPO = "HuggingFaceFW/fineweb-edu"
SAMPLE = "sample-10BT"     # the ~10-billion-token sample config (smallest named one)


def deps():
    try:
        import tiktoken
        from datasets import load_dataset
    except ImportError:
        sys.exit("need two libraries first:\n    pip install datasets tiktoken")
    return tiktoken, load_dataset


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mb", type=int, default=700,
                    help="how many megabytes of tokens to keep (700 ~= 300M tokens)")
    ap.add_argument("--out", default="data/fineweb.bin")
    ap.add_argument("--val", default="data/fineweb_val.bin")
    args = ap.parse_args()

    tiktoken, load_dataset = deps()
    enc = tiktoken.get_encoding("gpt2")       # 50257 byte-pair tokens; eot = 50256
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)

    target_tokens = args.mb * 1024 * 1024 // 2       # 2 bytes per uint16 token
    val_tokens = min(1_000_000, target_tokens // 100)  # hold out ~1% (min 1M) for val
    print(f"streaming {REPO} [{SAMPLE}] — keeping ~{target_tokens/1e6:.0f}M tokens "
          f"({val_tokens/1e6:.1f}M held out for val)")

    fw = load_dataset(REPO, name=SAMPLE, split="train", streaming=True)

    # Write val first, then train. Both are just raw uint16 token ids back-to-back
    # with an end-of-text token (50256) between documents — no header. The trainer
    # reopens them with the same uint16 dtype, so the format has to match exactly.
    val_f = open(args.val, "wb")
    train_f = open(args.out, "wb")
    written = 0
    buf = []              # batch up tokens so we write in big chunks, not tiny ones

    def flush():
        nonlocal buf
        if buf:
            np.array(buf, dtype=np.uint16).tofile(val_f if written < val_tokens else train_f)
            buf = []

    try:
        for doc in fw:
            ids = enc.encode_ordinary(doc["text"])   # ignore special tokens in scraped text
            ids.append(enc.eot_token)                # 50256 marks where this document ends
            # if this document would cross the val->train boundary, flush first so
            # the two files split cleanly at a document edge
            if written < val_tokens and written + len(ids) >= val_tokens:
                flush()
            buf.extend(ids)
            written += len(ids)
            if len(buf) >= 1_000_000:
                flush()
                print(f"\r  {written*2/1e6:7.0f} MB written", end="", flush=True)
            if written >= target_tokens:
                break
    except KeyboardInterrupt:
        print("\ninterrupted — keeping what we have so far.")
    finally:
        flush()
        val_f.close(); train_f.close()

    print(f"\ndone. wrote {args.val} and {args.out}")
    print(f"  {os.path.getsize(args.out)//2:,} train tokens, "
          f"{os.path.getsize(args.val)//2:,} val tokens")
    print(f"now run:  python train_internet.py")


if __name__ == "__main__":
    main()
