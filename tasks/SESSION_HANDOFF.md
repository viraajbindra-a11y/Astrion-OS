# Session Handoff — read this first in a new Claude session

> **Last updated:** 2026-04-12 by the outgoing session (post Phase 0 + Phase 1 + M3 seeds).
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
- **53 apps** in `js/apps/` — Notes, Terminal, Browser, Draw, Music, Chess, Messages, YouTube, etc.
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

- **Agent Core Sprint (Viraaj's "Milestone 2: AI Agent Core") — v0.3** — ✅ **SHIPPED 2026-04-11.** Soak-tested against real Ollama (qwen2.5:7b) with Viraaj driving Spotlight. 7 bugs found and fixed across two review sessions (commits `0cd1b5c` → `24234ed` → `2b7806b`). Canonical deliverable query passes. Branch merged to main as a clean 4-commit fast-forward. Phases:
  - Phase 1: `files.createFolder` + `files.createFile` capabilities with path-root guard (10/10 sanity)
  - Phase 2: `js/kernel/context-bundle.js` — openApps + activeApp + clipboard + selection + terminal tail snapshot (4/4 sanity)
  - Phase 3: `js/kernel/intent-planner.js` — catalog-aware prompt builder, JSON plan parser, schema validator, `routeQuery` heuristic router (15/15 sanity)
  - Phase 4: `executePlan` in `js/kernel/intent-executor.js` — binding resolver, L2+ preview gate, `plan:*` event lifecycle
  - Phase 5: `js/kernel/conversation-memory.js` — session-scoped short-term memory on the hypergraph
  - Phase 6: Spotlight multi-turn panel (step streaming, L2+ confirm gate, clarify UI, 3-mode Escape)
  - Soak test: 11 adversarial tests under stub + canonical query against real Ollama. Bugs: summarizeContext crash on empty timestamp (critical, fixed), initConversationMemory missing from web boot (fixed), unresolved bindings gave confusing errors (fixed), maxTokens rambling (fixed), semantically wrong plans for unsatisfiable intents (prompt rule added), input.disabled stuck after clarify/abort (fixed), clarify choices not clickable (fixed).
- Retrospective: `tasks/agent-core-sprint-complete-2026-04-11.md`
- Soak test report: `tasks/agent-core-soak-test-BLOCKED-2026-04-11.md`
- Lessons: #71–87 (17 new lessons from this sprint + review)

### 🔜 Next work — Agent Core EXPANSION (Phase 0: Chat Foundation)

**Viraaj's vision (2026-04-11):** "I want Agent Core to be special. It should be able to do anything — from making apps to playing video games for you." The current Agent Core is the skeleton (planner + executor + 17 capabilities). The expansion turns it into the real product.

**Approved 9-phase roadmap (April–December 2026):** See plan file `/Users/parul/.claude/plans/sorted-sprouting-candle.md` for the full plan with inversion tables, demo scripts, and file paths.

| Phase | Dates | Ships |
|---|---|---|
| 0 | Apr 12–27 | Messages becomes an agent (chat + actions) |
| 1 | Apr 28–May 11 | AI reads/writes actual source code (server file I/O bridge) |
| 2 | May 12–Jun 8 | M3 Dual brain (Ollama S1 + Claude S2 + calibration) |
| 3 | Jun 9–Jul 6 | M4 App generation ("build me a pomodoro timer") |
| 4 | Jul 7–20 | Game autoplay (AI plays Snake/Chess/2048) |
| 5 | Jul 21–Aug 10 | Bug fix pipeline (describe bug → AI proposes fix) |
| 6 | Aug 11–Sep 7 | M5 Reversibility (undo everything, visual timeline) |
| 7 | Sep 8–Oct 5 | M6 Socratic loop + red-team agent |
| 8 | Oct 6–Dec 1 | M8 Self-modification with safety rails |
| 9 | Dec 1–31 | M7 Skill marketplace + polish |

**First job of the next session:** Start Phase 0 — wire Messages app to route actionable queries through the planner instead of raw `aiService.ask`. Key file: `js/apps/messages.js` line 215 (`sendMessage`). Use `EnterPlanMode`, follow the dad-rules, no compression.

**Ollama is installed and working:** `brew install ollama` done, `qwen2.5:7b` pulled, tested, working on port 11434. Provider config: `localStorage['nova-ai-provider'] = 'ollama'`, `localStorage['nova-ai-ollama-model'] = 'qwen2.5:7b'`. No Anthropic API key needed for development — Ollama is the dev-time brain.

**Anthropic API key status:** Viraaj has a Max (20x) plan. console.anthropic.com key was generated and authenticates, but $0 credit balance (Max promo credits didn't materialize). When/if API credits are needed (M3 S2 integration), he'll need to either claim credits or add a small prepaid balance.

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
| `tasks/lessons.md` | 97 numbered lessons — grep before every design decision |
| `tasks/todo.md` | Current task checklist (durable artifact) |
| `tasks/contributions.md` | Friend revenue-share log |
| `js/kernel/intent-parser.js` | M1 parser — 19 inline sanity tests |
| `js/kernel/capability-api.js` | M1 capability registry (LEVEL, REVERSIBILITY, BLAST_RADIUS) |
| `js/kernel/capability-providers.js` | 21 core providers (files, code, notes, todo, reminder, ai, app, volume, translate, screenshot, chat) |
| `js/kernel/intent-planner.js` | Agent Core planner — NL → JSON plan via LLM, routeQuery heuristic |
| `js/kernel/intent-executor.js` | Wires parser → capability → events, executePlan with binding resolver |
| `js/kernel/context-bundle.js` | Snapshot of open apps, active window, clipboard, selection for planner |
| `js/kernel/conversation-memory.js` | Session-scoped turn recording on hypergraph |
| `js/kernel/calibration-tracker.js` | M3 seed — records per-query accuracy stats for S1/S2 routing |
| `js/kernel/budget-manager.js` | M3 seed — S2 daily/per-intent spending caps |
| `js/apps/messages.js` | Phase 0 — chat interface that routes through the planner |
| `js/shell/spotlight.js` | Spotlight UI with multi-turn plan panel, clarify flow, L2 confirm gate |
| `js/boot.js` | Boot sequence — imports all kernel modules, both native + normal branches |
| `server/index.js` | Express server — AI proxy + Phase 1 file I/O endpoints (/api/files/*) |
| `distro/nova-renderer/nova-shell.c` | Native C/GTK3 shell (~2,900 lines) |
| `distro/build.sh` | ISO build script — writes `.xinitrc`, installs packages, etc. |
| `.github/workflows/build-iso.yml` | CI workflow that builds + auto-publishes ISO to release |

## ⚙️ Tooling that actually works here

- **pptx generation:** `npm install -g pptxgenjs` then `NODE_PATH=$(npm root -g) node build-presentation.cjs` (this repo is `"type": "module"` so use `.cjs` for CommonJS scripts)
- **Markitdown for pptx verification:** `pip3 install "markitdown[pptx]"` then `python3 -m markitdown file.pptx`
- **Preview server for the web OS:** `.claude/launch.json` has it configured; use `mcp__Claude_Preview__preview_*` tools
- **Login gate in preview:** `document.getElementById('login-screen').click()` advances past it (lesson #32)
- **Ollama (local AI):** installed via `brew install ollama`, model `qwen2.5:7b` pulled. Start with `ollama serve` (port 11434). Set `localStorage['nova-ai-provider'] = 'ollama'` and `localStorage['nova-ai-ollama-model'] = 'qwen2.5:7b'` in the browser. Provider `auto` tries Ollama first, then Anthropic, then mock. Provider `mock` is auto-cleared on boot (lesson #72).
- **ISO builds:** push to `distro/**` triggers `build-iso.yml` which auto-publishes to latest release. Version comes from `gh release list --limit 1`, NOT `package.json` (lesson #35).
- **Anthropic API key status:** Max (20x) plan, console.anthropic.com key authenticates but $0 credit balance. When API credits are needed (M3 S2), add prepaid credit or claim promo.

---

## 🧱 Things that will bite you (grep lessons.md for full list)

Quick hits from the 97 lessons:
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
- **#72:** `localStorage['nova-ai-provider'] === 'mock'` silently neuters every AI path. Auto-cleared on boot now.
- **#83:** Stub verification ≠ shipped. Even thorough stub tests don't equal real AI testing.
- **#84:** Local LLMs ramble past JSON close-brace if maxTokens too generous. Cap at 500.
- **#87:** Weaker model soak tests are MORE informative — they test error paths.
- **#88:** Planner calls must use `skipHistory: true` to avoid poisoning chat context.
- **#89:** Don't use `executePlan()` from non-Spotlight contexts — it hijacks the UI. Messages has its own `executeStepsInChat`.
- **#92:** User queries in LLM prompts must be `JSON.stringify`'d, not template-literal'd.
- **#93:** Path traversal checks must run BEFORE normalization, not just after.

---

## 📣 How to start a fresh session

Paste something like this as your first message:

> Hey, this is Viraaj. Read `tasks/SESSION_HANDOFF.md` first, then the expansion plan at `.claude/plans/sorted-sprouting-candle.md`. We're working on the Agent Core Expansion — Phase 2 (Dual Brain / M3) is next. Use plan mode, follow the dad-rules. Ollama is installed (qwen2.5:7b on port 11434).

That's it. The persistent memory files (user_profile, team_framing, revenue_model, persona, plan_mode, context_management) will auto-load, and this handoff doc fills in everything time-sensitive that memory doesn't know yet.
