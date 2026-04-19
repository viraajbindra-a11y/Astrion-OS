// Astrion OS — Test Generator (M4.P2)
//
// Second phase of Verifiable Code Generation. Take a FROZEN spec and
// produce a structured suite of unit tests, one per acceptance
// criterion. The tests are stored as a 'test-suite' graph node with
// an edge back to the spec.
//
// Critical ordering rule (lesson from PLAN.md M4 inversion table):
// tests come from the spec, not the code. If you generate tests from
// already-written code, you just describe what the code does, which
// proves nothing. Spec-first → tests-from-spec → code-to-pass-tests
// is the only order that gives the user a real safety guarantee.
//
// Each test is shape-stable so M4.P3 can execute them in a sandbox
// without the AI needing to re-read the contract:
//
//   {
//     title: 'streak resets on a missed day',     // human-readable
//     setup: 'const app = new HabitTracker(); ...', // JS code string
//     act:   'app.toggleHabit("water", "2026-04-18"); ...',
//     assert: 'expect(app.streakOf("water")).toBe(0);',
//     criterionIndex: 2,                            // back-pointer
//   }
//
// The generator does NOT execute these — that's M4.P3. It also does
// not generate the code under test — that's M4.P3 too. M4.P2's only
// job is: spec -> shape-valid test suite, stored in the graph.

import { aiService } from './ai-service.js';
import { graphStore } from './graph-store.js';
import { query as graphQuery } from './graph-query.js';
import { getSpec } from './spec-generator.js';

const SUITE_TYPE = 'test-suite';

// ─── Prompt construction ───

function buildTestPrompt(spec) {
  const criteriaLines = spec.acceptance_criteria
    .map((c, i) => `  ${i}. ${c}`)
    .join('\n');
  const ngLines = (spec.non_goals || []).length
    ? '\nNON-GOALS (do NOT write tests for these):\n' + spec.non_goals.map(n => '  - ' + n).join('\n')
    : '';

  return `You are the Astrion OS test generator. Convert each acceptance
criterion below into ONE structured unit test. Output JSON only.

GOAL: ${JSON.stringify(spec.goal)}

ACCEPTANCE CRITERIA:
${criteriaLines}
${ngLines}

UX NOTES (informational only; do NOT write tests for these):
${JSON.stringify(spec.ux_notes || '')}

OUTPUT SHAPE (the values below are REAL CODE — DO NOT include "//" comment
prefixes; write executable JavaScript statements):
{
  "tests": [
    {
      "title": "short human-readable title for this test",
      "setup":  "const app = new App();",
      "act":    "app.add(2, 3);",
      "assert": "expect(app.result).toBe(5);",
      "criterionIndex": 0
    }
  ]
}

RULES:
1. EXACTLY one test per acceptance criterion. The order of "tests"
   must match the order of acceptance_criteria. criterionIndex must
   be the matching numeric index.
2. setup, act, assert MUST be executable JavaScript — NOT JavaScript
   wrapped in "//" comments. If you write "// const app = new App()",
   nothing runs and the test is rejected. Write "const app = new App();"
   instead.
3. "assert" MUST contain at least one un-commented expect(...).toBe(...)
   (or .toEqual / .toBeTruthy / .toBeFalsy / .toContain / .toBeGreaterThan
   / .toBeLessThan) call. A commented expect does not count.
4. No imports, no require, no fetch, no eval, no Function — these are
   blocked by the validator. The matcher "expect(value)" is already in
   scope.
5. Reference an unspecified "App" class — e.g. "const app = new App()".
   The code generator implements App next; you only describe its
   externally-visible behavior.
6. Do NOT write tests for non_goals or ux_notes.
7. Keep each block short. setup + act + assert combined < 400 chars
   per test.
8. Respond with JSON only, nothing else.`;
}

// ─── Tolerant JSON parse (same as planner / spec-gen) ───

function tryParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  return null;
}

// ─── Schema validation ───

function validateSuite(suite, spec) {
  if (!suite || typeof suite !== 'object') return { ok: false, error: 'suite not an object' };
  if (!Array.isArray(suite.tests)) return { ok: false, error: 'tests must be an array' };
  if (suite.tests.length === 0) return { ok: false, error: 'tests array is empty' };
  if (suite.tests.length !== spec.acceptance_criteria.length) {
    return { ok: false, error: `tests count ${suite.tests.length} does not match criteria count ${spec.acceptance_criteria.length}` };
  }
  for (let i = 0; i < suite.tests.length; i++) {
    const t = suite.tests[i];
    if (!t || typeof t !== 'object') return { ok: false, error: `tests[${i}] not an object` };
    if (typeof t.title !== 'string' || !t.title.trim()) return { ok: false, error: `tests[${i}].title required` };
    for (const k of ['setup', 'act', 'assert']) {
      if (typeof t[k] !== 'string') return { ok: false, error: `tests[${i}].${k} must be a string` };
    }
    if (t.criterionIndex !== i) {
      return { ok: false, error: `tests[${i}].criterionIndex must be ${i}, got ${t.criterionIndex}` };
    }
    const blob = (t.setup + t.act + t.assert);
    if (blob.length > 400) {
      return { ok: false, error: `tests[${i}] code blob too long (${blob.length} > 400)` };
    }
    // Reject obvious syscalls / injection attempts inside the test body
    if (/\b(import|require|fetch|XMLHttpRequest|WebSocket|eval|Function)\s*\(?/i.test(blob)) {
      return { ok: false, error: `tests[${i}] contains forbidden token (no imports/eval/network in tests)` };
    }
    // Reject tests whose `assert` is just a commented-out expect call.
    // qwen2.5:7b sometimes returns "// expect(app.getResult()).toBe('5')"
    // — every line a comment. The naive includes-"expect(" check passes
    // because the literal substring is there, but at runtime nothing
    // fires and the sandbox marks the test PASS by default. That breaks
    // the M4 safety contract: code "passing tests" that don't test.
    // Strip comments first, THEN check for expect( — synthetic fixtures
    // (e.g. expect(true).toBeTruthy() with empty setup/act) still pass.
    const stripComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim();
    const assertNoComments = stripComments(t.assert);
    if (!assertNoComments) {
      return { ok: false, error: `tests[${i}].assert is empty after removing comments` };
    }
    if (!/expect\s*\(/.test(assertNoComments)) {
      return { ok: false, error: `tests[${i}].assert must contain at least one un-commented expect(...) call` };
    }
  }
  return { ok: true };
}

// ─── Public API ───

/**
 * Generate a test suite from a frozen spec id. Returns
 * { status: 'ok' | 'failed', suite?, error?, meta? }. The spec must
 * exist and be in 'frozen' status — drafts are rejected so users can't
 * accidentally test against criteria that haven't been approved.
 */
export async function generateTests(specId) {
  if (!specId || typeof specId !== 'string') {
    return { status: 'failed', error: 'specId required' };
  }
  const spec = await getSpec(specId);
  if (!spec) return { status: 'failed', error: 'spec not found: ' + specId };
  if (spec.status !== 'frozen') {
    return { status: 'failed', error: `spec must be frozen to generate tests; current status: ${spec.status}` };
  }

  const prompt = buildTestPrompt(spec);
  let raw, meta;
  try {
    const r = await aiService.askWithMeta(prompt, {
      maxTokens: 1200, skipHistory: true, capCategory: 'tests', format: 'json',
    });
    raw = r.reply;
    meta = r.meta;
  } catch (err) {
    return { status: 'failed', error: `tests ai call threw: ${err?.message || err}` };
  }

  let suite = tryParseJSON(raw);
  let validation = suite ? validateSuite(suite, spec) : { ok: false, error: 'could not parse JSON' };

  if (!validation.ok) {
    const retryPrompt = `${prompt}

YOUR PREVIOUS RESPONSE WAS REJECTED:
\`\`\`
${(raw || '').slice(0, 400)}
\`\`\`
REJECTION REASON: ${validation.error}

Try again. Respond with JSON only.`;
    let retryRaw;
    try {
      const r = await aiService.askWithMeta(retryPrompt, {
        maxTokens: 1200, skipHistory: true, capCategory: 'tests', format: 'json',
      });
      retryRaw = r.reply;
      meta = r.meta;
    } catch (err) {
      return { status: 'failed', error: `tests retry threw: ${err?.message || err}`, raw, meta };
    }
    const retrySuite = tryParseJSON(retryRaw);
    const retryValidation = retrySuite ? validateSuite(retrySuite, spec) : { ok: false, error: 'retry also un-parseable' };
    if (!retryValidation.ok) {
      const kind = retrySuite ? 'invalid' : 'unparseable';
      return {
        status: 'failed',
        error: `tests output ${kind} twice: ${retryValidation.error}`,
        raw: retryRaw || raw, meta,
      };
    }
    suite = retrySuite;
  }

  return {
    status: 'ok',
    suite: {
      specId,
      tests: suite.tests.map(t => ({
        title: t.title.trim(),
        setup: t.setup,
        act: t.act,
        assert: t.assert,
        criterionIndex: t.criterionIndex,
      })),
      generatedAt: Date.now(),
      model: meta?.model || 'unknown',
    },
    meta, raw,
  };
}

/**
 * Persist a generated suite into the graph + create a 'covers' edge
 * back to the spec node. Returns the suite node id.
 */
export async function storeTestSuite(suite) {
  if (!suite || typeof suite !== 'object') throw new Error('storeTestSuite: suite required');
  if (!suite.specId) throw new Error('storeTestSuite: suite.specId required');
  const node = await graphStore.createNode(SUITE_TYPE, {
    specId: suite.specId,
    tests: suite.tests || [],
    generatedAt: suite.generatedAt || Date.now(),
    model: suite.model || 'unknown',
    status: 'generated',
    lastRunAt: null,
    lastRunResults: null,
  }, {
    createdBy: { kind: 'system', capabilityId: 'tests.generate' },
  });
  // Edge: suite -[covers]-> spec
  try {
    await graphStore.addEdge(node.id, 'covers', suite.specId);
  } catch (err) {
    // Edge creation is non-critical for test storage — log + continue
    console.warn('[test-generator] could not create covers edge:', err?.message);
  }
  return node.id;
}

/** Read a suite by id. */
export async function getTestSuite(id) {
  const node = await graphStore.getNode(id);
  if (!node || node.type !== SUITE_TYPE) return null;
  return { id: node.id, ...node.props };
}

/** Find suites for a given spec id. Most recent first. */
export async function getSuitesForSpec(specId) {
  const results = await graphQuery(graphStore, {
    type: 'select',
    from: SUITE_TYPE,
    where: { 'props.specId': specId },
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit: 20,
  });
  return results.map(n => ({ id: n.id, ...n.props }));
}

/**
 * Record that a suite was run. Stores per-test pass/fail info + a
 * timestamp so M4.P3's runner can show progress and diffs across runs.
 *
 * results shape: [{ index, ok, error?, durationMs }]
 */
export async function recordSuiteRun(suiteId, results) {
  const node = await graphStore.getNode(suiteId);
  if (!node || node.type !== SUITE_TYPE) return null;
  const passes = results.filter(r => r.ok).length;
  return await graphStore.updateNode(suiteId, {
    ...node.props,
    lastRunAt: Date.now(),
    lastRunResults: results,
    lastRunPasses: passes,
    lastRunTotal: results.length,
  });
}

// ─── Sanity tests (run on localhost only) ───

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const fakeSpec = {
    goal: 'x',
    acceptance_criteria: ['c0', 'c1', 'c2'],
    non_goals: [],
    ux_notes: '',
  };
  const fakeTest = (i) => ({ title: 't'+i, setup: 's', act: 'a', assert: 'as', criterionIndex: i });
  const tests = [
    { suite: { tests: [0,1,2].map(fakeTest) }, expectOk: true },
    { suite: { tests: [0,1].map(fakeTest) }, expectOk: false }, // count mismatch
    { suite: { tests: [0,1,2].map(fakeTest).map(t => ({ ...t, criterionIndex: 99 })) }, expectOk: false }, // bad index
    { suite: { tests: [0,1,2].map(i => ({ ...fakeTest(i), setup: 'fetch("http://x")' })) }, expectOk: false }, // forbidden token
    { suite: { tests: [0,1,2].map(i => ({ ...fakeTest(i), assert: 'x'.repeat(500) })) }, expectOk: false }, // too long
    { suite: null, expectOk: false },
  ];
  let fail = 0;
  for (const t of tests) {
    const v = validateSuite(t.suite, fakeSpec);
    if (v.ok !== t.expectOk) {
      console.warn('[test-generator] validate FAIL:', JSON.stringify(t.suite)?.slice(0, 100), '→', v);
      fail++;
    }
  }
  if (fail === 0) console.log('[test-generator] all 6 sanity tests pass');
  else console.warn('[test-generator]', fail, 'sanity tests failed');
}
