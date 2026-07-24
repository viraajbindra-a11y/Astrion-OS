# Training on the real internet — the honest version

This is the step up from `README.md` (Shakespeare and kids' stories) to **real
web text at GPT-2 scale**. Same model you already have — the RMSNorm/RoPE/SwiGLU
`GPT` from `train.py`, unchanged — but now fed:

- **A real tokenizer** (GPT-2 byte-pair, 50257 pieces) instead of one character
  at a time. `"the"` is one token, not three, so the model spends its brainpower
  on *meaning*, not *spelling*.
- **Real internet text** — FineWeb-Edu, a cleaned, quality-filtered slice of
  Common Crawl (the actual web). Real articles, not spam.
- **A model 20× bigger** — 124 million parameters, the exact size of GPT-2, the
  model that shocked people in 2019 by writing coherent articles.

Three files do it:
- `prepare_fineweb.py` — download + tokenize the web text into `data/*.bin`.
- `train_internet.py` — train on it (auto-resumes; survives reboots).
- `train.py` — the model itself, imported unchanged.

---

## The blunt truth about your hardware first

You asked for "understands the entire internet." Here's the real picture, no spin.

**"Understands the internet like ChatGPT" is a datacenter, not a bedroom PC —
and that's not a you problem, it's a physics problem.** GPT-4-class models run on
**tens of thousands** of GPUs for **months**. GPT-3 was 175 *billion* parameters
trained on 300 billion tokens. Nobody trains those at home. Not me, not anyone.

**But here's what your RTX 5080 genuinely CAN do, and it's real:** train a
GPT-2-class model (124M parameters) on real web text, from scratch, to the point
where it writes coherent, on-topic English paragraphs. That's a model that beat
the state of the art in 2019. On your card:

| | Tier A — *tonight* | Tier B — *a weekend* |
|---|---|---|
| Web text used | ~300 million tokens | ~10 **billion** tokens |
| Training updates | 600 | 19,073 |
| **Time on your 5080** | **~2.5–3 hours** | **~3.5 days** |
| Val loss you'll hit | ~4.0–4.3 | ~3.29 |
| What it means | real English shape, still climbing | **beats the original GPT-2-124M** |
| VRAM used | ~5 GB | ~6 GB (of your 16) |

Both are real wins. For scale: a datacenter with 8 top-end GPUs does that
weekend job in **90 minutes**. You're about **46× slower** than that — because
you have one $1,000 card, not a $150,000 server. That gap is expected. The move
isn't to beat the datacenter; it's to pick jobs that fit on your card. Both tiers
above do.

*(Numbers are honest engineering estimates at ~33,000 tokens/sec, the realistic
throughput for this model on a 5080. Could be a bit faster once Blackwell drivers
mature; I planned for the safe side.)*

---

## Setup (on the PC with the 5080)

You already installed PyTorch (see `README.md` Step 0 — the `cu128` build). Add
two libraries:

```
pip install datasets tiktoken
```

`tiktoken` is the GPT-2 tokenizer. `datasets` is how we stream the web text
without downloading terabytes.

---

## Tier A — see it work on real web text tonight

```
python prepare_fineweb.py --mb 700     # downloads ~300M tokens of real web text
python train_internet.py               # trains ~2.5-3 hours, prints samples as it goes
```

`prepare_fineweb.py` streams FineWeb-Edu over the network, tokenizes it, and
writes `data/fineweb.bin` (training) + `data/fineweb_val.bin` (the honesty test).
It stops as soon as it has ~700 MB — it does **not** pull the whole dataset.

Then `train_internet.py` trains. Every 100 steps it prints the loss and a live
sample. Watch the samples: they start as token-salad, then real words clump into
phrases, then phrases into web-article-shaped sentences. It **checkpoints every
eval and auto-resumes** — close the laptop, reboot, lose power; when you rerun
the command it picks up where it left off. You never lose more than a few minutes.

Generate from it any time:

```
python train_internet.py --sample_only --prompt "The best way to learn is"
```

**What Tier A gives you:** a model that writes English that *looks* right —
grammar, sentence shapes, topic words that go together. It will still say untrue
and half-finished things. That's expected: 300M tokens is a taste, not a meal.
The point of Tier A is to prove the whole machine works on real data, tonight.

---

## Tier B — a real GPT-2 over a weekend

When you've got 3–4 days where the PC can run, open `train_internet.py` and flip
the three lines the comments point to:

```python
max_iters  = 19073     # was 600
warmup     = 715       # was 60
eval_every = 250       # was 100
```

Get more data first (this one's big — ~20 GB on disk):

```
python prepare_fineweb.py --mb 20000    # the full 10B-token sample
python train_internet.py                # ~3.5 days, auto-resuming
```

**What Tier B gives you:** a val loss around **3.29** — which actually *beats*
the original GPT-2-124M's score on a standard reasoning benchmark (30.5% vs
29.4%). You will have trained, from scratch, on your own PC, a model as good as
the one that made headlines in 2019. That's not a toy. That's the real thing.

---

## What the numbers mean at this scale

```
step    300 | train 4.512 | val 4.480 | lr 3.1e-04 | 47.2m
```

- **val loss** is still the honest score — surprise-per-token on text it never
  saw. Lower = better. At this vocab, pure random guessing scores **10.83**
  (that's `ln(50304)`), so step 0 starts near there.
- **~4.0** ≈ it knows words and short phrases. **~3.3** ≈ GPT-2 quality, real
  sentences. Every 0.1 down is a real jump in how coherent the samples read.
- Trust the **samples** over the number. Readable, on-topic paragraphs = success.
- `train` and `val` should fall together. If `val` starts *rising* while `train`
  keeps dropping, it's memorizing — feed it more data (`--mb` higher).

---

## The gap to ChatGPT, in plain numbers

So you know exactly where this sits, biggest to smallest:

- **Yours (GPT-2-124M):** 124M parameters, ~10B tokens, one 5080, a weekend.
- **GPT-3:** ~175B parameters (**~1,400× yours**), ~300B tokens, a supercomputer.
- **GPT-4-class:** rumored **trillion+** parameters, tens of thousands of GPUs,
  months of training, costs more than a house.

That's the gap, and no amount of staying up late closes it — it's compute you
don't have. **But here's the thing that matters:** a small model can be genuinely
*great at one narrow job* even though it's hopeless as a general genius. It won't
out-argue ChatGPT. It *can* be a sharp little Astrion assistant — understand a
command, open an app, explain a setting, find a file — running **on your own
machine, private, offline, no server bill**. A giant cloud model meets every user
cold. Yours can be small, fast, and *yours*. That's not a consolation prize.
That's the actual product.

---

## Why this is the same brain Astrion runs

Nothing about going to real web text changed the model's *shape*. `train_internet.py`
imports the exact same `GPT` class as `train.py` — RMSNorm, RoPE, SwiGLU — the
same family your kernel's oracle (`kernel/tools/ref_forward.py`) implements, with
the same adjacent-pair RoPE convention (I checked it matches the oracle exactly).

So the path is real and unbroken:
1. **Tonight:** Tier A proves the pipeline on real web text.
2. **A weekend:** Tier B trains a genuine GPT-2 from scratch.
3. **Later:** quantize those weights to int8 (your kernel already has the int8
   matmul) and drop them into the model slot — same engine, new weight file,
   exactly the `TWO-TRACKS.md` plan.
4. **Then:** fine-tune it on OS-assistant examples so it's sharp at Astrion's job.

One engine, the whole way down. The thing you train this weekend is the thing
that can run inside your OS.
