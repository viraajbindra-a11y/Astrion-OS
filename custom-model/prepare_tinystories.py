#!/usr/bin/env python3
"""
prepare_tinystories.py — download TinyStories and save a clean .txt to train on.

TinyStories is a dataset of *very simple* children's stories (short words, tiny
vocabulary, simple grammar). That's the secret to a good tiny model — see the
README, section "Why children's stories". This grabs a chunk and writes it to
data/stories.txt so you can do:

    python prepare_tinystories.py            # ~20 MB (great first real run)
    python prepare_tinystories.py --mb 200   # bigger, better, slower to train
    python train.py --data data/stories.txt

Stories are separated by <|endoftext|> in the raw file; we turn that into a blank
line so the model learns where stories start and stop.
"""
import argparse, os, urllib.request

VALID = "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-valid.txt"
TRAIN = "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-train.txt"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mb", type=int, default=20, help="how many megabytes to keep")
    ap.add_argument("--out", default="data/stories.txt")
    args = ap.parse_args()

    # The validation file is ~20 MB; anything bigger streams from the train file.
    url = VALID if args.mb <= 22 else TRAIN
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    cap = args.mb * 1024 * 1024
    print(f"downloading up to {args.mb} MB from TinyStories...")

    got = bytearray()
    with urllib.request.urlopen(url) as r:
        while len(got) < cap:
            chunk = r.read(1 << 20)          # 1 MB at a time
            if not chunk:
                break
            got += chunk
            print(f"\r  {len(got)/1e6:6.1f} MB", end="", flush=True)
    print()

    text = got.decode("utf-8", errors="ignore")
    # cut at the last complete story so we don't end mid-sentence
    cut = text.rfind("<|endoftext|>")
    if cut != -1:
        text = text[:cut]
    text = text.replace("<|endoftext|>", "\n\n")

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(text)
    stories = text.count("\n\n")
    print(f"wrote {args.out}: {len(text):,} chars, ~{stories:,} stories")
    print(f"now run:  python train.py --data {args.out}")

if __name__ == "__main__":
    main()
