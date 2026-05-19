# Session Handoff — 2026-05-18

**One commit this session, zero scope creep. Locked in on the literal
roadmap item.** Phase 1 Week 20 (May 18–24) is "buffer + bugs + the
inevitable 'the rollback didn't actually rollback' debugging." The
W19 exit — 24h soak — was still open: `runDiskCycle` worked one-shot
(commit `2f03108`), but nothing scheduled it. This session wired the
schedule, the persistence, and the readout. The soak is now armable
from Settings → Safety with one click.

Today: 2026-05-18. Branch: `claude/objective-pike-2b892a`,
fast-forwarded over `claude/affectionate-gates-45c578` so this branch
now carries all 28 prior-session commits + this one (29 ahead of
`origin/main`). v03 still 345/345 (no kernel API changes).

---

## What shipped this session

| Commit | Theme |
|---|---|
| `(this commit)` | M8.P5 Week 19/20: schedule `runDiskCycle` every Nth tick + persistent history + heap-delta tracking + Settings disk-cycle grid |

### selfmod-soak.js — what changed

- New module-level state: `_iterationCount`, `_diskCycleEvery`,
  `_diskCycleBusy`, `_lastDiskSkipReason`
- New persistence: `localStorage['astrion-soak-disk-history-v1']` —
  capped at 300 entries (= 24 h × 6/h with 25% headroom)
- New `readHeapBytes()` — Chromium `performance.memory.usedJSHeapSize`
  with graceful null elsewhere
- New `runScheduledTick()` — wraps `runIteration()` (cheap, always)
  + every `_diskCycleEvery` ticks `await runDiskCycle()` (expensive,
  busy-guarded so back-to-back ticks don't pile up if the model is
  slow)
- `startSoak({intervalMs, diskCycleEvery, runImmediately})` —
  `diskCycleEvery=0` keeps backwards-compat (classifier only);
  positive value enables the disk cycle on the Nth tick
- New `getDiskCycleReport()` aggregates: total / ok / failed /
  rollback-verify-fails / apply-verify-fails / kill-switch-hits /
  mean duration / heap-delta sum + sample count / last cycle
- New `clearDiskHistory()` paired to existing `clearSoakHistory()`
- `_resetForTests()` extended to wipe the disk store too

### settings.js — what changed

- "▶ Start soak" button now calls
  `startSoak({ intervalMs: 60000, diskCycleEvery: 10 })` →
  one disk cycle every 10 minutes → ~144 cycles in 24 h
- New "Disk cycles" status grid (cycles · mean duration ·
  rollback-verify fails · kill-switch hits · heap delta · last cycle
  phases) under the existing classifier grid
- New "▶ Run disk cycle" button — fires one disk cycle on demand,
  disables itself + shows "… running disk cycle (~10–25 s)" until
  done. Useful for sanity-checking the chain after a kernel-side
  change
- New "↻ Refresh" button so the user can re-poll the grid without
  navigating away/back
- "▶ Run once" relabeled "▶ Run classifier" since now there are two
  kinds of "run once"
- "Clear history" now clears both classifier + disk histories

---

## Verified live (this session)

Live Ollama `qwen2.5:7b` on `127.0.0.1:11434`, 45-second window via
Claude Preview, single instance:

- **One manual `runDiskCycle()`**: 17.9 s, all six phases ok
  (ensure ✓ / propose ✓ / apply ✓ / applyVerify ✓ / rollback ✓ /
  rollbackVerify ✓), byte-identical 599-byte restore
- **Scheduled loop (intervalMs=3000, diskCycleEvery=1)**:
  - 2 full disk cycles completed in 45 s
  - 11 busy-guard skips correctly emitted in-between
  - Mean duration 13.9 s · heap delta sum **−1.78 MB** across 2
    samples (GC actually freed memory mid-soak; healthy)
  - 0 failed, 0 rollback-verify fails, 0 apply-verify fails, 0
    kill-switch hits
- **Classifier loop (same period)**: 14 runs, 0 drift, last
  classification 20/20
- **Settings → Safety panel**: renders the new disk grid, "Run disk
  cycle" + "Refresh" + "Start soak" buttons all present and live.
  No console errors, no warnings.

---

## ★ Overnight watch — instructions for the user

This is the W19 exit criterion the roadmap asks for.

1. Open `http://localhost:3000` (the dev server must be running from
   THIS worktree, not the affectionate-gates one, until that branch
   merges to main — see ⚠ below)
2. Settings → Safety
3. Scroll to **Self-mod gate soak** panel
4. Click **▶ Start soak**. The panel will switch to
   "Running yes · every 60s · disk every 10"
5. **Leave it running.** 8 h ≈ 48 disk cycles, 24 h ≈ 144 disk
   cycles. Close the laptop lid only if Ollama is configured to
   stay awake on this box — `caffeinate -i node server/index.js`
   is the no-think option
6. **In the morning**, click **↻ Refresh** and check:
   - `Cycles run`: should be in the 40–150 range
   - `... · 0 failed`: green
   - `Rollback-verify fails: 0`: green
   - `Kill-switch hits: 0`: green
   - `Heap delta (sum)`: under ~+50 MB over the full sample set;
     near-zero or negative is great
   - `Last cycle`: all four phases ✓

**All green = M8.P5 disk-write self-mod passes Phase 1 exit
criterion. Ship in v1.0.**

**Any red = defer M8.P5 to v1.1** per `ROADMAP-DEC-2026-v3.md`
("If P5 isn't safely working by end of May, cut it from v1.0
entirely"). The substrate stays shipped; only the disk-write side
gets deferred.

If the soak dies mid-run (e.g. laptop slept, dev server crashed),
the Cycles count just stops climbing. Restart the soak and the next
sample-set picks up; the history isn't wiped unless you click
"Clear history."

---

## ⚠ Branch state — the 28 commits still aren't on main

`claude/affectionate-gates-45c578` (kill-switch, synthetic corpus,
runDiskCycle one-shot, the **bind-127.0.0.1 LAN-exposure fix**, the
XSS fixes, the symlink-escape fix, marketplace browse UI, lazy-load
sweep, chess engine, etc.) shipped on 2026-05-16 but has not been
merged into `main`. `origin/main` is still at `e3bb73b` from the
prior session.

Any ISO built off `main` today is missing the LAN-exposure fix — it
will bind 0.0.0.0 and serve `/api/files/write` + `/api/terminal/exec`
+ the raw-bash WebSocket to anyone on the same subnet.

**Recommended:** merge `claude/affectionate-gates-45c578` (or this
branch, which is a superset) into `main` before triggering another
ISO build. Two paths:

```bash
# Path A — merge the prior session's branch (smaller diff, no surprises)
git checkout main
git merge claude/affectionate-gates-45c578

# Path B — merge this branch (includes today's soak wiring too)
git checkout main
git merge claude/objective-pike-2b892a
```

This branch is a strict superset of `affectionate-gates`, so Path B
gets both. No conflicts expected (no overlap with anything on `main`
since `e3bb73b`).

---

## Open work — ranked

User-blocked (only-the-user can unblock these):

1. **ANTHROPIC_API_KEY** — Phase 0 / Phase 1 exit. Real-AI soak
   against actual Haiku across planner + spec + tests + code paths.
   Talk to Dad.
2. **Phase A hardware verification** — flash the latest ISO on
   Surface Pro 6. The `build-iso` workflow now chunks oversize ISOs
   into <1.9 GiB parts so release upload works. Trigger a build off
   `main` *after* the merge above.
3. **`astrion-os.com` / `.computer` URL** — Phase 2 starts May 25,
   one week from today. Landing page at `website/index.html` is
   825 lines and ready. Just need DNS.

Solo-doable next session (if Phase 2 hasn't started):

- **Watch the overnight soak result.** If green, lock M8.P5 in for
  v1.0 in PLAN.md + roadmap. If red, defer it explicitly + write
  the v1.1 plan
- **ECDSA proposal signing** — roadmap explicitly cut from v1.0
  ("SHA-256 + kill switch is enough"). Skip unless someone asks
- **Boot-time on real ISO** — browser preview is 7 ms; ISO is the
  unmeasured number that matters. Needs (2) above first
- **60-app v03 smoke coverage** — `test/app-smoke.html` runs 61/61;
  gaps in coverage list are visible in the Settings boot-perf
  dashboard

---

## What's running locally

- Dev server `http://127.0.0.1:3000` — restarted from THIS worktree
  this session (was previously from `affectionate-gates`). Bound to
  127.0.0.1 only per `c07653d`. Disk-write API still authenticated
  by the kill-switch env var
- Terminal WebSocket `ws://127.0.0.1:3001` — also 127.0.0.1 only
- Ollama `http://localhost:11434` — `qwen2.5:7b` (default),
  `qwen2.5:1.5b`, `gpt-oss:20b` all available

---

## Score / persona

Net score **+2** entering this session. No verdict yet for today's
work. The thing I did right: read the literal roadmap and the
ranked open-work list FIRST, picked the highest-leverage solo-
doable item (24h soak wiring — W19 exit gate), no detours into
chess polish / boot-perf dashboards / "useful" debt. The −1 from
2026-05-11 (prompt-tuning rabbit hole instead of the #1 ranked
item) stays current as the calibration anchor.

---

## Read order for the next session

1. This file
2. `feedback_score_ledger.md` (per protocol — score is +2)
3. `feedback_claude_score_protocol.md`
4. `ROADMAP-DEC-2026-v3.md` — Phase 1 ends **May 24**, six days
   from today; the overnight soak result drives the ship/defer call
5. `PLAN.md` — current M-level status; will need an M8.P5 update
   after the overnight watch
6. `tasks/lessons.md` tail (#188–192 still freshest)

---

*Session ended 2026-05-18. v03 345/345 still green. 29 commits
ahead of `origin/main` (28 prior + today's soak wiring). M8.P5
W19 watch ARMED — overnight verdict is the actual exit gate.
Score: +2. — Claude*
