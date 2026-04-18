# Session Handoff: M0→M3 Audit + Full M4 Ship + M5.P1 + M5.P2

**Date:** 2026-04-17 → 2026-04-18
**Branch:** main (16 new commits ahead of origin — not pushed)
**Starting point:** 80 apps, commit `f8a47fa` (timer.js leak fix)
**Ending point:** commit `ad527d8` (M5.P2 operation interceptor)
**Verification:** **140/140 tests** in `test/v03-verification.html` (no API key needed)

---

## What This Session Was

User direct order at the start: "everything up to M3 needs to be done … no claude keys stopping me from doing anything." Persona reset to fully serious / no sugarcoating (memory file updated). Then: "work till context gone."

The session did three substantively different chunks of work:

1. **Audit** — discovered M3 was substantively shipped already (lesson #99). PLAN.md status had drifted.
2. **Fix + verify** — closed the actual M3 gaps + wrote the offline verification suite (44/44 → 85/85 over the session).
3. **M4** — built spec-from-intent (P1), tests-from-spec (P2), and sandboxed test runner (P3) end-to-end, all with stubbed-AI verification.

---

## Commits Landed (16, not pushed)

```
ad527d8 M5.P2: operation interceptor (L2+ preview gate generalized)
2cbaae8 Update NEXT_SESSION_PROMPT for M5.P1 + 131-test verification
d461e6d Docs: M5.P1 marked complete; lessons 121-123; bump verification to 131
2b29bfd M5.P1: branching storage layer (transaction-log copy-on-write)
267b524 Docs: M4 fully complete (P1+P2+P3+P3.b+P4); lessons 115-120
f414fee M4.P4: provenance + sandbox→dock promotion gate
c8e48e6 M4.P3.b: code-from-tests iteration loop with sandbox load step
c1569ca Docs: M4.P1/P2/P3 marked complete; lessons 109-114; new handoff prompt
0dbbe83 M4.P3: sandboxed test runner via iframe with allow-scripts only
e34f8c4 M4.P2: tests-from-spec generator with shape-stable per-criterion suite
4d8ac82 M4.P1: spec generator (intent -> structured spec) + freeze gate
aa09740 Docs: mark M0.P3, M0.P4, M3 complete; add lessons 99-108 + next-session prompt
51463ce Migrate 8 native confirm/prompt call sites to custom dialog
22eb154 M3: race-safe brain detection via askWithMeta + plan.meta; safe math parser
ea23740 M3.P1: bundle Ollama in ISO + Settings Pull Model UI
b7de3ed M0.P3 + M3.P1 server: dynamic per-app CSS, Ollama pull, v0.3 offline suite
```

---

## What Shipped (high level)

### M0.P3 — Web Apps in Native Mode ✅
`/app/:appId` route in `server/index.js` strips shell chrome (no menubar/dock/spotlight CSS). Dynamic per-app CSS via `existsSync`. Path traversal blocked by `[a-z0-9-]+` whitelist returning 400.

### M0.P4 — Install + Persistence ✅ (already shipped, verified)
`nova-first-boot.sh` + `nmcli` auto-reconnect + `ntpdate` + DNS fallback + IP-geolocation timezone all wired in `distro/build.sh`'s `.xinitrc` heredoc.

### M3 — Dual-Process Runtime ✅ (race-safe rewrite this session)
- ai-service.js: `askWithMeta(prompt) → {reply, meta}` with full brain/confidence/provider/model/escalated/responseTimeMs
- intent-planner.js: switched from `ask` to `askWithMeta`, propagates `meta` in plan result
- intent-executor.js: reads `plan.meta.brain` for calibration (race-safe per-call); falls back to module variable for legacy paths
- `Function()` eval in mock math handler replaced with hand-rolled recursive-descent parser (handles `+ - * / ^ ** ()`, right-assoc exponent)

### M3.P1 — Ollama in ISO ✅
`distro/build.sh` installs Ollama via `curl https://ollama.com/install.sh | sh` in chroot, enables `ollama.service`. Model NOT bundled (size). Settings > AI > "Download Model" Pull button streams ndjson progress from `/api/ai/ollama-pull` (server proxy of Ollama's `/api/pull`).

### Dialog migration ✅
`js/lib/dialog.js` gained `showConfirm(message, container, destructive=false)`. Migrated 8 native `confirm()`/`prompt()` calls in finder, youtube, music, text-editor.

### M4.P1 — Spec-from-Intent ✅ (new)
- `js/kernel/spec-generator.js`: `generateSpec(intent) → {goal, acceptance_criteria[], non_goals[], ux_notes, open_questions[], status:'draft'}`
- Schema validator caps criteria at 12, rejects empty fields
- `spec` graph node lifecycle: draft → frozen (user approval) or rejected
- Capabilities: `spec.generate` (L0), `spec.freeze` (L2 user-approval gate)
- Helpers: `getSpec`, `getFrozenSpecByIntent`, `listRecentSpecs`

### M4.P2 — Tests-from-Spec ✅ (new)
- `js/kernel/test-generator.js`: `generateTests(specId)` requires FROZEN spec
- Each test has `{title, setup, act, assert, criterionIndex}` (JS code strings)
- Validator: one test per criterion, code blob < 400 chars, blocks `import|require|fetch|eval|Function` tokens
- Suite stored as `test-suite` graph node with `covers` edge to spec
- Capability: `tests.generate` (L0). Helpers: `getTestSuite`, `getSuitesForSpec`, `recordSuiteRun`

### M4.P3 — Sandboxed Test Runner ✅ (new)
- `js/kernel/test-runner.js`: iframe with `sandbox="allow-scripts"` (NOT `allow-same-origin`) → unique origin
- Bootstrap exposes a tiny matcher: `.toBe / .toEqual / .toBeTruthy / .toBeFalsy / .toContain / .toBeGreaterThan / .toBeLessThan`
- `runSingleTest(test)` and `runSuite(suiteId, { sharedCode? })`. Sandbox-side `'load'` message accepts shared code once before tests run. Per-test 5s + suite 30s timeouts
- Capability: `tests.run` (L1 SANDBOX, FREE)
- Verification confirms sandbox blocks `localStorage` access from inside

### M4.P3.b — Code-from-Tests Iteration Loop ✅ (new)
- `js/kernel/code-generator.js`: `generateCode(suiteId, { maxAttempts })` reads suite + spec, asks model for code, validates schema + tokens + syntax, runs via `runSuite({sharedCode})`, iterates with the failure list echoed back into the next prompt. Default 3 attempts, max 5
- Validator rejects forbidden tokens (`import|require|fetch|XMLHttpRequest|WebSocket|eval|Function|setTimeout|setInterval|importScripts|document|window.parent|window.top`), oversize blobs (>8000), and syntactically invalid JS
- `storeGeneratedCode` persists `'generated-code'` graph node with per-attempt history; `'implements'` edge to suite
- Capability: `code.generate` (L1 SANDBOX, FREE)

### M4.P4 — Provenance + App Promotion ✅ (new)
- `js/kernel/app-promoter.js`: `bundleApp(codeId)` REFUSES unless code.status==='ok' AND every test passes AND suite exists AND spec is frozen. Builds `'generated-app'` graph node with full provenance (intent, model+brain per phase, attempts, test counts)
- Three provenance edges: `app -[derives_from]-> spec`, `app -[passed_tests]-> suite`, `app -[runs_code]-> code`
- Lifecycle: `sandboxed` → (user L2) → `docked` → (user L2) → `archived`
- Capabilities: `app.bundle` (L0), `app.promote` (L2 user-approval gate), `app.archive` (L2). Until M6 ships the red-team agent, the user IS the L2 unlock

### M5.P1 — Branching Storage Layer ✅ (new)
- `js/kernel/branch-manager.js`: transaction-log copy-on-write. Branch = `'branch'` graph node with `props.pendingMutations[]`. Lifecycle: `open` → `committed` | `discarded`
- `createBranch(opts)` returns `{id, status, record, createdAt}` where `record` is pre-bound for ergonomic mutation recording
- `mergeBranch` applies mutations in order; stops at first failure with `{failedAt, error}` so caller can fix and re-merge
- `diffBranch` returns counts per kind + describe lines for UI rendering; `onBranch(opts, fn)` helper auto-discards on throw
- Capabilities: `branch.create` (L0), `branch.merge` (L2 user-approval), `branch.discard` (L1)

### M5.P2 — Operation Interceptor ✅ (new)
- `js/kernel/operation-interceptor.js`: `interceptedExecute(cap, args, opts)` wraps any capability call. L0/L1 pass through; L2+ open the gate
- Event contract: `interception:preview {id, cap, args, recordedAt, timeoutMs}` → subscribers reply with `interception:confirm {id}` or `interception:abort {id, reason}`
- 60s default auto-abort timeout. Max 32 pending interceptions to bound memory
- Per-call opaque ids prevent confirmation races when multiple L2+ ops are in flight
- `opts.skipInterception` bypass for narrow headless cases. Generalises the M2 Agent Core L2+ plan-preview gate to any caller

### v0.3 Offline Verification Suite ✅
`test/v03-verification.html` — 140 tests across 14 sections. Refresh to re-run. No API key needed (stubbed `aiService.askWithMeta`).

---

## What's NOT Done (Open Loops)

### Real-API Verification
- Real Anthropic API E2E with funded `ANTHROPIC_API_KEY`. Stub verification proves wiring; real API proves Claude Haiku's prompt + JSON tolerance.
- Real Ollama E2E with `ollama serve` + `qwen2.5:7b` pulled.
- Native ISO E2E with all 80 apps in GTK windows. Last ISO build was prior to this session's `distro/build.sh` changes — needs a fresh build to include the Ollama install block.

### Bigger work (next)
- **M4 dock surface**: bundle/promote write graph nodes, but there's no actual dock-icon plumbing that reads `'generated-app'` nodes with status='docked' and shows them in the dock UI. Spotlight already supports launching arbitrary capabilities; the missing piece is a passive scan + register-as-app on the renderer side.
- **M5.P2.b** — Wire the existing capability provider execute() calls through `interceptedExecute` so L2+ ops actually hit the gate at runtime. Currently the interceptor exists but no caller uses it yet; flipping intent-executor's single-shot path to `interceptedExecute(cap, args)` is a 5-line change that makes the safety story REAL across the OS.
- **M5.P3/P4** — Undo/Rewind UI (timeline view of branches) + External-Effect Detection (mark git push / API call / file system writes outside Astrion's roots as point-of-no-return).
- **M6 (Socratic Loop + Red-Team Agent)** — second AI critiques every L2+ plan. Also retrofits the M4.P4 `app.promote` gate to require red-team signoff.
- More apps past 80, marketplace prep, ISO installer UX.

### Smaller open loops
- Spotlight Socratic UI for spec approval (currently spec.freeze is callable but no nice UI flow). Reuse the existing L2+ preview gate pattern in `spotlight.js`.
- safeMathEval doesn't handle scientific notation (1e6) or unary `+(`. Add tests + extend if users hit it.

---

## Architecture Notes (Stable)

- **All 80 apps** register in `js/apps/*.js` via `processManager.register()`.
- **boot.js** has THREE registration blocks (spotlight popup ~167, native mode ~227, normal ~335). All three must mirror each other.
- **Native shell registry**: `distro/nova-renderer/nova-shell.c` `app_registry[]` near line 156.
- **Brain tag flow**: `aiService.askWithMeta` → planner returns `plan.meta` → executor reads `plan.meta.brain` → `calibration-tracker.recordSample`.
- **M4 chain**: `spec-generator.generateSpec` → `storeSpec` → user `freezeSpec` → `test-generator.generateTests` → `storeTestSuite` → `test-runner.runSuite` → `recordSuiteRun`.
- **Ollama install in ISO**: `distro/build.sh` after Waydroid block. Tolerates network failure with `|| echo "..."`.
- **Verification entry point**: `http://localhost:3000/test/v03-verification.html` — refresh to re-run (no API key).

---

## File-by-File (uncommitted? no — all committed)

Everything from this session is in the 8 commits above. Clean working tree. To start fresh:

```
git status  # should be clean
git log --oneline -10  # see the 8 + prior commits
node server/index.js
# open http://localhost:3000/test/v03-verification.html
```

Next session prompt is in [tasks/NEXT_SESSION_PROMPT.md](tasks/NEXT_SESSION_PROMPT.md).
