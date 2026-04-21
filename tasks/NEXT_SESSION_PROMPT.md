# Paste this into the next session

```
Fresh session. Read in this order before touching anything:

SESSION_HANDOFF.md — full recap (top section is the latest 2026-04-18→20 session)
PLAN.md — milestones (M0–M6 done; M7 + M8 substrate shipped)
tasks/lessons.md — read lessons 144-155 (this session's lessons)

Then run:
- git status (working tree should be clean)
- git log --oneline -30 (last 30 commits are the prior session)
- node server/index.js
- open http://localhost:3000/test/v03-verification.html — should
  render 170/170 tests green across 16 sections
- in the live OS at http://localhost:3000, type "branches" /
  "timeline" / "morning summary" in Spotlight to exercise the
  shipped UI

Persona: completely serious, no sugarcoating, zero hallucination
tolerance. Memory file at ~/.claude/projects/-Users-parul-Nova-OS/
memory/user_persona.md is canonical.
Default behavior: execute, report, repeat. No trivial questions.
No narration. Verify every claim before stating it.

State of the world:

Architecturally finished (M0–M6 + M7 substrate + M8 substrate):
  M0 — Native shell + install ✅
  M1 — Intent Kernel ✅
  M2 — Hypergraph Storage ✅
  M3 — Dual-Process Runtime ✅
  M4 — Verifiable Code Generation ✅
       P1 spec.generate + freeze + P2 tests.generate + P3 sandbox
       runner + P3.b code-from-tests + P4 promote + dock surface
       (generated apps appear as launchable icons with provenance)
  M5 — Reversibility + Temporal ✅
       P1 branching + P2 interceptor + P2.b/c Spotlight + P3 rewind
       + P3.b branches command + P3.c timeline + P4 PONR
  M6 — Socratic + Red-Team ✅ (all phases)
       P1 red-team auto-review + P2 Socratic pre-planner + P3
       2-col preview UI + P4 rubber-stamp tracker + P4.b chaos
       injection + P4.c notification + Settings > Safety dashboard
  M7 — Skill Marketplace ✅ (cloud catalog deferred)
       P1 5-keyword DSL + 10 examples + P2 parser + registry +
       runner + Spotlight phrase dispatch + P2.c constraint
       enforcement + P3 expanded to 20 default skills + P4 first
       cut: enable/disable + Settings > Skills tab + scheduler
       (cron + event triggers fire) + user-installed skills
  M8 — Self-Modification ✅ (substrate; disk-write deferred)
       P1 golden integrity check (17 files SHA-256 lock) + P2
       value-lock + selfmod-sandbox stubs + P3 5-gate apply
       (golden + value-lock + red-team + typed-confirm + rollback-
       plan) + P3.b model diversity (red-team uses different
       model) + P4 drift detector

Real-Ollama hardening shipped: format:'json' wired through
server + ai-service + every generator + red-team. Timeouts
bumped to 60s/120s. test-generator validator + prompt fixed
(qwen comment-only false-pass closed).

What's NOT done (in priority order):

A) M8.P5 — actual disk-write side of self-mod. selfmod-sandbox.
   applyProposal walks all 5 gates and marks proposal 'approved'
   today; nothing actually mutates source. Needs a server-side
   write API + a signed request flow + the rollback automation
   from M8.P4 (today the drift detector exists but rollback
   execution is stubbed because there's no real apply to roll
   back from). Substantive safety conversation before shipping.

B) Real Anthropic API E2E with funded ANTHROPIC_API_KEY. Stubs
   prove wiring; real API proves Claude's prompt + JSON tolerance
   for spec/test/code generators + red-team. (User said "no
   anthropic" in prior session — only when Agent Core starts.)

C) Real Ollama M4 chain end-to-end: spec ✓ + tests ✓ verified
   live in prior session. code.generate untested with the post-
   fix prompt + validator. ~3 min run; would be the canonical
   "spec → tests → code → bundle → app in dock" demo on local
   Ollama.

D) Native ISO E2E with all 80 apps + Ollama + the new safety
   substrate (chaos / drift / golden). Build a fresh ISO first
   (distro/build.sh) since the last release predates this
   session's many kernel additions.

E) Cloud marketplace backend (M7.P4 expansion): real auth,
   payment, moderation queue, hosted catalog. Needs external
   infra; not a single-commit deliverable.

F) M7.P2.d — proper predicate parser for skill `when:` clauses
   and event `where:` clauses. Today's substring + tiny
   `ident OP value` parser is enough for the shipped skills but
   won't survive arbitrary user-authored expressions.

G) M8.P3.b model diversity — config exists; needs a documented
   second model the user can pull (e.g. llama3.2 or qwen2.5:1.5b)
   so "Red-team model: llama3.2" works without a manual `ollama
   pull`. Could add an Ollama Pull button under the new field.

H) safeMathEval edge cases beyond scientific notation — already
   shipped 1e6 + unary +. Could extend to `Math.PI` constants,
   percent (%), maybe trig.

If the user has no specific direction, suggest C first (real-
Ollama M4 chain end-to-end through code.generate). Everything
upstream is verified; the prompt + validator fixes from this
session SHOULD make it work but it hasn't been demonstrated
end-to-end.

Auto-push job (launchd, every 30 min): runs scripts/auto-push.sh
which pushes any unpushed commits on the current branch. Lesson
#147: Mac sleep pauses the StartInterval, so launches catch up
on wake. Logs at scripts/auto-push.log. Re-install via
scripts/AUTO_PUSH_README.md.

Architecture refresher (high level):

- Spotlight handleSubmit cascades:
  1. interception confirm/abort (M5.P2.c)
  2. plan confirm (M2 Agent Core)
  3. SKILL phrase match (M7.P2b) — runSkill emits intent:plan
     with skill metadata
  4. Socratic pre-planner check (M6.P2) — if confidence < 0.85,
     ask the model to clarify
  5. Multi-step plan path
  6. Fast single-shot intent
  7. Web/AI fallback

- intent:plan handler (intent-executor.js):
  1. planIntent → status:'plan' or 'clarify' or 'failed'
  2. executePlan(plan, { skill }) — resolves caps, computes total
     cost
  3. M7.P2c skill constraint check — refuses if any step exceeds
     skill.constraints.level/reversibility
  4. Budget reservation (M3.P2)
  5. plan:preview if maxLevel >= L2 → user gate (Spotlight UI
     + red-team review side-by-side per M6.P3)
  6. Sequential execution with bind resolution

- Self-mod gates (selfmod-sandbox.applyProposal):
  - golden-integrity (verifyGolden — SHA-256 over 17 locked files)
  - value-lock (verifyValueLock — canonical hash of LOCKED_VALUES)
  - red-team-signoff (reviewAction with model diversity)
  - user-typed-confirm (opts.typedConfirm === proposal id)
  - rollback-plan (proposal.rollbackDiff non-empty)
  ALL pass → status='approved' (no source write yet — M8.P5)

- Skill scheduler:
  - 1-minute cron tick fires runSkill if cron expr matches AND
    skill is enabled.
  - eventBus.on for each skill's event trigger; matchesWhere
    predicate on payload.

- Auto-push:
  - launchd plist at ~/Library/LaunchAgents/com.astrion.autopush.plist
  - StartInterval 1800s; RunAtLoad true.
  - scripts/auto-push.sh refuses during rebase/merge/cherry-pick.

Verification: /test/v03-verification.html — 170 tests, 16
sections, 0 API key. Resets nova-ai-provider='mock' +
astrion-budget-day at page load. Re-run after every kernel-
layer change. Real-Ollama tests need provider explicitly set
to 'ollama' after visiting v03.

Working tree is clean. The 30 commits this session (latest first):
  b6e89d4 docs: lessons 144-155
  39887f3 M7.P4 step 2: user-installed skills
  1c525b3 M8.P3.b red-team model diversity
  2f4a587 M7 scheduler: cron + event triggers fire
  20e2e55 M8.P4 partial: drift detector
  498656d M8.P3 self-mod 5-gate apply
  8a36a82 M8.P2 value-lock + selfmod-sandbox stubs
  f316f23 M8.P1 frozen golden test suite
  d3357bf M7.P4 first cut: enable/disable + Settings > Skills
  f6e4b22 M7.P3 expanded to 20 default skills
  e453b58 M7.P2c skill constraint enforcement
  7344fe9 M7.P2b skill registry + runner + Spotlight phrase
  091793d M7.P2a skill parser
  f4a8653 M7.P1 spec + 10 reference skills
  3cae10c Socratic UI extension to branch caps
  3e0e31e safeMathEval scientific notation
  8e9e4bb Settings > Safety dashboard
  b8cb264 M6.P4.b chaos injection
  5fdb761 M6.P3 planner-vs-red-team 2-col UI
  75b22be M6.P2 Socratic prompter
  ac31752 M5.P3.c timeline view
  9c94fc7 M4 Socratic UI for spec.freeze
  7c03266 M4 dock surface
  5a1e265 red-team timeout 10→60s
  57840e0 test-generator prompt fix (qwen comment-only)
  acbaa4c test-generator validator (comment-only assert)
  aaffab5 Ollama JSON-mode round 2 (test/code/planner/red-team)
  a2f0db7 Ollama JSON-mode round 1 (spec-generator + 120s)
  7c1dde7 Auto-push launchd job
  c333c23 Setup wizard wallpaper picker fix

If you change anything that's testable, run the verification
suite again before claiming done.
```
