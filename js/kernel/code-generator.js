// Astrion OS — Code Generator with Test-Driven Iteration (M4.P3.b)
//
// The piece that closes the M4 promise. Given a frozen spec + a
// generated test suite, ask the model to write JS code that makes
// every test pass. Run it. If anything fails, ask again with the
// failures echoed back. Bounded retries (default 3) before reporting
// failure.
//
// This is the "code-to-pass-tests" inversion of the usual flow:
//   - Spec is the SOURCE OF TRUTH (frozen, user-approved).
//   - Tests are EXECUTABLE acceptance criteria (M4.P2 generated).
//   - Code is what the model writes to satisfy the tests.
//
// Stored as a 'generated-code' graph node with edges to the suite
// (and transitively to the spec). M4.P4 will tighten this to a full
// 'generated-app' node; for P3.b we just persist the artifact + the
// iteration history.
//
// Non-goals here:
//   - App promotion / dock placement (M4.P4).
//   - Multi-file output, build steps, framework code (single JS blob
//     that defines App + helpers in one chunk).
//   - Performance profiling / coverage.

import { aiService } from './ai-service.js';
import { graphStore } from './graph-store.js';
import { getSpec } from './spec-generator.js';
import { getTestSuite } from './test-generator.js';
import { runSuite } from './test-runner.js';

const CODE_NODE_TYPE = 'generated-code';
const MAX_ATTEMPTS = 3;

// ─── Prompt construction ───

function buildCodePrompt(spec, suite) {
  const criteriaLines = spec.acceptance_criteria.map((c, i) => `  ${i}. ${c}`).join('\n');
  const testLines = suite.tests.map(t =>
    `  // [${t.criterionIndex}] ${t.title}\n` +
    `  ${t.setup}\n` +
    `  ${t.act}\n` +
    `  ${t.assert}\n`
  ).join('\n');

  return `You are the Astrion OS code generator. Write JavaScript that
makes every test below pass. Output JSON only.

GOAL: ${JSON.stringify(spec.goal)}

ACCEPTANCE CRITERIA:
${criteriaLines}

UX NOTES (informational only):
${JSON.stringify(spec.ux_notes || '')}

TEST CASES THE CODE MUST PASS:
${testLines}

OUTPUT SHAPE:
{
  "code": "// JavaScript code as a single string. Define every class,\\n// function, and helper the tests reference. Do NOT export — the\\n// runner evaluates this in a sandbox iframe and the symbols are\\n// available globally inside that scope.",
  "summary": "one short sentence describing the implementation"
}

RULES:
1. The code is a single JavaScript string (no modules, no imports,
   no requires). Tests evaluate it via new Function() in an isolated
   iframe.
2. Every class/function the tests use MUST be defined here. If a
   test setup says "const a = new App();", define class App.
3. Do NOT use fetch, XMLHttpRequest, WebSocket, eval, Function,
   setTimeout, setInterval, importScripts, or any DOM API. The
   sandbox blocks them, and the validator rejects them.
4. Code MUST be syntactically valid JavaScript. The runner will
   refuse to load malformed code.
5. Keep it small. < 4000 chars total.
6. Respond with JSON only, no prose, no markdown.`;
}

function buildRetryPrompt(spec, suite, lastCode, failures) {
  const failureLines = failures.map(f =>
    `  [${f.index}] ${f.title}\n` +
    `      error: ${f.error}`
  ).join('\n');

  return `${buildCodePrompt(spec, suite)}

YOUR PREVIOUS CODE FAILED ${failures.length} TEST(S):
${failureLines}

YOUR PREVIOUS CODE:
\`\`\`js
${(lastCode || '').slice(0, 2000)}
\`\`\`

Fix the failing tests. The passing tests must continue to pass.
Respond with JSON only.`;
}

// ─── Tolerant JSON parse ───

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

// ─── Code validation ───

function validateCode(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'payload not an object' };
  if (typeof payload.code !== 'string' || !payload.code.trim()) {
    return { ok: false, error: 'code must be a non-empty string' };
  }
  if (payload.code.length > 8000) {
    return { ok: false, error: 'code too long (' + payload.code.length + ' > 8000)' };
  }
  // Forbidden tokens — same set as the test-generator validator plus
  // a few timer-style escape hatches. Defense in depth: the iframe
  // sandbox already blocks the network ones; we still reject them so
  // a buggy plan fails up-front instead of later.
  const FORBIDDEN = /\b(import|require|fetch|XMLHttpRequest|WebSocket|eval|Function|setTimeout|setInterval|setImmediate|importScripts|document|window\.parent|window\.top)\b/i;
  if (FORBIDDEN.test(payload.code)) {
    return { ok: false, error: 'code contains forbidden token (no imports/eval/network/timers/DOM)' };
  }
  // Cheap syntax check via Function constructor.
  try {
    new Function(payload.code);
  } catch (err) {
    return { ok: false, error: 'code is syntactically invalid: ' + err.message };
  }
  return { ok: true };
}

// ─── Public API ───

/**
 * Generate code that satisfies a spec + suite, iterating until tests
 * pass or MAX_ATTEMPTS is exhausted.
 *
 * @param {string} suiteId
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @returns {Promise<{
 *   status: 'ok' | 'failed',
 *   code?: string,
 *   summary?: string,
 *   attempts: number,
 *   history: Array<{attempt, code, results}>,
 *   finalResults?: object,
 *   error?: string,
 * }>}
 */
export async function generateCode(suiteId, opts = {}) {
  if (!suiteId || typeof suiteId !== 'string') {
    return { status: 'failed', error: 'suiteId required', attempts: 0, history: [] };
  }
  const suite = await getTestSuite(suiteId);
  if (!suite) return { status: 'failed', error: 'suite not found: ' + suiteId, attempts: 0, history: [] };
  const spec = await getSpec(suite.specId);
  if (!spec) return { status: 'failed', error: 'spec not found: ' + suite.specId, attempts: 0, history: [] };
  if (spec.status !== 'frozen') {
    return { status: 'failed', error: 'spec must be frozen', attempts: 0, history: [] };
  }

  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts || MAX_ATTEMPTS, 5));
  const history = [];
  let lastCode = '';
  let lastResults = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = attempt === 1
      ? buildCodePrompt(spec, suite)
      : buildRetryPrompt(spec, suite, lastCode, lastResults.results.filter(r => !r.ok));

    let raw, meta;
    try {
      const r = await aiService.askWithMeta(prompt, {
        maxTokens: 2000, skipHistory: true, capCategory: 'code', format: 'json',
      });
      raw = r.reply;
      meta = r.meta;
    } catch (err) {
      return { status: 'failed', error: 'ai call threw: ' + (err?.message || err), attempts: attempt - 1, history };
    }

    const parsed = tryParseJSON(raw);
    const validation = parsed ? validateCode(parsed) : { ok: false, error: 'could not parse JSON' };
    if (!validation.ok) {
      // Treat parse / schema failure as a failed attempt and retry.
      history.push({ attempt, code: '', results: { ok: false, error: validation.error }, validationError: validation.error, raw });
      lastCode = '';
      lastResults = { results: spec.acceptance_criteria.map((_, i) => ({ index: i, ok: false, error: validation.error, title: 'parse-failure' })) };
      continue;
    }

    lastCode = parsed.code;
    let runResult;
    try {
      runResult = await runSuite(suiteId, { sharedCode: parsed.code });
    } catch (err) {
      // Sandbox load can throw on syntactically valid but semantically
      // broken code (e.g. "throw new Error('fail')" at top level).
      history.push({ attempt, code: parsed.code, results: { ok: false, error: 'sandbox load threw: ' + err.message } });
      lastResults = { results: spec.acceptance_criteria.map((_, i) => ({ index: i, ok: false, error: err.message, title: 'load-failure' })) };
      continue;
    }
    lastResults = runResult;
    history.push({ attempt, code: parsed.code, summary: parsed.summary || '', results: runResult, meta });

    if (runResult.passes === runResult.total) {
      // All tests pass — done.
      return {
        status: 'ok',
        code: parsed.code,
        summary: parsed.summary || '',
        attempts: attempt,
        history,
        finalResults: runResult,
      };
    }
    // else loop again
  }

  return {
    status: 'failed',
    error: `tests still failing after ${maxAttempts} attempts (${lastResults?.passes || 0}/${lastResults?.total || 0} pass)`,
    attempts: maxAttempts,
    history,
    finalResults: lastResults,
  };
}

/**
 * Persist a generated-code artifact in the graph + edges back to the
 * suite (and transitively the spec). Returns the new node id.
 */
export async function storeGeneratedCode(suiteId, payload) {
  if (!suiteId) throw new Error('storeGeneratedCode: suiteId required');
  const node = await graphStore.createNode(CODE_NODE_TYPE, {
    suiteId,
    code: payload.code || '',
    summary: payload.summary || '',
    attempts: payload.attempts || 1,
    status: payload.status || 'ok',
    finalResults: payload.finalResults || null,
    history: (payload.history || []).map(h => ({
      attempt: h.attempt,
      passes: h.results?.passes,
      total: h.results?.total,
      brain: h.meta?.brain,
      model: h.meta?.model,
    })),
    createdAt: Date.now(),
  }, {
    createdBy: { kind: 'system', capabilityId: 'code.generate' },
  });
  try {
    await graphStore.addEdge(node.id, 'implements', suiteId);
  } catch (err) {
    console.warn('[code-generator] could not create implements edge:', err?.message);
  }
  return node.id;
}

/** Read back a stored code artifact. */
export async function getGeneratedCode(id) {
  const node = await graphStore.getNode(id);
  if (!node || node.type !== CODE_NODE_TYPE) return null;
  return { id: node.id, ...node.props };
}

// ─── Sanity tests ───

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const tests = [
    { payload: { code: 'class App { constructor(){this.list=[]} add(x){this.list.push(x)} list(){return this.list} }' }, expectOk: true },
    { payload: { code: '' }, expectOk: false },
    { payload: { code: 'fetch("/x")' }, expectOk: false }, // forbidden token
    { payload: { code: 'this is not valid js (' }, expectOk: false }, // syntax err
    { payload: { code: 'a'.repeat(9000) }, expectOk: false }, // too long
    { payload: null, expectOk: false },
  ];
  let fail = 0;
  for (const t of tests) {
    const v = validateCode(t.payload);
    if (v.ok !== t.expectOk) {
      console.warn('[code-generator] validate FAIL:', String(t.payload?.code).slice(0, 50), '→', v);
      fail++;
    }
  }
  if (fail === 0) console.log('[code-generator] all 6 sanity tests pass');
  else console.warn('[code-generator]', fail, 'sanity tests failed');
}
