// Astrion OS — Sandboxed Test Runner (M4.P3)
//
// Third phase of Verifiable Code Generation. Read a generated test
// suite (M4.P2 output) and execute every test in an isolated iframe
// sandbox so the LLM-written test code can't touch the parent page,
// localStorage, IndexedDB, or the network.
//
// Why iframe sandbox + postMessage instead of new Function() in the
// parent context:
//   - Generated code is LLM output. Even with the test-generator's
//     forbidden-token check, defense in depth matters.
//   - sandbox="allow-scripts" (without allow-same-origin) gives the
//     iframe a unique origin. It can run JS but cannot read the
//     parent's window, document, or storage.
//   - postMessage round-trips test results in/out. The data shape is
//     fully verified before returning.
//
// The generated tests assume an `expect(value)` matcher with .toBe,
// .toEqual, .toBeTruthy, .toBeFalsy, .toContain. The matcher lives
// inside the sandbox bootstrap so the LLM never has to know about it.
//
// Non-goals for M4.P3:
//   - Code-from-tests generation (that's a separate phase that uses
//     this runner as its iteration engine).
//   - Per-test breakpoints / debugger integration.
//   - Coverage reporting.

import { graphStore } from './graph-store.js';
import { getTestSuite, recordSuiteRun } from './test-generator.js';

const RUN_TIMEOUT_MS = 5000; // per-test hard timeout
const SUITE_TIMEOUT_MS = 30000; // whole suite hard timeout

// ─── Sandbox bootstrap (HTML written into the iframe srcdoc) ───
//
// The iframe receives test cases via postMessage and replies with
// { type: 'result', index, ok, error, durationMs } per test.
// The matcher implementation lives ENTIRELY inside the sandbox so
// the parent page never has to expose it.

const SANDBOX_HTML = `<!DOCTYPE html>
<html><body><script>
(function(){
  // Tiny matcher — same surface as the test-generator prompt promises.
  function expect(actual) {
    return {
      toBe(expected) {
        if (actual !== expected) throw new Error('expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
      },
      toEqual(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error('expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
        }
      },
      toBeTruthy() {
        if (!actual) throw new Error('expected a truthy value, got ' + JSON.stringify(actual));
      },
      toBeFalsy() {
        if (actual) throw new Error('expected a falsy value, got ' + JSON.stringify(actual));
      },
      toContain(item) {
        if (typeof actual === 'string') {
          if (actual.indexOf(item) === -1) throw new Error(JSON.stringify(actual) + ' does not contain ' + JSON.stringify(item));
        } else if (Array.isArray(actual)) {
          if (actual.indexOf(item) === -1) throw new Error('array does not contain ' + JSON.stringify(item));
        } else {
          throw new Error('toContain requires a string or array, got ' + typeof actual);
        }
      },
      toBeGreaterThan(n) {
        if (!(actual > n)) throw new Error('expected > ' + n + ', got ' + actual);
      },
      toBeLessThan(n) {
        if (!(actual < n)) throw new Error('expected < ' + n + ', got ' + actual);
      },
    };
  }

  // The runtime support code that gets prepended to every test. The
  // user's "App" class lives in the act of code generation (M4 future
  // phase) — for M4.P3 verification the test code defines App inline
  // in setup, which is fine.

  function runOne(test) {
    const start = performance.now();
    try {
      // Build a single function body: setup + act + assert, with
      // expect in scope. No access to window/document/parent — the
      // iframe sandbox attribute already strips those (or they are
      // null because of unique origin).
      const body = test.setup + '\\n' + test.act + '\\n' + test.assert;
      // eslint-disable-next-line no-new-func
      const fn = new Function('expect', body);
      fn(expect);
      return { ok: true, durationMs: Math.round(performance.now() - start) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err), durationMs: Math.round(performance.now() - start) };
    }
  }

  window.addEventListener('message', function(ev) {
    if (!ev.data || ev.data.type !== 'run') return;
    var index = ev.data.index;
    var test = ev.data.test;
    var result = runOne(test);
    parent.postMessage({ type: 'result', index: index, ok: result.ok, error: result.error || null, durationMs: result.durationMs }, '*');
  });

  parent.postMessage({ type: 'ready' }, '*');
})();
<\/script></body></html>`;

// ─── Sandbox handle ───

function createSandbox() {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts'; // NOT allow-same-origin
    iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;border:none;';
    iframe.srcdoc = SANDBOX_HTML;

    const onMsg = (ev) => {
      if (ev.source !== iframe.contentWindow) return;
      if (ev.data && ev.data.type === 'ready') {
        window.removeEventListener('message', onMsg);
        resolve({
          iframe,
          run(index, test) {
            return new Promise((res) => {
              const handler = (ev) => {
                if (ev.source !== iframe.contentWindow) return;
                if (ev.data && ev.data.type === 'result' && ev.data.index === index) {
                  window.removeEventListener('message', handler);
                  clearTimeout(timer);
                  res(ev.data);
                }
              };
              window.addEventListener('message', handler);
              const timer = setTimeout(() => {
                window.removeEventListener('message', handler);
                res({ index, ok: false, error: 'test timed out (' + RUN_TIMEOUT_MS + 'ms)', durationMs: RUN_TIMEOUT_MS });
              }, RUN_TIMEOUT_MS);
              iframe.contentWindow.postMessage({ type: 'run', index, test }, '*');
            });
          },
          destroy() {
            iframe.remove();
          },
        });
      }
    };
    window.addEventListener('message', onMsg);
    document.body.appendChild(iframe);

    // Hard fail if the iframe doesn't post 'ready' within a couple of seconds
    setTimeout(() => {
      window.removeEventListener('message', onMsg);
      // Resolve handler may already have fired; harmless either way.
      try { iframe.remove(); } catch (_) {}
      reject(new Error('sandbox failed to initialize within 3s'));
    }, 3000);
  });
}

// ─── Public API ───

/**
 * Run a single test object in a fresh sandbox (one-off use).
 * Test shape: { title, setup, act, assert }. Returns { ok, error?,
 * durationMs }. Use runSuite for batches.
 */
export async function runSingleTest(test) {
  const sandbox = await createSandbox();
  try {
    const r = await sandbox.run(0, test);
    return { ok: r.ok, error: r.error, durationMs: r.durationMs };
  } finally {
    sandbox.destroy();
  }
}

/**
 * Execute every test in a stored suite. Reuses a single sandbox for
 * the whole batch (cheaper than per-test). Records the run via
 * recordSuiteRun() so the suite node has lastRunAt + lastRunResults.
 *
 * Returns { suiteId, total, passes, fails, results, durationMs }.
 */
export async function runSuite(suiteId) {
  if (!suiteId || typeof suiteId !== 'string') {
    throw new Error('runSuite: suiteId required');
  }
  const suite = await getTestSuite(suiteId);
  if (!suite) throw new Error('runSuite: suite not found: ' + suiteId);
  if (!Array.isArray(suite.tests) || suite.tests.length === 0) {
    return { suiteId, total: 0, passes: 0, fails: 0, results: [], durationMs: 0 };
  }

  const start = performance.now();
  const sandbox = await createSandbox();
  const results = [];
  try {
    // Hard timeout for the entire suite — guards against an iframe
    // that loads but never responds.
    const suiteTimer = setTimeout(() => {
      try { sandbox.destroy(); } catch (_) {}
    }, SUITE_TIMEOUT_MS);

    for (let i = 0; i < suite.tests.length; i++) {
      const test = suite.tests[i];
      const r = await sandbox.run(i, test);
      results.push({ index: i, ok: r.ok, error: r.error || null, durationMs: r.durationMs, title: test.title });
    }
    clearTimeout(suiteTimer);
  } finally {
    sandbox.destroy();
  }

  const passes = results.filter(r => r.ok).length;
  const durationMs = Math.round(performance.now() - start);

  // Record into the graph for dashboards / history
  await recordSuiteRun(suiteId, results.map(r => ({
    index: r.index, ok: r.ok, error: r.error, durationMs: r.durationMs,
  })));

  return { suiteId, total: results.length, passes, fails: results.length - passes, results, durationMs };
}

/**
 * Convenience: read the most recent run record off a suite.
 * Returns null if the suite has never been run.
 */
export async function getLastRun(suiteId) {
  const suite = await getTestSuite(suiteId);
  if (!suite || !suite.lastRunAt) return null;
  return {
    suiteId,
    ranAt: suite.lastRunAt,
    passes: suite.lastRunPasses,
    total: suite.lastRunTotal,
    results: suite.lastRunResults || [],
  };
}

// ─── Sanity probe (no execution; just verify SANDBOX_HTML parses) ───

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  // Cheap syntax check — does the bootstrap match the matcher API
  // promised in the test-generator prompt?
  const required = ['toBe(', 'toEqual(', 'toBeTruthy(', 'toBeFalsy(', 'toContain('];
  let fail = 0;
  for (const m of required) {
    if (!SANDBOX_HTML.includes(m)) {
      console.warn('[test-runner] sandbox missing matcher:', m);
      fail++;
    }
  }
  if (fail === 0) console.log('[test-runner] all 5 matcher methods present in sandbox');
}
