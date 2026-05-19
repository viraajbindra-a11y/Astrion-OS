# M8.P5 May 24 Decision — RED path ("defer to v1.1")

**Pick this doc if, after the overnight soak finishes, any one of:**

- `... failed` > 0 (some cycles didn't complete cleanly)
- `Rollback-verify fails` > 0 (rollback didn't restore byte-identical
  content — this is the v1.0-killer; the user CAN'T trust the
  rollback)
- `Apply-verify fails` > 0 (apply wrote different bytes than expected)
- `Kill-switch hits` > 0 *and* you didn't deliberately set
  `ASTRION_SELFMOD_DISABLED` (something in the server toggled it)
- `Heap delta (sum)` is growing super-linearly with cycle count, or
  hits multi-hundred MB after a full day's worth of cycles (~144)
- Soak crashed / hung / required intervention to keep running

If all of the above are clean, **stop reading this file** and open
`tasks/m8-p5-decision-GREEN.md` instead.

This file is the "honest defer" recipe. Per
`ROADMAP-DEC-2026-v3.md`:

> 3. **M8.P5 is the highest-risk path on the roadmap.** Disk-write
>    self-mod can brick the OS. v2 allocates 4 weeks. **If P5 isn't
>    safely working by end of May, cut it from v1.0 entirely** and
>    ship M8 as "all 5 gates exist; disk-write deferred to v1.1."
>    Better to ship without P5 than to ship with a P5 that bricks
>    1 in 100 users.

The substrate stays shipped. Only the disk-write side (`applyUpgrade`
+ `rollbackUpgrade` actually mutating source files) defers. The
5-gate sandbox, the synthetic corpus, the soak driver, the
kill-switch — all of those stay in v1.0 as the v1.1 foundation.

---

## Paste numbers here

```
Soak started at:         <UTC timestamp>
Soak duration:           <hours:minutes>
Cycles run:              <N>
... ok:                  <X>
... failed:              <Y — should be 0, was Y>
Rollback-verify fails:   <Y — should be 0, was Y>
Apply-verify fails:      <Y — should be 0, was Y>
Kill-switch hits:        <Y — should be 0 unless deliberately tested>
Mean cycle duration:     <X.X s>
Heap delta (sum):        <+/- N MB across M samples>
Drift events (classifier loop): <N>

PRIMARY FAILURE MODE: <write the specific thing — e.g. "rollback
left tag-line in target after 53 cycles", "apply wrote 0 bytes on
cycle 87", "heap grew +312 MB over 100 cycles", "soak hung at
iteration 41">

WHEN IT FIRST APPEARED: <iteration N at timestamp T>

FAILURE STABLE OR FLAKY: <every cycle after X / 1 in N cycles /
once and never again>
```

Console-eval shortcut for the diagnostic dump:

```js
(async () => {
  const m = await import('/js/kernel/selfmod-soak.js');
  const d = m.getDiskCycleReport();
  const last5 = (JSON.parse(localStorage.getItem('astrion-soak-disk-history-v1') || '{"cycles":[]}').cycles || []).slice(-5);
  return {
    summary: {
      cycles: d.cycles, ok: d.totalOk, failed: d.totalFailed,
      applyVerifyFails: d.applyVerifyFailures,
      rollbackVerifyFails: d.rollbackVerifyFailures,
      killSwitchHits: d.killSwitchHits,
      meanS: (d.meanDurationMs / 1000).toFixed(1),
      heapMb: d.heapDeltaSum === null ? null : (d.heapDeltaSum / 1048576).toFixed(2),
    },
    last5Phases: last5.map(c => ({
      at: new Date(c.at).toISOString(),
      iter: c.iteration,
      ok: c.ok,
      apply: c.applyOk, applyV: c.applyVerifyOk,
      rollback: c.rollbackOk, rollbackV: c.rollbackVerifyOk,
      ks: c.killSwitch,
      dur: (c.durationMs/1000).toFixed(1) + 's',
      heapDeltaMb: c.heapDelta === null ? null : (c.heapDelta / 1048576).toFixed(2),
      reason: c.reason,
    })),
  };
})()
```

The `last5Phases` dump is what you paste into the verdict record so
the failure mode is documented even if you can't immediately
reproduce it.

---

## Commit checklist

1. [ ] Stop the soak (Settings → Safety → ⏹ Stop) so the numbers freeze
2. [ ] **Don't** clear history yet — the failure entries are evidence
3. [ ] Edit `PLAN.md` — M8 section header + status block. Use §A below
4. [ ] Edit `README.md` — the "Verified ✓" list. Use §B below
5. [ ] Scan `docs/SAFETY.md` for any line that asserts disk-write
       self-mod is shipped. Use §C below
6. [ ] Append lesson #193 to `tasks/lessons.md`. Use the body in §D
7. [ ] Create `tasks/m8-p5-soak-verdict-2026-05-XX.md` (today's date).
       Use the template in §E
8. [ ] Create `tasks/m8-p5-v1.1-plan.md` for the eventual retry.
       Use the template in §F
9. [ ] Optionally: delete `tasks/m8-p5-decision-GREEN.md` (this path
       won the decision; the other one is no longer relevant)
10. [ ] Commit with §G's message
11. [ ] **Do NOT push** — auto-push will pick it up in 30 min, or
       `git push origin main` if you want it on the remote now

---

## §A — `PLAN.md` diff

### Header (around line 542)

Find:

> ### M8 — Alignment-Proven Self-Modification *(SHIPPED 2026-04-19 → 2026-05-15)*

Replace with:

> ### M8 — Alignment-Proven Self-Modification *(SUBSTRATE SHIPPED 2026-04-19 → 2026-05-15; P5 disk-write DEFERRED to v1.1 after 2026-05-XX soak)*

### Status block (around line 544)

Find:

> **Status:** P1 (golden integrity check), P2 (value-lock + selfmod-sandbox stubs), P3 (5-gate apply with red-team signoff via M8.P3.b model diversity), P4 (drift detector) all shipped 2026-04. P5 (disk-write side) shipped 2026-05-11 → 2026-05-15: kill-switch env var (`af16f68`) blocks /api/files/write at the server boundary; applyUpgrade walks all 6 gates + writes via /api/files/write when allowed; rollbackUpgrade restores the prior content the same way. Substrate commits: `f316f23` `8a36a82` `498656d` `20e2e55` `1c525b3`. P5 commits: `af16f68` (kill-switch) `e6a78ec` (synthetic corpus + Node-builtin regex fix) `7034b9d` (soak driver + drift detection) `8649a7f` (Settings safety panel) `2f03108` (real apply+rollback disk cycle). Symlink escape on /api/files/write closed by `de95c79` (parent-realpath check).

Replace with:

> **Status:** P1 (golden integrity check), P2 (value-lock + selfmod-sandbox stubs), P3 (5-gate apply with red-team signoff via M8.P3.b model diversity), P4 (drift detector) all shipped 2026-04 and remain in v1.0. P5 (disk-write side) was wired 2026-05-11 → 2026-05-15 but **deferred to v1.1** after the 2026-05-XX 24h soak surfaced `<failure mode>`. The kill-switch (`af16f68`), 5-gate sandbox, synthetic corpus (`e6a78ec`), soak driver (`7034b9d` + `307b26b`), Settings safety panel (`8649a7f`), and Server symlink escape defense (`de95c79`) stay shipped as the foundation for the v1.1 retry. The disk-write side itself — `applyUpgrade` and `rollbackUpgrade` actually mutating source files — is reachable only via direct console invocation in v1.0 and is NOT wired into any user-facing surface. **The Spotlight "upgrade yourself" command path and the Settings self-upgrade history panel are LIVE in v1.0 only as a manual proposal+rollback developer surface; users cannot accidentally trigger an apply.** See `tasks/m8-p5-soak-verdict-2026-05-XX.md` for the verdict trace and `tasks/m8-p5-v1.1-plan.md` for the retry plan.

### Verification block (around line 546)

Find:

> **P5 verification end-to-end:** one full propose→apply→rollback cycle against the synthetic target (`js/apps/.synthetic-target.js`, gitignored) with real Ollama qwen2.5:7b on the red-team gate. 22.2 s first cycle, 8.3 s warm cycle, byte-identical restore both times. Kill-switch: server returns HTTP 403 with `killSwitch: true` when `ASTRION_SELFMOD_DISABLED` is set; no file created on disk. Tested with curl in both env-set and env-unset modes.

Replace with:

> **P5 verification status:** the one-shot propose→apply→rollback cycle works (22.2 s first cycle, 8.3 s warm, byte-identical restore). The 24h soak surfaced `<failure mode>` — see verdict record. The substrate's correctness in *isolation* was proven; what was NOT proven is its safety under sustained operation, which is what the soak was designed to test, which is exactly why we're deferring. Kill-switch curl tests still pass; that defense remains intact.

### Still-deferred line (around line 548)

Find:

> **Still-deferred (cut from v1.0 per ROADMAP-DEC-2026-v3.md "What gets cut" list):** Per-install ECDSA signing of proposals. Roadmap explicitly states "SHA-256 + kill switch is enough." Asymmetric signing is v1.1.

Replace with:

> **Deferred to v1.1:** (a) M8.P5 disk-write self-mod, per the 2026-05-XX soak verdict. (b) Per-install ECDSA signing of proposals, per the roadmap's original cut list. The v1.1 plan in `tasks/m8-p5-v1.1-plan.md` reopens both together.

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
- M8.P5 substrate (5-gate sandbox, kill-switch, synthetic corpus,
  soak driver): all shipped and locked. **The disk-write side
  (`applyUpgrade` actually mutating source files) is deferred to
  v1.1** after the 2026-05-XX 24h soak surfaced <failure mode>.
  v1.0 ships the safety substrate; v1.1 turns on the write.
  See `tasks/m8-p5-soak-verdict-2026-05-XX.md` and
  `tasks/m8-p5-v1.1-plan.md`.
```

---

## §C — `docs/SAFETY.md` scan

Run this grep first:

```bash
grep -nE "M8\.P5|disk.write|self.modif|self-modif" docs/SAFETY.md
```

For each hit, check whether the surrounding sentence asserts that
disk-write is shipped in v1.0. The current SAFETY.md (lines around
100, 168, 291, 315) talks about M6 (advisory) vs M8 (hard-gate). The
hard-gate framing is fine — the 5-gate is hard. What you need to
edit is any sentence that implies "and this leads to a write that
mutates source." If you find such a sentence, qualify it:

> "M8 hard-gates the proposal evaluation. **In v1.0 the disk-write
>  side is deferred; the gates run, the proposal is approved, but
>  nothing is written to disk except via direct developer console
>  invocation.** See PLAN.md M8 section."

If no such sentence exists, leave SAFETY.md alone — the doc already
correctly describes the gates as advisory-vs-hard at the M6/M8
boundary without claiming the write itself is enabled.

---

## §D — `tasks/lessons.md` lesson #193

Append at the end of the file:

```
193. **Defer when defer is honest — "safety substrate shipped, write
deferred" is a stronger v1.0 story than "M8.P5 shipped with caveats."**
The 24h soak on 2026-05-XX surfaced `<failure mode>` after `<N>`
cycles. The substrate held: gates fire, kill-switch holds, corpus
classification is stable, the proposal/audit trail is correct. What
the soak revealed is that the actual disk-write path under sustained
operation `<one-sentence summary of failure>`. Per roadmap: "Better
to ship without P5 than to ship with a P5 that bricks 1 in 100
users." The cost of deferring: a footnote in the README and one
column in the M8 section header. The cost of NOT deferring: a tester
flashes v1.0 on a real laptop, the soak repro hits their setup,
their machine half-applies a self-mod and never rolls back. The
substrate's reputation is destroyed in one bug report. **Rule:**
when a soak surfaces ANY of {apply-verify fail, rollback-verify
fail, unexplained kill-switch hit, unbounded memory growth}, the
threshold for "safely working" is not met. Defer, document, ship
the foundation. The retry plan goes in `tasks/m8-p5-v1.1-plan.md`
so future-you knows what shape the v1.1 work has. Corollary: the
soak instrumentation (commit `307b26b`) was the cheapest insurance
shipped this entire roadmap — 167 LOC + 32 LOC settings panel,
caught a v1.0-killer.
```

---

## §E — `tasks/m8-p5-soak-verdict-2026-05-XX.md` (new file)

```markdown
# M8.P5 24h soak verdict — 2026-05-XX

**Outcome: RED. M8.P5 disk-write self-mod DEFERRED to v1.1.**

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

| Metric                       | Value     | Pass criterion       | Pass/Fail |
|------------------------------|-----------|----------------------|-----------|
| Cycles run                   | <N>       | ≥ 40                 | <P/F>     |
| Successful                   | <X>       | == Cycles run        | <P/F>     |
| Failed                       | <Y>       | == 0                 | <P/F>     |
| Apply-verify failures        | <Y>       | == 0                 | <P/F>     |
| Rollback-verify failures     | <Y>       | == 0                 | <P/F>     |
| Kill-switch hits             | <Y>       | == 0 (or expected)   | <P/F>     |
| Mean cycle duration          | <X.X> s   | Within 5–30 s        | <P/F>     |
| Heap delta sum               | <±N> MB   | Bounded / oscillating| <P/F>     |
| Classifier loop drift events | <N>       | == 0                 | <P/F>     |

## Primary failure mode

<Detailed description — what failed, when, was it stable or flaky.
Paste the last5Phases dump from the diagnostic console-eval at the
top of m8-p5-decision-RED.md. If the failure was reproducible
post-soak, document the repro steps.>

## Hypotheses

<2-3 hypotheses about the root cause, ranked by likelihood. Examples:
- "After cycle 53 the synthetic target file got into a state where
  the next apply wrote to the wrong offset" — investigate file-write
  atomicity
- "The red-team model started returning `review` instead of `proceed`
  on the same proposal it had been passing" — investigate model
  drift OR the typed-confirm override path
- "Server's writable region map didn't include the target after N
  writes" — investigate the realpath check

These are starting points for v1.1 work, not commitments.>

## Decision

Per `ROADMAP-DEC-2026-v3.md`: "If P5 isn't safely working by end of
May, cut it from v1.0 entirely and ship M8 as 'all 5 gates exist;
disk-write deferred to v1.1.' Better to ship without P5 than to
ship with a P5 that bricks 1 in 100 users."

**M8.P5 disk-write is deferred to v1.1.** The v1.0 cut:
- M8.P1 (golden integrity) — STAYS
- M8.P2 (value-lock + selfmod-sandbox) — STAYS
- M8.P3 (5-gate apply) — STAYS but `applyUpgrade` is dev-console only
- M8.P3.b (red-team model diversity) — STAYS
- M8.P4 (drift detector) — STAYS
- M8.P5 (disk-write) — DEFERRED to v1.1
- ECDSA signing — DEFERRED to v1.1 (already on cut list)

The substrate is real. The write turns on in v1.1.

## Phase 1 exit

Phase 1 ends 2026-05-24 with Option A scoped down: the substrate
shipped, the write didn't. Phase 2 (Distribution Engineering) starts
2026-05-25 on schedule. The marketing line for v1.0 stops at "the
safety substrate is real" — no overclaim about the write.
```

---

## §F — `tasks/m8-p5-v1.1-plan.md` (new file)

```markdown
# M8.P5 — v1.1 retry plan

Captured 2026-05-XX after the v1.0 24h soak returned RED. Use this
file as the source-of-truth for what shape the retry has, so v1.1
work picks up cleanly instead of starting from scratch.

## What's already shipped (don't rebuild)

- `js/kernel/selfmod-sandbox.js` — proposeSelfMod + applyProposal +
  the 6-gate walker
- `js/kernel/self-upgrader.js` — proposeUpgrade + applyUpgrade +
  rollbackUpgrade + listUpgradeHistory + content blocklist
- `js/kernel/synthetic-proposals.js` — 10 good + 10 bad corpus
- `js/kernel/selfmod-soak.js` — soak driver with disk-cycle wiring
  (commit 307b26b)
- `js/apps/settings.js` — Safety panel with the soak readout
- `server/index.js` — /api/files/write with symlink-escape defense
  and the kill-switch env var

## What the v1.0 soak revealed

<Paste from m8-p5-soak-verdict-2026-05-XX.md "Primary failure mode"
+ "Hypotheses">

## v1.1 phases (proposed)

**v1.1.P1 — Reproduce the v1.0 failure deterministically.** Before
fixing anything, build a unit test that hits the failure mode in
under 5 minutes. Without a fast repro, the bug-fix cycle is the same
24h loop and we don't ship.

**v1.1.P2 — Root-cause the primary failure mode.** Walk the
hypotheses, prove one, fix it. Document in lessons.

**v1.1.P3 — Re-soak.** Same harness, 24h, expect 0 failures across
the failure mode that originally tripped + a smaller set (≥1
randomized test of each of the other failure modes — disk-full,
network-drop, AI-nonsense, kernel-restart).

**v1.1.P4 — Per-install ECDSA signing.** Originally cut from v1.0;
v1.1 reopens. Generate a keypair on first boot, sign proposals at
propose time, verify at apply time. The substrate already has the
proposal node + the apply gate; this adds one gate (sig-check) to
the walker.

**v1.1.P5 — Re-enable user-facing surface.** The Spotlight "upgrade
yourself" path + the Settings "Apply" button currently no-op or
warn in v1.0. v1.1 wires them through, gated on the same 6+1 gates.

## What does NOT need to change

- The 5 gates themselves (golden-integrity, value-lock,
  red-team-signoff, user-typed-confirm, rollback-plan, content-
  blocklist) all work. Don't rebuild.
- The kill-switch. Keep.
- The synthetic corpus. Keep, possibly extend.
- The soak driver's cadence + busy-guard + persistence. Keep.

## Timeline guess

Best case: 2 weeks (1 week to root-cause + fix, 1 week to re-soak +
ECDSA + surface). Realistic: 4 weeks given v1.0 maintenance overhead.

v1.1 target: not before 2027-Q1. The v1.0 launch (2026-12-21) needs
all attention through end of year.
```

---

## §G — Commit message template

```
M8.P5 24h soak RED — defer disk-write to v1.1

24h soak on 2026-05-XX surfaced <primary failure mode> after <N>
cycles. Per ROADMAP-DEC-2026-v3.md: 'If P5 isn't safely working by
end of May, cut it from v1.0 entirely and ship M8 as "all 5 gates
exist; disk-write deferred to v1.1." Better to ship without P5 than
to ship with a P5 that bricks 1 in 100 users.'

PLAN.md: M8 header walks back from '(SHIPPED ...)' to '(SUBSTRATE
SHIPPED ...; P5 disk-write DEFERRED to v1.1 after 2026-05-XX soak)'.
Status block clarifies which pieces stay vs defer. Verification
block flags "what was proven vs what wasn't."

README.md verified list replaces the M8.P5 disk-write claim with
"substrate shipped, disk-write deferred."

docs/SAFETY.md scanned for overclaims; <found / not found> any
sentence that implied the write itself was enabled.

Lessons.md #193: the "defer when defer is honest" lesson, captures
why this isn't a failure of the substrate, it's the substrate doing
its job (the soak instrumentation was the cheapest insurance shipped
this roadmap).

Verdict record at tasks/m8-p5-soak-verdict-2026-05-XX.md.
v1.1 retry plan at tasks/m8-p5-v1.1-plan.md.

The 5-gate sandbox, kill-switch, synthetic corpus, soak driver,
and Settings panel all stay in v1.0 as the v1.1 foundation. The
disk-write side itself is reachable only via direct developer
console in v1.0 and is NOT wired into any user-facing surface.

Phase 1 Option A exit downgraded: substrate shipped, write deferred.
Phase 2 (Distribution) starts 2026-05-25 on schedule with the
marketing line "the safety substrate is real" — no overclaim.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Notes

### Why no middle path

You might be tempted to ship M8.P5 with caveats — "works mostly,"
"in beta," "behind a flag." Don't. The reason the soak exists is
that disk-write self-mod can brick a tester's machine, and a
caveat-shipped M8.P5 is the worst of both worlds: users who turn
it on get the failure mode, users who don't see nothing of value,
and either way the safety story you sell is undermined by the
caveat.

If you've spent the night staring at the numbers and you feel
genuinely uncertain whether GREEN or RED applies — that's RED.
GREEN is "obviously clean." Anything else is RED.

### What this doesn't change

The 28+1 commits already merged to `main` STAY. The substrate's
correctness in isolation was proven, the documentation reflects
that. We're not ripping anything out; we're walking back ONE claim
and capturing the failure mode so v1.1 picks up cleanly.

The bind-127.0.0.1 fix, the XSS fixes, the symlink-escape, the
marketplace browse UI, the lazy-load sweep, the chess engine, the
file-system.rename collision check — all stay. They have nothing to
do with M8.P5.
