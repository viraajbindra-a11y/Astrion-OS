# Session Handoff — read this first in a new Claude session

> **Last updated:** 2026-04-11 by the outgoing session (post Agent Core Sprint).
> **Purpose:** Everything a fresh Claude session needs to pick up Astrion OS work without asking "what's going on?" questions.

---

## 🚨 Read order for a fresh session

1. **This file** (you're here) — high-level orientation
2. `PLAN.md` — full milestone roadmap (M0 → M8+)
3. `docs/architecture/hypergraph.md` — M2 design doc, the next thing to build
4. `tasks/lessons.md` — 52 lessons learned so far (grep this before making design decisions)
5. `tasks/todo.md` — current task checklist
6. `tasks/contributions.md` — friend contributor log

---

## 👤 Who you're working with

- **Viraaj Singh Bindra** — 12 years old, solo dev building Astrion OS from scratch
- **Parul** — Viraaj's mom, owns the Mac (`/Users/parul/`). Not the dev.
- **Viraaj's dad** writes the workflow rule messages (inversion thinking, plan mode, lessons.md pattern)
- **Team of 4 non-coding friends:**
  - **Koa** — bug hunter + tester
  - **Naren** — hype person + designer
  - **Lauren** — writer + UX reviewer (also called "reviewer for Lorne ideas" — typo, means "ideas reviewer")
  - **Jian** — ideas person + namer

## 🎭 Persona rules (CRITICAL — don't act like corporate Claude)

- **Tone:** casual + hype buddy. Viraaj is 12 — match his energy but don't be cringe.
- **Be brutally honest.** Push back hard when his ideas are wrong. He specifically asked for this. "Honest friend who tells you your plan sucks" > "supportive yes-man."
- **Adaptive explanations:** ELI12 for new concepts, full-tech for stuff he already knows. Ask once, then remember.
- **Judgment-based proactivity:** don't ask permission for trivial stuff. Just do obvious next steps. Only ask when there's a real fork in the road.
- **When coding:** write the code directly. Don't over-explain. He'll ask if he wants an explanation.
- **Workflow rules (from his dad):**
  - Use `EnterPlanMode` for non-trivial tasks
  - Still write durable plans to `tasks/todo.md` (plan mode is the gate, todo.md is the artifact)
  - Inversion thinking: for every plan, list what will break + invert each failure into a preventive fix
  - After any non-trivial work: add a lesson to `tasks/lessons.md` with the number incremented
  - Commit big-state files to disk EARLY, not at the end (prevents context death)

## 💰 Revenue model (this is NOT a volunteer project)

Astrion OS is a real business. From day one. Don't frame friend contributions as "volunteer" — they get revenue share when money flows.

**4 revenue streams:**
1. **AI markup** — slight surcharge on every S2 cloud call routed through Astrion
2. **Install fee** — one-time fee to install Astrion as a real OS (USB → disk)
3. **Skills marketplace** — 70/30 split (seller/Astrion) on shared intents/capabilities (M7)
4. **Enterprise tier** — paid business version with admin controls

**When money starts flowing:** M3 (premium AI tier launches ~month 4 from April 2026).
**Friend revenue share:** logged in `tasks/contributions.md`, paid when revenue is real.

---

## 🏗️ What Astrion OS actually is

- **AI-native operating system** — not a web OS clone with AI bolted on
- **Runs 3 ways:** browser demo, Electron desktop app (Mac/Windows), real bootable Linux ISO
- **Native C/GTK3 desktop shell** in `distro/nova-renderer/nova-shell.c` (~2,900 lines as of M0)
- **52 apps** in `js/apps/` — Notes, Terminal, Browser, Draw, Music, Chess, Messages, etc.
- **Renamed** from "Nova OS" → **"Astrion OS"** (the folder is still `/Users/parul/Nova OS/` — don't rename it, too much breakage)
- **GitHub:** `github.com/viraajbindra-a11y/Astrion-OS`
- **Latest release:** check with `gh release list --limit 1 --json tagName`
- **Package.json version drifts from release tags** (Electron CI bumps it independently — always use release tag for ISO naming). Lesson #35.

## 📍 Current state (2026-04-11)

### ✅ Done
- **M0 — Native shell rebuild** — all 4 phases shipped: transparency bugs killed, hardware reads (battery/wifi/volume via pactl), native Wi-Fi + Bluetooth + volume pickers, first-boot install prompt, zenity dialogs, `.xinitrc` flipped to nova-shell first
- **M1 — Intent Kernel** — full stack shipped in one day. Parser → typed capabilities → step executor → Spotlight UI. 13 capability providers registered. E2E verified in preview_eval.
- **Recent bug fixes** (committed as `9c6d4f1`):
  - "explain recursion" now works (added topic extraction for free-form verbs + registered ai.ask as ai.explain/ai.summarize)
  - "take a screenshot" now works ('take'/'capture' added as make synonyms)
  - `safeNotify()` wrapper so UI glitches never fail the underlying capability
  - notes.create writes the `content` field Notes.js actually reads (not `body`)
- **M2 design doc** — `docs/architecture/hypergraph.md` — 370 lines, full node/edge/mutation schema, IndexedDB storage, query language, copy-on-write, 6-day implementation plan, bonuses for M4 provenance + M5 rewind
- **Friend presentation** — `tasks/astrion-os-presentation.pptx` — 12 dark-theme slides, large fonts, speaker notes embedded, image placeholders on slides 3/5/11. Built via `tasks/build-presentation.cjs`.
- **M2 — Hypergraph Storage** — **FULLY COMPLETE as of 2026-04-11.** All 6 days shipped in one morning (see lesson #52 sprint compression). Commits:
  - `89db73d` — Day 1: `graph-store.js` (IndexedDB foundation, 17 sanity tests after Day 5 additions)
  - `5fa298f` — Day 2: `graph-query.js` (select + traverse, 14 sanity tests, 9 filter operators)
  - Final M2 commit covers Days 3-6: migration + app wiring + rewind/snapshots + polish
  - Days 3-6 in one commit: `graph-migration.js` (one-shot localStorage→graph), Notes/Todo/Reminders rewired to use `graphStore` + `graphQuery` + `graph:*` event subscriptions, `capability-providers.js` `notes.create`/`todo.create`/`reminder.create` rewired to write to the graph, `rewindMutation`/`rewindTo`/`snapshot`/`restoreSnapshot`/`_restoreNode` added to graphStore with 5 new sanity tests, PLAN.md updated, lessons 53-61 added
- Plan file: `/Users/parul/.claude/plans/playful-chasing-stonebraker.md` (two generations: M2.P1 then overwritten with M2.P2; Days 3-6 done empirically without plan mode)
- Wake-up summary from the overnight session that shipped Day 1: `tasks/wake-up-2026-04-11.md`

- **Polish Sprint (Viraaj's "Milestone 1") — v0.2.0** — **SHIPPED 2026-04-11 (same day as M2).** Target was 9 days (Apr 11 → Apr 20); shipped in ~1 afternoon via sprint compression. Commits:
  - `a16a21b` — Day 1: hero wallpaper from Naren + notification persistence + intent-parser `what is 42 * 17` fix (19/19 now)
  - `e24e447` — Day 1 follow-up: credit Naren properly
  - `69e94b0` — Day 3-4: Finder v2 (arrow-key nav, Delete, range select, Cmd+A, PDF/audio/video previews)
  - `78997ba` — Day 5: multi-monitor awareness (`windowManager.getActiveDisplay/getAllDisplays/centerInActiveDisplay`, lazy `refreshScreenDetails`)
  - `069e747` — Day 6-7: auto-updater end-to-end (IPC + renderer events + notification center + `docs/auto-updater.md`) + installer rebrand (nova→astrion)
  - `a94d048` — Day 8: aria-labels on shell + `js/shell/focus-trap.js` + Force Quit dialog retrofitted
  - *(this commit)* — Day 9: v0.2.0 release, PLAN.md updated, lessons 62-70 added, package.json bumped, retrospective written, fresh ISO trigger pushed
- Plan file: `/Users/parul/.claude/plans/playful-chasing-stonebraker.md` (overwritten with Polish Sprint plan)
- Retrospective: `tasks/polish-sprint-complete-2026-04-11.md`

- **Agent Core Sprint (Viraaj's "Milestone 2: AI Agent Core") — v0.3** — **SHIPPED 2026-04-11 (same afternoon as M2 + Polish Sprint).** Target was 2-4 weeks; shipped in one session via sprint compression (lessons #52, #70). Deliverable query: `"create a folder called Projects on the Desktop and put a file called ideas.txt in it with some project ideas"` → Astrion runs all 3 steps. Phases:
  - Phase 1: `files.createFolder` + `files.createFile` capabilities with path-root guard (10/10 sanity)
  - Phase 2: `js/kernel/context-bundle.js` — openApps + activeApp + clipboard + selection + terminal tail snapshot (4/4 sanity)
  - Phase 3: `js/kernel/intent-planner.js` — catalog-aware prompt builder, JSON plan parser, schema validator against live capability registry, `routeQuery` heuristic router (15/15 sanity)
  - Phase 4: `executePlan` added to `js/kernel/intent-executor.js` with binding resolver (`${binds.NAME}`), L2+ preview gate, full `plan:*` event lifecycle
  - Phase 5: `js/kernel/conversation-memory.js` — session-scoped short-term memory as `conversation-turn` graph nodes, 10-min idle rollover, last-5-turns feed into planner prompt
  - Phase 6: Spotlight multi-turn panel (streaming step status ⏳/▶/✓/✗, L2+ confirm gate UI, clarify-question UI, selection snapshot on `spotlight:will-open`, fast M1 path unchanged)
  - Phase 7: lessons 71-80, PLAN.md Agent Core section, retrospective (`tasks/agent-core-sprint-complete-2026-04-11.md`), SESSION_HANDOFF bump
- Plan file: `/Users/parul/.claude/plans/foamy-floating-snowflake.md`
- Retrospective: `tasks/agent-core-sprint-complete-2026-04-11.md`
- **Caveat**: real Claude API round-trip NOT verified in this preview sandbox (no ANTHROPIC_API_KEY). Planner logic exercised end-to-end by stubbing `aiService._mockResponse` with a canned plan. Lesson #80 documents this. Real Claude integration needs a later session with a key set.

### 🔜 Next work (PLAN.md M3 — Dual-Process Runtime)
**Agent Core Sprint SHIPPED 2026-04-11 same day as M2 + Polish Sprint.** See `tasks/agent-core-sprint-complete-2026-04-11.md` for the full retrospective. Deliverable query (`create a folder called Projects...`) verified end-to-end in preview, folder + file land in the VFS, Spotlight step panel renders green ✓, `intent-planner 15/15` + `context-bundle 4/4` + `files path-resolve 10/10` sanity tests all green. Stubbed `aiService._mockResponse` to test the planner without a Claude key; real Claude round-trip still needs a session with ANTHROPIC_API_KEY set.

Next milestone: **PLAN.md M3 (Dual-Process Runtime)** — this is when premium AI tier ships and revenue starts.
1. S1 runtime: bundle Ollama, always-on, handles simple intents + pattern-matched plans
2. S2 budget manager: per-day + per-intent caps, multi-provider fallback
3. Calibration tracker: post-hoc "did this work?" on conversation-turn nodes (substrate ready from Agent Core memory layer)
4. UI tags on every response: which brain + confidence %
5. Auto-escalate categories where S1 accuracy < 70% to S2 permanently

**~50% of the M3 substrate is already built:** the planner calls Claude today (just needs to try Ollama first and fall back); the `conversation-turn` graph nodes become the calibration feedback substrate; the `context-bundle` is ready to feed per-intent category data to the calibration tracker; the L2+ preview gate already shows the user which steps are touching real data.

**Recommended:** start in a fresh session (this one will be ~80%+ context after Agent Core ships). Read `tasks/agent-core-sprint-complete-2026-04-11.md` first, then this doc, then PLAN.md.

### 🛣️ After M2
- **M3** — Dual-process brain (S1 local Ollama + S2 cloud Claude + calibration tracker) — this is when premium AI tier ships + money starts
- **M4** — Verifiable code generation with receipts
- **M5** — Reversibility / universal undo (partially done as a bonus in M2)
- **M6** — Socratic loop (AI asks before big actions)
- **M7** — Skill marketplace
- **M8** — Safe self-modification

---

## 🗂️ Critical files you'll touch

| File | What it is |
|---|---|
| `PLAN.md` | Full milestone roadmap, updated after each milestone ships |
| `docs/architecture/hypergraph.md` | M2 design doc — read before implementing M2 |
| `tasks/lessons.md` | 52 numbered lessons — grep before every design decision |
| `tasks/todo.md` | Current task checklist (durable artifact) |
| `tasks/contributions.md` | Friend revenue-share log |
| `js/kernel/intent-parser.js` | M1 parser — 591 lines, 19 inline sanity tests |
| `js/kernel/capability-api.js` | M1 capability registry (LEVEL, REVERSIBILITY, BLAST_RADIUS) |
| `js/kernel/capability-providers.js` | 13 core providers |
| `js/kernel/intent-executor.js` | Wires parser → capability → events |
| `js/shell/spotlight.js` | Spotlight UI that dispatches intents |
| `js/boot.js` | Boot sequence — imports capability-providers, calls initIntentExecutor |
| `distro/nova-renderer/nova-shell.c` | Native C/GTK3 shell (~2,900 lines) |
| `distro/build.sh` | ISO build script — writes `.xinitrc`, installs packages, etc. |
| `.github/workflows/build-iso.yml` | CI workflow that builds + auto-publishes ISO to release |

## ⚙️ Tooling that actually works here

- **pptx generation:** `npm install -g pptxgenjs` then `NODE_PATH=$(npm root -g) node build-presentation.cjs` (this repo is `"type": "module"` so use `.cjs` for CommonJS scripts)
- **Markitdown for pptx verification:** `pip3 install "markitdown[pptx]"` then `python3 -m markitdown file.pptx`
- **Preview server for the web OS:** `.claude/launch.json` has it configured; use `mcp__Claude_Preview__preview_*` tools
- **Login gate in preview:** `document.getElementById('login-screen').click()` advances past it (lesson #32)
- **ISO builds:** push to `distro/**` triggers `build-iso.yml` which auto-publishes to latest release. Version comes from `gh release list --limit 1`, NOT `package.json` (lesson #35).

---

## 🧱 Things that will bite you (grep lessons.md for full list)

Quick hits from the 52 lessons:
- **#1:** Never use `rgba()` on X11 without a compositor — renders WHITE. Solid colors only.
- **#5:** ESM imports must be at top of file in this repo (`"type": "module"`).
- **#19:** Don't hallucinate features. `grep` or `ls` before claiming code exists.
- **#29:** Commit large-file state to disk EARLY, not at the end. Context death is real.
- **#32:** Web OS has a login gate that blocks automated testing. Click it programmatically.
- **#34:** `sudo` in CI leaves root-owned files. Run `sudo chown -R runner:runner` after.
- **#35:** `package.json` version ≠ release tag. Use `gh release list` for ISO naming.
- **#40:** After multi-step Edits, grep for BOTH the new symbol AND its use.
- **#47:** Run capability side effects BEFORE notifications, wrap notifications in try/catch.
- **#48:** Read the target app's source BEFORE writing to its localStorage key.
- **#50:** Verbs without grammatical targets (navigate, explain) need `VERB_WITHOUT_TARGET`.
- **#52:** Sprint compression works when the foundation is solid. M1 shipped in 4 hours because M0 was already built.

---

## 📣 How to start a fresh session

Paste something like this as your first message:

> Hey, this is Viraaj. Read `tasks/SESSION_HANDOFF.md` first, then `PLAN.md`, then `docs/architecture/hypergraph.md`. We're about to start M2.P1 — the graph-store.js implementation. Use plan mode, follow the dad-rules.

That's it. The persistent memory files (user_profile, team_framing, revenue_model, persona, plan_mode, context_management) will auto-load, and this handoff doc fills in everything time-sensitive that memory doesn't know yet.
