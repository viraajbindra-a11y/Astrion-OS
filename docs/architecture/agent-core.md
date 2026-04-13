# Astrion Agent Core — Design Doc

**Status:** Active. Targeting 2-4 week implementation starting 2026-04-11.

**Why this milestone:** The Intent Kernel (M1) runs **one** capability per intent. It can't chain steps ("create a folder AND put a file in it"), ask clarifying questions, or remember what happened last turn. The hypergraph (M2) stores data but the AI can't query its own conversation history. Spotlight fires one intent and closes. Every future milestone (M3 dual-brain, M4 verifiable codegen, M6 Socratic loop) needs an agent that can plan, execute multi-step sequences, surface progress, and ask for help when stuck.

Building the Agent Core gives Astrion a real AI that:
1. **Decomposes** "create a folder called Projects on the Desktop and put a file called ideas.txt in it with some project ideas" into 3 ordered steps
2. **Executes** each step via the OS Action API (already ~60% shipped as M1 capability providers)
3. **Reports progress** in real time inside Spotlight ("Step 1/3: creating folder… done")
4. **Asks clarifying questions** when the intent is ambiguous ("You said 'the file' — which one?")
5. **Remembers** prior turns so "now rename it" knows what "it" refers to

---

## What already exists (M1 + M2 foundation)

| Piece | Where | Status |
|---|---|---|
| **NL → structured intent** | `js/kernel/intent-parser.js` | ✅ 19 verbs, 40+ targets, confidence scores |
| **Capability registry + typed providers** | `js/kernel/capability-api.js` + `capability-providers.js` | ✅ 13 providers with LEVEL/REVERSIBILITY/BLAST_RADIUS |
| **Step executor** | `js/kernel/intent-executor.js` | ✅ but runs ONE capability per intent, no chaining |
| **Spotlight UI** | `js/shell/spotlight.js` | ✅ single-shot: type query → fire → close |
| **Graph storage** | `js/kernel/graph-store.js` | ✅ nodes/edges/mutations/snapshots, IndexedDB |
| **Graph query** | `js/kernel/graph-query.js` | ✅ select + traverse, 9 filter operators |
| **Event bus** | `js/kernel/event-bus.js` | ✅ global pub/sub, all graph mutations emit events |
| **File system** | `js/kernel/file-system.js` | ✅ IndexedDB-backed vFS with readDir/writeFile/delete/rename/search |
| **Process manager** | `js/kernel/process-manager.js` | ✅ app lifecycle: register/launch/terminate |
| **Window manager** | `js/kernel/window-manager.js` | ✅ create/focus/close/minimize/maximize + multi-monitor |

**What the Agent Core adds on top:**
1. A **planner** that decomposes one natural-language intent into a sequence of capability calls
2. An **OS Action API** that exposes every OS primitive as a typed, discoverable action
3. A **context system** that tells the planner what's happening right now
4. **Conversation memory** as graph nodes so "rename it" resolves across turns
5. A **Spotlight multi-turn UI** that stays open, streams progress, and accepts follow-ups

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    SPOTLIGHT (UI)                          │
│   multi-turn input → streams step progress → follow-ups   │
└─────────┬──────────────────────────────────────┬──────────┘
          │ intent                               │ display
          ▼                                      │
┌──────────────────┐   context    ┌──────────────┴──────────┐
│  INTENT PLANNER  │◄────────────│  CONTEXT SYSTEM          │
│  (NL → plan)     │             │  open apps, active file, │
│                  │             │  clipboard, recent cmds,  │
│  uses S2 (Claude)│             │  selection, system state  │
│  for multi-step  │             └──────────────────────────┘
│  decomposition   │
└─────────┬────────┘
          │ plan: [step1, step2, step3]
          ▼
┌──────────────────┐
│  STEP EXECUTOR   │  (augmented intent-executor.js)
│  for each step:  │
│   1. resolve cap │
│   2. execute     │
│   3. emit result │──── graph:mutation events ───► GRAPH STORE
│   4. check ok    │
│   5. if fail:    │
│      ask user    │──── clarification ──► SPOTLIGHT UI
└──────────────────┘
          │
          ▼
┌──────────────────┐
│ CONVERSATION     │
│ MEMORY           │
│ (graph nodes)    │  stores: user query, plan, each step result,
│                  │  follow-up questions, final answer, timestamp
└──────────────────┘
```

---

## The 5 new modules

### 1. `js/kernel/intent-planner.js` — NL → multi-step plan

**What it does:** Takes a parsed intent (from `intent-parser.js`) + context (from the context system) and produces a **plan** — an ordered array of steps, each step being a capability call with resolved arguments.

**When it plans vs. executes directly:**
- **Single-step intents** (e.g., "open notes", "mute") → bypass the planner entirely, go straight to the executor (same as today). Detected by: the parser returns a recognized verb+target with high confidence AND the capability exists.
- **Multi-step intents** (e.g., "create a folder called Projects on the Desktop and put a file called ideas.txt in it") → planner engages. Detected by: the intent contains multiple verbs, or the parser returns `confidence < 0.7`, or the intent references a sequence ("and then", "after that", "first X then Y").

**How it plans:**
1. Gather context (open apps, active file, clipboard, etc.)
2. Build a prompt for S2 (Claude API) with:
   - The user's raw query
   - The context snapshot
   - The list of available capabilities (from capability-api.js `listCapabilities()`)
   - The expected output format: `{ steps: [{ capability, args, dependsOn? }], clarifications?: [{ question, options? }] }`
3. Send to S2
4. Parse the structured response
5. If `clarifications` array is non-empty → surface them via Spotlight before executing
6. If `steps` array is clean → pass to the step executor

**Shape:**
```ts
interface Plan {
  id: string;              // "plan-<uuid>"
  query: string;           // original user query
  steps: PlanStep[];
  clarifications: Clarification[];
  context: ContextSnapshot; // what the planner knew when it planned
  createdAt: number;
}

interface PlanStep {
  index: number;
  capability: string;      // e.g., "file.createFolder", "file.create"
  args: object;            // resolved arguments for the capability
  dependsOn?: number[];    // indices of steps that must complete first
  description: string;     // human-readable "Creating folder 'Projects' on the Desktop"
}

interface Clarification {
  question: string;        // "You said 'the file' — which one?"
  options?: string[];      // optional multiple-choice ["report.txt", "notes.md"]
  resolves: string;        // which arg in which step this answers
}
```

**Key design decisions:**
- The planner is STATELESS — it takes an intent + context and returns a plan. No persistent state between calls. Conversation memory is handled by the memory module, not the planner.
- Planner output is JSON, not free-text. S2's structured output mode is used where available; otherwise JSON-in-markdown is parsed.
- Plans are stored as graph nodes (`type: 'plan'`) with edges to each step result. This gives M4 provenance chains for free.
- If S2 is unavailable (offline, rate-limited), the planner falls back to single-step execution and logs a warning. The OS doesn't break — it just can't decompose.

### 2. `js/kernel/os-actions.js` — typed OS Action API

**What it does:** A registry of every action the AI can take, with typed signatures, permission levels, and reversibility annotations. This is the "tool menu" the planner reads when deciding what steps to emit.

**Why separate from capability-providers.js?** Capability providers are the *implementation* — they DO things. The OS Action API is the *interface* — it DESCRIBES what can be done, what inputs are needed, and what the risks are. The planner reads the interface; the executor calls the implementation.

**Shape:**
```ts
interface Action {
  id: string;              // e.g., "file.create"
  category: string;        // "file" | "app" | "window" | "terminal" | "browser" | "notes" | "settings" | "notification"
  name: string;            // human: "Create file"
  description: string;     // for the planner prompt
  parameters: Parameter[]; // typed inputs
  returns: string;         // what it gives back
  level: 0|1|2|3;         // capability tier (observe/sandbox/real/self-mod)
  reversibility: string;   // "free" | "bounded" | "irreversible"
  capabilityId: string;    // links to the capability-providers.js implementation
}
```

**Initial action catalog (shipped with Agent Core v1):**

| Category | Action | Maps to capability |
|---|---|---|
| file | file.create | NEW — create a file at a path with content |
| file | file.createFolder | NEW — mkdir |
| file | file.read | NEW — read file content |
| file | file.delete | NEW — delete (with blast radius) |
| file | file.rename | NEW — rename/move |
| file | file.search | NEW — search by name/content |
| app | app.open | existing: app.open |
| app | app.close | NEW |
| window | window.focus | NEW |
| window | window.minimize | NEW |
| terminal | terminal.run | NEW — run a command (L2, high blast radius) |
| browser | browser.navigate | NEW — open a URL |
| notes | notes.create | existing: notes.create |
| notes | notes.search | NEW — query the graph |
| todo | todo.create | existing: todo.create |
| reminder | reminder.create | existing: reminder.create |
| settings | settings.change | NEW |
| notification | notification.show | NEW — fire a toast |

**Implementation:** Each action is registered via `registerAction(actionDef)` and is auto-included in the planner's capability prompt. When the executor resolves a step, it looks up the `capabilityId` and calls `runCapability`. Actions that don't have a matching capability yet throw a `NOT_IMPLEMENTED` error and the step executor reports it to the user via Spotlight.

### 3. `js/kernel/context-system.js` — what's happening right now

**What it does:** Assembles a snapshot of the current OS state and passes it to the planner. The planner uses context to resolve ambiguous references ("the file" → the file the user is currently editing).

**What it surfaces:**
```ts
interface ContextSnapshot {
  timestamp: number;
  activeWindow: { id, title, app } | null;
  openApps: { appId, instanceId, title }[];
  activeFile: { path, name, content? } | null;   // if a text editor has focus
  selectedText: string | null;                     // from any focused textarea/input
  clipboard: string | null;                        // last copied text
  recentIntents: { query, result, timestamp }[];   // last 5 intents from this session
  systemState: {
    battery: number;
    wifi: boolean;
    volume: number;
    time: string;
  };
}
```

**How it gathers context (all sync, must be cheap):**
- `activeWindow`: from `windowManager.activeWindowId` + the windows Map
- `openApps`: from `processManager.getRunningApps()`
- `activeFile`: from the active window's content element → check if it has a `.text-editor-textarea` or similar
- `selectedText`: `window.getSelection()?.toString()` + check `document.activeElement` for textarea/input selection
- `clipboard`: navigator.clipboard.readText() (async, cached on last copy event instead)
- `recentIntents`: from a ring buffer maintained by the executor
- `systemState`: cached from menubar polls (battery, wifi, volume already poll every 10s)

**Key constraint:** Context gathering must complete in <10ms. Anything async (clipboard, file reads) is cached from the last event, not fetched on-demand. The context snapshot is a best-effort "what was true 1-2 seconds ago" — NOT a real-time guarantee.

### 4. `js/kernel/conversation-memory.js` — cross-turn state

**What it does:** Stores each conversation turn as a graph node so follow-up queries like "now rename it" can resolve "it" by looking at the previous turn's result.

**Shape in the graph:**
```
node type: "conversation-turn"
props: {
  query: string,          // user's raw input
  plan: Plan | null,      // the plan (if multi-step) or null (if single-step)
  results: StepResult[],  // what happened
  timestamp: number,
  sessionId: string,      // groups turns within one Spotlight session
}
```

Turns within one Spotlight session are linked by edges:
```
turn-1 —next_turn→ turn-2 —next_turn→ turn-3
```

**Pronoun / reference resolution:**
When the planner sees a query with unresolved references ("rename it", "delete the last one", "that folder"), it looks at the last N turns in the conversation memory and resolves:
- "it" / "that" → the primary result artifact from the last turn (e.g., the file that was just created)
- "the last one" → same, with a fallback to the last item in a list result
- "those" → the list of results from the last turn

This resolution happens in the planner's prompt — the conversation history is injected as context, and S2 resolves the references naturally. No hand-coded pronoun resolution.

### 5. Spotlight multi-turn UI — `js/shell/spotlight.js` upgrade

**What changes:**
- Spotlight stays **open** after an intent is dispatched (currently it closes)
- A **conversation thread** renders below the input: user queries + AI responses + step progress
- Each step shows a **progress indicator**: pending → running → done / failed
- If the planner surfaces **clarifying questions**, they render as inline prompts with buttons
- The user can type **follow-up queries** without reopening Spotlight
- A "New conversation" button clears the thread and starts fresh

**UI shape (rough):**
```
┌─────────────────────────────────────────┐
│ 🔍  create a folder called Projects... │ ← input
├─────────────────────────────────────────┤
│ You: create a folder called Projects   │
│      on the Desktop and put a file     │
│      called ideas.txt in it            │
│                                         │
│ 🤖 Plan:                                │
│   ✅ 1. Create folder "Projects"       │
│   ⏳ 2. Create file "ideas.txt"        │ ← running
│   ⬜ 3. Write content to ideas.txt     │ ← pending
│                                         │
│ You: now rename it to brainstorm.txt   │
│                                         │
│ 🤖 ✅ Renamed ideas.txt → brainstorm   │
│                                         │
│          [New conversation]             │
└─────────────────────────────────────────┘
```

**Implementation approach:**
- Keep the existing Spotlight's search/launch functionality (typing an app name still launches it instantly)
- Add a `.spotlight-thread` container below the input
- Each message is a `.spotlight-message` div with a role (`user` | `assistant` | `step-progress` | `clarification`)
- Step progress updates arrive via event bus: `step:started`, `step:completed`, `step:failed`
- Clarification questions render as inline forms with buttons; clicking a button injects the answer and re-plans
- Conversation memory persists across the session (graph nodes) so reopening Spotlight after a minimize shows the full thread

---

## Implementation plan

### Phase 1: OS Action API + expanded capabilities (Week 1)

- `js/kernel/os-actions.js` — the action registry (register, list, describe)
- Expand capability-providers.js with the missing actions:
  - `file.create`, `file.createFolder`, `file.read`, `file.delete`, `file.rename`, `file.search`
  - `app.close`, `window.focus`, `window.minimize`
  - `terminal.run` (L2!), `browser.navigate`
  - `notes.search`, `settings.change`, `notification.show`
- Map each new capability to the M1 registry with proper LEVEL/REVERSIBILITY/BLAST_RADIUS
- Sanity tests: every action registered, every capability callable

### Phase 2: Context system + conversation memory (Week 1-2)

- `js/kernel/context-system.js` — the context snapshot builder
- `js/kernel/conversation-memory.js` — graph-backed turn storage
- Wire context system to read from windowManager, processManager, menubar state
- Wire conversation memory to use graphStore `createNode('conversation-turn', ...)`
- Tests: context snapshot includes expected fields; turns persist across calls

### Phase 3: Intent planner (Week 2-3)

- `js/kernel/intent-planner.js` — the multi-step decomposition engine
- Prompt engineering: build the S2 prompt with capabilities list, context, conversation history, and output format
- Wire planner → executor → graph (plan stored as node, each step result linked)
- Clarification flow: planner returns questions → surface in Spotlight → user answers → re-plan
- Fallback: if S2 unavailable, run single-step (same as today)
- Tests: canonical demo ("create folder + file + content") decomposes into 3 steps

### Phase 4: Spotlight multi-turn UI (Week 3-4)

- Rewrite `js/shell/spotlight.js` to support the conversation thread
- Keep instant app-launch for single-word queries (don't break existing UX)
- Stream step progress via event bus
- Clarification inline forms
- "New conversation" button
- Persist thread across minimize/restore
- CSS polish: typing animation, step icons, responsive layout

### Phase 5: Polish + ship (Week 4)

- End-to-end test: the canonical deliverable ("create a folder called Projects on the Desktop and put a file called ideas.txt in it with some project ideas")
- Follow-up test: "now rename it to brainstorm.txt" → resolves "it" via conversation memory
- Error-path test: a step fails mid-plan → user sees the failure, can retry or abort
- Update PLAN.md, lessons.md, SESSION_HANDOFF.md
- Commit + push

---

## Risks + inversions

| Will break | Inverted fix |
|---|---|
| S2 API call in the planner is slow (2-3s) | Show "Planning…" spinner in Spotlight immediately; single-step intents skip the planner entirely |
| S2 returns malformed JSON plan | Parse in a try/catch; on failure, fall back to single-step or ask user to rephrase |
| Planner hallucinates a capability that doesn't exist | Validate every step's `capability` against the action registry before executing; surface "I don't know how to do X" |
| Context snapshot stale by the time the plan executes | Re-gather context before EACH step, not just at plan time — cheap enough since it's all sync |
| Conversation memory grows unbounded | Cap at 50 turns per session; oldest turns are compacted (keep query + result, drop step details) |
| "Rename it" fails because pronoun resolution is wrong | Surface "I think 'it' refers to <X> — is that right?" as a clarification instead of silently guessing wrong |
| Multi-step plan modifies a file then tries to read it before the write completes | Step executor enforces `dependsOn` ordering: a step doesn't start until all its dependencies have `status: 'completed'` |
| Spotlight stays open and blocks the desktop | Spotlight is a panel, not a modal. Desktop + dock + menubar remain clickable. Clicking outside minimizes it. |
| User closes Spotlight mid-plan | Steps that haven't started are cancelled; steps in-flight complete but results are logged to conversation memory for later |
| Step executor runs a dangerous command (terminal.run) without asking | terminal.run is L2 (requires per-session unlock). The step executor checks LEVEL before executing; L2+ steps surface a confirmation dialog via Spotlight |
| API key exhaustion during a 10-step plan | Budget tracker (already in intent-executor.js) enforces per-day cap; if budget is exceeded mid-plan, remaining steps are paused and user is notified |

---

## What this sets up for free

| Milestone | How Agent Core helps |
|---|---|
| **M3 Dual-brain** | The planner already routes to S2. When S1 (local Ollama) is available, the planner tries S1 first and escalates to S2 on low confidence — the planner becomes the routing layer. |
| **M4 Verifiable codegen** | Plans are stored as graph nodes with provenance. "Build me a habit tracker" becomes a plan → spec → tests → code, each linked as a subgraph. |
| **M5 Reversibility** | Each step's result includes a mutation id. `rewindTo` can undo the entire plan by walking the step chain backward. |
| **M6 Socratic loop** | Clarification flow IS the Socratic loop for the planning phase. Red-team agent reviews the plan before execution starts. |
| **M7 Skill marketplace** | A "skill" is a saved plan template. "Morning routine" = plan that opens Weather + Calendar + Notes. Users share plans as intent files. |

---

## Backward compatibility

- Single-step intents (open, close, mute, compute, etc.) keep working exactly as they do today. The planner short-circuits them.
- Spotlight still launches apps instantly on single-word queries.
- The 13 existing capability providers are untouched — new file/app/window actions are ADDED, not replacing.
- If S2 (Claude API) is unavailable, the OS degrades to M1 behavior (single-step only). It never breaks.
- Graph-backed conversation memory uses the same graphStore that Notes/Todo/Reminders use. No new storage layer.

---

## Open questions for Phase 3 (planner prompt engineering)

1. **How much context to include in the planner prompt?** Full context snapshot is ~500 tokens. Last 5 conversation turns add ~200 tokens each. Capability list is ~1000 tokens. Total: ~2500 tokens of context per plan request. This is fine for Claude, but S1 (when it arrives in M3) might struggle. Decision: full context for S2, truncated for S1.

2. **Should the planner output be streaming or all-at-once?** If the plan takes 3s to generate and we wait for the complete JSON, the UX feels slow. Alternative: stream the plan step-by-step as S2 emits tokens. But parsing partial JSON is fragile. Decision: wait for complete response, but show a "Planning…" spinner immediately. The total wall time (plan + execute) is still shorter than a human doing it manually.

3. **How to handle ambiguous step ordering?** "Move file A to folder B and rename file C" — are these parallel or sequential? If parallel, do we `Promise.all` the steps? Decision: default to sequential (safer); add a `parallel: true` flag on independent steps that the planner can set when it's confident they don't interact.
