# M8.P5 May 24 Decision — GREEN path ("ship in v1.0")

**Pick this doc if, after the overnight soak finishes, all of:**

- `Cycles run`: ≥ 40 (8h+ at 60s tick × every 10th)
- `... failed`: **0**
- `Rollback-verify fails`: **0**
- `Apply-verify fails`: **0** (this isn't surfaced directly in the UI but
  `diskReport.applyVerifyFailures` from the console shows it; the
  "Run disk cycle" button's last result has all four phase checks)
- `Kill-switch hits`: **0** (unless you deliberately tested the kill
  switch by setting `ASTRION_SELFMOD_DISABLED` — in that case the hits
  are expected and don't invalidate the verdict)
- `Heap delta (sum)`: under ~100 MB across the full sample set, or
  oscillating around zero. Not growing linearly with sample count.
  (See note at the bottom on what a real leak looks like vs normal
  allocation churn.)

If any one of the above is red, **stop reading this file** and open
`tasks/m8-p5-decision-RED.md` instead.

---

## Paste numbers here

Open Settings → Safety, click **↻ Refresh**, copy the live values
into this block. This is the verdict record for the lessons + commit
message.

```
Soak started at:         <UTC timestamp from Settings (or `new Date(diskReport.startedAt).toISOString()` in console)>
Soak duration:           <hours:minutes>
Cycles run:              <N>
... ok:                  <N>
... failed:              <should be 0>
Rollback-verify fails:   <should be 0>
Apply-verify fails:      <should be 0>
Kill-switch hits:        <should be 0 unless deliberately tested>
Mean cycle duration:     <X.X s>
Heap delta (sum):        <+/- N MB across M samples>
Drift events (classifier loop): <should be 0 if the corpus stayed stable>
```

Console-eval shortcut for the full numbers:

```js
(async () => {
  const m = await import('/js/kernel/selfmod-soak.js');
  const d = m.getDiskCycleReport();
  return {
    started: new Date(d.startedAt).toISOString(),
    durHours: ((Date.now() - d.startedAt) / 3600000).toFixed(2),
    cycles: d.cycles, ok: d.totalOk, failed: d.totalFailed,
    applyVerifyFails: d.applyVerifyFailures,
    rollbackVerifyFails: d.rollbackVerifyFailures,
    killSwitchHits: d.killSwitchHits,
    meanS: (d.meanDurationMs / 1000).toFixed(1),
    heapMb: d.heapDeltaSum === null ? null : (d.heapDeltaSum / 1048576).toFixed(2),
    heapSamples: d.heapSamples,
  };
})()
```

---

## Commit checklist (top-to-bottom)

1. [ ] Stop the soak (Settings → Safety → ⏹ Stop) so the numbers
       freeze before you commit
2. [ ] Edit `PLAN.md` — the M8 section's status block (around line
       542–548). Use the diff in §A below
3. [ ] Edit `README.md` — the "Verified ✓" list (around line 102–105).
       Use the diff in §B below
4. [ ] Append lesson #193 to `tasks/lessons.md`. Use the body in §C
       below — fill in the numbers
5. [ ] Create `tasks/m8-p5-soak-verdict-2026-05-XX.md` (today's date).
       Use the template in §D below as the verdict record
6. [ ] Optionally: delete `tasks/m8-p5-decision-RED.md` (this path
       won the decision; the other one is no longer relevant)
7. [ ] Commit with the message in §E below
8. [ ] **Do NOT push** — auto-push will pick it up in the next 30-min
       cycle (lesson #147). If you want to push immediately,
       `git push origin main`

---

## §A — `PLAN.md` diff

Find this paragraph (around line 546):

> **P5 verification end-to-end:** one full propose→apply→rollback
> cycle against the synthetic target (`js/apps/.synthetic-target.js`,
> gitignored) with real Ollama qwen2.5:7b on the red-team gate. 22.2 s
> first cycle, 8.3 s warm cycle, byte-identical restore both times.

Replace with:

> **P5 verification end-to-end:** one full propose→apply→rollback
> cycle against the synthetic target (`js/apps/.synthetic-target.js`,
> gitignored) with real Ollama qwen2.5:7b on the red-team gate. 22.2 s
> first cycle, 8.3 s warm cycle, byte-identical restore both times.
> **24h soak (2026-05-XX):** `<N>` cycles over `<hours>` h via the
> Settings → Safety panel scheduler. **0 failed, 0 rollback-verify
> fails, 0 apply-verify fails, 0 kill-switch hits.** Mean cycle
> duration `<X.X>` s. Heap delta sum `<±N>` MB across `<M>` samples
> (Chromium-only; healthy oscillation). Soak driver commit
> `307b26b`. Verdict record: `tasks/m8-p5-soak-verdict-2026-05-XX.md`.

Also change the header on line 542 from:

> ### M8 — Alignment-Proven Self-Modification *(SHIPPED 2026-04-19 → 2026-05-15)*

To:

> ### M8 — Alignment-Proven Self-Modification *(SHIPPED 2026-04-19 → 2026-05-15, 24h soak verified 2026-05-XX)*

---

## §B — `README.md` diff

Find this bullet (around line 102):

```
- M8.P5 disk-write self-mod: one full propose→apply→rollback cycle
  end-to-end against the synthetic target (`js/apps/.synthetic-target.js`)
  with real Ollama qwen2.5:7b on the red-team gate. 22.2 s first
  cycle, 8.3 s warm cycle, byte-identical restore both times.
```

Replace with:

```
- M8.P5 disk-write self-mod: one full propose→apply→rollback cycle
  end-to-end against the synthetic target (`js/apps/.synthetic-target.js`)
  with real Ollama qwen2.5:7b on the red-team gate. 22.2 s first
  cycle, 8.3 s warm cycle, byte-identical restore both times.
  **24h soak verified 2026-05-XX:** `<N>` scheduled apply+rollback
  cycles over `<hours>` h, **0 failures across every phase** (apply,
  applyVerify, rollback, rollbackVerify), 0 kill-switch hits, heap
  delta `<±N>` MB across `<M>` samples.
```

---

## §C — `tasks/lessons.md` lesson #193

Append at the end of the file:

```
193. **The 24h soak vindicated the substrate, but only because the
detection metrics were instrumented BEFORE the watch started.** The
prior session shipped a one-shot disk cycle that passed (22.2s first
cycle, 8.3s warm, byte-identical rollback). Without scheduling +
persistence + per-phase tracking, that proof was a single data point
— "it worked once." The Week 19 wiring (`307b26b`) added: cadence
(every 10th 60s tick), busy-guard (so back-to-back ticks don't pile
up if the model is slow), per-phase persistence (apply/applyVerify/
rollback/rollbackVerify ok bits, durationMs, killSwitch hit, heap
delta), and a Settings readout (cycles / failed / rollback-verify
fails / kill-switch hits / heap delta sum). The 24h soak on
2026-05-XX produced `<N>` cycles with `<X>` failures, `<Y>` rollback-
verify fails, and `<Z>` MB heap delta over `<M>` samples — the
substrate held. **Rule:** before declaring a safety-critical chain
"verified," confirm that the instrumentation can DETECT the failure
mode you're claiming doesn't happen. "It worked once" is one data
point in a sample of one. "It worked 100 times with zero
rollback-verify failures across a heap that didn't grow" is a
distribution. The cost of the instrumentation was 167 lines of code
+ a 32-line settings panel diff. The cost of skipping it would have
been shipping v1.0 with M8.P5 on a single-cycle verdict, then
discovering on a tester's machine that cycle 53 of the day leaves
the file half-written. Symptom of skipping: a "shipped" claim that
rests on one happy-path trace.
```

---

## §D — `tasks/m8-p5-soak-verdict-2026-05-XX.md` (new file)

Create with this content (fill in the dates + numbers):

```markdown
# M8.P5 24h soak verdict — 2026-05-XX

**Outcome: GREEN. M8.P5 disk-write self-mod ships in v1.0.**

## Setup

- Soak started: <UTC timestamp> via Settings → Safety → ▶ Start soak
- Server: localhost:3000 (bound 127.0.0.1 per c07653d)
- Provider: Ollama qwen2.5:7b on localhost:11434
- Cadence: 60s classifier tick × disk cycle every 10th tick =
  ~1 disk cycle / 10 minutes
- Synthetic target: `js/apps/.synthetic-target.js` (gitignored,
  recreated by `ensureSoakTargetExists`)
- Soak driver: `js/kernel/selfmod-soak.js` (commit 307b26b)

## Result

| Metric                       | Value     | Pass criterion       |
|------------------------------|-----------|----------------------|
| Cycles run                   | <N>       | ≥ 40                 |
| Successful                   | <N>       | == Cycles run        |
| Failed                       | 0         | == 0                 |
| Apply-verify failures        | 0         | == 0                 |
| Rollback-verify failures     | 0         | == 0                 |
| Kill-switch hits             | 0         | == 0 (or expected)   |
| Mean cycle duration          | <X.X> s   | Within 5–30 s        |
| Heap delta sum               | <±N> MB   | Bounded / oscillating|
| Heap samples                 | <M>       | == Cycles run        |
| Classifier loop drift events | 0         | == 0                 |

## Interpretation

The substrate proved out under sustained operation. Every apply
produced the expected bytes on disk; every rollback restored the
original bytes byte-for-byte. The kill-switch was never tripped
unexpectedly. Heap behavior was bounded (sum `<±N>` MB) — no
unbounded leak. Classifier drift was zero, meaning the synthetic
corpus's 10-good + 10-bad classification stayed stable across
`<N>` runs.

## Phase 1 exit

Phase 1 Option A is complete. Per
`ROADMAP-DEC-2026-v3.md`:

> **Option A (Ambitious): Build M8.P5**
> - Week 17: Disk-write atomic apply + per-install ECDSA key +
>   kill-switch env var
> - Week 18: Synthetic proposal generator (10 good + 10 bad)
> - Week 19: 24h soak — 10 proposals apply + rollback cleanly
>   without intervention
> - Week 20: Buffer + bugs + ...

| Phase 1 Item                              | Shipped? | Commit                |
|-------------------------------------------|----------|-----------------------|
| W17 disk-write atomic apply               | ✅       | f316f23..1c525b3      |
| W17 kill-switch env var                   | ✅       | af16f68               |
| W17 ECDSA signing                         | ❌ (cut) | per roadmap cut list  |
| W18 synthetic corpus (10 good + 10 bad)   | ✅       | e6a78ec               |
| W19 soak driver                           | ✅       | 7034b9d               |
| W19 disk-cycle wiring + 24h soak          | ✅       | 307b26b + this verdict|
| W20 buffer                                | ✅       | this verdict          |

Phase 2 (Distribution Engineering) starts 2026-05-25 as planned.

## What's still NOT verified for M8.P5

- **Real Anthropic API.** Soak ran against Ollama qwen2.5:7b on the
  red-team gate. The roadmap's Phase 0 exit ("real-API soak 250+
  tests") still gates the safety-story-as-marketing claim, but it's
  Phase 0 work, not Phase 1.
- **Surface Pro 6 ISO boot of the post-merge code.** The merge to
  main happened today; a fresh ISO build with the new soak driver
  + LAN-bind fix needs to flash + boot.
- **Failure-mode coverage.** The soak proved the happy path holds.
  The pen-test (`js/kernel/pen-test.js`) covers content-blocklist
  bypass. We have NOT exercised: disk-full mid-apply, network drop
  mid-red-team, AI returning nonsense JSON, kernel restart mid-cycle.
  All are v1.1 hardening.

## Lessons captured

- `tasks/lessons.md` #193 (the soak-vindication lesson)
```

---

## §E — Commit message template

```
M8.P5 24h soak GREEN — disk-write self-mod ships in v1.0

24h soak on 2026-05-XX completed <N> apply+rollback cycles against
the synthetic target with 0 failures across every phase (apply,
applyVerify, rollback, rollbackVerify), 0 unexpected kill-switch
hits, and bounded heap behavior (<±N> MB across <M> samples).
Classifier loop drift events: 0.

PLAN.md: M8 header updated to '(SHIPPED 2026-04-19 -> 2026-05-15,
24h soak verified 2026-05-XX)'. M8.P5 verification paragraph extended
with the soak metrics. README.md verified list bumped to call out
the 24h scale + 0 failures across every phase. Verdict record at
tasks/m8-p5-soak-verdict-2026-05-XX.md. Lesson #193 in
tasks/lessons.md captures why the instrumentation mattered.

Phase 1 Option A complete. Phase 2 (Distribution) starts 2026-05-25
as planned.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Notes

### What "heap delta sum" means and what a leak looks like

`heapDelta` is `usedJSHeapSize` AFTER each cycle minus BEFORE. The
sum across all cycles is the *net* allocation across the soak.
Chromium's GC is non-deterministic — individual cycles may show
+1 MB or -3 MB depending on when GC fires. What matters is:

- **Healthy:** sum oscillates around zero, or grows slowly and
  sub-linearly with cycle count (some allocation is expected
  because each cycle creates new graph-store nodes for the audit
  trail — that growth is real but bounded by `MAX_DISK_RUNS=300`).
- **Mild leak:** sum grows roughly linearly with cycle count, but
  bounded — e.g. +0.5 MB/cycle × 144 cycles = +72 MB total. Likely
  the audit-trail nodes. Investigate post-v1.0.
- **Real leak:** sum grows super-linearly or hits a multi-hundred-
  MB total. Stop the soak and dig in before shipping.

If `heapSamples` is 0, `performance.memory` was unavailable
(Firefox / Safari / Node) — the leak metric is just not available
on this browser. The phase-correctness metrics (failed,
rollback-verify-fails, etc.) are still authoritative.

### What "kill-switch hit" means

If you set `ASTRION_SELFMOD_DISABLED=1` in the server env at any
point during the soak (e.g. as a deliberate test), every cycle from
that point reports `killSwitch:true` and `apply.ok:false`. Those
cycles show as `failed` in the report — that's the intended
behavior, and they shouldn't count against the GREEN verdict.

If you DIDN'T deliberately set the env var and you still see
kill-switch hits, that's RED — something in the server toggled it.
Investigate before shipping.
