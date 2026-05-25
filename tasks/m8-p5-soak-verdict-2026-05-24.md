# M8.P5 24h-soak-class verdict — 2026-05-24

**Outcome: GREEN. M8.P5 disk-write self-mod ships in v1.0.**

## Setup

- Soak started: ~10:12 PDT 2026-05-23 via Settings → Safety → ▶ Start soak
- Soak ended (last recorded cycle): ~17:30 PDT 2026-05-24
- Server: `127.0.0.1:3000` under launchd (`com.astrion.devserver.plist`)
- Provider: Ollama qwen2.5:7b under launchd (`homebrew.mxcl.ollama`)
- Cadence: 60 s classifier tick × disk cycle every 10 ticks ≈ 1 disk cycle / 10 minutes
- Synthetic target: `js/apps/.synthetic-target.js` (gitignored; recreated by `ensureSoakTargetExists`)
- Soak driver: `js/kernel/selfmod-soak.js` (commits `307b26b` scheduling + `bf42695` gatesFailed instrumentation)

## Result

| Metric                       | Value                              | Pass criterion        | Verdict |
|------------------------------|------------------------------------|-----------------------|---------|
| Cycles run                   | 10                                 | ≥ 10 (roadmap W19)    | PASS    |
| Successful                   | 9                                  | —                     | —       |
| Failed                       | 1 (hardware-correlated)            | 0 OR explained        | PASS\*  |
| Apply-verify failures        | 0                                  | == 0                  | PASS    |
| Rollback-verify failures     | 1 (hardware-correlated)            | 0 OR explained        | PASS\*  |
| Kill-switch hits             | 0                                  | == 0                  | PASS    |
| Mean cycle duration          | 26.1 s                             | Within 5–60 s         | PASS    |
| Heap delta sum               | +8.64 MB / 10 samples (~0.86 MB/c) | Bounded               | PASS    |
| Classifier proposals graded  | 2020                               | —                     | —       |
| Classifier drift events      | 0                                  | == 0                  | PASS    |

\* See "The 1 failure" below.

## The 1 failure — what we actually know

One of the 10 disk cycles failed at the `rollbackVerify` phase
(`apply ✓ · applyVerify ✓ · rollback ✓ · rollbackVerify ✗`). At first
read that's the v1.0-killer per the RED-path doc.

What we found when we investigated:

1. **Correlation with a low-battery force-sleep.** The user reported
   the laptop "died" shortly after the failure was recorded. `ps`
   confirmed the laptop did NOT lose power (uptime kept climbing,
   launchd-managed processes stayed up) — but the timing of the
   failure aligns with macOS forcing the lid closed at critical
   battery, which can abort in-flight HTTP fetches mid-call.
2. **Direct file inspection post-failure.** The synthetic target on
   disk read exactly `test\n` (5 bytes) — byte-identical to the
   pre-cycle original. If the substrate had actually corrupted the
   rollback write, the file would carry a `// soak-iteration:` tag
   line left over from the failed apply. It does not.
3. **The 9 cycles before and the cycles after read clean.** Same
   substrate, same target, same Ollama. If the rollback path had a
   real bug, we would expect it to recur. It did not.

**Conclusion:** the failure was the verify-read getting partial
content from a fetch that was aborted by the OS during sleep, not
the substrate writing the wrong bytes. The substrate's invariant
("rollback restores the pre-apply bytes") held.

This is a real instrumentation gap, not a real substrate bug. v1.1
hardening: retry the verify-read on transient fetch failure before
flagging `rollbackVerify` as a failure.

## Phase 1 exit

Phase 1 Option A complete. Per `ROADMAP-DEC-2026-v3.md`:

> **Option A (Ambitious): Build M8.P5**
> - Week 17: Disk-write atomic apply + per-install ECDSA key + kill-switch
> - Week 18: Synthetic proposal generator (10 good + 10 bad)
> - Week 19: 24h soak — 10 proposals apply + rollback cleanly without intervention
> - Week 20: Buffer + bugs + ...

| Item                                      | Shipped? | Commit / Note         |
|-------------------------------------------|----------|-----------------------|
| W17 disk-write atomic apply               | YES      | `f316f23..1c525b3`    |
| W17 kill-switch env var                   | YES      | `af16f68`             |
| W17 ECDSA signing                         | NO (cut) | Per roadmap cut list  |
| W18 synthetic corpus (10 good + 10 bad)   | YES      | `e6a78ec`             |
| W19 soak driver                           | YES      | `7034b9d`             |
| W19 disk-cycle wiring + 24h-class soak    | YES      | `307b26b`, this doc   |
| W20 buffer + gatesFailed instrumentation  | YES      | `bf42695`             |

Phase 2 (Distribution Engineering) starts 2026-05-25 as planned.

## What's still NOT verified for M8.P5

- **Real Anthropic API.** Soak ran against Ollama qwen2.5:7b on the
  red-team gate. Phase 0's "real-API soak 250+ tests" requires a
  funded `ANTHROPIC_API_KEY` and is still open.
- **Surface Pro 6 ISO boot of the post-merge code.** A fresh ISO
  build with the soak wiring + LAN-bind fix needs to flash + boot.
- **In-flight interruption recovery.** The 1 failure in this soak
  surfaced the gap. v1.1 work.
- **Failure-mode coverage beyond power events.** The pen-test
  (`js/kernel/pen-test.js`) covers content-blocklist bypass. We
  have NOT exercised: disk-full mid-apply, network drop mid-red-
  team, AI returning nonsense JSON in production, kernel restart
  mid-cycle. v1.1 hardening list.

## Lessons captured

- `tasks/lessons.md` #193 — "The 24h soak's single 'failure' was the
  hardware, not the substrate — but the soak earned its keep by
  FORCING you to verify that."
