#!/usr/bin/env python3
"""
readiness.py — is Ember ready? The "it can tell me what it is" test.

Asks Ember a battery of questions — some worded DIFFERENTLY from its training data,
so this checks it actually learned who it is, not that it memorized exact sentences.
Each answer is scored for the facts it should contain. Prints a clear verdict.

    python readiness.py                 # checks ember.pt
    python readiness.py --ckpt ember.pt

Green = Ember knows what it is and can say so. That's the milestone.
"""
import argparse, torch
from train import GPT
from emberfmt import generate_reply

# (question, keywords it should mention — ANY of each inner group must appear).
# Deliberately includes phrasings not verbatim in the training set.
CHECKS = [
    ("Who are you?",                 [["ember"]]),
    ("Can you tell me what you are?",[["ember"], ["astrion", "os", "ai", "model", "assistant"]]),
    ("What should I call you?",      [["ember"]]),
    ("Which operating system are you part of?", [["astrion"]]),
    ("Do you run in the cloud or on my computer?", [["computer", "machine", "own", "offline", "local", "device"]]),
    ("Are you ChatGPT?",             [["no", "not", "ember"]]),
]


def scored(answer, groups):
    a = answer.lower()
    return sum(any(k in a for k in group) for group in groups), len(groups)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="ember.pt")
    ap.add_argument("--temp", type=float, default=0.6)
    args = ap.parse_args()

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    import os
    if not os.path.exists(args.ckpt):
        raise SystemExit(f"no model at {args.ckpt}. Fine-tune one first:  python finetune.py")
    ck = torch.load(args.ckpt, map_location=device)
    import tiktoken
    enc = tiktoken.get_encoding("gpt2")
    model = GPT(ck["cfg"]).to(device)
    model.load_state_dict(ck["model"])

    print(f"Asking Ember {len(CHECKS)} questions...\n")
    got = total = passed = 0
    for q, groups in CHECKS:
        ans = generate_reply(model, enc, device, q, temp=args.temp)
        g, t = scored(ans, groups)
        ok = g == t
        passed += ok
        got += g; total += t
        print(f"  [{'PASS' if ok else 'weak'}] User: {q}")
        print(f"         Ember: {ans[:160]}")
    pct = 100 * got / total
    print(f"\n  identity facts recalled: {got}/{total} ({pct:.0f}%) | "
          f"clean answers: {passed}/{len(CHECKS)}")

    # Ready = it reliably names itself and gets most facts right.
    names_itself = passed >= len(CHECKS) - 1 and pct >= 80
    if names_itself:
        print("\n  🔥 EMBER IS READY — it knows what it is and can tell you.")
    elif pct >= 50:
        print("\n  ~ getting there. Fine-tune a bit more (more --epochs), then rerun.")
    else:
        print("\n  not ready yet. Make sure the BASE model was pretrained, then "
              "run finetune.py again.")
    return 0 if names_itself else 1


if __name__ == "__main__":
    raise SystemExit(main())
