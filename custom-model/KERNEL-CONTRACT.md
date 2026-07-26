# Ember ↔ Kernel contract

How a trained Ember becomes a brain Astrion can load. This is the seam between
the two tracks: the training side (this dir) produces a checkpoint; the kernel
side (`kernel/`) loads it with ZERO changes. One engine, swap the weight file.

Written after reading both sides on 2026-07-25. Everything marked VERIFIED was
checked against the actual code, not assumed.

---

## The one command

```
python custom-model/export_ember.py --ckpt ember.pt        # -> ember.astrion
```

That's it. `export_ember.py` delegates to `kernel/tools/mkweights.py --ckpt`,
which writes the binary `AMW1` format `kernel/src/model_load.c` reads. Do not
write your own format — the kernel has no JSON parser, on purpose.

---

## What your checkpoint must contain  — VERIFIED against mkweights.py

`train_best.py` and `finetune.py` already save this. Don't change it; just don't
break it.

```python
torch.save({"model": model.state_dict(), "cfg": cfg}, "ember.pt")
```

**cfg keys** (all present in `train_best.CFG`): `dim`, `n_layer`, `n_head`,
`n_kv_head`, `ffn_dim`, `block_size`, `vocab`, `rope_theta`, `rms_eps`,
`qk_norm`. Tied embeddings are handled automatically.

**parameter names** (from `train.py`'s `GPT`) — every one maps cleanly through
`mkweights.oracle_name`, and the Linear `[out, in]` shapes match what the engine
expects:

| torch name | becomes |
|---|---|
| `embed.weight` | embed |
| `blocks.N.ln1.weight` / `ln2.weight` | layer norms |
| `blocks.N.attn.{wq,wk,wv,wo}.weight` | attention projections |
| `blocks.N.attn.qk_norm.weight` | QK-norm gain (only if `qk_norm`) |
| `blocks.N.mlp.{gate,up,down}.weight` | SwiGLU |
| `final_ln.weight`, `lm_head.weight` | head |

If you rename a module in `train.py`, update `mkweights.oracle_name` in the same
commit — or this silently breaks.

---

## Verify it BEFORE you trust it — no training required

A random-init model of the right SHAPE exercises the whole export path. Training
changes the numbers, not the plumbing. So this runs today.

**On the PC (has torch):**
```
python custom-model/roundtrip_check.py      # -> rt_ckpt.astrion + rt_ckpt_ref.txt
```

Send those two small files to the kernel chat. **On the Mac (has cc + the engine):**
```
cd kernel && cc -std=c11 -Iinclude tools/ckpt_roundtrip.c -o build/ckpt_roundtrip
./build/ckpt_roundtrip rt_ckpt.astrion rt_ckpt_ref.txt
```
Expect `argmax mismatches 0/7 ... PASS`. A convention or format bug shows up as
argmax mismatches and a big deviation — the harness is control-proven to catch
RoPE and GQA-grouping bugs (it fails at 31% and 111% deviation when they're
planted; a clean run sits at 3%).

---

## Status

- **Mac chain** (`emit_blob` → `model_load` → `model_forward`): **VERIFIED**
  today, numpy only, on a random Ember-shape model. Config-independent and
  bug-sensitive (`kernel/tools/rt_oracle.py` + `ckpt_roundtrip.c`).
- **Engine fidelity at depth**: **VERIFIED**. A random dim-256 / 16-layer /
  64-position model runs through the C engine and tracks a numpy int8 simulation
  position-for-position — so RoPE at high positions, GQA, and 16-layer int8
  accumulation are all correct, not just the 2-layer oracle.
- **`from_ckpt`** (the torch `.pt` reader + name map): verified by inspection;
  `roundtrip_check.py` run-verifies it on the PC. **This is the one step left.**
- **A real trained `ember.pt`**: the final gate is loading it live on Astrion
  and watching it generate.

### Reading a round-trip result

`roundtrip_check.py` uses a **3-layer** model on purpose: there, argmax is a
clean gate and `0/N mismatches` means the converter is correct. Do **not** crank
its depth up and read argmax flips as failure — on *random* weights, int8
quantization alone flips near-tied logits at depth (that's expected, and proven
to be quantization, not a bug). Convention/format bugs show at 3 layers just as
loudly. Depth robustness comes from a *trained* model's confident logits, which
is exactly why the final gate is a real Ember running live.

---

## Size — the next real problem, not a blocker

A trained 341M Ember exports to a **~775 MB** `.astrion` file:

| section | size | why |
|---|---|---|
| embed | 412 MB | stored int64 fixed-point |
| 24 layers (matmuls) | 308 MB | int8 |
| lm_head | 55 MB | int8 |
| everything else | ~1 MB | |

It **fits** in the 12 GB the kernel maps, but it's a big GRUB module. Two things
follow:

1. **M7 wires the load path with a KB-scale test brain first.** When the 775 MB
   file arrives, size is the only new variable — the path is already proven.
2. **Obvious win, deferred:** store `embed` int8 like `lm_head` and the file
   drops to **~414 MB**. That's an engine change (`model.c` embed lookup +
   `model_load.c` + `mkweights.py`), so it waits until the basic path runs.

### There are TWO memory costs, not one

The file is only the first. Generation also needs a **KV cache**, allocated at
runtime from the kernel heap. At `max_seq=1024` that's **~100 MB** (kcache +
vcache). Today's kernel heap is **32 MiB** — so a real Ember would load, then
fail to allocate its cache, and the Assistant would say "generation disabled".
Verified by arithmetic against `kernel/src/heap.c`, not guessed.

- **Kernel side — DONE (commit `b8e1cff`, rex-verified).** The KV cache now
  comes from the page allocator (PMM) as a contiguous frame run, not the 32 MiB
  heap. Proven on the shipped kernel: a 56 MB cache generated live, frame
  accounting confirmed both caches came from the PMM, and the pre-fix control
  OOMs. So `max_seq=1024` is fine now — no need to shrink it.
- **Still open (needs a real model):** the ~775 MB module-MAPPING path is
  untested until a real Ember `.astrion` exists. That's separate from the cache
  (which was the actual blocker). If it turns out GRUB/the loader struggles with
  a 775 MB module, the `--max-seq`/`embed int8` levers shrink it.

The tiny test brain (M7) sidesteps all of this — its cache is a few KB.
