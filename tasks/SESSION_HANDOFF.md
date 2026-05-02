# Session Handoff — 2026-05-02 Sprints A+B (self-hosted AI end-to-end)

**Sprint A** (first-boot brain picker) and **Sprint B** (RAM gate +
Ollama diagnostics) both shipped this session.
**Today: 2026-05-02 (Saturday).**

**Latest released ISO:** [`astrion-os-0.2.262-amd64.iso`](https://github.com/viraajbindra-a11y/Astrion-OS/releases/download/v0.2.262/astrion-os-0.2.262-amd64.iso)
(1.37 GiB slim — about to bump because slim now bundles Ollama).

**Domain:** `astrion-os.com` — Dad billing.

## What shipped this session

**Sprint B — RAM-aware safety + Ollama diagnostics.** Both pull buttons
in Settings > AI now run through `ramGateAllowsPull(model)`. The gate
estimates the model's size (lookup table for common families, or the
already-pulled actual byte count when known), pulls free RAM via
`/api/system/memory`, and shows a confirm modal when `size + 2 GB
headroom > free RAM` or when either piece is unknown. Cancel aborts;
"Pull anyway" lets the user override. New Diagnostics group renders
service status (alive/active/stopped) + pulled-models summary + free
RAM + free disk + last 30 journalctl lines, with Refresh and Restart
buttons. Restart calls `sudo -n systemctl restart ollama`.

**Sprint A — self-hosted AI on first boot.** Setup wizard grew a new
"Pick your AI brain" step between accent picker and feature tour:

- 5 options — Tiny (`qwen2.5:1.5b` ~1 GB), Standard (`qwen2.5:7b` ~4.7
  GB), Big (`gpt-oss:16b` ~10 GB), Remote (URL prompt for a beefy LAN
  PC), Skip (provider stays auto, falls to mock).
- RAM detection via `/api/system/memory` highlights the right option
  with a `RECOMMENDED` badge; cards that don't fit available RAM get a
  red border + "needs N GB, you have M" warning.
- On Continue with Tiny/Standard/Big: streams `/api/ai/ollama-pull`
  ndjson into an in-pane progress bar; on success auto-advances to
  the tour. On failure shows Try-again / Skip-for-now.
- On Continue with Remote: URL-validates `http(s)://…`, commits
  `nova-ai-provider=ollama` + `nova-ai-ollama-url=<remote>`.
- On Continue with Skip: commits `nova-ai-provider=auto` (so
  ai-service falls back to mock until the user opens Settings > AI).

**Files touched (Sprint B):**
- `server/index.js` — new `GET /api/ai/ollama-status` (per-field soft
  failure: alive probe + systemctl + journalctl + memory + disk) and
  `POST /api/ai/ollama-restart`.
- `js/apps/settings.js` — `MODEL_SIZE_GB` lookup, `confirmRamGate()`
  modal, `ramGateAllowsPull()` helper called by primary AND red-team
  pull buttons; new Diagnostics group with refresh + restart wired.

**Files touched (Sprint A):**
- `js/shell/wizard-ai-brain.js` (new) — picker UI, RAM-recommend,
  ndjson pull streamer, `commitBrainChoice()` writer.
- `js/shell/setup-wizard.js` — `totalSteps` 6 → 7, new `case 4` for
  the brain step, `next()` async-pulls before advancing,
  `commitBrainChoice` in `finish()`, lightweight onChange branch for
  the URL input so typing doesn't wipe focus.
- `server/index.js` — new `POST /api/ai/ollama-start`. Idempotent:
  probes `/api/tags` first (1.5s timeout), falls through to
  `sudo -n systemctl enable --now ollama` only if the probe fails.
  No-op success on macOS dev or any host without systemd.
- `distro/build.sh` — slim mode now installs Ollama (was skipped),
  but only the full build auto-enables the systemd unit. Slim relies
  on the wizard's `/api/ai/ollama-start` call to wake the daemon.
- `tasks/lessons.md` — lessons #171–173 (Sprint A) + #174–175 (Sprint
  B) added.

## Verified ✓ (Sprints A + B)

- **RAM gate** — typed `gpt-oss:16b` (10 GB) into Settings > AI on a
  4 GB-free box; modal showed "~10 GB for 4 GB free", Cancel restored
  the Pull button cleanly, status read "Cancelled."
- **Diagnostics panel** — auto-refreshed on AI tab open; rendered
  "Running (responding on :11434) — 2 models pulled (qwen2.5:1.5b,
  qwen2.5:7b) · RAM unknown · 966.7 GB free disk".



- **Skip path** — fresh wizard → step 4 → click Skip → Continue →
  finish → `localStorage` has `nova-ai-provider=auto`, model unset.
- **Remote path** — pick Remote, fill `http://192.168.1.42:11434` →
  Continue is enabled (URL validated, focus preserved while typing) →
  finish → `provider=ollama, url=<remote>`.
- **Local pull path (real Ollama)** — picked Tiny on macOS dev with
  Ollama running, watched `qwen2.5:1.5b` stream to 100%, advanced to
  tour, finished, then `ollama-stream` round-trip "what is 2+2"
  returned `4` in 49 ms.
- **216/216 v03 verification still green.**
- **18/18 `golden.lock.json` still match** (`node tools/sign-golden.mjs --check`).
- **No new console errors** during the wizard run.

## Acceptance — handoff said:

1. Fresh boot → wizard appears ✓
2. New step "Pick your AI brain" with 5 options ✓
3. RAM detection from `/api/system/memory` highlights recommended ✓
4. On confirm, model pulls with progress (reuses `/api/ai/ollama-pull`) ✓
5. Desktop boots with `provider=ollama, url=localhost:11434, model=chosen` ✓
6. Spotlight "what is 2+2" → AI responds via local model ✓ (49 ms)
7. v03 verification still 216/216 ✓
8. Lesson #171+ captures whatever breaks ✓ (171, 172, 173)

## Unverified ⚠ (still risky)

- **M8.P5 propose path on `gpt-oss:16b`** — same as before. Local
  qwen2.5:7b times out at 30s; remote PC URL still required.
- **Slim ISO end-to-end** — Sprint A's build.sh changes are
  unbuilt. Next slim ISO build will include Ollama + the
  wizard's wake-on-pull. Expected size: 1.37 GiB → ~1.5 GiB
  (Ollama binary is ~80 MB).
- **Surface Pro 6 retest with v0.2.263+ slim** — pending hardware
  free moment.

## Open loops

| Item | Blocker | Unblock |
|---|---|---|
| Real-AI soak gpt-oss:16b on M8.P5 propose | Remote PC URL | When user is on that PC |
| Domain registration (astrion-os.com) | Billing | Dad |
| Slim ISO retest with Sprint A (v0.2.263+) | ISO build trigger | Push commit to main |
| Surface Pro 6 retest | Hardware in use | Any free moment |
| Competitive-watch agent | `/schedule` backend | Retry tomorrow |
| Stripe / entity for $7/mo Pro tier (Oct) | Legal | Dad |

## ⚡ NEXT TASK: Sprint C (post-v1.0) OR pivot

Sprint C from the proposal — LAN share mode (one beefy Astrion
serving Ollama to other hosts via mDNS) — was scoped post-v1.0. With
A+B done, the self-hosted-AI thread is at a clean pause. Real work
candidates for the next sitting:

1. **Real-AI soak on `gpt-oss:16b`** — still gating M8.P5 propose for
   the launch story. Needs the user's remote PC URL + 2-3 hours.
2. **Surface Pro 6 retest with v0.2.263+** — once the Sprint A/B ISO
   builds (this push triggers it), boot on the Surface and run the
   wizard end-to-end on real Linux to validate the slim-Ollama path.
3. **Spotlight Phase 1 hardening pick E** — the next item from
   tasks/sanity-check-2026-05-02.md if user wants polish over feature.
4. **Phase 2 distribution** — landing-page polish, install docs,
   maybe the contributor-onboarding doc since friends have offered to
   help.

User picks; spec lives in `tasks/sanity-check-2026-05-02.md` or
`PLAN.md` for any of these.

## Read order for the new session

1. `tasks/SESSION_HANDOFF.md` (this file)
2. `tasks/sanity-check-2026-05-02.md` (current state)
3. `tasks/self-hosted-ai-proposal-2026-05-02.md` § Sprint C if going
   the LAN-share route
4. `PLAN.md` if you need M-level context
5. `tasks/lessons.md` tail (171–175 are the freshest)

## Persona reminder

- User: 12yo solo founder. Casual + hype buddy tone. Brutally honest
  pushback. Action over deliberation.
- Dad writes the workflow-rule messages.
- The user wants COMMITS, not analysis. Sprints A+B shipped → all good.

## What I'd do first

1. Read this file.
2. `git status` — confirm clean.
3. Ask the user which thread they want next (real-AI soak,
   Surface retest, Phase 2 distribution, or Sprint C).
4. v03 must stay 216/216 across whatever ships.

---

## Older history

The 2026-04-30 → 2026-05-02 strategic pivot handoff is preserved in
git history (commit `dff5491`). The 2026-04-22 → 2026-04-25 demo-prep
sprint is at commit `78cef7f`.
