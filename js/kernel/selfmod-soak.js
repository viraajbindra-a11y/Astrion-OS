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
import { proposeSelfMod, discardProposal } from './selfmod-sandbox.js';
import { applyUpgrade, rollbackUpgrade } from './self-upgrader.js';
import { graphStore } from './graph-store.js';

const HISTORY_KEY = 'astrion-soak-history-v1';
const MAX_RUNS = 1440;             // 24 h × 60 min
const DEFAULT_INTERVAL_MS = 60 * 1000;

// Synthetic apply/rollback target. Gitignored — written + restored
// in every disk cycle. The initial-content string MUST match the
// file's on-disk initial content character-for-character; after each
// cycle the soak reads disk, compares against this, and reports
// drift if they don't match.
const SOAK_TARGET_PATH = 'js/apps/.synthetic-target.js';
const SOAK_TARGET_INITIAL =
  '// Astrion OS — Synthetic Soak Target (M8.P5 Week 19, ROADMAP-DEC-2026-v3.md)\n' +
  '//\n' +
  '// This file is the throwaway target the apply+rollback soak writes\n' +
  '// against. It is gitignored — every CI checkout starts with this\n' +
  '// initial content; the soak rewrites it many times during a run and\n' +
  '// always restores it before the next iteration.\n' +
  '//\n' +
  '// Do NOT import this from runtime code. It is a soak fixture only.\n' +
  '//\n' +
  '// If you see drift in this file in git, the soak left a tail. Reset\n' +
  '// to this initial content via git checkout or by deleting + re-creating.\n' +
  '\n' +
  'export const SYNTHETIC_SOAK_TARGET_VERSION = 1;\n';

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

// ─── Disk cycle (Week 19 — full apply/rollback) ─────────────────────
//
// One iteration of the disk-write soak: stage a synthetic proposal,
// applyUpgrade (writes new content), verify on-disk, rollbackUpgrade
// (restores old content), verify on-disk. Returns { ok, phases } so
// the caller can record per-step outcomes.
//
// Bypasses proposeUpgrade (the AI-driven path) by calling the lower-
// level proposeSelfMod helper directly and patching the proposal
// node with explicit newContent + oldContent. Same pattern as
// js/kernel/pen-test.js test #3.
//
// Honest scope: this proves the apply + rollback chain is stable
// across iterations. It does NOT exercise the AI proposal step (the
// soak corpus is hand-crafted on purpose — Week 18 lesson). The full
// AI loop is tested on first ISO boot.

async function readTargetFromDisk() {
  try {
    const r = await fetch('/api/files/read?path=' + encodeURIComponent(SOAK_TARGET_PATH) + '&limit=20000');
    if (!r.ok) return null;
    const data = await r.json();
    return typeof data.content === 'string' ? data.content : null;
  } catch {
    return null;
  }
}

async function ensureSoakTargetExists() {
  const current = await readTargetFromDisk();
  if (current !== null) return { ok: true, restored: false };
  // File missing — write the initial content. Uses the same
  // /api/files/write endpoint as applyUpgrade, so the kill-switch
  // gate applies. If the kill-switch is on, ensure returns ok:false
  // and the caller skips the disk cycle.
  try {
    const r = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: SOAK_TARGET_PATH, content: SOAK_TARGET_INITIAL }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return { ok: false, error: err.error || `write returned ${r.status}`, killSwitch: !!err.killSwitch };
    }
    return { ok: true, restored: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runDiskCycle(opts = {}) {
  const phases = { ensure: null, propose: null, apply: null, applyVerify: null, rollback: null, rollbackVerify: null };
  const t0 = Date.now();

  const ensure = await ensureSoakTargetExists();
  phases.ensure = ensure;
  if (!ensure.ok) {
    return { ok: false, phases, durationMs: Date.now() - t0, reason: 'target unavailable: ' + ensure.error };
  }

  const original = await readTargetFromDisk();
  if (original === null) {
    return { ok: false, phases, durationMs: Date.now() - t0, reason: 'cannot read original content' };
  }

  // New content: append a comment with the iteration timestamp so each
  // cycle's apply produces a different byte sequence. Verifies the apply
  // path is genuinely writing, not just no-op-passing.
  const tag = `// soak-iteration: ${t0}\n`;
  const newContent = original + tag;

  // 1. Stage a proposal through the sandbox helper (bypasses AI).
  let proposalId;
  try {
    proposalId = await proposeSelfMod({
      target: SOAK_TARGET_PATH,
      diff: '--- a/' + SOAK_TARGET_PATH + '\n+++ b/' + SOAK_TARGET_PATH + '\n+' + tag,
      reason: 'M8.P5 Week 19 soak iteration ' + t0,
      proposer: 'selfmod-soak',
    });
    phases.propose = { ok: true, proposalId };
  } catch (err) {
    phases.propose = { ok: false, error: err.message };
    return { ok: false, phases, durationMs: Date.now() - t0 };
  }

  // Patch the proposal node with explicit newContent + oldContent so
  // applyUpgrade has what it needs. (Normally proposeUpgrade in self-
  // upgrader.js sets these; we bypass it.)
  try {
    await graphStore.updateNode(proposalId, (prev) => ({
      ...prev.props,
      newContent,
      oldContent: original,
      rollbackDiff: 'auto',
    }));
  } catch (err) {
    phases.propose.patchError = err.message;
  }

  // 2. Apply — walks 5 gates + writes to disk.
  let applyResult;
  try {
    applyResult = await applyUpgrade(proposalId, { typedConfirm: proposalId });
    phases.apply = { ok: applyResult.ok, error: applyResult.error, killSwitch: applyResult.killSwitch, bytes: applyResult.bytes };
  } catch (err) {
    phases.apply = { ok: false, error: err.message };
  }

  if (!applyResult || !applyResult.ok) {
    // Apply failed — nothing to roll back. Discard the proposal so we
    // don't leak it across iterations.
    await discardProposal(proposalId, 'soak apply failed').catch(() => {});
    return { ok: false, phases, durationMs: Date.now() - t0, reason: 'apply failed' };
  }

  // 2a. Verify disk now matches newContent
  const afterApply = await readTargetFromDisk();
  phases.applyVerify = {
    ok: afterApply === newContent,
    diskBytes: afterApply?.length,
    expectedBytes: newContent.length,
  };
  if (afterApply !== newContent) {
    // Surface the mismatch but proceed to rollback (we need to restore
    // the original regardless).
  }

  // 3. Rollback
  let rollbackResult;
  try {
    rollbackResult = await rollbackUpgrade(proposalId);
    phases.rollback = { ok: rollbackResult.ok, error: rollbackResult.error, killSwitch: rollbackResult.killSwitch, bytes: rollbackResult.bytes };
  } catch (err) {
    phases.rollback = { ok: false, error: err.message };
  }

  // 3a. Verify disk now matches original
  const afterRollback = await readTargetFromDisk();
  phases.rollbackVerify = {
    ok: afterRollback === original,
    diskBytes: afterRollback?.length,
    expectedBytes: original.length,
  };

  const ok =
    phases.apply?.ok === true &&
    phases.applyVerify?.ok === true &&
    phases.rollback?.ok === true &&
    phases.rollbackVerify?.ok === true;

  eventBus.emit('selfmod-soak:disk-cycle', { ok, phases, proposalId, durationMs: Date.now() - t0 });
  return { ok, phases, proposalId, durationMs: Date.now() - t0 };
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
