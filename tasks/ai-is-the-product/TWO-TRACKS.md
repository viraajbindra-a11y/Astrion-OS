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

## The memory layer — "learns what YOU mean," and it needs no cloud

Clarified 2026-07-23. The goal is NOT the model getting globally smarter. It is
the AI adapting to its one user — learning what this person means when they say
something, getting more efficient for them specifically. That is a MEMORY
problem, not a training problem: the model's weights never change, and nothing
ever leaves the device.

The model provides general language understanding (shared, fixed). The memory
layer provides the you-specific layer on top (personal, growing, local). Three
things, all just files on disk:

- **Learned phrasings.** User says something unmatched, then rephrases into
  something matched → record "for THIS user, phrase X → intent Y." Next time X
  resolves directly. A synonym table that grows on every correction, sitting in
  front of the intent layer that already exists.
- **Corrections.** "No, the other one" → remember which one was meant.
- **Habits.** Which files/apps get used, naming patterns → "open my notes"
  resolves to the file they actually use, not a guess.

Why this shape:
- **No cloud, ever.** Nothing about "learns what you mean" requires a server —
  it is per-user, small, and local. This is the whole resolution of the
  cloud-vs-offline tension: personalization is inherently local, so the "can't
  phone home" promise stays absolute.
- Bad memory is one file you delete; a corrupted weight is a week.
- Inspectable — the user can open the file and read what it learned about them.
- Build it ONCE and it works for Qwen and the custom model both.

**Strategic point:** a small, mediocre model feels great once it knows you. The
memory layer covers what a 0.6B model lacks — a giant cloud model meets you cold
every time, yours already knows you. Personalization is how a tiny local model
beats a big remote one FOR ITS ONE USER. The seed already exists: today's "it"
pronoun slot and did-you-mean are baby versions of exactly this.

Explicitly NOT doing: on-device weight updates / online backprop (drift +
catastrophic forgetting = how models get worse, brutal without SSE), and NOT
sending any user data to the cloud to personalize (breaks the one promise no
competitor can copy). Model improvement is a SEPARATE track — we train better
weights on our own GPUs from public data and ship them as updates, which is just
normal development and touches no user's private data. The cloud can make the
model better for everyone; it is never where a user's data goes.

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
