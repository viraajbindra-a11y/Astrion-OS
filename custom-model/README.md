# Astrion's own little brain — training a language model from scratch

This trains a **real transformer from zero** on your PC. No fine-tuning, no
downloading someone else's brain. You feed it text, it learns to predict the
next character, and out of that it learns to *write*. You'll literally watch it
go from random noise → gibberish → real words → sentences.

It's small on purpose (a few **million** parameters, not billions). It won't
reason like ChatGPT. It writes. That's the goal, and it's plenty — this is the
seed of Astrion's own AI.

**Three files, that's the whole thing:**
- `train.py` — builds the model and trains it. Read it top to bottom; every part
  has a plain-English comment.
- `sample.py` — generate text from a model you trained.
- `prepare_tinystories.py` — download clean kids'-story data (step 2).

---

## Why it's built the way your kernel expects

Your Astrion kernel already has an oracle (`kernel/tools/ref_forward.py`) that
says what shape a model must be to run inside the OS: **RMSNorm, RoPE, SwiGLU** —
the modern (Llama/Qwen) recipe, not the old GPT-2 one. So `train.py` uses that
exact same recipe. The RoPE math here is checked to match your oracle *exactly*.

Meaning: the thing you train tonight is the **same kind of brain** that runs
inside Astrion. That's the "grow our own → drop it into the same slot" plan from
`TWO-TRACKS.md`, made real. Train host-side now, swap the weight file in later.

---

## Step 0 — one-time setup on your PC (the RTX 5080)

Do this on the **Windows PC with the 5080**, not the Mac.

**1. Install Python** (3.10 or newer) from python.org. During install, tick
"Add Python to PATH".

**2. Install PyTorch — and this is the ONE thing that trips people up.**
Your RTX 5080 is a **Blackwell** GPU. It needs a PyTorch built for **CUDA 12.8**.
The default `pip install torch` may give you an older build that doesn't know
your card exists. Use this exact command instead:

```
pip install torch --index-url https://download.pytorch.org/whl/cu128
```

**3. Check the GPU is actually seen:**

```
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

You want it to print `True NVIDIA GeForce RTX 5080`. If it says `False`, or you
later see an error mentioning `sm_120`, your torch is too old for Blackwell —
reinstall it with the `cu128` line above.

That's the whole setup. Two installs.

---

## Step 1 — see it work (Shakespeare, ~a few minutes)

```
python train.py
```

With no arguments it downloads a 1 MB file of Shakespeare, builds a character
tokenizer, and starts training. Every 250 steps it prints the loss **and a
sample** so you can watch it learn. Leave it running. On your 5080 the whole
thing (5000 steps) finishes in just a few minutes.

At the start the samples are pure noise. By the end it writes fake-Shakespeare —
made-up words that *look* right, character names, line breaks, `:` after names.
It's not memorizing; it's learning the shape of the language one character at a
time. When it's done:

```
python sample.py                          # generate 500 fresh characters
python sample.py --prompt "ROMEO:"        # give it a starting line
python sample.py --n 1000 --temp 0.6      # longer, and more "careful"
```

Shakespeare is the "hello world" here — small, works instantly, proves the whole
pipeline. Then we switch to data that makes a *small* model sound much smarter.

---

## Step 2 — the trick: train on children's stories

```
python prepare_tinystories.py            # downloads ~20 MB of simple stories
python train.py --data data/stories.txt  # train on them instead
```

**Why this makes such a big difference.** A model this small has only a few
million "knobs." It can't hold much. So the *simpler and cleaner* the language
you feed it, the more of that language it can actually fit inside its tiny brain.

- The whole internet has millions of words, wild grammar, code, typos, five
  languages mixed together. A small model drowns — it learns a soupy average of
  everything and sounds broken.
- **TinyStories** is thousands of stories written with the vocabulary of a
  3–4 year old: short words, short sentences, simple grammar, one thing happens
  at a time. The "rules" of that language are small enough that a few-million-
  parameter model can genuinely *learn them* — so it writes real, coherent
  little stories instead of mush.

This is a real research finding (the "TinyStories" paper, Microsoft 2023): small
models trained on simple, clean, consistent data punch **way** above their size.
Clean narrow data beats big messy data when your model is tiny. That's your
whole edge, and it's exactly why `TWO-TRACKS.md` says to start TinyStories-scale.

Want more/better? `python prepare_tinystories.py --mb 200` grabs more data
(trains longer, writes better). Start with 20 MB to see it work fast.

---

## What the numbers mean while it trains

```
step   750 | train 1.612 | val 1.633 | lr 2.8e-04 | 41s
```

- **step** — how many learning updates so far (out of `max_iters`).
- **train loss** — how *surprised* the model is by the next character in text
  it's studying. Lower = less surprised = it's learning. This is measured in
  "nats"; you mostly just watch it **go down**.
- **val loss** — same test, but on text it has **never seen** (we hold back 10%).
  This is the honest score — it proves the model *learned the language*, not just
  memorized the file.
- **lr** — learning rate, the step size. It ramps up at the start (warmup) then
  slowly shrinks (cosine decay). You don't touch this; it's automatic.
- **the sample** — the real proof. Read it. It should get better over time.

**What's a good loss?** A model guessing randomly scores about `ln(vocab)` —
around **4.2** for Shakespeare's ~65 characters. So step 0 starts near there. A
well-trained char model lands around **1.4–1.5** on Shakespeare, a bit lower on
TinyStories. But don't chase the number — **trust the samples**. Readable
stories = success.

**Watch for overfitting:** if train loss keeps dropping but **val loss starts
rising**, the model is memorizing instead of learning. Fix: more data
(`--mb 200`), or a smaller model. For the default setup you won't hit this fast.

---

## Honest expectations for your hardware

Your 5080 (16 GB) is a genuinely strong card for this — it's not the bottleneck,
*your patience and your data are*. Realistic picture:

- **Shakespeare demo (default 5–6M model):** a few minutes, start to finish.
- **TinyStories, 20 MB, default model:** roughly 15–40 minutes to clearly
  coherent stories. Longer = better, with diminishing returns.
- **Bigger model / 200 MB data:** an hour or a few. Still totally fine on a 5080.
- **VRAM:** the default uses a small slice of your 16 GB. You can go much bigger
  (see knobs below) before you run out.

What you will **not** get, and shouldn't expect: reasoning, facts about the
world, math, following instructions. It's a *writer*, not a *thinker*. A tiny
model that writes clean little stories is a genuine win — that's the target.

You can even do a quick "does it run" test on your **Mac** (`python train.py`
uses the Apple GPU automatically) — but it's much slower there. Do real runs on
the PC.

---

## Knobs to turn (top of `train.py`, the `CFG` block)

Make it **bigger/smarter** (needs more VRAM + time):
- `dim` 256 → 384 or 512 (biggest effect on "smartness")
- `n_layer` 6 → 8 or 12 (deeper = more capable)
- `block_size` 256 → 512 (sees more context at once)

Make it **train faster** (if you're impatient or low on memory):
- `batch_size` down if you ever get an "out of memory" error
- `max_iters` down for a quicker (rougher) result

Rule of thumb: **more data → you can afford a bigger model → better writing.**
If you make the model big but keep tiny data, it just memorizes. Grow both.

---

## Where this goes next (toward running inside Astrion)

1. **Now:** get coherent TinyStories text. That's the milestone — proof you
   trained a real LM from scratch.
2. **Better tokenizer:** character-level is simplest to learn, but a small
   *word-piece* tokenizer writes cleaner text. You already have `mktok.py` in
   `kernel/tools/` — that's the upgrade path.
3. **Shape it to the OS job:** train on OS-assistant-style text (commands,
   short answers) instead of stories, so it's sharp at Astrion's one job.
4. **Drop it in:** quantize the weights to int8 (your kernel already has the
   int8 matmul) and write them in your model-file format. Same engine, new
   weight file — exactly the `TWO-TRACKS.md` plan.

Get step 1 working first. Watch it write. Everything else builds on that.

---

## Troubleshooting

- **`torch.cuda.is_available()` is False / `sm_120` error** → wrong PyTorch.
  Reinstall with the `cu128` command in Step 0.
- **`CUDA out of memory`** → lower `batch_size` (64 → 32 → 16), or `block_size`.
- **Download failed** → put any `.txt` file in `data/` and run
  `python train.py --data data/yourfile.txt`. Any big chunk of clean text works.
- **Samples are still gibberish after lots of steps** → your data may be too
  messy/varied for this size. Use TinyStories, or a bigger model, or both.
- **It's slow** → make sure it printed `device: cuda`, not `cpu`. `cpu` means
  torch can't see your GPU — back to Step 0.
