# The AI is the product

**Decision, 2026-07-19.** Viraaj: *"whatever you pick i just want the ai in an ai
operating system to work everything else is nice but the ai is crucial."*

So the AI moves to the front of the queue. Networking and the browser slip
behind it. This document is the call and the route.

---

## The call

**Target: Qwen3-0.6B, int4/int8, loaded as a multiboot2 module.** Not 7B.

Not because 7B is impossible — because it is the difference between a project
that finishes and one that doesn't:

| model | Q4 size | FLOP/token | soft-float (today) | AVX2 + int8 kernels |
|---|---|---|---|---|
| 212K (current) | 2.5 MB | 0.4 M | instant | — |
| **Qwen3-0.6B** | ~400 MB | 1.2 G | ~40 s/tok | **~5-10 tok/s** |
| Qwen3-1.7B | ~1.1 GB | 3.4 G | ~2 min/tok | ~2-4 tok/s |
| Qwen 7B | ~4.5 GB | 14 G | ~12 min/tok | ~1-2 tok/s |

Every piece of infrastructure below is identical for 0.6B and 7B. Build it at
0.6B, where a bad iteration costs ten seconds instead of half an hour, and 7B
stays open forever after — same code, bigger file, more RAM.

## Two layers, not one

This is the architecture, and it is not a compromise — it is how good
assistants are actually built:

- **Intent layer** — instant, deterministic, *does things*. Writes files, opens
  apps, reports real kernel numbers. A 0.6B model cannot be trusted to call
  functions reliably; this layer never guesses.
- **Model layer** — open-ended language, for everything the intent layer
  doesn't own.

The intent work is therefore not throwaway. It stays in front of the model
permanently. Expanding it is the fastest path to "the AI works" and it ships
in days, not weeks.

## What actually blocks the model

Established by inspection today, not assumed:

1. **~~RAM~~ — not a blocker.** `boot/multiboot2.S:68` identity-maps 4 GiB
   (4 PDs x 512 x 2 MiB). `-m 256M` is just a flag. Above 4 GiB is invisible
   until the map grows.
2. **No hardware floating point.** `src/gpt.c:12` — the kernel builds
   `-mgeneral-regs-only`; gpt.c is the sole exception and its float arithmetic
   lowers to libgcc soft-float, i.e. a function call per multiply. This is the
   wall.
3. **Disk is far too slow.** `src/ata.c` is PIO `insw`, ~3 MB/s. 400 MB is
   ~2 minutes; 4.5 GB is ~25. Fixing it properly means an AHCI DMA driver —
   weeks. **Sidestepped by loading the model as a multiboot2 module** so GRUB
   reads it (20-50 MB/s) before the kernel starts.

## Milestones

Ordered so each one is independently verifiable and nothing is a big-bang.
Status as of 2026-07-23.

- [x] **M1 — lift the 4 GiB ceiling.** 1 GiB pages via CPUID PDPE1GB, 2 MiB
      fallback. Booted `-m 12G`, sentinel written and read back at 6 GiB.
      Commit 2075e31. PMM freed to follow it (a0480df): 3 GB → 12 GB usable.
- [x] **M2 — multiboot2 module loading.** Parsed, bounds-checked, exposed as
      `boot_module()`. Kernel-side FNV-1a matched the host hash exactly — which
      caught the heap eating half the module (00f5222).
- [ ] **M3 — XSAVE/FXSAVE in the context switch.** DEFERRED, and possibly
      never needed: M4's int8 path emits zero SSE and runs today. This is only
      required if the AVX2 rewrite happens, and the scalar path may be fast
      enough that it doesn't. Re-decide after the forward pass runs and we have
      a real tokens/sec number.
- [x] **M4 — int8 quantized matmul.** `q8_dot` / `q8_quantize` in include/q8.h,
      scalar. Compiles under `-mno-sse -mgeneral-regs-only` emitting zero xmm.
      Exhaustive host test, both controls fail correctly. Commit c4da575.
      AVX2 rewrite is a later option, gated on M3, gated on need.
- [~] **M5 — BPE tokenizer.** Converter (tools/mktok.py) done and run against
      real Qwen2.5: 4.01 MB table, commit 8c2f1b4. KERNEL SIDE NOT BUILT —
      needs the merge loop, the ASCII pretokenizer, and offset validation over
      the mapped module. Host test diffs against HF reference.
- [ ] **M5.5 — THE FORWARD PASS.** *This was missing and it is the largest
      piece.* A Qwen block is RMSNorm → RoPE → grouped-query attention with a KV
      cache → RMSNorm → SwiGLU MLP, times N layers, then a final norm and the
      logit projection, then sampling. `q8_dot` is one line inside this; the
      rest — attention, the KV cache, RoPE, softmax, the residual stream — does
      not exist yet. Everything before this milestone is plumbing that carries
      data to a loop that has not been written. *Verify:* host-run one layer
      against a PyTorch reference on fixed weights, then the full stack on a
      tiny config before Qwen.
- [ ] **M6 — weight format.** Host converter, Qwen `.safetensors` → the grouped
      int8 layout q8.h expects, emitted as a second multiboot module. Prefer
      custom over GGUF: less parser surface in the kernel, and the converter is
      host-side Python where it is cheap to test and checksum.
- [ ] **M7 — wire to the Assistant**, behind the intent layer. The intent table
      stays in front; the model only runs on what the table doesn't claim.
- [x] **I1 — expand the intent layer.** Done and QA-signed: 18 questions, 8
      actions, 8 apps, plus the "it" pronoun and did-you-mean. All real numbers,
      cross-checked against the serial log by Rex.

Parallel track, no dependency on the above:

- [ ] **I1 — expand the intent layer** from ~6 to dozens, with phrasing
      tolerance. Every keyword gets a row in `tests/test_assist_match.c`,
      including a negative one.

## Rules for this arc

- **Host tests over boot tests wherever the logic allows it.** Today proved
  both directions: QEMU could not distinguish a fixed mouse decode from a
  broken one (it clamps to +/-127), while a booted screenshot caught a matcher
  bug that review missed. Tokenizer, matmul and quantization are all pure
  logic — they get exhaustive host tests. Rendering and timing get boots.
- **Every test carries a control** proving it fails against the bug it claims
  to catch. A gate that cannot fail is not a gate.
- **No claim of "works" without evidence attached.**
