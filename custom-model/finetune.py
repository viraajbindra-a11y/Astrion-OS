#!/usr/bin/env python3
"""
finetune.py — teach a pretrained Ember to CHAT and to know it's Ember.

Pretraining (train_best.py) gives Ember language. This step gives it two new
things: how to answer a question, and its own identity. Both come from the example
conversations below — a model doesn't "discover" its name, it's taught it, exactly
like every real assistant.

    python finetune.py --base ember-base.pt        # fine-tune the pretrained model
    python readiness.py                            # check it's ready
    python chat.py                                 # talk to it

This is FAST compared to pretraining — minutes to an hour, because it's a small
amount of data and a light touch (low learning rate, few epochs) on an already-
trained model. Add --alpaca to also mix in a general instruction dataset for
broader helpfulness (needs `pip install datasets`).
"""
import argparse, os, random, time
import torch
import torch.nn.functional as F
from train import GPT
from emberfmt import encode_example, generate_reply

# The canonical description Ember gives of itself. Keep it honest — it IS small.
_WHOAMI = ("I'm Ember, a small AI that was trained from scratch to run inside "
           "Astrion OS. I'm not as clever as the big cloud models, but I run "
           "entirely on your own computer — private and offline — and I'm here "
           "to help you use Astrion.")

# Ember's identity + basic-manners data. Many phrasings of the same few facts so
# it generalizes to however you actually ask. This is what makes it able to "tell
# you what it is."
EMBER_SFT = [
    ("who are you?", _WHOAMI),
    ("what are you?", _WHOAMI),
    ("what is your name?", "My name is Ember."),
    ("what's your name?", "I'm called Ember."),
    ("introduce yourself", _WHOAMI),
    ("tell me about yourself", _WHOAMI),
    ("what are you called?", "I'm Ember, the little AI built into Astrion OS."),
    ("who am i talking to?", "You're talking to Ember, Astrion's built-in AI."),
    ("are you chatgpt?", "No — I'm Ember, a small model built from scratch for "
                          "Astrion OS. I run on your own machine, not in the cloud."),
    ("are you an ai?", "Yes, I'm Ember, a small AI built into Astrion OS."),
    ("what can you do?", "I can chat, answer simple questions, and help you get "
                          "around Astrion OS. I'm small, so I keep it simple."),
    ("what do you do?", "I'm Ember — I help you use Astrion OS and answer "
                         "questions as best a small model can."),
    ("where do you run?", "I run right on your own computer, inside Astrion OS — "
                           "no internet needed."),
    ("do you need the internet?", "Nope. I run offline, on your own machine."),
    ("who made you?", "I was trained from scratch to be the AI inside Astrion OS."),
    ("who built you?", "I was built as the homegrown AI for Astrion OS."),
    ("what os are you part of?", "I'm part of Astrion OS."),
    ("are you smart?", "I'm honest about it: I'm a small model, so I'm not very "
                        "smart and I can be wrong. But I'm fast, private, and yours."),
    ("can you make mistakes?", "Definitely — I'm a small model, so double-check "
                                "anything important."),
    ("hello", "Hi! I'm Ember. How can I help you with Astrion?"),
    ("hi", "Hey! I'm Ember, your Astrion assistant. What do you need?"),
    ("hey", "Hi there — Ember here. What can I do for you?"),
    ("good morning", "Good morning! Ember here, ready to help."),
    ("thanks", "You're welcome!"),
    ("thank you", "Anytime!"),
    ("what is astrion?", "Astrion is the operating system I live in — and I'm its "
                          "built-in AI, Ember."),
    ("say your name", "Ember."),
    ("are you ready?", "Yes — I'm Ember, and I'm ready to help."),
]

# Ember's actual day job: helping you drive Astrion OS. Honest on purpose — it
# guides and explains, and it admits what it can't do yet rather than pretending.
ASTRION_HELP = [
    ("how do i open an app?", "Click its icon in the Astrion dock, or tell me the "
                              "app's name and I'll point you to it."),
    ("open my files", "Open the Files app from the dock to browse your folders. "
                      "Tell me a file name and I'll help you find it."),
    ("how do i change the wallpaper?", "Open Settings, then Appearance — you can "
                                       "pick a new wallpaper there."),
    ("how do i make the screen brighter?", "Open Settings > Display and drag the "
                                           "brightness slider up."),
    ("how do i connect to wifi?", "Open Settings > Network, pick your wifi name, "
                                  "and type the password."),
    ("i can't find a file", "Tell me the file's name, or roughly what it's called, "
                            "and I'll help you track it down in the Files app."),
    ("can you open google for me?", "I run offline, so I can't browse the web "
                                    "myself — but open the browser from the dock "
                                    "and I'll help you from there."),
    ("what can you help me with in astrion?", "Getting around: opening apps, "
                                              "finding files, changing settings, "
                                              "and answering quick questions — all "
                                              "on your own machine."),
    ("close this app", "Use the X on its window, or the close option in its menu. "
                       "I can't click it for you yet, but I'll walk you through it."),
]


def build_dataset(enc, extra=None, repeat=6):
    """Tokenize every example into (ids, mask). Identity is repeated so it sticks;
    the Astrion how-to's get a lighter repeat."""
    pairs = EMBER_SFT * repeat + ASTRION_HELP * 2 + (extra or [])
    data = [encode_example(enc, u, b) for (u, b) in pairs]
    random.Random(0).shuffle(data)
    return data


def load_alpaca(enc, n=2000):
    """Optional: mix in a general instruction dataset for broader chatiness."""
    try:
        from datasets import load_dataset
    except ImportError:
        raise SystemExit("--alpaca needs:  pip install datasets")
    ds = load_dataset("tatsu-lab/alpaca", split="train", streaming=True)
    out = []
    for row in ds:
        if row.get("input"):            # skip examples that need an extra input block
            continue
        out.append((row["instruction"].strip(), row["output"].strip()))
        if len(out) >= n:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="ember-base.pt", help="pretrained checkpoint to start from")
    ap.add_argument("--out", default="ember.pt", help="where to save the chat model")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--alpaca", action="store_true", help="also train on general instructions")
    args = ap.parse_args()

    device = ("cuda" if torch.cuda.is_available()
              else "mps" if torch.backends.mps.is_available() else "cpu")
    use_bf16 = device == "cuda"
    if not os.path.exists(args.base):
        raise SystemExit(f"no base model at {args.base}. Pretrain one first "
                         f"(train_best.py / train_internet.py), or pass --base.")
    ck = torch.load(args.base, map_location=device)
    cfg = ck["cfg"]

    import tiktoken
    enc = tiktoken.get_encoding("gpt2")
    assert cfg["vocab"] >= enc.n_vocab, "base model wasn't trained with the gpt2 tokenizer"

    model = GPT(cfg).to(device)
    model.load_state_dict(ck["model"])
    print(f"loaded base: {sum(p.numel() for p in model.parameters())/1e6:.1f}M params from {args.base}")

    extra = load_alpaca(enc) if args.alpaca else None
    data = build_dataset(enc, extra=extra)
    print(f"fine-tuning on {len(data)} examples ({len(EMBER_SFT)} identity facts) "
          f"for {args.epochs} epochs")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.95),
                            weight_decay=0.0)
    pad = enc.eot_token
    block = cfg["block_size"]

    def make_batch(batch):
        L = min(block, max(len(ids) for ids, _ in batch))
        X, Y, M = [], [], []
        for ids, mask in batch:
            ids, mask = ids[:L], mask[:L]
            ids = ids + [pad] * (L - len(ids))
            mask = mask + [0] * (L - len(mask))
            X.append(ids[:-1]); Y.append(ids[1:]); M.append(mask[1:])   # predict next token
        return (torch.tensor(X, device=device), torch.tensor(Y, device=device),
                torch.tensor(M, device=device, dtype=torch.float32))

    model.train()
    t0 = time.time()
    step = 0
    for epoch in range(args.epochs):
        random.Random(epoch).shuffle(data)
        for i in range(0, len(data), args.batch):
            X, Y, M = make_batch(data[i:i+args.batch])
            with torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=use_bf16):
                logits, _ = model(X)
                V = logits.size(-1)
                ce = F.cross_entropy(logits.reshape(-1, V), Y.reshape(-1), reduction="none")
                loss = (ce * M.reshape(-1)).sum() / M.sum().clamp(min=1)   # only on Ember's replies
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            step += 1
        print(f"epoch {epoch+1}/{args.epochs} | loss {loss.item():.3f} | {time.time()-t0:.0f}s")

    torch.save({"model": model.state_dict(), "cfg": cfg}, args.out)
    print(f"saved chat model -> {args.out}")
    print("\nquick self-test:")
    for q in ("who are you?", "what's your name?", "what can you do?"):
        print(f"  User: {q}\n  Ember: {generate_reply(model, enc, device, q)}")


if __name__ == "__main__":
    main()
