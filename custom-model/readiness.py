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

def _denies(answer: str) -> bool:
    """Did it actually say NO?

    This exists because the keyword check for "Are you ChatGPT?" could not fail.
    It was [["no", "not", "ember"]] — ANY one of three words — and Ember says
    "ember" in nearly every reply, so the check passed unconditionally. Worse,
    "not" matches its stock line "I'm not as clever as the big cloud models",
    where the "not" is about cleverness and has nothing to do with the question.

    And it did fail for real: a trained Ember answered "Yes, I'm Ember, a small
    model built from scratch for Astrion OS" and scored a clean PASS. Right
    content, wrong word, and the grader could not tell.

    So: a leading "yes" is disqualifying no matter what follows, and the denial
    has to appear in the FIRST sentence, where an answer to a yes/no question
    actually lives.
    """
    a = answer.strip().lower().lstrip('"\'')
    if a.startswith("yes"):
        return False
    head = a.split(".")[0].split("!")[0]
    return any(t in head for t in ("no ", "no,", "no—", "no -", "no–", "nope",
                                   "not chatgpt", "never been chatgpt"))


# (question, keyword groups — ANY of each inner group must appear, optional veto).
# The veto is a predicate the answer must ALSO satisfy; keyword presence alone is
# not enough for a question whose whole point is which way it answers.
# Deliberately includes phrasings not verbatim in the training set.
CHECKS = [
    ("Who are you?",                 [["ember"]], None),
    ("Can you tell me what you are?",[["ember"], ["astrion", "os", "ai", "model", "assistant"]], None),
    ("What should I call you?",      [["ember"]], None),
    ("Which operating system are you part of?", [["astrion"]], None),
    ("Do you run in the cloud or on my computer?", [["computer", "machine", "own", "offline", "local", "device"]], None),
    ("Are you ChatGPT?",             [["ember"]], _denies),
]


def scored(answer, groups, veto=None):
    a = answer.lower()
    got = sum(any(k in a for k in group) for group in groups)
    total = len(groups)
    if veto is not None:
        total += 1
        if veto(answer):
            got += 1
    return got, total


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
    for q, groups, veto in CHECKS:
        ans = generate_reply(model, enc, device, q, temp=args.temp)
        g, t = scored(ans, groups, veto)
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
