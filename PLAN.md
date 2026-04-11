# Astrion OS — PLAN v2

*A rewrite of the plan after an adversarial audit of v1. Written so a 12-year-old (me) can read it and still precise enough to guide real code.*

---

## The One Sentence

> **Astrion OS is the right shape for a human and a super-smart AI to work together without the human going to sleep at the wheel.**

That's it. Everything below is in service of that sentence.

---

## What Was Wrong With v1 (short version)

v1 was "build a really polished Linux desktop, then put Claude in Spotlight." That sounds cool, but it's **not AI-native** — it's AI *bolted on*. When AI gets way smarter, a desktop with 51 apps and a chat box is a cage for it. The audit found 10 big holes. The three that matter most:

1. **51 hand-coded apps is a trap** — every app becomes future homework the AI has to understand before it can help. A real AI-native OS has 0 apps or ~5 primitives.
2. **"Self-learning" was just taking notes** — no evaluation, no "did it work?", no getting-better-next-time loop.
3. **Zero safety story for the AGI transition** — no way to trust AI outputs, no way to undo dangerous moves, no way to keep the human awake in the decision loop.

Full audit is in chat history. v1 is in git history if anyone needs to look back.

---

## The 3 Load-Bearing Ideas

I'm committing to exactly 3 big architectural ideas. Not 10. Three. Because overloading kills shipping.

### Idea 1 — The Intent Kernel

**Kid version:** You tell the OS what you *want*, not what to *do*. Say "I want a birthday card for mom" and the OS figures out the steps, makes the card, shows it to you. You don't click through apps.

**Adult version:** The kernel schedules **goals**, not processes. An intent comes in, gets decomposed into sub-intents, each sub-intent runs as an agent with a budget (time, compute, irreversibility), results bubble up, user sees the final artifact or a decision-gate. This is not POSIX. It's closer to a constraint solver than Unix.

**Why we need it:** Without this, the OS is just a menu of tools you have to know how to use. With it, the OS speaks **intent**, which is the one language humans and AI share.

**What breaks if we skip it:** We build macOS again. Claude answers one question at a time. When AI becomes 10× smarter, our UI is the bottleneck because it forces the AI to talk to the human turn by turn.

### Idea 2 — The Dual-Process Brain (Fast + Slow)

**Kid version:** Astrion has two brains. A **little brain** that's always on, handles easy stuff instantly, runs right on your computer (Ollama). And a **big brain** that only wakes up when the little brain isn't sure — careful, slow, shows its work (Claude API). As AI gets smarter, more and more moves into the little brain, and Astrion gets faster and smarter without changing shape.

**Adult version:**
- **System 1 (fast)** — local small model, always-on, low-power, handles reflexes, autocomplete, "obvious" choices, instant responses.
- **System 2 (slow)** — large cloud or big-local model, called on uncertainty or high stakes, explicit reasoning, shown to user, auditable.
- **Metacognition layer** — tracks System 1's calibration per topic. When S1 is wrong too often on topic X, topic X is permanently escalated to S2.

**Why we need it:** This is the **evolution path** from today's generative AI → AGI → SGI. The architecture never changes. What changes is the **boundary** between S1 and S2. As local models get stronger, more moves into S1. When SGI arrives, S2 is unchanged from the user's view — just smarter.

**What breaks if we skip it:** The OS is locked to the model available in 2026. Every model upgrade is a rewrite. No learning loop, because no calibration signal.

### Idea 3 — Verifiable + Reversible + Socratic (the safety triple)

This is one idea, three parts, all mandatory. Skipping any one breaks the rest.

**Kid version:** Three rules:
1. **Receipts** — every time the AI makes or says something, it gives you a receipt: "here's where I learned this, here's the proof it works, here's how sure I am."
2. **Undo** — every dangerous thing the AI does happens in a **practice universe** first. Only after you say "yes, for real" does it happen in the real one. Mistakes are never permanent.
3. **Asks before doing big stuff** — not "are you sure?" popups, but real questions like "you said you wanted X, but did you think about Y?" This keeps *you* smart as the AI gets smart. If you stop deciding, you stop thinking.

**Adult version:**
- **Verifiable Computation** — every AI artifact (code, fact, action) ships with a proof certificate. Code has tests it passes + formal spec. Facts have source + confidence. Actions have blast radius + reversibility window.
- **Reversibility Budget** — every action is priced in "undo tokens." Cheap reversible actions are free. Irreversible actions require explicit human unlock. Destructive actions execute in a forked branch first; main reality updates only after confirmation.
- **Socratic Default** — before any non-trivial action: "is this what you meant? here are 2 alternatives you didn't consider." After any action: "did this help? what would've been better?" This generates the alignment training data AND keeps the human's decision-making muscle active.

**Why we need it:** This is the ONLY real answer to "help mankind stay on course as AI evolves." The danger of AGI isn't the AI getting smarter — it's humans getting lazy and losing the habit of deciding things. A Socratic OS makes that habit impossible to lose.

**What breaks if we skip it:** We ship a super-powerful assistant that lies sometimes, occasionally destroys data, and slowly trains its user to stop thinking. That's every AI product today. We'd be adding to the problem, not solving it.

---

## Safety Rails (Always On, Per Milestone)

These are **not optional.** Every milestone's work must respect these rails. If a milestone conflicts with a rail, the rail wins.

1. **Capability Tiering — 4 levels, AI never promotes itself:**
   - L0: Observe (read-only)
   - L1: Edit sandbox (scratch space only, no real data)
   - L2: Edit real (touches user data — requires per-session unlock)
   - L3: Self-modify (touches Astrion's own code — requires per-action unlock + red-team signoff)
2. **Value-Lock** — the user's declared goals and the safety rails are cryptographically separated from the AI's learned behavior. Self-modification can NEVER touch them.
3. **Red-Team Agent is Mandatory** — any plan touching beyond L1 gets reviewed by a red-team agent whose job is to find flaws. Both agents' outputs are shown to the user.
4. **Provenance Everywhere** — every fact carries source + confidence. Every generated artifact carries chain-of-reasoning. Never hidden in an LLM context.
5. **Self-Modification Quarantine** — if we ever build a healer (M8), it CANNOT touch itself, its sandbox, or its own tests. Ever. This is inviolable.

---

## What Survives / What Gets Demoted

### Survives from the current 51-app codebase
| Keep | Why |
|---|---|
| Native C/GTK3 shell (nova-shell.c) | This is the substrate. The audit agrees shell work is prereq. |
| Terminal, Text Editor, Browser | These are **primitives**, not apps. Kept as first-class. |
| Express server + WebKitGTK rendering | Reused as the render layer for graph-native apps |
| Vault (AES-GCM, PBKDF2) | Classical security, still needed for L2/L3 unlocks |
| Ollama + Anthropic integrations | Become S1 and S2 in the dual-process brain |
| `distro/` build system + ISO pipeline | Shipping matters — don't rebuild what works |

### Demoted to "templates" (not shipped apps, AI generates from them on demand)
Notes, Finder, Kanban, Pomodoro, Todo, Calendar, Reminders, Sticky Notes, Kanban, Music, Photos, Video Player, Draw, Whiteboard, Calculator, Clock, Stopwatch, Timer, Weather, Maps, Translator, Unit Converter, Color Picker, Dictionary, QR Code, Password Generator, Chess, Snake, 2048, Flashcards, Typing Test, Journal, Habit Tracker, Contacts, Messages, Markdown Editor, System Info, Activity Monitor, Budget, PDF Viewer, Daily Quotes, Screen Recorder, Voice Memos, Settings, Task Manager, Trash, Installer, Live Chat, Beat Studio.

**That's 48 apps demoted.** This is the single biggest change and the hardest one. They still work — you can still run them — but they stop being "shipped apps" and become examples the AI uses when you express intent like "I want to track habits" → AI instantiates the habit template into a graph-native view.

### Deleted
Nothing yet. Deletion is irreversible — we demote first, delete only after we're sure nothing depends on it.

---

## Milestones & Phases

Each milestone has: a 1-sentence success definition, **explicit phases** (the sub-steps that actually get checked off), a demo script, safety rails, and an inversion table.

**Cadence rule:** Never start the next phase until the current one has a working demo. Never start the next milestone until the current one's demo passes.

---

### M0 — Finish the Shell Rebuild *(April 6–14, 2026 — current sprint)*

**Why this comes first:** Everything else assumes a stable native substrate. If Ctrl+R still kills the OS, none of the AI work matters.

**Success:** Native panel/dock/desktop works, each app opens in its own GTK window, battery/Wi-Fi/volume read from real hardware, Ctrl+R does nothing, tested on Surface Pro 6.

**Phases:**
- **M0.P1 — Kill Transparency, Add Real Hardware** *(Day 1–2)* ✅ **COMPLETE**
  - ✅ Deleted all `gdk_widget_set_app_paintable()` calls (commit `6332a23`)
  - ✅ Fixed radial glow alpha-gradient (was rendering white on X11)
  - ✅ Battery reads from `/sys/class/power_supply/BAT*/capacity` + status
  - ✅ Wi-Fi parses `nmcli -t -f ACTIVE,SSID dev wifi`
  - ✅ Volume reads `pactl get-sink-volume` + `pactl get-sink-mute`
  - ✅ Flipped `.xinitrc` preference: nova-shell is now the default renderer
  - ✅ Display-aware HiDPI scaling (don't 2x in VMs)
  - ✅ Responsive wallpaper grid in setup wizard (no more "Geometrys" overlap)
- **M0.P2 — Polish the Native Shell** *(Day 3–4)* ✅ **COMPLETE**
  - ✅ Native Wi-Fi picker dialog — click the 📶 icon → GTK dialog lists networks, click to connect, password prompt for secured (commit `e67b173`)
  - ✅ Native Bluetooth picker dialog — click 🔵 icon → scan + pair + connect flow (commit `93bb443`)
  - ✅ Native volume slider in the panel — click 🔊 icon → GTK popover with scale + mute toggle (commit `af201fc`)
  - ✅ Desktop right-click menu — already existed (New Folder, Change Wallpaper, Display, Terminal, Finder, About)
  - ✅ Keyboard shortcuts — already existed (`Ctrl+Space` Search, `Alt+Tab` app switcher, key snooper global)
  - ✅ Window snap — already existed (drag to left/right/top edge → snap)
- **M0.P3 — Web Apps in Native Mode** *(Day 5–6)* — pending
  - Strip OS chrome from web apps when running under nova-shell (no boot, no login, no HTML menubar/dock)
  - Fix browser app to launch `astrion-browser`
  - Test all 52 apps in native GTK windows, one at a time
- **M0.P4 — Install + Persistence** *(Day 7–8)* — pending
  - Default boot path: prompt to install to disk
  - Auto Wi-Fi + NTP on installed systems
  - Full Surface Pro 6 end-to-end test

**Demo script:** Boot ISO in UTM → native panel visible → click Terminal icon in dock → terminal opens in its own GTK window → close it → desktop survives → battery % is accurate → Ctrl+R does nothing.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Transparency partially removed, random white flashes | Grep for every RGBA/alpha call, not just the ones I remember |
| Hardware reads fail on non-standard laptops | Fallback to "unknown" state instead of crashing; log the missing path |
| Web apps keep showing their HTML menubar | Server `/app/:appId` route confirmed to strip chrome; visually verify each app |
| Install-to-disk corrupts existing Windows partition | Installer refuses to touch non-empty disks without explicit confirm |

---

### M1 — Intent Kernel Foundations *(~3 weeks after M0)* ✅ **COMPLETE — shipped in a one-day sprint on 2026-04-11 (commit `2016dba`)**

**Kid version:** Build the "goal scheduler." You tell it what you *want*, it figures out the steps, runs them, reports back. No AI yet — just the machinery.

**Success:** I can type a natural-language intent into Spotlight, see the kernel decompose it into steps, watch each step execute, see the final result. The kernel is the only way apps get launched after this.

**Phases:**
- **M1.P1 — Intent Parser** *(Week 1)*
  - Define the intent data shape (goal, inputs, constraints, budget)
  - Build a parser that converts natural-language → structured intent via S2 (Claude API for now, S1 later in M3)
  - Unit test on 50 example intents
- **M1.P2 — Capability Provider Interface** *(Week 2)*
  - Define the tool API: `provider.list_capabilities()`, `provider.execute(capability, args)`, `provider.cost_estimate(capability, args)`
  - Implement first two providers: `notes` (create/read/edit) and `files` (create/read/delete)
  - Providers live in separate processes, kernel talks to them over IPC
- **M1.P3 — Step Executor + Budget Tracker** *(Week 3)*
  - Executor loops through decomposed steps, respects budgets (time, compute, irreversibility)
  - On failure: halt, show the failed step, let user retry/abort/modify
  - Every executed intent logged with input + plan + result for replay
- **M1.P4 — Spotlight Integration** *(Week 4)*
  - Ctrl+Space routes through the kernel, not directly to app launcher
  - Dock clicks also route through the kernel (as trivial "open app X" intents)
  - UI shows steps executing in real time

**Demo script:** Press Ctrl+Space → type "make a note called shopping with items apples and bread" → watch 3 steps: (1) choose template: Notes, (2) create node, (3) render view → note opens.

**Safety rails applied:** L0 intents only for first iteration; L1 (sandbox) for create/edit; L2 unlock required for delete/overwrite.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Intents are ambiguous → kernel picks wrong template | Socratic default: ask "did you mean X or Y?" if confidence < 0.8 |
| Step failures cascade silently | Every step emits status; UI shows the failed step, user can retry or abort |
| Kernel becomes a god-object coupled to every app | Strict interface: providers in separate processes, swappable |
| No way to test intents reproducibly | Every executed intent logged with input + plan + result |
| Too slow, feels worse than clicking | Pattern cache for common intents; S1 handles them locally in M3 |

---

### M2 — Hypergraph Storage *(~4 weeks after M1)* ✅ **COMPLETE — shipped in a one-day sprint on 2026-04-11 across Days 1-6. Commits: `89db73d` (Day 1 graph-store), `5fa298f` (Day 2 graph-query), and a final squash commit for Days 3-6 (migration + app wiring + rewind + snapshots + polish).**

### POLISH SPRINT — v0.2 foundation polish *(2026-04-11, 1-day sprint, all 9 days compressed)* ✅ **COMPLETE**

*Interstitial sprint inserted between M2 and M3 at Viraaj's request: "proper operating system finished maxed out by Apr 20."* The target was 9 days of work (Apr 11 → Apr 20). Shipped all 9 days in one morning/afternoon on 2026-04-11 via sprint compression (lesson #52 again). Exploration found that ~70% of Viraaj's original checklist was ALREADY built; the real work was ~30%.

| Day | What shipped | Commit |
|---|---|---|
| 1 | `what is 42 * 17` intent parser fix (now 19/19), notification history persistence (localStorage, 200-entry cap), Naren's Astrion Brain hero wallpaper as the new default across web OS + installer, CREDITS.md + contributions.md update | `a16a21b` / `e24e447` |
| 2 | Subsumed into Day 1 — the hero wallpaper is the centerpiece; no generic JPG bulk-add needed | (same commits) |
| 3-4 | Finder v2: arrow-key navigation, Delete/Backspace, Home/End, Cmd+A, Shift-click range select, Escape to clear, route-by-extension open (PDF → pdf-viewer, media → music/video-player, images → photos), inline PDF/audio/video/image/text previews, ARIA scaffolding | `69e94b0` |
| 5 | Multi-monitor awareness: `getActiveDisplay()`, `getAllDisplays()`, async `refreshScreenDetails()` via Window Management API, `centerInActiveDisplay()`, `display:changed`/`display:active-changed` events — all with single-display fallback; permission prompt deferred until an app explicitly asks | `78997ba` |
| 6-7 | Auto-updater end-to-end: rebrand installer/package.json (name/version/appId/productName → Astrion), wire Squirrel events through IPC to the renderer, manual "Check for Updates" path via `window.astrionElectron.updater`, auto-wire Astrion notification center for background update events, new `docs/auto-updater.md` | `069e747` |
| 8 | Accessibility pass: 13 aria-labels on menubar, role=toolbar on dock, new `js/shell/focus-trap.js` utility (Tab cycling + onEscape + initialFocus + restore-focus), Force Quit dialog retrofitted as the first consumer | `a94d048` |
| 9 | **v0.2.0 release** — PLAN.md updated (this section), lessons 62-70 added, package.json bumped, SESSION_HANDOFF.md bumped, retrospective written, fresh ISO build triggered via distro bump | *(this commit)* |

**Deliverable:** A polished v0.2.0 — the OS feels real enough to share. Shipped on 2026-04-11 instead of 2026-04-20. Nine days of calendar time banked for the Agent Core Sprint.

**Kid version:** Replace files-and-folders with a big web of connected stuff. Every note, photo, contact, bookmark, setting is a node. Connections are automatic.

**Success:** Finder is gone as an app. Queries from Spotlight work. Everything I create goes into the graph, versioned forever.

**Phases:**
- **M2.P1 — Graph Data Model + Storage** *(Week 1–2)*
  - Node shape: id, type, properties, edges, version, provenance
  - Storage: content-addressed + copy-on-write on top of SQLite (keep it boring)
  - Migration script: walk the current IndexedDB + filesystem, emit graph nodes
- **M2.P2 — Graph Query Language** *(Week 3)*
  - Simple query syntax: `type:note where tag:school order-by modified desc limit 10`
  - S2 translates natural language → structured query for Spotlight
  - Top-K query pre-computation (cache results for common queries)
- **M2.P3 — POSIX Compatibility Lens** *(Week 4)*
  - Legacy apps expecting a filesystem see a read-only FUSE-style view over the graph
  - Writes from legacy apps are intercepted and converted to graph mutations
  - This is the "don't break the 52 existing apps" bridge
- **M2.P4 — Retire Finder, Migrate Notes to Graph-Native** *(Week 5)*
  - Notes becomes the reference graph-native view
  - Finder as an app is deleted; Spotlight queries replace it
  - "Finder-view" lens (shows graph as folders) still available for users who need it

**Demo script:** Type "show me my 3 most-edited notes this week" → 3 notes appear → click one → opens → edit → close → still in graph, version +1.

**Safety rails applied:** Reversibility — every graph mutation is a commit, undoable for 30 days. Provenance — every node knows what created it.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Users expect files & folders | Ship "Finder-view" lens over the graph |
| Graph explodes in size | Content-addressed + dedup + cold compression |
| Queries too slow | Pre-compute top-K; S1 learns common patterns in M3 |
| Losing a graph = losing the OS | Hourly local snapshots + optional encrypted backup |
| Migration from current IndexedDB corrupts data | Keep IndexedDB as a read-only backup for 30 days post-migration |

---

### M3 — Dual-Process Runtime *(~4 weeks after M2)*

**Kid version:** Officially split the brain into fast + slow. Little brain (Ollama) always on. Big brain (Claude API) only when the little brain isn't sure. Track mistakes, get smarter.

**Success:** 80% of intents resolve via S1. S2 cost drops ~80%. UI shows which brain answered and why.

**Phases:**
- **M3.P1 — S1 Runtime (Ollama Always-On)** *(Week 1)*
  - Bundle Ollama with ISO, auto-start as a service
  - S1 handles: intent parsing, simple classifications, pattern-matched plan selection
  - Falls back to S2 on uncertainty
- **M3.P2 — S2 Runtime (Claude with Budget)** *(Week 2)*
  - Wrap existing Anthropic calls in a budget manager
  - Per-day cap, per-intent cap, cost tracking
  - Multi-provider fallback (Anthropic → larger local Ollama → prompt user to add a key)
- **M3.P3 — Calibration Tracker + Escalation Policy** *(Week 3)*
  - Every intent asks "did this work?" after the fact (thumbs up/down, non-intrusive)
  - Track S1 accuracy per intent category
  - Auto-escalate categories where S1 accuracy < 70% to S2 permanently
- **M3.P4 — UI Tags (Which Brain + Confidence)** *(Week 4)*
  - Every response shows a small S1/S2 badge + confidence %
  - Click badge → see the reasoning trace
  - Calibration dashboard: "S1 is 94% on create-file, 67% on math → math routed to S2"

**Demo script:** Run 10 intents → 8 show "S1" tag, 2 show "S2" tag with reasoning → calibration page updated.

**Safety rails applied:** Interpretability — every answer tagged with brain + confidence. Socratic — low-confidence S1 answers prompt "double-check with big brain?"

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Local model too weak, everything escalates | Fine-tune S1 on user's usage; shrink S1's task scope |
| No calibration signal → S1 never improves | Post-hoc "did this work?" is the learning signal |
| S2 costs blow up | Hard daily cap + cheaper fallback on exceed |
| User can't tell which brain answered | Mandatory S1/S2 badge on every response |
| Model provider outage kills everything | S1 always local; S2 has multi-provider fallback |

---

### M4 — Verifiable Code Generation *(~6 weeks after M3)*

**Kid version:** When Astrion writes code, it also writes the tests that prove it works. You get a receipt: "here's the spec in plain English, here's the code, here are the tests, all pass."

**Success:** "Build me a habit tracker app" → spec → tests → code → app appears in dock, fully working, with a provenance trail.

**Phases:**
- **M4.P1 — Spec-from-Intent** *(Week 1–2)*
  - S2 converts intent → plain-English spec (acceptance criteria, not code)
  - User sees the spec and approves BEFORE any code is written (Socratic gate)
  - Spec is frozen once approved
- **M4.P2 — Tests-from-Spec** *(Week 2–3)*
  - Generate tests from the frozen spec (not from code that doesn't exist yet)
  - Tests live in a sandbox; code must pass them to be promoted
- **M4.P3 — Code-to-Pass-Tests + Sandbox Executor** *(Week 3–5)*
  - S2 writes code targeting the tests
  - Code runs in a sandboxed WebKit context with limited syscalls
  - If tests fail, S2 iterates up to N times, then asks user for help
- **M4.P4 — Provenance + App Promotion** *(Week 5–6)*
  - Every generated app is a node in the graph with: original intent, spec, tests, code, prompt chain, model version, seed
  - Promotion from sandbox → dock requires red-team signoff (from M6) OR user's explicit L2 unlock (until M6 ships)

**Demo script:** "build me a pomodoro timer with 25-min work + 5-min break" → spec → tests → code → tests pass → app in dock → works.

**Safety rails applied:** Provenance everywhere. Reversibility (sandbox before promotion). Red-team review once M6 ships.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Tests are fake (generated to pass whatever was written) | Spec-first, tests-from-spec, code-last. Order matters. |
| Generated app has security holes | Red-team review blocks promotion |
| Not reproducible later | Full prompt chain + model + seed stored |
| User can't verify intent match before code runs | Socratic spec approval gate |
| Generated code is unreadable | Enforce small-function style; docstrings reference spec lines |

---

### M5 — Reversibility + Temporal Substrate *(~4 weeks after M4)*

**Kid version:** Everything dangerous happens in a practice universe first. You see the result, say "yes for real" to commit. Rewind to any past state.

**Success:** Delete a folder → branch created → see before/after → confirm or rewind. Works for files, installs, settings, code edits.

**Phases:**
- **M5.P1 — Branching Storage Layer** *(Week 1)*
  - Copy-on-write on top of the M2 graph
  - Every L2+ action creates a branch; main only updates on confirm
- **M5.P2 — Operation Interceptor** *(Week 2)*
  - Wrap every L2+ action (file delete, settings change, app install) in the interceptor
  - Interceptor shows diff UI, waits for confirm/rewind
- **M5.P3 — Undo/Rewind UI** *(Week 3)*
  - Timeline view of past states (like a Git log but visual)
  - Rewind to any point; optionally fork from a past state
- **M5.P4 — External-Effect Detection** *(Week 4)*
  - Mark any action touching external state (git push, file upload, API call) as "point of no return"
  - PONR actions can't branch; require explicit unlock

**Demo script:** "clean up my downloads folder" → branch → diff shown → click undo → nothing actually changed. Click confirm → real delete.

**Safety rails applied:** This IS the reversibility rail, fully implemented.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Branching = 10× storage | Copy-on-write + dedup + aggressive GC on expired branches |
| User forgets to confirm, state stuck | Auto-confirm cheap reversible ops (L0/L1) after 30s |
| Rewind breaks on external state changes | Mark external-touching ops as PONR + explicit unlock |
| Infinite history bloat | Compact branches > 30 days into keyframes |

---

### M6 — Socratic Loop + Red-Team Agent *(~4 weeks after M5)*

**Kid version:** Astrion pushes back when you ask for something risky. A second AI tries to break every plan before it runs.

**Success:** Run an intent → see planner's plan AND red-team's critique side-by-side → choose to proceed or revise.

**Phases:**
- **M6.P1 — Red-Team Agent** *(Week 1)*
  - Separate process, different model (or same model with adversarial system prompt)
  - Input: the planner's proposed plan. Output: list of failure modes + risks
- **M6.P2 — Socratic Prompter** *(Week 2)*
  - Confidence-threshold based: above 0.9 → silent execute; 0.6–0.9 → single-line prompt; below 0.6 → full Socratic ("did you consider X?")
  - Prompts are questions, not yes/no dialogs
- **M6.P3 — Planner-vs-Red-Team UI** *(Week 3)*
  - Side-by-side display: planner's plan in green, red-team's concerns in red
  - User can accept, revise, or abort
- **M6.P4 — Rubber-Stamp Detection** *(Week 4)*
  - Track how often the user approves without reading
  - If > 80% rubber-stamp rate, inject a known-bad plan as a test (chaos engineering)
  - If user catches it → trust up; if not → force a cooldown

**Demo script:** "delete all screenshots older than a week" → planner proposes list → red-team spots 3 linked to active notes → Socratic prompt → you decide.

**Safety rails applied:** Socratic + red-team rails, fully live for L2+ ops.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Red-team always wrong, user ignores | Track precision; retrain on user's decisions if < 30% useful |
| Annoying friction on every action | L0/L1 stay frictionless; only L2+ engages full loop |
| Planner and red-team collude | Different model OR different adversarial system prompt |
| User rubber-stamps everything | Chaos test + rate-limit on high-stamp rates |

---

### M7 — Declarative Intent Language + Skill Marketplace *(~6 weeks after M6)*

**Kid version:** Invent a tiny language for saying "I want X." People share their intents as skills. Friends can write skills without coding.

**Success:** A 5-line intent file can be written, shared, installed, and runs on someone else's computer.

**Phases:**
- **M7.P1 — Language Design** *(Week 1)*
  - 5 keywords max: `goal`, `trigger`, `when`, `do`, `constraints`
  - Examples doc: 20 intent files covering common cases
- **M7.P2 — Parser + Runner** *(Week 2)*
  - Parse intent files into the M1 kernel's intent shape
  - Run via the kernel with the appropriate capability providers
- **M7.P3 — 20 Built-in Default Intents** *(Week 3–4)*
  - Ship a library: "organize downloads by type," "morning routine summary," "photo-of-the-day backup," etc.
  - These prove the language works before any marketplace exists
- **M7.P4 — Marketplace Backend** *(Week 5–6)*
  - Upload, browse, install
  - Red-team auto-review on every upload
  - Community rating + moderation
  - 70/30 revenue split for paid skills

**Demo script:** Write 5-line intent file → publish → friend installs → runs on their machine → works.

**Safety rails applied:** All installed intents start at L0. Promotion to L1/L2 requires explicit unlock. Sandboxed per origin.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Language too complex | Cap at 5 keywords; every keyword maps to one primitive |
| Marketplace floods with spam/malicious | All L0 by default + red-team auto-review + rating |
| Skills work on one machine not another | Explicit dependency declarations; installer checks env |
| Nobody uses it | 20 built-in intents ship first; marketplace opens only after they work |

---

### M8 — Alignment-Proven Self-Modification *(the real AGI milestone — ~8 weeks after M7)*

**Kid version:** Astrion can carefully modify itself. Strict rules: can't touch safety code, can't touch tests, every fix passes red-team, every fix is reversible.

**Success:** Astrion fixes a small bug in one of its own non-safety modules autonomously. Fix passes red-team. Fix is reversible. User approved.

**Phases:**
- **M8.P1 — Frozen Golden Test Suite** *(Week 1–2)*
  - Define the test suite that Astrion cannot touch, ever
  - Cryptographically signed; any modification attempt shuts down self-mod capability
  - Tests cover the safety rails, value-lock, and core kernel behavior
- **M8.P2 — Self-Mod Sandbox + Value-Lock Crypto** *(Week 3–4)*
  - Self-mod work happens in a forked branch of the Astrion source tree
  - Value-lock crypto: the safety rails file is signed; any diff to it flips the kill-switch
- **M8.P3 — Red-Team Signoff Gate** *(Week 5–6)*
  - Every proposed fix runs through M6's red-team agent
  - Red-team uses a different model than the planner making the fix
  - Signoff required before user approval is even requested
- **M8.P4 — Rollback Automation + Drift Detection** *(Week 7–8)*
  - Automatic rollback if ANY golden test fails after a fix is applied
  - Weekly drift check: diff Astrion's current behavior vs. a baseline
  - Drift above threshold → human review required before next self-mod

**Demo script:** Reproduce a known small bug → Astrion proposes fix → red-team approves → I approve → fix applied → bug gone → rollback still works.

**Safety rails applied:** Value-lock (inviolable), self-modification quarantine (inviolable), L3 capability.

**Inversion table:**
| Will break | Inverted solution |
|---|---|
| Fix introduces new bug, healer chains out of control | Frozen golden test suite; any failure → auto rollback |
| Healer modifies its own rules | Rules cryptographically signed; modification trips value-lock |
| Healer modifies its red-team | Red-team is different process + model + signed prompt; healer has no write access |
| Small fixes drift values over time | Weekly drift check against baseline; threshold = human review |
| User gets lazy approving | Approval requires typing confirmation, not click; rate-limited |

---

## Revenue (Reshaped)

v1 had a SaaS pricing model. v2 has an **agent economy** model.

| When | What | Pricing |
|---|---|---|
| M0–M1 | Open source, free, build audience | $0 (but builds audience) |
| M2 | Donations / Patreon | $100-500/mo possible |
| M3–M4 | Pay-per-use S2 calls (your own API key OR our metered tier) | Usage-based, 20% margin |
| M5–M6 | "Attention premium" — ad-free, no telemetry, priority S2 | $5/mo subscription |
| M7 | Skill marketplace (70/30 split, creators keep 70%) | Marketplace fees |
| M8 | Enterprise tier — value-lock auditing, compliance, private S2 | $20+/mo per seat |

**What's different:** No "compute included in the $10 price" lie. Compute is metered and honest. Human attention is monetized (ad-free premium) because it's the most valuable resource in an AGI era. Skills are user-owned IP.

---

## Lessons Carried Forward

From `tasks/lessons.md` into this plan's DNA:
- **#8:** "A web page is NOT an operating system" → informs M0 (finish native shell) and M2 (hypergraph replaces files)
- **#19:** "Don't hallucinate features" → informs M4 (provenance everywhere, verifiable code gen)
- **#20:** "Cancel and retrigger stale builds" → informs M5 (reversibility for builds too)

From the audit:
- **AI-bolted is not AI-native** → M1 + M2 commit to intent-first architecture
- **Small action space = unsafe** → M1 provides typed capability tiers instead of `terminal.run`
- **Logging ≠ learning** → M3 makes calibration a first-class concept
- **Frozen to 2026 LLMs** → M3's dual-process architecture absorbs future model gains without rewrites
- **Zero safety story** → Ideas 3 + M5 + M6 + M8 ARE the safety story
- **Self-mod as feature is dangerous** → M8 quarantines it under strict rules

---

## What I'm Doing This Week

1. Finish M0 (shell rebuild) — in progress
2. Ship this plan (v2) to the team
3. Prep M1 design doc (Intent Kernel skeleton in C + JS)

**Not** starting M1 code until M0 is fully done and the plan is signed off.
