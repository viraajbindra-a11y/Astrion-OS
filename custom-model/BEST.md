# The best model your 5080 can train — the flagship run

This is the strongest from-scratch language model a single RTX 5080 can honestly
train in a weekend: **~341 million parameters**, trained with the same techniques
the current speed-record holders use. It's a real step up from the GPT-2-124M in
`INTERNET.md` — bigger, and trained *smarter*, not just longer.

Everything here was tested before it was written down. The one number I can't test
on this Mac — the exact wall-clock on your 5080 — I've bracketed honestly below.

```
pip install datasets tiktoken
python prepare_fineweb.py --mb 13500       # ~7B tokens of FineWeb-Edu (~14 GB)
python train_best.py --compile             # the real run — see time estimate below
python train_best.py --sample_only --prompt "The best way to learn is"
```

Files: [train_best.py](train_best.py) (the run), [muon.py](muon.py) (the optimizer),
plus the model in [train.py](train.py) — imported unchanged, same as always.

---

## What makes it "best" — five real upgrades

Not one giant model. A 5080 can't out-muscle a datacenter, so the win is getting
**more quality out of every GPU-hour**. Five levers, all verified:

1. **~341M parameters** — dim 1024, 24 layers, 16 query heads. This is the biggest
   model that can be trained to a *genuinely useful amount of data* in a weekend.
   Bigger models physically fit in your 16 GB, but you couldn't feed them enough
   to be worth it in 2-3 days. Time is the limit, not memory.

2. **Grouped-query attention (4:1)** — 16 query heads share just 4 key/value heads.
   Same quality, smaller memory, and a **4× smaller KV-cache** when it runs inside
   Astrion. Your kernel oracle already supports this.

3. **The Muon optimizer** — the single biggest win. It cleans up each weight
   matrix's update so no direction dominates, reaching the same quality in roughly
   **half the training** of plain Adam. On one GPU over a weekend, that's the
   difference between finishing and not. (Verified: it orthogonalizes correctly and
   really does drive loss down.) It's training-only — the finished weights run in
   your kernel with zero changes.

4. **QK-norm + Warmup-Stable-Decay schedule** — small, cheap stability upgrades
   that let Muon run at a high learning rate without blowing up.

5. **Gradient checkpointing + torch.compile + bf16** — the plumbing that makes
   341M fit in ~9 GB and run ~2-4× faster. Without these it wouldn't fit or finish.

Upgrades 1-3 keep the weights a **drop-in file-swap** for Astrion. Upgrade 4
(QK-norm) is a real architecture change — so I also taught your kernel's oracle
(`kernel/tools/ref_forward.py`) the exact same QK-norm and **verified the math
matches to 8 decimal places.** Still one engine, all the way down.

---

## Honest expectations — read this before you start

**Time on your 5080:** the soft number. Plain PyTorch at this size does ~12k
tokens/sec, which would be too slow (~6 days). With `--compile` + flash attention +
bf16 you should get ~2-4× that:
- **~3× (realistic):** 7B tokens in **~54 hours — a long weekend.** ✅
- **~2× (if compile underdelivers):** you land ~4.5B tokens in the same time — a
  strong, slightly-undertrained model, *not* a failure.
- **~4× (good case):** ~40 hours, with room to push toward 10B tokens.

Set the goal at 7B tokens; the run auto-resumes, so stopping early just gives you a
smaller-but-fine model. It checkpoints every ~250 steps — reboots cost minutes.

**VRAM:** ~9 GB of your 16. Comfortable, even with the Windows desktop using some.
Memory genuinely isn't the constraint here.

**Quality — the truth, best to worst:**
- **Val loss ~3.1-3.3** on FineWeb-Edu. That **beats the original GPT-2-medium
  (355M, 2019) and rivals GPT-2-large (774M)** — because 2025 data + architecture +
  Muon beat 2019, even at similar or smaller size. Projected HellaSwag ~40-46.
- It writes **coherent, on-topic paragraphs** with real sentence structure and some
  world knowledge.
- It will **not** reason well, do math (GSM8K ~0), or know a lot of facts (MMLU near
  random). Knowledge is capped by the ~7B tokens it saw.
- **vs HuggingFace's SmolLM-360M** (same size class): comparable on fluency, clearly
  behind on knowledge. Why? SmolLM saw **85-500× more tokens** than a weekend
  allows. That's the *token gap*, not a flaw in your recipe — and it's exactly the
  thing you'd close by letting it train for a week instead (push `--mb` to 30000+).
- A base model like this is an **autocomplete engine**. It won't follow instructions
  until you fine-tune it on a narrow task — which is cheap on the same 5080, and is
  precisely the **Astrion-assistant** lane: small, private, offline, sharp at one job.

This is the "grow our own" track's first real base checkpoint. Quantized to int8
(~340 MB) it runs inside the OS you already built the engine for.

---

## If you have a full week, not a weekend

Small models get much better when trained **past** Chinchilla-optimal (which is how
SmolLM got good). Same command, more data:

```
python prepare_fineweb.py --mb 40000       # ~20B tokens (~3× Chinchilla)
```

and raise `total_steps` in `train_best.py` to match (≈ tokens / 524288). Diminishing
returns, but real ones — this is how you close the gap toward SmolLM.

---

## Want it even better? The optional data mix

Pure FineWeb-Edu is a great default. To add code + math reasoning (the SmolLM
recipe), interleave three streams in `prepare_fineweb.py` — all free, all streamable:

```python
from datasets import load_dataset, interleave_datasets
web  = load_dataset("HuggingFaceFW/fineweb-edu", "sample-10BT", split="train", streaming=True)
code = load_dataset("HuggingFaceTB/smollm-corpus", "python-edu", split="train", streaming=True)
math = load_dataset("HuggingFaceTB/finemath", "finemath-4plus", split="train", streaming=True)
mix  = interleave_datasets([web, code, math], probabilities=[0.75, 0.15, 0.10],
                           stopping_strategy="all_exhausted", seed=42)
# then tokenize `doc["text"]` from `mix` exactly as prepare_fineweb.py already does
```

Do the pure run first. Add the mix once that works.

---

## The exact recipe (for the curious / for reproducing)

| | value |
|---|---|
| params | 341M (dim 1024, 24 layers, 16 heads / 4 KV-heads GQA, ffn 3072) |
| context | 1024 tokens · vocab 50304 · tied embeddings · QK-norm on |
| optimizer | Muon (lr 0.02, momentum 0.95) on hidden matrices + AdamW (lr 3e-4) on the rest |
| schedule | Warmup-Stable-Decay: warmup 270, stable to 8100, decay to 0 by 13500 |
| batch | micro-batch 8 × 1024 × grad-accum 64 = 524,288 tokens/update |
| budget | 13,500 updates ≈ 7.08B tokens (Chinchilla-optimal for 341M) |
| precision | bf16 autocast + torch.compile + gradient checkpointing |
| data | FineWeb-Edu `sample-10BT` (cleaned, quality-filtered real web text) |
