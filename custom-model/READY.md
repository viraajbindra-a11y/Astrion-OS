# Ember — from nothing to "I'm Ember," start to finish

This is the whole path in one page: an empty model → a thing that writes → a thing
that knows it's **Ember** and can say so → a file your Astrion kernel loads. Every
step below was tested end-to-end on a small stand-in model before it was written
down; the only step that needs your actual PC is the weekend pretrain.

```
# SETUP on your 5080 PC. A 50-series card is new (Blackwell) — a plain
# `pip install torch` often grabs a build that can't drive it, so use cu128:
pip install torch --index-url https://download.pytorch.org/whl/cu128
pip install datasets tiktoken
python -c "import torch; print(torch.cuda.get_device_name(0))"   # must print your 5080

python prepare_fineweb.py --mb 13500   # 0. get ~7B tokens of real web text
python train_best.py --compile         # 1. PRETRAIN  (~weekend)  -> ember-base.pt
python finetune.py                     # 2. FINE-TUNE (~minutes)  -> ember.pt
python readiness.py                    # 3. READY?    -> "🔥 EMBER IS READY"
python chat.py                         # 4. TALK to Ember
python export_ember.py                 # 5. EXPORT    -> ember.astrion (kernel-loadable)
```

---

## What each step actually does

**0. Get the data** — [prepare_fineweb.py](prepare_fineweb.py) streams FineWeb-Edu
(cleaned, quality-filtered real web text) and writes it as tokens. Nothing to babysit.

**1. Pretrain — learns language.** [train_best.py](train_best.py) trains the 341M
model from scratch (Muon optimizer, GQA, QK-norm — see [BEST.md](BEST.md)). This is
the long one, ~54 hours, but it auto-resumes across reboots. At the end you have
`ember-base.pt`: a model that writes coherent English but has **no idea it's Ember**
and only autocompletes — it can't answer a question yet.

**2. Fine-tune — learns to chat, and learns it's Ember.** [finetune.py](finetune.py)
shows the base model example conversations: who it is, and how to help you use
Astrion. This is fast (minutes). A model doesn't *discover* its name — it's taught,
exactly like every real assistant. Out comes `ember.pt`, which introduces itself.

**3. Readiness — the milestone.** [readiness.py](readiness.py) asks Ember who it is,
in wordings it wasn't trained on, and grades the answers. Green means the thing you
asked for is done: *it can tell you what it is.*

**4. Chat.** [chat.py](chat.py) is a normal back-and-forth. Talk to it.

**5. Export — the bridge into Astrion.** [export_ember.py](export_ember.py) writes
`ember.astrion`, the binary **AMW1** file the kernel actually loads (it now delegates
to `kernel/tools/mkweights.py` — one format, no drift). A trained 341M Ember comes
out **~775 MB** (the token embedding dominates). Same engine as Qwen, different file
— the whole point of the two-track plan.

**Before you trust the export, prove it converts right — no training needed.** Run
`python roundtrip_check.py`; it builds a small model, exports it, and dumps a
reference. Send the two files it writes to the kernel chat — I run them through the
real C engine and confirm the conversion is exact. The kernel side (engine, memory,
loading a 775 MB module) is already built and verified; details in
[KERNEL-CONTRACT.md](KERNEL-CONTRACT.md). The final gate is loading your real
`ember.astrion` live on Astrion.

---

## What's proven vs what waits for your PC

**Proven here on the Mac (small stand-in model):**
- The fine-tune → identity → readiness chain: **6/6 questions PASS, "EMBER IS READY."**
- The int8 export: float → int8 barely changes the model's output — **cosine 1.00000,
  0.08% error** — and the file round-trips through its checksum cleanly.
- Ember's QK-norm math matches your kernel oracle to 8 decimal places, so the
  exported weights really are drop-in.

**Waits for the weekend pretrain on your 5080:**
- Real language ability and general helpfulness (the OS how-to answers). The toy
  stand-in has no pretraining, so it nails its identity but can't hold a real
  conversation. Your pretrained Ember will.

---

## The honest shape of it

- **Identity always comes from the fine-tune data**, never from the model "waking up."
  That's true of ChatGPT too. It's not a trick — it's how assistants know who they are.
- **Ember is small.** After all of this it writes well and helps with simple things;
  it won't reason like a giant cloud model. Its edge is different: it's *yours*, it's
  private, it runs offline, and it can be made sharp at the one job that matters —
  being Astrion's assistant.
- **This is Track 2 of the plan, done for real.** Ship on Qwen now; Ember grows up
  beside it and swaps into the same slot the day it's good enough. `ember.astrion` is
  that swap.

You built an operating system. Now you're building the mind inside it, from zero. 🔥
