# Two tracks: ship on Qwen, grow our own

**Decision, 2026-07-23.** Viraaj: build a custom Astrion-native model alongside
the OS while shipping on Qwen — "kinda like how we worked on Linux and the
kernel at the same time." Same pattern that already worked here: the v1.0 web
desktop shipped while the v2.0 real kernel was built underneath it.

## The insight that makes this cheap

It is NOT two AIs. It is **one engine, two weight files.**

Everything in ai-is-the-product/PLAN.md — the int8 matmul, the tokenizer, module
loading, the forward pass — is weight-agnostic. Qwen is a `.bin` in the model
module slot. A custom model is a different `.bin` in the same slot. Same engine,
same kernel code, swap the file.

- **Ship track:** Qwen weights → engine → launch (end of Sept). The engine gets
  built once, the hard way, and works forever after.
- **Build track:** train custom weights host-side, on our own time and compute →
  drop them into the same slot when ready. No kernel rebuild. A file swap.

Neither track blocks the other. If the custom model is not ready at launch,
Qwen carries it and ours becomes v2.1.

## The one decision that makes the swap free — and MUST hold from day one

**The engine reads its shape from the weight file's header, not from
`#define`s.** Layer count, model dim, head count, KV-head count, head dim, FFN
dim, vocab, RoPE theta, RMS epsilon — all fields in the file, read at load,
validated wrap-safe like every other module field.

Cost of doing this now: near zero — the forward pass is being written this
session, and the oracle (tools/ref_forward.py) already carries config as a dict
rather than constants.

Cost of NOT doing it: the custom-model track becomes a kernel rewrite instead of
a drag-and-drop, and we would only discover that after both models exist. This
is the extensibility hook; it is load-bearing for the whole two-track plan.

A model file is therefore: `[header: config + checksums][quantized weights]`,
and the loader refuses a header whose dims do not match the weight-section size.
Qwen's converter (M6) and the custom-model converter both emit this one format.

## The memory / "self-learning" layer sits ABOVE the model

Weights stay fixed, tested, predictable. Learning happens as DATA — the
assistant keeps notes (files, corrections, phrasing, recent context) on disk and
feeds them back as context. It feels like it learns you because it does, without
touching weights.

Why above the model and not inside it:
- Bad memory is one file you delete; a corrupted weight is a week.
- It is inspectable — just text, no black box.
- It fits the pitch: an AI that learns YOU, on YOUR machine, learning that never
  leaves the device.
- Build it ONCE and it works for Qwen and the custom model both.

Explicitly NOT doing: on-device weight updates / online backprop. That is how
models get worse — drift and catastrophic forgetting — and it is brutal without
SSE. The memory layer is the safe, shippable version of "self-learning."

## The custom-model build track — honest scope

- **Compute is the real limit.** No cluster. Start TinyStories-scale (5–30M
  params) on free Colab or a few dollars of rented GPU. This trains host-side,
  never on Astrion.
- It will NOT match Qwen's general smarts. It CAN be Astrion-native and sharp at
  the one job that matters — being an OS assistant — because we choose its data
  and its size.
- Shaped to the hardware from the start: int8, dims chosen to fit, a small
  purpose-built tokenizer rather than Qwen's 151K vocab.
- It is the deepest skill in the project: training a transformer from scratch.
  Long, incremental, learn-as-you-go — and it ships the day it clears a quality
  bar, not before.

## Order of operations

1. Forward-pass engine, config-driven, verified against the oracle. (in flight)
2. M6 weight format + Qwen converter → ship track runs.
3. Memory layer above the model → works on Qwen now.
4. Custom-model training track starts host-side, in parallel, whenever. Swaps in
   when it clears the bar.
