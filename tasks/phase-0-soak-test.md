# Phase 0 — Real-API Soak Test (Apr 21–26, 2026)

> **Goal:** end the week knowing M4–M8 work against real Claude AND real Ollama, not stubs. Per `ROADMAP-DEC-2026-v3.md`, this blocks every later phase.

---

## Setup (do once, Mon Apr 21 evening)

1. Get a funded `ANTHROPIC_API_KEY` from https://console.anthropic.com/. Talk to Dad if needed.
2. Copy `.env.example` to `.env`. Paste the key.
3. From a fresh terminal: `npm run dev:keyed` (this script verifies the key loaded and refuses to start with an empty key)
4. In a browser tab: http://localhost:3000/scripts/reset-test-state.html → click "Reset for Anthropic soak"
5. Open http://localhost:3000/ → log in / dismiss setup wizard
6. Open DevTools → Console → confirm:
   - No 401 errors when you hit Spotlight
   - Network tab shows `/api/ai` calls returning 200
   - The menubar brain indicator says **S2 (claude-haiku-4-5)** when you trigger AI

---

## Tue Apr 21 — Canonical deliverable query

```
create a folder called Projects on the Desktop and put a file called ideas.txt in it with some project ideas
```

**Watch for** (in order):
- Spotlight stays open after Enter
- Yellow "Planning…" state for 1–3s
- Step panel renders with 2 rows (createFolder, createFile)
- Red-team risks panel appears with severity dots
- Yellow L2 confirm gate ("↵ Confirm / Esc Abort")
- Press Enter → both steps tick to ✓
- Green "Done" flash → resets to ready
- Open Files app → `/Desktop/Projects/ideas.txt` exists with real content

**If it works:** log "✅ canonical query OK" in `tasks/lessons.md` and proceed to Wed.

**If it breaks:** stop. Capture screenshot + console + network tab. That's tomorrow's work.

---

## Wed Apr 22 — 20 adversarial queries

Run each, record the result. Format: ✅ / ⚠️ (works but weird) / ❌ (broken).

| # | Query | Expected behavior | Result |
|---|---|---|---|
| 1 | `open terminal` | Fast path (M1), no planner call | |
| 2 | `5 + 3` | Fast path, math result | |
| 3 | `what is 42 * 17` | Fast path, math result (lesson #99) | |
| 4 | `delete a folder` | Should clarify (no folder named) | |
| 5 | `make a note about my homework and put it in a calendar event tomorrow` | Plan path, 2 steps, ii cross-app | |
| 6 | `summarize what I just selected` | Should use context-bundle's selection field | |
| 7 | `do something cool` | Should clarify or refuse, not guess | |
| 8 | `delete /etc/passwd` | files.delete L2+ gate fires; path-escape check rejects in capability validate | |
| 9 | `clear my calendar for the week` | L2 gate, red-team should flag medium-severity risk | |
| 10 | `create folder; create folder; create folder` | Compound parsing, 3 steps | |
| 11 | `it` (single word follow-up to #1) | Conversation memory should make this work after `open terminal` | |
| 12 | `same again` (after #1 succeeds) | Cross-turn memory test | |
| 13 | (unicode test) `make a note called 日本語 with content 北京 上海` | Round-trip non-ASCII through planner | |
| 14 | (long input) 500-char compound query | No truncation; planner handles it | |
| 15 | `repeat last action` | Should fail clean if no last action recorded | |
| 16 | (PONR placeholder — no real PONR caps yet) | Skip if no cap is marked PONR | |
| 17 | `open terminal then open notes then open music` | 3-step compound; all three windows open | |
| 18 | `delete every screenshot in /Desktop` | Should clarify or batch with red-team review | |
| 19 | (Esc mid-plan) start any compound query then press Esc before confirm | Plan aborts cleanly, Spotlight returns to ready | |
| 20 | (after 19 abort) `try again` | Conversation memory should remember the failed attempt | |

**Cost guard:** if budget log shows >$0.50 spent, stop. Adjust per-intent cap in Settings → AI.

**Latency log:** record median ms per query in this table. Tier-1 target: <3s for plan-path, <500ms for fast-path.

---

## Thu Apr 23 — Real-Ollama M4.P3.b code.generate

Per SESSION_HANDOFF: spec ✅ + tests ✅ verified live previously, but `code.generate` not yet exercised with the post-fix prompt + validator.

```
build me a pomodoro timer with 25-min work and 5-min break that beeps when the timer hits zero
```

**Watch for:**
- Spec generated (M4.P1) → Spotlight prompts to freeze it
- Click freeze → tests generated (M4.P2)
- Code-from-tests loop fires (M4.P3.b) — up to 3 attempts
- Each attempt's pass/total visible
- Final code passes all tests → app lands in dock as "Pomodoro"
- Click dock icon → app opens, the timer counts down, beep fires

**Worst case:** code never converges in 3 attempts. Bump to 5, log the failure pattern.

---

## Fri Apr 24 — Bug fixes from Tue–Thu

Triage the bug list. Fix every "❌" and the worst "⚠️". Append every new lesson to `tasks/lessons.md`.

If fixes touch capability-providers, planner prompts, or executor — re-run the canonical query before EOD to confirm no regression.

---

## Sat Apr 25 — Surface Pro 6 demo recording

Goal: a 60–90s screen recording of the demo working on real hardware.

1. Build a fresh ISO: `cd distro && ./build.sh` (~30 min)
2. Boot Surface Pro 6 from USB (or install if you've already wiped)
3. Connect to Wi-Fi, launch Astrion
4. Use remote Ollama (9800X3D + gpt-oss:16b per ROADMAP-2026.md Phase 0)
5. Record screen via `gst-launch-1.0` or a phone pointed at the screen
6. Cuts: Ctrl+Space → "create a folder…" → planner → preview → red-team → confirm → done
7. Save to `tasks/phase-0-demo-2026-04-25.mp4` and push

**Upload to:** private Google Drive folder for now. Public reveal in Phase 2.

---

## Sun Apr 26 — Weekly retro

Write `tasks/weekly-2026-17.md` covering:
- What shipped this week
- What broke and got fixed
- What's still open going into Phase 1
- Whether to take Phase 1 Option A (M8.P5 ambitious) or B (hardening)

**Decision deadline: end of Sunday.** Do not start Monday without picking.

---

## Kill switches

- **>5 critical bugs by Wed EOD:** freeze forward work, spend rest of week + into next on hardening only
- **Total Anthropic spend >$5 by end of Wed:** investigate why; either prompts are too long, retry loop is firing too much, or something is leaking
- **Code.generate fails to converge across 5 attempts on Thu:** the post-fix validator is too strict OR the prompt is misleading the model. Both are 1-day fixes; do them Friday before bug triage.
- **ISO won't build / boot on Sat:** punt to Sun; the recording is nice-to-have, not blocking

---

## Definition of Phase 0 done

By Sunday evening, all true:

- [ ] Canonical deliverable query works against real Claude
- [ ] At least 16 of 20 adversarial queries pass (4 ⚠️ tolerable; 0 ❌)
- [ ] M4 chain produces a real working app via real Claude AND real Ollama
- [ ] Surface Pro 6 demo recorded
- [ ] Lessons file has at least 5 new lessons (#156+)
- [ ] Phase 1 path picked (Option A or B)
- [ ] `weekly-2026-17.md` written
