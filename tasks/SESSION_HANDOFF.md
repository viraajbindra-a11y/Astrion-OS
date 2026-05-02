# Session Handoff — 2026-05-02 Sprint A (self-hosted AI brain picker)

**Sprint A is done.** First-boot wizard now picks an AI brain.
**Today: 2026-05-02 (still Saturday, same session as the strategic pivot).**

**Latest released ISO:** [`astrion-os-0.2.262-amd64.iso`](https://github.com/viraajbindra-a11y/Astrion-OS/releases/download/v0.2.262/astrion-os-0.2.262-amd64.iso)
(1.37 GiB slim — about to bump because slim now bundles Ollama).

**Domain:** `astrion-os.com` — Dad billing.

## What shipped this session

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

**Files touched:**
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
- `tasks/lessons.md` — lessons #171–173 added.

## Verified ✓ (Sprint A)

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

## ⚡ NEXT TASK: Sprint B — RAM-aware safety + Ollama diagnostics

Spec: `tasks/self-hosted-ai-proposal-2026-05-02.md` § Sprint B.

**Mission:** Settings > AI > Pull Model still has no RAM gate (a
user with 4 GB free can hit "Pull" on a 10 GB model and OOM-kill
the box). And there's no in-shell view of Ollama's status/logs/
pulled models — when something breaks, the user has nowhere to
look.

**Files to touch:**
- `js/apps/settings.js` — wrap the existing `#ai-pull-btn` click in
  a RAM check. If `(model_size + 2 GB headroom) > free_ram`, show a
  warning modal: "This model needs N GB; you have M. Pulling will
  swap hard. Continue?" with explicit confirm.
- `server/index.js` — new `GET /api/ai/ollama-status` returning
  `{ active, lastLogs, models, freeRamMb, freeDiskMb }`. Reuse
  `/api/system/memory` + `/api/ai/ollama-tags` + a journalctl tail.
- `js/apps/settings.js` — new "Diagnostics" subsection under AI
  with a refresh button + Restart Ollama button (calls
  `sudo -n systemctl restart ollama`).

**Out of scope (Sprint C, post-v1.0):**
- LAN share mode (one beefy Astrion serving Ollama to other hosts
  via mDNS) — defer until after v1.0.

## Read order for the new session

1. `tasks/SESSION_HANDOFF.md` (this file)
2. `tasks/self-hosted-ai-proposal-2026-05-02.md` § Sprint B
3. `tasks/sanity-check-2026-05-02.md` (current state)
4. `PLAN.md` if you need M-level context
5. `tasks/lessons.md` tail (171–173 are the freshest)

## Persona reminder

- User: 12yo solo founder. Casual + hype buddy tone. Brutally honest
  pushback. Action over deliberation.
- Dad writes the workflow-rule messages.
- The user wants COMMITS, not analysis. Sprint B ships → all good.

## What I'd do first

1. Read this file + Sprint B section.
2. `git status` — confirm clean.
3. `node server/index.js` + open `localhost:3000`.
4. Open Settings > AI to find the `#ai-pull-btn` handler.
5. Sketch the modal, add `/api/ai/ollama-status`, add Diagnostics.
6. v03 must stay 216/216.

GO BUILD SPRINT B.

---

## Older history

The 2026-04-30 → 2026-05-02 strategic pivot handoff is preserved in
git history (commit `dff5491`). The 2026-04-22 → 2026-04-25 demo-prep
sprint is at commit `78cef7f`.
