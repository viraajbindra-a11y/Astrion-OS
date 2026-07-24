#!/usr/bin/env python3
"""
chat.py — talk to Ember.

    python chat.py                 # chat with ember.pt
    python chat.py --ckpt ember.pt --temp 0.7

Type a message, Ember replies. Ctrl-C or "bye" to quit. Remember: Ember is a small
model — it's private and yours, but it's not a genius. Keep questions simple.
"""
import argparse, os, torch
from train import GPT
from emberfmt import generate_reply


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="ember.pt")
    ap.add_argument("--temp", type=float, default=0.7)
    ap.add_argument("--top_k", type=int, default=40)
    ap.add_argument("--max_new", type=int, default=160)
    args = ap.parse_args()

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    if not os.path.exists(args.ckpt):
        raise SystemExit(f"no model at {args.ckpt}. Fine-tune one first:  python finetune.py")
    ck = torch.load(args.ckpt, map_location=device)
    import tiktoken
    enc = tiktoken.get_encoding("gpt2")
    model = GPT(ck["cfg"]).to(device)
    model.load_state_dict(ck["model"])
    model.eval()

    print("Ember is listening. Type 'bye' to quit.\n")
    print("Ember: Hi! I'm Ember, your Astrion assistant. What do you need?")
    try:
        while True:
            msg = input("You:   ").strip()
            if not msg:
                continue
            if msg.lower() in ("bye", "quit", "exit"):
                print("Ember: Bye! 🔥")
                break
            reply = generate_reply(model, enc, device, msg,
                                   max_new=args.max_new, temp=args.temp, top_k=args.top_k)
            print(f"Ember: {reply or '...'}")
    except (EOFError, KeyboardInterrupt):
        print("\nEmber: Bye! 🔥")


if __name__ == "__main__":
    main()
