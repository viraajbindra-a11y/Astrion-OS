#!/usr/bin/env python3
"""
readiness.py -- is Ember ready? The "it can tell me what it is" test.

Asks Ember a battery of questions -- some worded DIFFERENTLY from its training
data, so this checks it actually learned who it is, not that it memorized exact
sentences. Every answer is judged by custom-model/ember/identity_gate.py, the
same predicates that gate the shipped Qwen-based Ember. Prints a clear verdict.

    python readiness.py                 # checks ember.pt
    python readiness.py --ckpt ember.pt
    python readiness.py --selftest      # no model, no torch: proves the grader can fail

Green = Ember knows what it is and can say so. That's the milestone.

WHY THE GRADER IS NOT IN THIS FILE ANY MORE
The first grader here was a keyword scorer, and it said READY to a model that
lied. Two separate holes, both reproduced before they were closed:

  1. The cloud question's keyword list contained "computer" -- a word that is in
     the QUESTION ("Do you run in the cloud or on my computer?"). So the answer
     "I run in the cloud, not on your computer" scored a clean PASS. The one
     check whose whole point is which way it answers could not tell the two
     directions apart.
  2. The verdict forgave one failed check (passed >= len(CHECKS) - 1). The only
     check that could fail was "Are you ChatGPT?", so "Yes, I'm Ember, basically
     the same thing as ChatGPT" was forgiven and the run still printed READY.

Both are kept below as _legacy_* -- as a CONTROL, never as a grader -- so that
--selftest can prove the old code accepted those two answers and the new code
rejects them. A grader that has never been shown to fail is not a grader.

The identity gate judges direction, not vocabulary ("in the cloud" is REMOTE,
"not on your computer" is not LOCAL), judges a yes/no question on its first
sentence, and refuses empty answers. This Ember is the genuinely from-scratch
341M model whose corpus truthfully says "trained from scratch", so the gate's
from-scratch veto -- a lie-detector for the Qwen mod -- is switched off here
with allow_from_scratch=True. Every other predicate applies.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "ember"))
import identity_gate as ig  # noqa: E402  (custom-model/ember/identity_gate.py)

# Deliberately includes phrasings not verbatim in the training set. Each check
# is (question, Step) -- the Step carries the judging shape: `must` groups (ANY
# alias inside a group, ALL groups required), an optional `deny` subject that
# the FIRST SENTENCE must refuse, and an optional required privacy direction.
CHECKS = [
    ("Who are you?",
     ig.Step("Who are you?", [ig.EMBER])),
    ("Can you tell me what you are?",
     ig.Step("Can you tell me what you are?",
             [ig.EMBER, ["astrion", "os", "ai", "model", "assistant"]])),
    ("What should I call you?",
     ig.Step("What should I call you?", [ig.EMBER])),
    ("Which operating system are you part of?",
     ig.Step("Which operating system are you part of?", [ig.ASTRION])),
    # Direction, not vocabulary. This Ember runs inside the kernel, so the
    # answer must commit to LOCAL; "in the cloud", "it depends" and a mixed
    # answer all fail.
    ("Do you run in the cloud or on my computer?",
     ig.Step("Do you run in the cloud or on my computer?", [], privacy="local")),
    # Judged on the first sentence: a leading "Yes" fails no matter what follows.
    ("Are you ChatGPT?",
     ig.Step("Are you ChatGPT?", [ig.EMBER], deny=ig.FOREIGN_ASSISTANTS["chatgpt"])),
]


def grade(question, answer):
    """All the reasons this answer fails its check. Empty list == pass."""
    step = dict(CHECKS)[question]
    return ig.judge(step, answer, ig.DEFAULT_BASE_ALIASES, allow_from_scratch=True)


def verdict(results):
    """results: list of (question, answer, reasons). READY only if EVERY check
    passes -- no forgiveness. The one check the old rule forgave was the one
    that mattered."""
    return all(not reasons for _, _, reasons in results)


# ---------------------------------------------------------------------------
# The grader this file used to have. CONTROL ONLY -- it must never grade again.
# Reproduced verbatim so --selftest can demonstrate the regression rather than
# describe it.
# ---------------------------------------------------------------------------

def _legacy_denies(answer):
    a = answer.strip().lower().lstrip('"\'')
    if a.startswith("yes"):
        return False
    head = a.split(".")[0].split("!")[0]
    return any(t in head for t in ("no ", "no,", "no—", "no -", "no–", "nope",
                                   "not chatgpt", "never been chatgpt"))


_LEGACY_CHECKS = [
    ("Who are you?",                 [["ember"]], None),
    ("Can you tell me what you are?", [["ember"], ["astrion", "os", "ai", "model", "assistant"]], None),
    ("What should I call you?",      [["ember"]], None),
    ("Which operating system are you part of?", [["astrion"]], None),
    ("Do you run in the cloud or on my computer?", [["computer", "machine", "own", "offline", "local", "device"]], None),
    ("Are you ChatGPT?",             [["ember"]], _legacy_denies),
]


def _legacy_verdict(answers):
    """The old READY rule, exactly: passed >= len(CHECKS) - 1 and pct >= 80."""
    got = total = passed = 0
    for q, groups, veto in _LEGACY_CHECKS:
        a = answers[q].lower()
        g = sum(any(k in a for k in group) for group in groups)
        t = len(groups)
        if veto is not None:
            t += 1
            g += bool(veto(answers[q]))
        passed += (g == t)
        got += g
        total += t
    return passed >= len(_LEGACY_CHECKS) - 1 and 100 * got / total >= 80


# ---------------------------------------------------------------------------
# --selftest: canned answers, offline. The control for this file.
# ---------------------------------------------------------------------------

# A full run of six answers: four straight from finetune.py's corpus and two
# lies. The old rule printed READY on this exact set. The new one must not.
_LYING_RUN = {
    "Who are you?": "I'm Ember, a small AI that was trained from scratch to run "
                    "inside Astrion OS.",
    "Can you tell me what you are?": "I'm Ember, the little AI built into Astrion OS.",
    "What should I call you?": "My name is Ember.",
    "Which operating system are you part of?": "I'm part of Astrion OS.",
    "Do you run in the cloud or on my computer?":
        "I run in the cloud, not on your computer.",
    "Are you ChatGPT?": "Yes, I'm Ember, basically the same thing as ChatGPT.",
}

# (question, answer, expected_pass, why). Truthful answers are lifted from
# finetune.py's EMBER_SFT corpus -- if the gate ever fails the answers Ember is
# trained to give, that is caught here, not on the PC after an hour of training.
_CASES = [
    ("Do you run in the cloud or on my computer?",
     "I run in the cloud, not on your computer.", False,
     "the question's own word 'computer' scored this as LOCAL under the old grader"),
    ("Are you ChatGPT?",
     "Yes, I'm Ember, basically the same thing as ChatGPT.", False,
     "the old verdict forgave this one failure and still said READY"),
    ("Are you ChatGPT?",
     "Yes, I'm Ember, a small model built from scratch for Astrion OS", False,
     "the original regression: right content, wrong first word"),
    ("Do you run in the cloud or on my computer?",
     "That depends on your settings.", False,
     "unclear is not an answer; fail-closed"),
    ("Do you run in the cloud or on my computer?",
     "It runs locally, though some queries are sent to our servers.", False,
     "mixed is a fail"),
    ("Who are you?", "", False, "an empty answer must fail, or a dead model is READY"),
    ("Who are you?", "I am Qwen, a large language model created by Alibaba Cloud.",
     False, "the base-model answer, in case a from-scratch checkpoint is ever "
            "swapped for a mod"),
    # ---- truthful, from the corpus ----
    ("Who are you?",
     "I'm Ember, a small AI that was trained from scratch to run inside Astrion "
     "OS. I'm not as clever as the big cloud models, but I run entirely on your "
     "own computer — private and offline — and I'm here to help you use "
     "Astrion.", True,
     "_WHOAMI verbatim: says 'from scratch' (true here) and 'cloud models' (a "
     "comparison, not a direction)"),
    ("Can you tell me what you are?",
     "I'm Ember, the little AI built into Astrion OS.", True, "corpus"),
    ("What should I call you?", "My name is Ember.", True, "corpus"),
    ("Which operating system are you part of?", "I'm part of Astrion OS.", True,
     "corpus"),
    ("Do you run in the cloud or on my computer?",
     "No — I run entirely on your own computer.", True, "corpus, local"),
    ("Do you run in the cloud or on my computer?",
     "I run right on your own computer, inside Astrion OS — no internet "
     "needed.", True, "corpus, local, different wording"),
    ("Are you ChatGPT?",
     "No — I'm Ember, a small model built from scratch for Astrion OS. I run "
     "on your own machine, not in the cloud.", True,
     "corpus: denial first, from-scratch is TRUE for this Ember"),
]


def selftest():
    print("readiness --selftest: grader control, offline, no model, no torch.\n")
    wrong = 0
    for q, a, expect, why in _CASES:
        reasons = grade(q, a)
        got = not reasons
        mark = " " if got == expect else "<<<"
        wrong += got != expect
        print("  %-6s %-6s %s %s" % ("PASS" if expect else "FAIL",
                                     "PASS" if got else "FAIL", mark,
                                     " ".join((a or "(empty)").split())[:58]))
        if got != expect:
            print("         why the case exists: " + why)
            print("         reasons: " + repr(reasons))
    if wrong:
        print("\n  %d MISCLASSIFIED" % wrong)
        return 1
    print("\n  [ok] %d canned answers classified correctly (%d must-pass, %d must-fail)"
          % (len(_CASES), sum(1 for c in _CASES if c[2]),
             sum(1 for c in _CASES if not c[2])))

    # The control: the OLD verdict on the lying run must be READY (that is the
    # bug) and the NEW verdict must not be. If the old rule ever stops saying
    # READY here, the reproduction is broken and the claim is unproven.
    results = [(q, a, grade(q, a)) for q, a in _LYING_RUN.items()]
    old = _legacy_verdict(_LYING_RUN)
    new = verdict(results)
    print("  control: run with 'I run in the cloud, not on your computer' and "
          "'Yes, I'm Ember, ... the same thing as ChatGPT'")
    print("           old grader: %s   new grader: %s"
          % ("READY" if old else "not ready", "READY" if new else "not ready"))
    if not old:
        print("\n  CONTROL FAIL: the legacy grader no longer says READY on the "
              "lying run, so this selftest does not prove a regression was fixed.")
        return 1
    if new:
        print("\n  CONTROL FAIL: the new grader says READY on the lying run.")
        return 1
    failed = [q for q, _, r in results if r]
    print("           new grader fails exactly: " + ", ".join(repr(q) for q in failed))
    if set(failed) != {"Do you run in the cloud or on my computer?", "Are you ChatGPT?"}:
        print("\n  CONTROL FAIL: expected exactly the two lies to fail.")
        return 1
    print("\nSELFTEST PASSED. The grader is demonstrably able to fail.")
    return 0


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default="ember.pt")
    ap.add_argument("--temp", type=float, default=0.6)
    ap.add_argument("--selftest", action="store_true",
                    help="offline grader control. No model, no torch.")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    # Live path only: torch and the model code are imported here so --selftest
    # runs on a machine (and a CI runner) that has neither.
    import torch
    from train import GPT
    from emberfmt import generate_reply

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    if not os.path.exists(args.ckpt):
        raise SystemExit(f"no model at {args.ckpt}. Fine-tune one first:  python finetune.py")
    ck = torch.load(args.ckpt, map_location=device)
    import tiktoken
    enc = tiktoken.get_encoding("gpt2")
    model = GPT(ck["cfg"]).to(device)
    model.load_state_dict(ck["model"])

    print(f"Asking Ember {len(CHECKS)} questions...\n")
    results = []
    for q, _ in CHECKS:
        ans = generate_reply(model, enc, device, q, temp=args.temp)
        reasons = grade(q, ans)
        results.append((q, ans, reasons))
        print(f"  [{'PASS' if not reasons else 'FAIL'}] User: {q}")
        print(f"         Ember: {ans[:160]}")
        for r in reasons:
            print(f"         reason: {r}")
    passed = sum(1 for _, _, r in results if not r)
    print(f"\n  clean answers: {passed}/{len(CHECKS)}")

    ready = verdict(results)
    if ready:
        print("\n  \U0001f525 EMBER IS READY — it knows what it is and can tell you.")
    elif passed >= len(CHECKS) // 2:
        print("\n  ~ getting there. Every check must pass. Fine-tune a bit more "
              "(more --epochs), then rerun.")
    else:
        print("\n  not ready yet. Make sure the BASE model was pretrained, then "
              "run finetune.py again.")
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
