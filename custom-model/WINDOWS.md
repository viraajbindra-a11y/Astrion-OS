# Ember on the 5080 — the whole run, start to finish

Every command here goes in **PowerShell on the Windows PC**. Nothing here runs on
the Mac. Open PowerShell once and stay in it.

The order matters. Steps 0–4 are cheap and they exist to catch a broken setup
*before* you spend hours on a download and days on a training run. Do not skip
ahead to step 5 — if torch can't see the card, you want to know that in two
minutes, not on Sunday night.

Time budget, honestly:

| Step | What | How long |
|---|---|---|
| 0–2 | Get the code, install torch, check the GPU | ~15 min |
| 3 | Round-trip check (send me two files) | ~30 sec |
| 4 | Smoke test — proves the whole training path | ~10 min |
| 5 | Download + tokenize 7B tokens | 1–3 hours |
| 6 | **Pretrain** | **~54 hours** |
| 7–10 | Fine-tune, check, chat, export | ~20 min |

You need about **30 GB of free disk**. The token file is ~13 GB and the
checkpoint is ~5 GB.

---

## Step 0 — Prerequisites

Install these first if you don't have them:

* **Python 3.13** from python.org. Tick **"Add Python to PATH"** during install.
  **Not 3.14.** Triton has no 3.14 wheel (checked 2026-07-27: triton-windows
  3.7.1.post27 ships cp310–cp313 only), and without Triton `torch.compile` cannot
  work, which costs 2–3x wall-clock. See step 2.
* **Git for Windows** from git-scm.com.
* An **NVIDIA driver from 2025 or later**. The 5080 is Blackwell; old drivers won't do.

Check Python is on PATH:

```powershell
python --version
```

If that opens the Microsoft Store instead of printing a version, PATH didn't take.
Use `py` everywhere instead of `python` for the rest of this document.

---

## Step 1 — Get the code

You need the **whole repo**, not just the `custom-model` folder. `roundtrip_check.py`
and `export_ember.py` both reach into `kernel/tools/mkweights.py`, so a partial
copy will fail at step 3.

```powershell
cd ~
git clone https://github.com/viraajbindra-a11y/Astrion-OS.git
cd Astrion-OS\custom-model
```

Already cloned it on a previous try? Then pull instead — you need the newest
`train_best.py` or `--smoke` won't exist:

```powershell
cd ~\Astrion-OS
git pull
cd custom-model
```

**Stay in `custom-model` for everything below.** Every command assumes it.

---

## Step 2 — Install torch, and prove it sees the 5080

Use `python -m pip`, not bare `pip` — a fresh Windows Python often has `pip` off
PATH even when `python` is on it.

A plain `pip install torch` often grabs a build that cannot drive a 50-series
card. The `cu128` index is the one that can:

```powershell
python -m pip install torch --index-url https://download.pytorch.org/whl/cu128
```

That's ~2.5 GB. Then the rest:

```powershell
python -m pip install numpy datasets tiktoken
```

**Then Triton**, or `torch.compile` fails and the run takes 2–3x longer. Triton
on Windows is an unofficial build and its version must pair with torch:

| torch | triton-windows |
|---|---|
| 2.7 | 3.3 |
| 2.8 | 3.4 |
| 2.9 | 3.5 |
| 2.11 | 3.7 |

```powershell
python -m pip install -U triton-windows
```

If that says **"no matching distribution"** you are on Python 3.14 — no wheel
exists for it. Install Python 3.13 and redo this step under it.

Triton also needs the **Visual C++ Redistributable 2015–2022** from Microsoft;
`libtriton.pyd` links against it. Most PCs already have it. Full MSVC is *not*
needed — that is only for CPU inductor, and this run is entirely on the GPU.

Now the gate. This must print your card:

```powershell
python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

Expected: `True` then `NVIDIA GeForce RTX 5080`.

**If it prints `False`, stop.** Nothing after this point can work. Either the
driver is too old, or pip installed the CPU-only build. Reinstall with the cu128
line above and check again.

---

## Step 3 — Round-trip check → send me two files

This is the one thing I'm blocked on. It needs no data and no training, and it
takes seconds:

```powershell
python roundtrip_check.py
```

It writes `rt_ckpt.astrion` and `rt_ckpt_ref.txt` into the `custom-model` folder.
**Send me both.** I run them through the real C engine on the Mac and confirm the
weight conversion is exact.

Do this now, before the download. Then I can verify the export path while you
pretrain, instead of finding a format bug on Monday with a finished model in hand.

---

## Step 4 — Smoke test

`train_best.py` needs a token file to exist before it will start, so make a tiny
one first. This is ~50 MB and takes a minute or two:

```powershell
python prepare_fineweb.py --mb 50 --out data/smoke.bin --val data/smoke_val.bin
```

Now run four real training steps against it:

```powershell
python train_best.py --data data/smoke.bin --val data/smoke_val.bin --compile --smoke
```

This exercises the entire path: data → forward → backward → both optimizers →
eval → checkpoint. It saves to `ember-smoke.pt`, which is a throwaway — it can
never touch your real model.

**What to watch for.** One of these two lines will appear:

* `torch.compile: working` — good. The real run is ~54 hours.
* `torch.compile FAILED — continuing WITHOUT it` — **not fatal.** Inductor needs
  Triton, which isn't officially supported on Windows. The run still works, just
  2–3x slower, which turns 54 hours into 5+ days. See "If compile fails" below.

Also watch **VRAM**. If you see `CUDA out of memory`, tell me — the fix is
lowering `micro_batch` from 8 to 4 and raising `grad_accum` from 64 to 128, which
keeps the batch size identical.

When it finishes, clean up:

```powershell
Remove-Item ember-smoke.pt, data/smoke.bin, data/smoke_val.bin
```

---

## Step 5 — Download the real data

```powershell
python prepare_fineweb.py --mb 13500
```

~7 billion tokens of FineWeb-Edu, written to `data/fineweb.bin` (~13 GB). It
streams — it never downloads the full 44 TB dataset.

This takes **1–3 hours**, mostly CPU-bound tokenizing, not network. It prints
progress in MB. If it dies partway, just rerun it; it starts over.

---

## Step 6 — Pretrain

```powershell
python train_best.py --compile
```

This is the long one. ~54 hours.

**Before you start it, stop Windows from sleeping.** Settings → System → Power →
Screen and sleep → set **sleep to Never**. Screen turning off is fine. Sleep kills
the run.

**Leave the PowerShell window open.** Closing it stops training.

You'll see a line every 250 steps:

```
step    500 | train 6.412 | val 6.388 | lr 2.0e-02 | 41.3m
   the of and to a in that is was for it with as on
```

The sample text is gibberish at first. That is correct. It becomes English
somewhere around step 1500–2500.

Loss should fall fast at first, then slowly. By the end expect **val around
3.1–3.3**. If val ever goes *up* and stays up, or prints `nan`, stop and tell me.

**It auto-resumes.** It saves every 250 steps. If the PC reboots, run the exact
same command again — it picks up where it left off and prints `resumed at step N`.

**Never add `--fresh`.** That deletes your progress and starts over.

### If compile fails

2–3x slower means 5+ days, which is too long. Cut the run in half instead. Open
`train_best.py` and change three numbers in `CFG` near the top:

```python
    total_steps=6750,       # was 13500
    warmup=135,             # was 270
    stable_until=4050,      # was 8100
```

All three must change together — they're one schedule. That gives ~3.5B tokens
in ~2.5 days without compile. The model comes out a bit weaker, not broken.

Do this **before** you start step 6, not partway through.

---

## Step 7 — Fine-tune

Pretraining gives you a model that writes English but has no idea it's Ember and
can only autocomplete. It cannot answer a question yet. **Do not panic when you
first see this.** That's what step 7 fixes.

```powershell
python finetune.py
```

Minutes, not hours. Reads `ember-base.pt`, writes `ember.pt`.

---

## Step 8 — Readiness check

```powershell
python readiness.py
```

Asks Ember who it is, in wordings it wasn't trained on, and grades the answers.

You want: **`🔥 EMBER IS READY`**

If it says "getting there," run `python finetune.py --epochs 6` and check again.

---

## Step 9 — Talk to it

```powershell
python chat.py
```

This is the moment. It's your model, trained from zero on your own machine.

---

## Step 10 — Export for the kernel

```powershell
python export_ember.py
```

Writes `ember.astrion`, ~775 MB. That is the file Astrion loads as its brain.
Send it to me and we boot it on the real kernel.

---

## If something goes wrong

Send me the **exact** error text, not a description of it. Copy the whole traceback.

Common ones:

* **`python` opens the Microsoft Store** — use `py` instead of `python` everywhere.
* **`pip` not recognized** — use `python -m pip install ...`.
* **`torch.cuda.is_available()` is False** — wrong torch build or old driver. Redo step 2.
* **`CUDA out of memory`** — tell me; the fix is a micro_batch change.
* **`no token file at data/fineweb.bin`** — you're not in the `custom-model` folder, or step 5 didn't finish.
* **`cannot find ...mkweights.py`** — you cloned only part of the repo. Redo step 1.
