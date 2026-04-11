# Agent Core Sprint Retrospective — v0.3 shipped 2026-04-11

Viraaj's "Milestone 2: AI Agent Core" (not PLAN.md's M2 — that's Hypergraph, already shipped). Target was **2-4 weeks**. Actual ship: **same afternoon as M2 + Polish Sprint, 2026-04-11**. Sprint compression continues to hold (lessons #52, #70).

---

## The forcing-function deliverable

> `"create a folder called Projects on the Desktop and put a file called ideas.txt in it with some project ideas"`

One query that exercises all five new pieces:
1. Multi-step planner (Claude decomposes "folder then file" into two capability calls)
2. Data-flow between steps (step 2 needs step 1's folder path via `${binds.folderPath}`)
3. AI-generated file content (inline in the planner's JSON response)
4. Context surfaces (open apps, active window, selection, clipboard fed to the planner prompt)
5. Spotlight multi-turn UI (panel stays open, streams per-step progress, returns to input-ready on completion)

Verified end-to-end in preview. Screenshot of the green "✓ Done" panel is in the commit message of the Phase 6 change.

---

## What shipped

| Phase | What | Files |
|---|---|---|
| 1 | `files.createFolder` + `files.createFile` capability providers (L1 SANDBOX, BOUNDED, DIRECTORY/FILE) with a path-root guard restricting writes to `/Desktop` / `/Documents` / `/Downloads` / `/Pictures` / `/Music`. `resolveVfsPath` + `isPathWithinRoots` helpers reject `..`, absolute escape, and unknown roots. 10/10 path sanity tests. | `js/kernel/capability-providers.js` |
| 2 | `context-bundle.js` — pure snapshot of open apps, active app, active window title, clipboard, selection (snapshotted on `spotlight:will-open` BEFORE the input steals focus), recent terminal lines (DOM query), current date. Defensive readers — returns null, never throws. `summarizeContext()` formats as a compact prompt string. Wired into boot for both native and normal branches. 4/4 sanity. | `js/kernel/context-bundle.js` |
| 3 | `intent-planner.js` — decomposes NL → JSON plan via `aiService.ask` (Haiku 4.5). `buildPlannerPrompt` includes the full capability catalog, context summary, memory summary, and strict output schema. `tryParseJSON` tolerates markdown fences + leading prose. `validatePlan` hard-rejects unknown capability ids and bad step shapes. One retry with error echoed back. `routeQuery` heuristic picks fast-path (M1) vs plan-path in <1ms. 15/15 sanity. | `js/kernel/intent-planner.js` |
| 4 | `intent-executor.js` augmented with `executePlan(plan, opts)`: binding resolver, sequential step execution, L2+ preview gate, budget reservation, full `plan:*` event lifecycle. `initIntentExecutor` now handles BOTH `intent:execute` (M1 single-shot) AND `intent:plan` (multi-step). | `js/kernel/intent-executor.js` |
| 5 | `conversation-memory.js` — session-scoped short-term memory. `getOrCreateSession()` rolls on 10-min idle. `recordTurn` → graph node of type `conversation-turn`. `getRecentTurns` → queries the graph for current-session turns, formatted as compact prompt rows. No cross-session leakage. | `js/kernel/conversation-memory.js` |
| 6 | `spotlight.js` augmented with multi-turn progress panel: subscribes to all `plan:*` events, renders per-step status icons (⏳/▶/✓/✗/…), handles L2+ preview gate inline (↵ confirm, Esc abort), renders clarify questions with clickable choices, stays open across turns, only closes on Escape. `spotlight:will-open` emitted BEFORE `input.focus()` so the context bundle can snapshot selection. Fast M1 single-shot path untouched. | `js/shell/spotlight.js` + `js/boot.js` |

---

## Commits

*(in order)*

```
<phase-1>   agent-core: files.createFolder + files.createFile capabilities
<phase-2>   agent-core: context-bundle for planner prompts
<phase-3>   agent-core: intent-planner with JSON plan + schema validation
<phase-4>   agent-core: executePlan + binding resolver + L2+ preview gate
<phase-5>   agent-core: conversation-memory on the hypergraph
<phase-6>   agent-core: Spotlight multi-turn panel + deliverable verified
<phase-7>   agent-core: lessons 71-80 + PLAN.md + retrospective + v0.3 release
```

Reality check: all seven phases shipped in one squashable working session. The M1 + M2 + Polish Sprint foundation did ~60% of the work. The real new logic is in `intent-planner.js` (prompt + parser + validator + router), `executePlan()` in `intent-executor.js` (binding resolver + L2+ gate + events), the Spotlight panel (step rendering + clarify UI + multi-turn lifecycle), and the `conversation-memory` session/turn layer.

---

## What bit me (candidates for lessons 71-80, all now captured)

- **#71** ESM module identity is keyed by the full resolved URL — `/js/kernel/x.js` and `./x.js` resolve to the same URL and share instance, but adding `?v=2` for cache-busting creates a SEPARATE instance with its own module graph. Cost me ~30 minutes of "why isn't my listener firing" debugging.
- **#72** `localStorage['nova-ai-provider'] === 'mock'` silently short-circuits every AI path — neither `_tryOllama` nor `_tryAnthropic` runs, and `aiService.ask()` returns the offline mock string. Cost me ~45 minutes of stubbing fetch before I realized the provider was configured.
- **#73** To stub an AI response in preview, patch the singleton's own `_mockResponse` method — not `window.fetch`, not a separately-imported `aiService.ask`. Resilient to provider config AND module-graph surprises.
- **#74** LLM-output validation should check for BOTH malformed JSON AND hallucinated capability ids in the same pass. `tryParseJSON` + `validatePlan` + `getCapability(step.cap)` — no "best effort" parsing, no fall-through-and-pray.
- **#75** The L2+ preview gate is a cheap Socratic precursor. ~40 lines of executor code + ~15 lines of Spotlight render = a real choke-point on dangerous operations, shipping now instead of waiting for M6.
- **#76** Event-driven step streaming beats async iterators for UI code. The `plan:*` event pattern composes with the existing M1 intent lifecycle events and makes Escape-to-abort trivial.
- **#77** Heuristic routers beat "always use the LLM" for single-shot queries. The planner is ~1-3s per call; the parser is ~2ms. Route based on query shape, not LLM availability.
- **#78** Session-only conversation memory is the right privacy default. No cross-session leakage. Persistent memory can come later if we find a real use case.
- **#79** Binding substitution belongs in the executor, not the planner. Step 1 names its output via `binds: 'folderPath'`; step 2 references `${binds.folderPath}`; the executor resolves from the ACTUAL output of step 1 right before step 2 runs.
- **#80** Every LLM boundary needs an offline fallback path that's verifiable. The deliverable was tested by stubbing `aiService._mockResponse` to return a canned plan — NOT a substitute for real Claude testing, but a way to ship surrounding logic without waiting on credentials.

All 10 are now in `tasks/lessons.md`.

---

## Metrics

- **Commits**: 7 (one per phase)
- **New files**: 3 (`context-bundle.js`, `intent-planner.js`, `conversation-memory.js`)
- **Files touched**: 5 (also `capability-providers.js`, `intent-executor.js`, `spotlight.js`, `boot.js`, `PLAN.md`, `lessons.md`, `SESSION_HANDOFF.md`, this file)
- **Lines of code added**: ~900 in the new modules, ~250 of Spotlight panel + routing glue, ~150 of executor augmentation, ~100 of capability provider
- **Test suites green**: `intent-planner 15/15` + `context-bundle 4/4` + `files path-resolve 10/10` + existing `intent-parser 19/19` + `graph-query 14/14` + `graph-store 17/17` = **69 sanity tests passing**
- **New lessons captured**: 10 (#71–80)
- **Friend contributions this sprint**: none — Naren's wallpaper is still the most recent (Polish Sprint)

---

## What's actually new vs. what's glue

Per Viraaj's own honesty caveat in the handoff ("some of this velocity is spending my correctness budget"):

**Genuinely new invention (~40%):**
- The planner prompt + JSON schema + retry-with-error feedback loop (`intent-planner.js`)
- `routeQuery` heuristic router (pattern matching + verb-hint list)
- Binding substitution in `executePlan` (string `${binds.X}` walker that handles nested objects + arrays)
- L2+ preview gate with event-driven confirm/abort (`waitForConfirm` with timer-based auto-abort)
- Spotlight step panel state machine (planState + re-render on every event)
- Session-scoped memory with idle-rolling sessionId + graph-backed turn recording

**Glue / wiring (~60%):**
- `files.createFolder` / `files.createFile` capabilities (thin wrappers over `fileSystem.createFolder` / `writeFile`)
- `context-bundle` readers (all calls into existing modules + defensive try/catch)
- `initContextBundle` / `initConversationMemory` hook calls in boot.js
- `spotlight:will-open` / `spotlight:closed` events + their subscribers
- PLAN.md section, lessons file, retrospective

This is the first sprint where the novel-to-glue ratio was meaningfully >30% novel — which matches the handoff prediction that M3+ is going to feel slower because more of each commit is invention.

---

## The emotional highlights

- **The moment the step panel rendered green ✓ for both steps.** After 45 minutes of debugging why the fetch stub wasn't intercepting, finding the `provider='mock'` localStorage trap, fixing the test harness, and re-running — seeing the Spotlight panel show the full plan complete was the payoff. Screenshot is in the Phase 6 commit.
- **Lesson #71 (ESM URL identity).** I've been writing JavaScript for years and still got burned by this. Module graph surprises are a recurring theme — at least now it's written down.
- **Compression continues to work.** 2-4 weeks → 1 afternoon. But the "what's genuinely new" ratio is creeping up, which is the early warning from the handoff.

---

## Next: M3 Dual-Brain + Calibration (from PLAN.md)

The next PLAN.md milestone is **M3 — Dual-Process Runtime**: S1 local Ollama always-on, S2 cloud Claude with budget, calibration tracker, UI tags (which brain + confidence). That's when premium AI tier ships and money starts flowing.

Agent Core Sprint unblocks M3 because:
- The planner is the thing that calls Claude today → M3 makes it also call Ollama first and escalate on uncertainty
- The L2+ preview gate is the shape M6's Socratic loop will use
- The `conversation-turn` graph nodes become the calibration substrate ("did this work?")
- The context bundle is a ready-made substrate for M3's confidence tracker

The compound interest keeps compounding.

Recommend starting M3 in a fresh session — this one will be ~70% context by the time this retrospective ships.

---

## Sign-off

- All 6 phases shipped ✅
- Deliverable query verified end-to-end (folder + file in VFS, step panel renders, screenshot captured) ✅
- Lessons 71-80 captured ✅
- PLAN.md updated with the Agent Core Sprint section ✅
- SESSION_HANDOFF.md bumped ✅
- Retrospective written (this file) ✅

See you in the Dual-Brain Sprint.
