# Paste this into the next session

```
Fresh session. Read in this order before touching anything:

SESSION_HANDOFF.md — full recap (M0→M3 audit + ship + M4.P1/P2/P3 ship)
PLAN.md — milestones (M0.P3, M0.P4, M3, and M4.P1/P2/P3 are now done)
tasks/lessons.md — read lessons 99-114 (this session's lessons)

Then run:
- git status (working tree should be clean)
- git log --oneline -12 (last 8 commits are this session)
- node server/index.js
- open http://localhost:3000/test/v03-verification.html — should
  render 85/85 tests green

Persona: completely serious, no sugarcoating, zero hallucination
tolerance. Memory file at ~/.claude/projects/-Users-parul-Nova-OS/
memory/user_persona.md was rewritten on 2026-04-17 — read it.
Default behavior: execute, report, repeat. No trivial questions.
No narration. Verify every claim before stating it.

State of the world:

(1) Architecturally finished through M4.P3:
    - Intent Kernel (M1) — capability registry, executor, parser
    - Hypergraph Storage (M2) — graph-store, query, migration
    - Dual-Process Runtime (M3) — Ollama+Anthropic+budget+
      calibration+brain-tag-via-plan.meta
    - Verifiable Code Gen (M4.P1+P2+P3):
        spec-generator.js  — intent → frozen spec
        test-generator.js  — frozen spec → unit test suite
        test-runner.js     — sandboxed iframe runner with matchers
    - 5 new capabilities: spec.generate, spec.freeze (L2),
      tests.generate, tests.run (L1 SANDBOX)

(2) ISO ready to rebuild:
    - Ollama install added to distro/build.sh
    - All M0.P3/P4 wiring already in place
    - Run distro/build.sh to produce a fresh ISO that has the new
      bits — last ISO build was prior to this session.

(3) Verification: 85/85 tests offline at
    /test/v03-verification.html. The suite stubs aiService.askWithMeta
    so it runs without an API key. Re-run after any kernel change.

What's NOT done:

A) Real Anthropic API E2E with funded ANTHROPIC_API_KEY.
   Tests prove wiring; real API proves Claude's prompt + JSON
   tolerance for spec/test generation.

B) Real Ollama E2E. ai-service.js routes to /api/ai/ollama →
   localhost:11434 by default. Settings > AI > Test Connection +
   Pull Model both work; not soak-tested against real Ollama.

C) Native ISO E2E with all 80 apps + Ollama bundled. Hardware
   boot or full UTM run required. Build a new ISO first
   (distro/build.sh) since the last release predates these
   changes.

D) M4.P3.b — Code-from-tests iteration loop. The runner
   accepts pre-written tests; the next phase is asking the
   model to write code that satisfies a failing suite, run,
   capture failures, ask again with failures echoed. Bounded
   retries (~3) before asking the user.

E) M4.P4 — Provenance + App Promotion.
   - 'generated-app' graph node carrying intent + spec +
     suite + code + prompt history + model + seed
   - Promotion to dock requires user L2 unlock until M6 ships
     the red-team agent

F) Spotlight Socratic UI for spec approval. spec.freeze is
   callable but there's no nice UI flow. Reuse the existing
   L2+ preview gate pattern in spotlight.js.

G) safeMathEval doesn't handle scientific notation (1e6) or
   unary +(. Add tests + extend if users hit it.

If the user has no specific direction, suggest options A-C
first (verify what shipped against real APIs / hardware) before
starting M4.P3.b — there's no point shipping more layers on top
of M3+M4.P3 wiring that hasn't been proven against real APIs.

Architecture refresher:

- M4 chain: spec-generator.generateSpec → storeSpec → user
  freezeSpec → test-generator.generateTests → storeTestSuite →
  test-runner.runSuite → recordSuiteRun.

- Sandbox isolation: test-runner builds an iframe with
  sandbox="allow-scripts" (NOT allow-same-origin). Unique
  origin → no parent window/storage/network. Verified by an
  explicit "sandbox blocks parent localStorage access" test.

- Brain tag flow: aiService.askWithMeta returns {reply, meta}.
  Planner propagates meta. Executor reads plan.meta.brain.
  Race-safe per-call. Don't read localStorage('nova-ai-provider')
  to determine which brain answered — that's the original bug
  (lessons #100, #106).

- Schema validators are first-line defense. test-generator's
  validator rejects forbidden tokens (import|require|fetch|
  eval|Function) BEFORE the runner ever sees them. Two layers
  of defense: schema + sandbox.

- All 80 apps register in 3 boot.js blocks (spotlight popup,
  native mode, normal). Add new apps to all three. Native
  shell C registry at distro/nova-renderer/nova-shell.c
  (~line 156) also needs updating.

- Verification: /test/v03-verification.html. Re-run after every
  kernel-layer change. 85 tests, 10 sections, 0 API key.

Working tree is clean — every file change from this session is
in one of these 8 commits (latest first):
  0dbbe83 M4.P3 sandboxed runner
  e34f8c4 M4.P2 tests-from-spec
  4d8ac82 M4.P1 spec generator
  aa09740 docs (lessons 99-108)
  51463ce dialog migration
  22eb154 brain race-safe + safe math
  ea23740 M3.P1 Ollama in ISO
  b7de3ed M0.P3 chrome strip + verification suite

If you change anything that's testable, run the verification
suite again before claiming done.
```
