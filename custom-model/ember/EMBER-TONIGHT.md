# Ember on your PC — the whole thing, tonight

Every command here goes in **PowerShell on the Windows PC**. Nothing runs on the
Mac.

This is NOT the 80-hour training run. That was `WINDOWS.md`, and it built the
341M model that lives inside the C kernel. This is the other Ember: the one a
person actually talks to, built by modding Qwen3 rather than training from zero.

Honest time budget:

| Step | What | How long |
|---|---|---|
| 0 | Install Ollama | ~3 min |
| 1 | Pull the base model | 5-20 min (5.2 GB download) |
| 2 | Create Ember from it | ~10 seconds |
| 3 | Prove it holds its identity | ~1 min |
| 4 | Point Astrion at it | ~1 min |

Total: under half an hour, and most of that is the download.

---

## Why this is fast when the other one took 80 hours

Training a model from nothing means learning language itself, which is the 80
hours. Modding one means taking a model that already knows language and giving
it an identity and a job. Ollama does that with a text file. No GPU time, no
dataset, no waiting.

What you get is genuinely better at helping with calculus and code than the
341M model ever will be, because Qwen3 8B has roughly 24x the parameters and
was trained on far more. What you give up is that the weights are not ours.
Both of those are true and the README says so.

---

## Step 0 — Install Ollama

Download the Windows installer from **ollama.com/download** and run it. It
installs a background service that starts with Windows.

Check it is alive:

```powershell
ollama --version
```

If that prints a version, the service is running. If it says the command is not
recognised, close PowerShell and open a new one — the installer adds it to PATH
and the old window has the old PATH.

---

## Step 1 — Pull the base

Pick the tier that matches the machine. The 5080 box should take the middle one
comfortably; the big one is also fine if you want it.

```powershell
ollama pull qwen3:8b
```

Sizes, checked against the Ollama registry on 2026-08-29:

| Tier | Tag | Download | Resident while running |
|---|---|---|---|
| small | `qwen3:1.7b` | 1.4 GB | ~2 GB |
| standard | `qwen3:8b` | 5.2 GB | ~6.4 GB |
| big | `qwen3:14b` | 9.3 GB | ~11 GB |

**The download size is not the memory cost.** The weights load into RAM and the
context window costs more on top — about 1.2 GB for the standard tier at an
8192 context. So `qwen3:8b` is ~6.4 GB resident before Astrion, before a
browser, before anything you are actually doing. On the 5080 box that is fine.
On a machine with exactly 8 GB, standard will run and make everything else
miserable; small is the honest choice there.

---

## Step 2 — Create Ember

From the repo root:

```powershell
ollama create ember -f custom-model\ember\Modelfile.standard
```

There is one Modelfile per tier — `.tiny`, `.standard`, `.big` — because the
context size differs between them. Use the one matching the tag you pulled.
(Plain `Modelfile` with no suffix is the standard tier, kept so `-f Modelfile`
does the obvious thing.)

This takes seconds. It is not copying the weights — it writes a small manifest
that points at the base you just pulled and layers Ember's identity on top.

Check it exists:

```powershell
ollama list
```

You should see `ember` in the list alongside `qwen3:8b`.

---

## Step 3 — Prove it is actually Ember

This is the step that matters, and it is the one that is easy to skip because
the model will *look* right if you just chat to it.

```powershell
python custom-model\ember\identity_gate.py
```

It asks the model who it is, several different ways, and checks the answers
with a predicate that cannot be satisfied by a wrong answer that happens to
contain the right words.

That is not a hypothetical worry. An earlier identity check in this repo passed
a model that answered **"Yes, I'm Ember"** to *"Are you ChatGPT?"* — because the
check looked for the word "ember" anywhere in the reply and found it. The gate
now reads the front of the answer and refuses anything that starts with "yes".

If it fails, it prints the exact question and the exact answer. Send me both.

You can also check the gate itself is working, with no model and no network:

```powershell
python custom-model\ember\identity_gate.py --selftest
```

That runs the predicate against known-good and known-bad answers. If the
selftest ever passes when it should not, the gate is worthless and everything
above it is unverified.

---

## Step 4 — Point Astrion at it

Start Astrion and go through first boot. On the AI screen, pick the tier you
pulled.

It will still run its download step - the picker does not check what you
already have, it just asks Ollama to pull. That is fine: Ollama already has
every layer, so it verifies them and returns almost immediately. Expect the
progress bar to appear and finish in a second or two rather than not appear at
all. (Checked in js/shell/wizard-ai-brain.js - there is no already-installed
detection in there today. Worth adding, but it changes nothing about whether
this works.)

If Astrion is already set up, Settings > AI > model, and set it there.

---

## If something goes wrong

**`ollama pull` is slow or stalls.** It resumes. Ctrl-C and run it again; it
picks up where it stopped.

**`ollama create` says the base is not found.** You skipped step 1, or you
pulled a different tag than the Modelfile's `FROM` line names. Run
`ollama list` and compare.

**The model answers in visible `<think>` tags.** Qwen3 is a hybrid reasoning
model and can show its working. The Modelfile handles this; if you see it
anyway, tell me — it means the parameter did not take and Astrion's chat panel
will look broken.

**The identity gate fails.** Do not ship it. Send me the failing question and
answer. A model that tells a user it is ChatGPT undoes the entire product
claim, and it is the one failure here that is worse than having no assistant.
