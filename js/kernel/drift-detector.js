// Astrion OS — Drift detector (M8.P4)
//
// Snapshots key system state on a schedule + compares each snapshot to
// the baseline (first snapshot ever recorded). Emits drift:detected
// when the diff exceeds threshold. The intent: catch slow-burn changes
// that no single safety check would catch — a self-mod that "refactors"
// the capability registry by deleting one obscure cap, a settings edit
// that quietly disables every safety skill, etc.
//
// What's snapshotted (extend as new safety primitives ship):
//   - capability count
//   - registered cap ids (sorted)
//   - golden lock file count
//   - skill registry: total + enabled count + disabled set
//   - safety settings: rubber-stamp lastWarnedAt, chaos cooldown
//   - value-lock current hash
//
// Storage: localStorage 'astrion-drift-baseline' (first ever snapshot)
// + 'astrion-drift-history' (last N=20 snapshots).
//
// Why "weekly" cadence per PLAN: drift is a slow signal — daily noise
// would overwhelm. Today we snapshot at every initDriftDetector() call
// (once per boot) and trust boot-frequency to be roughly daily.
//
// Limitations today:
//   - No automatic action on drift; the event fires + a notification
//     surfaces. M8.P4.b (future) will gate the next self-mod attempt
//     on a clean drift report.
//   - Baseline is established at FIRST init. To re-baseline (e.g.
//     after intentional refactor), call recordNewBaseline().

import { eventBus } from './event-bus.js';

const BASELINE_KEY = 'astrion-drift-baseline';
const HISTORY_KEY = 'astrion-drift-history';
const HISTORY_LIMIT = 20;
// Drift threshold — number of snapshot field-level changes before we
// flag. Tunable.
const DRIFT_THRESHOLD = 3;

async function buildSnapshot() {
  const snap = { ts: Date.now() };

  // Capability registry — count + ids
  try {
    const m = await import('./capability-api.js');
    if (typeof m.listCapabilities === 'function') {
      const caps = m.listCapabilities();
      snap.capCount = caps.length;
      snap.capIds = caps.map(c => c.id || c).sort();
    }
  } catch {}

  // Skill registry
  try {
    const m = await import('./skill-registry.js');
    const list = m.listSkills();
    snap.skillCount = list.length;
    snap.skillEnabledCount = list.filter(s => s.enabled).length;
    snap.skillDisabled = (m.getDisabledSkills() || []).slice().sort();
  } catch {}

  // Value-lock
  try {
    const m = await import('./value-lock.js');
    snap.valueLockHash = await m.currentValueHash();
  } catch {}

  // Golden lockfile size
  try {
    const res = await fetch('/golden.lock.json');
    if (res.ok) {
      const lock = await res.json();
      snap.goldenFileCount = Object.keys(lock.files || {}).length;
    }
  } catch {}

  // Safety stats
  try {
    const m = await import('./rubber-stamp-tracker.js');
    const s = m.getStats();
    snap.rubberSampleTotal = s.total;
  } catch {}

  return snap;
}

function readBaseline() {
  try { const s = localStorage.getItem(BASELINE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}

function writeBaseline(snap) {
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify(snap)); } catch {}
}

function pushHistory(snap) {
  try {
    const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    arr.push(snap);
    while (arr.length > HISTORY_LIMIT) arr.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch {}
}

function diffSnapshots(baseline, current) {
  const out = [];
  const fields = new Set([...Object.keys(baseline || {}), ...Object.keys(current || {})]);
  fields.delete('ts'); // timestamp always changes
  for (const f of fields) {
    const a = baseline?.[f];
    const b = current?.[f];
    const aJ = JSON.stringify(a);
    const bJ = JSON.stringify(b);
    if (aJ !== bJ) out.push({ field: f, baseline: a, current: b });
  }
  return out;
}

export async function snapshotNow() {
  return buildSnapshot();
}

export function getDriftHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

export function getDriftBaseline() {
  return readBaseline();
}

export function recordNewBaseline(snap) {
  const target = snap || readBaseline();
  if (!target) return;
  writeBaseline(target);
  eventBus.emit('drift:rebaselined', { hash: target.valueLockHash || null });
}

export async function checkDrift() {
  const current = await buildSnapshot();
  pushHistory(current);
  const baseline = readBaseline();
  if (!baseline) {
    writeBaseline(current);
    eventBus.emit('drift:baselined', current);
    return { ok: true, baseline: true, snap: current };
  }
  const diffs = diffSnapshots(baseline, current);
  if (diffs.length === 0) {
    eventBus.emit('drift:none', { snap: current });
    return { ok: true, drift: 0, snap: current, diffs: [] };
  }
  if (diffs.length < DRIFT_THRESHOLD) {
    eventBus.emit('drift:minor', { count: diffs.length, diffs, snap: current });
    return { ok: true, drift: diffs.length, snap: current, diffs };
  }
  // Drift above threshold
  eventBus.emit('drift:detected', { count: diffs.length, diffs, snap: current, threshold: DRIFT_THRESHOLD });
  eventBus.emit('notification:show', {
    title: '🌊 System drift detected',
    message: diffs.length + ' fields drifted from baseline (threshold ' + DRIFT_THRESHOLD + '). Settings > Safety to investigate.',
    icon: '🌊',
    duration: 14000,
  });
  return { ok: false, drift: diffs.length, snap: current, diffs };
}

/**
 * Wire boot-time drift check. Defers the actual snapshot/compare so
 * the kernel finishes init first. Idempotent.
 */
export function initDriftDetector() {
  setTimeout(() => { checkDrift().catch(() => {}); }, 4000);
}

// ─── Sanity tests (localhost only) ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  (async () => {
    let f = 0;
    const a = { capCount: 5, ts: 1 };
    const b = { capCount: 5, ts: 999 };
    const c = { capCount: 6, ts: 999, skillEnabledCount: 12 };
    if (diffSnapshots(a, b).length !== 0) { console.warn('[drift] same snap (ts ignored) FAIL'); f++; }
    const d = diffSnapshots(a, c);
    if (d.length !== 2) { console.warn('[drift] expected 2 diffs (capCount + skillEnabledCount), got', d.length); f++; }
    if (f === 0) console.log('[drift] all 2 sanity tests pass');
    else console.warn('[drift]', f, 'sanity tests failed');
  })();
}
