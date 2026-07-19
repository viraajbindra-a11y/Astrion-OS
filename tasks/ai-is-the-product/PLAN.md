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

- [ ] **M1 — lift the 4 GiB ceiling.** Switch the PDPT to 1 GiB pages
      (`PDPTE.PS=1`), guarded by a CPUID `PDPE1GB` check with the 2 MiB path as
      fallback. *Verify:* boot with `-m 8G`, write and read back a pattern at a
      physical address above 4 GiB.
- [ ] **M2 — multiboot2 module loading.** Parse the MB2 module tag, expose base
      and length. *Verify:* pass a known blob, checksum it from inside the
      kernel and compare against the host's checksum.
- [ ] **M3 — XSAVE/FXSAVE in the context switch.** Prerequisite for SSE/AVX
      under a preemptive scheduler; without it vector state corrupts across
      tasks. *Verify:* two tasks each spinning on distinct vector values,
      neither observes the other's.
- [ ] **M4 — int8 quantized matmul.** The hot loop, `int8 x int8 -> int32`.
      Scalar first (works today, no SSE), then AVX2. *Verify:* host test with
      exhaustive small cases + a reference implementation.
- [ ] **M5 — BPE tokenizer.** Qwen vocab is ~150K. *Verify:* host test,
      round-trip a corpus against the reference tokenizer's output.
- [ ] **M6 — weight format.** GGUF parse, or a custom format converted on the
      host. Prefer custom: less surface, and the converter is host-side Python
      where it's cheap to test.
- [ ] **M7 — wire to the Assistant**, behind the intent layer.

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
