# How Astrion Stays Safe

Most "AI" software asks you to trust a black box. Astrion replaces trust
with **runtime, code-enforced safety**. Every L2+ action passes through
a stack of gates. This document walks through that stack with a real
example and points at the file in the repo where each claim lives.

## The thesis in one paragraph

Training-time techniques (constitutional AI, RLHF, system prompts) shape
what a model *tends to do*. They don't help once the action is happening
on your machine. Astrion's safety is at runtime: a capability you ask
for is **labeled** (level + reversibility + blast radius), the planner
**sees those labels** before executing, the user **sees a typed-confirm
gate** for L2+ actions, an **adversarial reviewer** scans the same
preview, the **change is wrapped in a branch** that can be rewound, and
**tripwires** fire if any of the safety files themselves get modified.

None of this is paperwork. Every line that follows is a real module,
already running in v0.3.

---

## The walkthrough

User opens Spotlight (Cmd+Space) and types:

> `run rm -rf ~/Documents/work-2024`

Below is what actually happens, in order, with the file responsible for
each step. The same shape applies to every L2+ action — file edits,
terminal commands, app installs, system settings.

### 1. Intent parsing — [`intent-parser.js`](../js/kernel/intent-parser.js)

The query goes into the parser. It identifies the **verb** (`run`),
**target** (`command`), and **args** (`{ cmd: 'rm -rf ~/Documents/work-2024' }`).
Confidence is computed from how cleanly it matched a known shape. If
it's low, Spotlight shows free-text "ask AI" instead of a dispatch
button — because dispatching ambiguous intents is how things break.

### 2. Capability resolution — [`capability-api.js`](../js/kernel/capability-api.js)

The parsed intent matches the capability `terminal.exec`, declared at
[`capability-providers.js:957`](../js/kernel/capability-providers.js).
The capability carries its own labels:

```
level:         REAL              (2 — touches user data)
reversibility: BOUNDED           (rm goes to trash, recoverable for a window)
blastRadius:   ACCOUNT           (everything the user owns is in scope)
estimateCost:  { timeMs, irreversibilityTokens }
```

`level: REAL` is the trigger — anything ≥ `REAL` (level 2 or above)
**must** go through the preview gate. There is no path that bypasses
this. See [`operation-interceptor.js:130`](../js/kernel/operation-interceptor.js).

### 3. Budget check — [`budget-manager.js`](../js/kernel/budget-manager.js) + [`intent-executor.js`](../js/kernel/intent-executor.js)

Each action's `estimateCost.irreversibilityTokens` is debited from a
**daily token bucket** (50 tokens / day by default). If you've already
spent your budget on big destructive actions today, the next one fails
with `plan exceeds daily budget` — the safety budget pushes back even
when you don't.

### 4. Operation interception — [`operation-interceptor.js`](../js/kernel/operation-interceptor.js)

The executor calls `interceptedExecute(cap, args)`. Because
`level >= REAL`, it doesn't run the command. It calls
`requestConfirmation`, which:

- Generates a unique interception id
- Subscribes to `interception:confirm` and `interception:abort`
- Emits **`interception:preview`** with the full cap + args
- Sets a 60 s timeout. No response in 60 s → auto-abort.

Spotlight is one of the subscribers. It paints the gate UI: cap
summary, blast radius badge, the actual `cmd` string the OS is about
to run. The user can read what's about to happen *before it happens*.

### 5. Adversarial review — [`red-team.js`](../js/kernel/red-team.js)

The same `interception:preview` event fires the **red-team agent**. A
second model reads the cap + args and produces a structured review:

```json
{
  "risks": [
    { "severity": "high", "summary": "rm -rf on a top-level user folder; if path is wrong this is unrecoverable beyond trash retention" }
  ],
  "recommendation": "review",
  "summary": "destructive op against a user-owned directory; double-check the path"
}
```

It emits **`interception:enriched`** which the gate UI appends to the
preview panel. The user sees the planner's proposal **and** the
critic's concerns side-by-side. Red-team is **advisory** in v0.3 (M6) —
it can recommend `abort` but only the user can actually abort. M8 will
hard-gate self-modification on a `proceed` recommendation specifically.

### 6. Typed-confirm for points of no return — [`operation-interceptor.js:103`](../js/kernel/operation-interceptor.js)

Capabilities can mark themselves `pointOfNoReturn: true`. When set,
`requestConfirmation` flags `requiresTypedConfirmation` in the preview
event. The gate UI requires the user to type the cap id (e.g.
`terminal.exec`) into a text box before Enter does anything. Hitting
the wrong key doesn't accidentally fire a destructive op.

### 7. Rubber-stamp tracking — [`rubber-stamp-tracker.js`](../js/kernel/rubber-stamp-tracker.js)

The tracker watches every preview/confirm/abort. A confirm in under
2 seconds is "rapid"; over 2 s is "considered." After at least 20
samples, if the rapid-confirm rate exceeds **80%**, a Socratic warning
fires. The user is told they're stamping without reading and the next
preview is held longer. This is the gate against gate fatigue.

### 8. Plan rehearsal (multi-step plans only) — [`plan-rehearser.js`](../js/kernel/plan-rehearser.js)

If the action is part of a multi-step plan that touches the graph
store (notes, todos, reminders), the plan first runs against a
**sandbox graph branch**. The user sees the resulting diff
("+3 nodes, -1 edge") before the real graph is touched. Accept →
merge. Reject → branch is discarded; nothing changed.

### 9. Branch wrap (capabilities that opt in) — [`branch-manager.js`](../js/kernel/branch-manager.js)

Graph-mutating capabilities can wrap their execution in `onBranch()`.
Every change is recorded as a branch entry. `branch.rewind` restores
the pre-change state. Spotlight has a built-in `rewind` command. This
is the "undo" guarantee for everything that uses it.

### 10. Execute + record + notify

User confirms. `interception:confirm` fires. The promise resolves.
`cap.execute(args)` runs the actual `rm`. `recordBudgetUsed` debits
the irreversibility tokens. `intent:completed` fires. The notification
system shows a toast. Done.

### 11. Drift observation — [`drift-detector.js`](../js/kernel/drift-detector.js)

Across runs, the drift detector watches the AI's output distribution
on a fixed prompt set. If next week's responses systematically differ
from last week's, that's flagged as **behavior drift** and the user
sees a warning that the AI's behavior has shifted.

---

## Self-modification — the loaded gun

Every other capability changes user data. Self-modification changes
**Astrion itself**. So the gate is harder.

When the user asks Astrion to fix a bug in its own code (Spotlight →
`upgrade yourself with: ...`), the proposed change has to pass **all
five** of these:

1. **Golden integrity** — [`golden-check.js`](../js/kernel/golden-check.js)
   The pre-change SHA-256 of every safety-critical file matches
   `golden.lock.json`. Tampering is detected before anything runs.
2. **Value lock** — [`value-lock.js`](../js/kernel/value-lock.js)
   Predicate-based runtime invariants the AI cannot relax. Examples:
   "the red-team agent must remain subscribed to `interception:preview`",
   "self-upgrader must remain in the golden file list."
3. **Red-team approval** — [`red-team.js`](../js/kernel/red-team.js)
   Adversarial review of the proposed diff. Recommendation must be
   `proceed`. M8 hard-gates here, unlike M6's advisory mode.
4. **Typed confirmation** — [`self-upgrader.js`](../js/kernel/self-upgrader.js)
   The user types the cap id verbatim. No accidental Enter.
5. **Rollback plan present** — [`self-upgrader.js`](../js/kernel/self-upgrader.js)
   Pre-change bytes are stored. After write, the user has a
   one-command bytewise restore.

Only when all five pass do bytes hit disk. If any fail, the proposal
is discarded. The AI **cannot** add a new safety primitive that grants
itself broader rights — `self-upgrader.js` is in the golden list, so
modifying its allow-list / blocklist / content scanner triggers a
TAMPERED error before it even runs.

---

## The tripwires

These don't fire on normal use. They fire when something has gone wrong.

### Golden check — [`golden-check.js`](../js/kernel/golden-check.js)

19 safety-critical files SHA-256 hashed at boot. If any file's bytes
differ from `golden.lock.json`, the boot logs `[golden-check] TAMPERED`
with the offending paths. Includes self-upgrader, red-team, golden-check
itself, value-lock, capability-api, skill-registry, and the API surface
lock manifest.

If the AI rewrote red-team.js to soften it, this fires.
If the AI rewrote golden-check.js to skip itself, **the lock includes
golden-check**, so its own diff trips the alarm before it runs.
If the AI rewrote `api-surface.lock.js` to silently authorize a new
capability, this fires.

### API surface lock — [`api-surface.lock.js`](../js/kernel/api-surface.lock.js)

The set of registered capability IDs (41), browser IPC channels (47),
and skill-registry public exports (11) is locked. The v03 verification
suite imports the manifest, force-loads `capability-providers.js`, and
asserts the live registry **exactly** matches the locked Set in both
directions. Adding a new capability without updating the manifest
fails `v03 section 19`. Removing one fails it too.

This means scope creep at the API surface is a blocked failure mode,
not a slow one.

### Value lock — [`value-lock.js`](../js/kernel/value-lock.js)

Predicate language for runtime invariants. Currently used to encode
"safety modules must remain wired." Self-mod proposals are checked
against the predicate set; any proposal that would falsify a predicate
is rejected before red-team even runs.

### Drift detector — [`drift-detector.js`](../js/kernel/drift-detector.js)

Cross-run behavior shift on a held-out prompt set. Surfaces if the AI
has started behaving differently — even if every action it took
individually passed the gates.

---

## What this doesn't protect against

This is the credibility part. Safety claims are only useful if the
threat model is honest.

- **Your own malware.** If you `chmod +x` and run a binary you
  downloaded, that binary runs as you. Astrion's gates are for actions
  *the AI* takes. If you tell the OS "run this," that's you, not the AI.
- **Hardware faults.** Disk corruption, memory bit-flip, clock skew.
  The golden lock detects bit-rot in safety files but not in your data.
- **Supply-chain attacks against dependencies.** `npm install` pulls
  packages from npm; we don't audit every transitive dep. Lock-file
  pinning and sub-resource integrity help, but a compromised upstream
  is a compromised upstream.
- **Side-channel attacks.** Timing, power, electromagnetic. Out of
  scope.
- **Physical access.** Someone with your unlocked laptop can do
  anything you can.
- **Loss of the user's password.** Vault and login both use PBKDF2
  with high iteration counts. We can't decrypt your data without it.
- **The cloud AI you opt into.** If you choose Anthropic instead of
  local Ollama, prompts leave your machine. That's a UX choice; we
  default to local.
- **The AI being wrong in a way every gate misses.** None of these
  gates make the AI smart. They make its actions *visible* and
  *reversible*. A bad action you confirm is still a bad action.

---

## How this differs from "Constitutional AI" / RLHF / system prompts

Those techniques shape model **tendencies**. They are real and useful.
They are also:

- **Training-time.** They don't help once the model is deployed and
  asked to act. The action either happens or it doesn't.
- **Soft.** A persistent prompt can be jailbroken. A learned
  preference can be overridden by a harder learned preference.
- **Invisible.** The user can't audit a system prompt at runtime.
  They can't see why the model declined. They can't disagree.

Astrion's gates are **runtime**, **code**, and **visible**:

- The gate fires whether the AI "wants to" or not. It's not a
  preference; it's `if (cap.level >= LEVEL.REAL) await
  requestConfirmation(...)`.
- The user can read every gate. Every claim in this document is a
  file path. You can `cat` the source.
- The user has the override. Red-team can recommend `abort`; the
  user can confirm anyway. The OS doesn't pretend to know better than
  you.

Both layers help. Astrion adds the runtime layer most projects skip.

---

## Verifying every claim

| Claim | File:line |
|---|---|
| Capability declares level/reversibility/blastRadius | [capability-api.js:30-49](../js/kernel/capability-api.js) |
| L2+ actions intercepted before execute | [operation-interceptor.js:126-142](../js/kernel/operation-interceptor.js) |
| Red-team subscribes to interception:preview | [red-team.js](../js/kernel/red-team.js) |
| Red-team is advisory in M6, hard-gate at M8 | [red-team.js:30](../js/kernel/red-team.js) |
| 60s preview timeout default | [operation-interceptor.js:79-82](../js/kernel/operation-interceptor.js) |
| Typed-confirm flag for points of no return | [operation-interceptor.js:103-107](../js/kernel/operation-interceptor.js) |
| 80% rapid-confirm threshold over 20+ samples | [rubber-stamp-tracker.js:27-28](../js/kernel/rubber-stamp-tracker.js) |
| Plan rehearser runs on sandbox graph branch | [plan-rehearser.js](../js/kernel/plan-rehearser.js) |
| onBranch helper for capability authors | [branch-manager.js:348-358](../js/kernel/branch-manager.js) |
| Self-upgrader 5-gate flow | [self-upgrader.js](../js/kernel/self-upgrader.js) |
| 19 files in golden lock | [golden.lock.json](../golden.lock.json) |
| 41/47/11 locked surface counts | [api-surface.lock.js](../js/kernel/api-surface.lock.js) |
| v03 enforces surface drift | [test/v03-verification.html](../test/v03-verification.html) section 19 |
| 50-token daily irreversibility budget | [budget-manager.js](../js/kernel/budget-manager.js) |
| Chaos injector fires synthetic L2+ previews | [chaos-injector.js](../js/kernel/chaos-injector.js) |

---

## What we still owe

This list exists because being honest about gaps is part of the safety
story.

- Branch-wrap is opt-in by capability author. Not every L2+ capability
  uses it. The pattern is documented; coverage is partial.
- Drift detector ships but doesn't yet have a default prompt set
  in v0.3. It's plumbing for now.
- Red-team is M6 (advisory). M8 will hard-gate self-mod on it.
- Astrion Browser is ~5500 lines and has not been hardware-tested.
  Pre-flash audit caught two silent IPC bugs in 2026-05-09; another
  pass is warranted.

When any of these flips, this document changes with the same commit.
