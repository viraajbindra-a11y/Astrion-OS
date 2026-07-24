#!/usr/bin/env python3
"""
sample.py — generate text from a model you trained.

    python sample.py                              # 500 chars from checkpoint.pt
    python sample.py --prompt "Once upon a time"  # continue your own text
    python sample.py --n 1000 --temp 0.7          # longer, less random

temperature: lower (0.5) = safer/repetitive, higher (1.0) = wilder/more mistakes.
"""
import argparse, torch
from train import GPT   # reuse the exact same model definition

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="checkpoint.pt")
    ap.add_argument("--prompt", default="\n")
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--temp", type=float, default=0.8)
    ap.add_argument("--top_k", type=int, default=40)
    args = ap.parse_args()

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    ck = torch.load(args.ckpt, map_location=device)
    stoi, itos = ck["stoi"], ck["itos"]

    model = GPT(ck["cfg"]).to(device)
    model.load_state_dict(ck["model"])
    model.eval()

    # encode the prompt; skip characters the model never saw during training
    ids = [stoi[c] for c in args.prompt if c in stoi] or [stoi.get("\n", 0)]
    idx = torch.tensor([ids], device=device)
    out = model.generate(idx, args.n, temperature=args.temp, top_k=args.top_k)[0].tolist()
    print("".join(itos[i] for i in out))

if __name__ == "__main__":
    main()
