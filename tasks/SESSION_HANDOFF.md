# Session Handoff — 2026-04-30 → 2026-05-02 (post-demo strategic pivot)

**Sunday 2026-04-26 demo was CANCELLED** (not failed). Lesson #169.
**Today: 2026-05-02.** Saturday. v1.0 ships Dec 21, 2026 — 33 calendar
weeks / ~24 productive weeks remaining.

**Latest released ISO:** [`astrion-os-0.2.262-amd64.iso`](https://github.com/viraajbindra-a11y/Astrion-OS/releases/download/v0.2.262/astrion-os-0.2.262-amd64.iso)
(1.37 GiB, slim, SHA `0003923d3ebb862e03b5394fd06afda53ed2980849b68e4bb3e85d5ab8855b52`,
commit `1cb879f`, lockfile-fix included).

**Domain decided: `astrion-os.com`** — Dad handles billing.

## What shipped this session

**Strategic pivot:** Phase 2 distribution pulled forward 3 weeks (per
v3 roadmap was May 25; started May 2). Phase 1 hardening compresses
to 2 weeks instead of 4. Calendar net unchanged; effort redistributed.

**Code:**
- Spotlight `Function()` injection killed — new `js/lib/safe-math.js`
  with hardened recursive-descent parser. Music-audit debt closed
  3 weeks late. (`b01bb8f`)
- Spotlight `?` help index categorized into 5 groups + empty-state
  hint pointing at `?` for discoverability. (`bd48cdd`)
- Landing page rewritten to lead with the safety triple, drops the
  contested "AI-native OS" lead claim. M8.P5 self-mod showcase + vs-
  the-field comparison table + v0.2.262 download. Auto-deployed via
  GH Pages. (`0f79cdb`, domain swap `270eaad`)

**Docs:**
- `tasks/competitive-2026-05-02.md` — landscape map. The "AI-native
  OS" category contested by Brain Tech (shipped Apr 24 in Japan),
  OpenClaw (140k★), MS Copilot+, Apple Intelligence, Anthropic
  Cowork, VAST Data, AIOS. Astrion's true moat: shipping safety
  triple + open + free + boots from USB. Lead claim is "the AI-
  native OS whose safety story is actually true."
- `tasks/sanity-check-2026-05-02.md` — brutal audit. Verified:
  216/216, golden lock 18/18, 76 apps register clean, ISO boots
  through UEFI. Unverified: gpt-oss:16b on M8.P5 propose path
  (highest demo risk). False alarm corrected: `safe-storage.js`
  globally patches Storage.prototype so all "unguarded localStorage"
  worries were already mitigated. Lesson #166.
- `tasks/self-hosted-ai-proposal-2026-05-02.md` — **THE NEXT BUILD.**
  Astrion shouldn't need a remote PC. Substrate already there
  (Ollama bundled, Settings has pull UX). Gap is a first-boot AI
  brain picker step in setup wizard. Sprint A spec inside.
- `tasks/weekly-2026-18.md` — week 18 retro.

**Lessons added: #166–#170**
- 166 — audit-the-audit; check existing fix infrastructure first
- 167 — "AI-native OS" no longer blue sky; differentiate on safety
- 168 — Edit-tool escape mismatch; use Python sed for surgical edits
- 169 — cancelled demo ≠ failed demo; different lesson
- 170 — help indexes need categories past ~10 entries

## Verified ✓ (today)

- 216/216 v03 verification green
- Golden lock 18/18 match (`node tools/sign-golden.mjs --check`)
- 76 apps register cleanly
- 170 lessons documented
- Skill manifest 20/20 files exist
- Spotlight calculator works after the safe-math swap (`42 * 17 = 714`)
- Spotlight `?` shows 5 categories, 17 commands
- Empty-state Spotlight shows "Type ? to see all commands" hint
- Landing page hero renders with new claim, no console errors

## Unverified ⚠ (still risky)

- **M8.P5 propose path on `gpt-oss:16b`** — local qwen2.5:7b timed out
  >30s last test. Headline feature for v1.0 launch. Needs user's
  remote PC URL + 2-3 hours.
- M4 chain (spec→tests→code→app) on real frontier model.
- Hardware compatibility beyond Surface Pro 6.

## Hardware testers in pipeline

| Device | Status | When |
|---|---|---|
| Surface Pro 6 | ✓ verified base | (existing) |
| Chromebook (friend) | committed | when received |
| AMD Lenovo (user-funded) | committed | when ordered |

3/5 of v3 roadmap Phase 4 hardware matrix.

## Open loops

| Item | Blocker | Unblock |
|---|---|---|
| Real-AI soak gpt-oss:16b on M8.P5 propose | Remote PC URL | When user is on that PC |
| Domain registration (astrion-os.com) | Billing (12yo founder) | Dad's call |
| Surface Pro 6 v0.2.262 retest | Hardware in use | Any future free moment |
| Competitive-watch agent | `/schedule` backend was down | Retry tomorrow |
| Stripe / entity for $7/mo Pro tier (Oct) | Legal | Dad conversation |

## ⚡ THE NEXT TASK: Sprint A — Self-hosted AI brain picker

Spec: `tasks/self-hosted-ai-proposal-2026-05-02.md`

**Mission:** Astrion already bundles Ollama (`distro/build.sh:215`).
The setup wizard should ask which AI brain you want at first boot,
RAM-check to recommend a size, pull the model with the existing
ndjson progress UI, default to localhost:11434.

**Files to touch:**
- `js/shell/setup-wizard.js` — add new step `step-ai-brain` between
  accent picker and ready
- New `js/shell/wizard-ai-brain.js` — the picker UI + pull logic
- `js/kernel/ai-service.js` — set `nova-ai-provider='ollama'` +
  `nova-ai-ollama-model=<chosen>` after wizard
- `server/index.js` — confirm `/api/system/memory` exists
  (`grep -n "/api/system/memory" server/index.js`); the agent reports
  said it does — verify before adding
- `distro/build.sh` — slim ISO should install Ollama but NOT enable
  systemd by default (user opts in via wizard); current behavior
  skips Ollama entirely in slim per `ASTRION_SLIM=1`

**5 options in the picker:**
- **Tiny** — `phi3:3.8b-mini` or `qwen2.5:1.5b` (~1.5 GB) — for low-RAM
- **Standard** — `qwen2.5:7b` (~4.7 GB) — recommended default
- **Big** — `gpt-oss:16b` or current frontier (~10 GB) — for 16GB+ RAM
- **Remote** — URL prompt for "I have a beefy PC on the LAN"
- **None** — skip; provider stays auto, falls to mock

**Acceptance:**
1. Fresh boot → wizard appears
2. New step "Pick your AI brain" with the 5 options above
3. RAM detection from `/api/system/memory` highlights recommended option
4. On confirm, model pulls with progress (reuse `/api/ai/ollama-pull`)
5. Desktop boots with provider=ollama, URL=localhost:11434, model=chosen
6. Type "what is 2+2" in Spotlight → AI responds via local model
7. v03 verification still 216/216
8. Lesson #171+ captures whatever breaks

**Constraints / rails:**
- Don't touch files in `golden.lock.json` (intent-executor, capability-
  api, self-upgrader, etc.). M8-locked. If you must, re-run
  `node tools/sign-golden.mjs` after.
- Don't add new apps (CI moratorium via `.github/workflows/moratorium-
  check.yml`).
- Don't break v03 (216 tests).
- Use existing `/api/ai/ollama-pull` ndjson endpoint, don't rebuild.
- `safe-storage.js` already wraps `Storage.prototype` globally —
  `localStorage.setItem(...)` is safe everywhere, don't add try/catch
  (lesson #166).
- Use existing `js/lib/safe-math.js`, don't reintroduce `Function(...)`.

**Out of scope (defer):**
- LAN-share mode (Astrion as Ollama server for other Astrion installs)
  — proposal says post-v1.0
- RAM-aware safety modal in Settings > Pull Model — Sprint B
- Diagnostics panel (journalctl in browser) — Sprint B

**When done:**
1. Commit + push (auto-deploys to GH Pages; auto-builds ISO if you
   touched `distro/**`).
2. Update `PLAN.md` only if M3.P1 status changes.
3. Lesson #171+ in `tasks/lessons.md`.
4. Overwrite this `tasks/SESSION_HANDOFF.md` with what shipped + what's
   next.

## Read order for the new session

1. `tasks/SESSION_HANDOFF.md` (this file)
2. `tasks/self-hosted-ai-proposal-2026-05-02.md` (Sprint A spec)
3. `tasks/sanity-check-2026-05-02.md` (current state)
4. `tasks/competitive-2026-05-02.md` (positioning)
5. `PLAN.md` if you need M-level context
6. `ROADMAP-DEC-2026-v3.md` if you need calendar context
7. `tasks/lessons.md` tail (lessons #160-#170 are recent)

## Persona reminder

- User: 12yo solo founder. Casual + hype buddy tone. Brutally honest
  pushback when right. Action over deliberation.
- Dad writes the workflow-rule messages. Don't take dad's tone as the
  user's tone.
- The user wants COMMITS, not analysis. Sprint A ships → all good.

## What I'd do first

1. Read this file + the proposal.
2. `git status` — confirm clean.
3. `node server/index.js` + `npm run dev` (or `node server/index.js`).
4. Open `http://localhost:3000` in preview, dismiss login.
5. `grep -n "/api/system/memory" server/index.js` — find existing
   endpoint or note absence.
6. Read `js/shell/setup-wizard.js` to find the seam between accent
   picker and ready step.
7. Sketch the wizard step in `js/shell/wizard-ai-brain.js` standalone,
   integrate after.
8. Test in preview before committing.
9. Single coherent commit per acceptance criterion. Don't batch.

GO BUILD SPRINT A.

---

## Older history

The 2026-04-22 → 2026-04-25 demo-prep sprint handoff is preserved in
git history (commit `78cef7f`). The pre-2026-04-22 handoff is at
`SESSION_HANDOFF.md` in the repo root.
