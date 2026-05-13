// Astrion OS — Self-Mod 24h Soak Driver (M8.P5, Phase 1 Week 19)
//
// Roadmap (ROADMAP-DEC-2026-v3.md Phase 1 Option A): "Week 19
// (May 11–17): 24h soak — 10 proposals apply + rollback cleanly
// without intervention."
//
// What this is: the harness that runs the Week 18 synthetic corpus
// on an interval (every minute by default, configurable) and tracks
// classification stability across runs. If a gate weakens (a bad
// proposal that used to reject starts passing) or hardens (a good
// proposal that used to pass starts rejecting), the next run's
// drift list surfaces it.
//
// What this is NOT (yet): the apply/rollback half. That's a more
// dangerous test — it writes to disk and rolls back, against a
// throwaway commit on a side branch. The corpus + classifier + drift
// detector are the SAFE half, ship-able now. Drift detection alone
// catches the most likely failure mode: a future refactor silently
// rewriting a gate's logic and nobody noticing until a user reports.
//
// Storage shape:
//   localStorage['astrion-soak-history-v1'] = JSON.stringify({
//     startedAt: <epoch ms>,
//     runs: [
//       { at, total, classifiedCorrectly, byGate, durationMs, results: [{ id, actual }] },
//       …
//     ],
//   })
// Capped at 1440 runs (= 24 h at 60 s cadence). Older entries are
// pruned at the head. Total worst-case size ~1.5 MB which fits well
// inside the 5 MB localStorage budget.

import { eventBus } from './event-bus.js';
import { runSyntheticSuite } from './synthetic-proposals.js';

const HISTORY_KEY = 'astrion-soak-history-v1';
const MAX_RUNS = 1440;             // 24 h × 60 min
const DEFAULT_INTERVAL_MS = 60 * 1000;

let _timer = null;
let _started = false;
let _startedAt = 0;
let _intervalMs = DEFAULT_INTERVAL_MS;

// ─── Persistence ────────────────────────────────────────────────────

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { startedAt: 0, runs: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.runs)) return { startedAt: 0, runs: [] };
    return parsed;
  } catch {
    return { startedAt: 0, runs: [] };
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    // Quota or private-browsing — soak keeps running, just no history.
    return false;
  }
}

// ─── Drift detection ────────────────────────────────────────────────

/**
 * Compare two run results. Drift = same proposal id classified
 * differently. Returns an array of { id, before, after } entries.
 *
 * @param {Array<{id, actual}>} previousResults
 * @param {Array<{id, actual}>} currentResults
 */
export function detectDrift(previousResults, currentResults) {
  if (!Array.isArray(previousResults) || previousResults.length === 0) return [];
  const prevById = new Map(previousResults.map(r => [r.id, r.actual]));
  const drift = [];
  for (const cur of currentResults) {
    const prev = prevById.get(cur.id);
    if (prev !== undefined && prev !== cur.actual) {
      drift.push({ id: cur.id, before: prev, after: cur.actual });
    }
  }
  return drift;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Run a single iteration: run the synthetic suite, persist the
 * outcome, detect drift vs the previous run, emit events. Returns
 * the new run record + any drift entries.
 */
export function runIteration() {
  const t0 = Date.now();
  const result = runSyntheticSuite();
  const durationMs = Date.now() - t0;

  const compact = {
    at: t0,
    total: result.summary.total,
    classifiedCorrectly: result.summary.classifiedCorrectly,
    byGate: result.summary.byGate,
    durationMs,
    // Per-proposal id → actual only (full reason text would bloat history);
    // misclassified entries keep their reason for post-hoc debugging.
    results: result.results.map(r => ({ id: r.id, actual: r.actual })),
    misclassified: result.summary.misclassified.map(m => ({
      id: m.id, expected: m.expected, actual: m.actual, gate: m.gate, reason: m.reason,
    })),
  };

  const history = loadHistory();
  const previousRun = history.runs.length > 0 ? history.runs[history.runs.length - 1] : null;
  const drift = previousRun ? detectDrift(previousRun.results, compact.results) : [];

  history.runs.push({ ...compact, drift });
  // Cap history at MAX_RUNS — prune oldest first.
  while (history.runs.length > MAX_RUNS) history.runs.shift();
  if (!history.startedAt) history.startedAt = t0;
  saveHistory(history);

  eventBus.emit('selfmod-soak:iteration', { compact, drift });
  if (drift.length > 0) {
    eventBus.emit('selfmod-soak:drift', { drift, at: t0 });
    console.warn('[selfmod-soak] drift detected on this iteration:', drift);
  }

  return { run: compact, drift };
}

/**
 * Start the soak. Subsequent calls are no-ops (idempotent — single
 * timer at a time).
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=60000]
 * @param {boolean} [opts.runImmediately=true]
 */
export function startSoak(opts = {}) {
  if (_started) return { ok: false, error: 'already running', intervalMs: _intervalMs };
  _intervalMs = Math.max(1000, opts.intervalMs || DEFAULT_INTERVAL_MS);
  _started = true;
  _startedAt = Date.now();
  if (opts.runImmediately !== false) runIteration();
  _timer = setInterval(runIteration, _intervalMs);
  eventBus.emit('selfmod-soak:started', { at: _startedAt, intervalMs: _intervalMs });
  return { ok: true, intervalMs: _intervalMs, startedAt: _startedAt };
}

/** Stop the soak. Idempotent. History stays in localStorage. */
export function stopSoak() {
  if (!_started) return { ok: false, error: 'not running' };
  if (_timer) clearInterval(_timer);
  _timer = null;
  _started = false;
  eventBus.emit('selfmod-soak:stopped', { at: Date.now() });
  return { ok: true };
}

/** Read the current state. */
export function getSoakState() {
  return {
    running: _started,
    startedAt: _startedAt,
    intervalMs: _intervalMs,
  };
}

/**
 * Aggregate report over the full retained history. Useful for the
 * Settings / Adaptations diagnostics panel and for the eventual
 * end-of-soak verdict.
 */
export function getSoakReport() {
  const history = loadHistory();
  const runs = history.runs;
  if (runs.length === 0) {
    return { runs: 0, startedAt: 0, totalProposalsClassified: 0, driftEvents: 0, lastRun: null };
  }
  const totalProposalsClassified = runs.reduce((acc, r) => acc + r.total, 0);
  const totalMisclassified = runs.reduce((acc, r) => acc + (r.total - r.classifiedCorrectly), 0);
  const driftEvents = runs.reduce((acc, r) => acc + (Array.isArray(r.drift) ? r.drift.length : 0), 0);
  const lastRun = runs[runs.length - 1];
  // Mean latency across runs
  const meanDurationMs = runs.reduce((acc, r) => acc + (r.durationMs || 0), 0) / runs.length;
  return {
    runs: runs.length,
    startedAt: history.startedAt,
    spannedMs: lastRun.at - history.startedAt,
    totalProposalsClassified,
    totalMisclassified,
    driftEvents,
    meanIterationMs: Math.round(meanDurationMs * 10) / 10,
    lastRun: {
      at: lastRun.at,
      total: lastRun.total,
      classifiedCorrectly: lastRun.classifiedCorrectly,
      byGate: lastRun.byGate,
      drift: lastRun.drift || [],
    },
  };
}

/** Wipe history. Used for tests + the user-facing "reset" button. */
export function clearSoakHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
  return { ok: true };
}

/** Test helper — visible only on localhost. */
export function _resetForTests() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _started = false;
  _startedAt = 0;
  _intervalMs = DEFAULT_INTERVAL_MS;
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

// ─── Sanity tests ───────────────────────────────────────────────────
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  // Smoke: one iteration runs without throwing, persists a record.
  _resetForTests();
  const r = runIteration();
  const history = loadHistory();
  if (history.runs.length !== 1) console.warn('[selfmod-soak] expected 1 run, got', history.runs.length);
  if (r.run.classifiedCorrectly !== r.run.total) console.warn('[selfmod-soak] corpus drifted on first iteration:', r.run);
  // Drift on the same input should be empty
  const r2 = runIteration();
  if (r2.drift.length !== 0) console.warn('[selfmod-soak] spurious drift between identical iterations:', r2.drift);
  _resetForTests();
  console.log('[selfmod-soak] 2 sanity iterations pass — first classified 20/20, second drift empty');
}
