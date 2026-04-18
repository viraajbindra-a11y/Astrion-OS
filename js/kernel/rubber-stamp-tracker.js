// Astrion OS — Rubber-Stamp Tracker (M6.P4)
//
// Tracks how often the user confirms L2+ interception previews
// without reading them (proxy: response time < READ_FLOOR_MS). High
// rubber-stamp rates undermine the M5/M6 safety story — if the user
// always presses Enter without thinking, the gate becomes theatre.
//
// Stats are persisted to localStorage on a 7-day rolling window.
// When the rate exceeds RUBBER_STAMP_THRESHOLD over MIN_SAMPLES
// confirmations, the tracker emits `socratic:rubberstamp-warning`
// at most once per day. UI subscribers (Spotlight) can surface a
// gentle "you've been confirming a lot quickly — slow down?" banner.
//
// What this does NOT do (deferred to M6.P4.b):
//   - Chaos injection (PLAN.md describes injecting a known-bad
//     plan as a test). Requires capability-provider cooperation
//     and a separate audit log.
//   - Per-cap rubber-stamp rates. Today's stats are global; a
//     per-capability breakdown would surface "you trust file ops
//     too much but not browser ops" patterns.

import { eventBus } from './event-bus.js';

const STORAGE_KEY = 'astrion-rubberstamp-stats';
const READ_FLOOR_MS = 1500;     // < 1.5s = "didn't read"
const SAMPLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RUBBER_STAMP_THRESHOLD = 0.80; // 80% rapid-confirm rate
const MIN_SAMPLES = 20;
const WARN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 warning per day

// In-memory map of pending preview ids → start timestamp
const previewStarts = new Map();

function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const now = Date.now();
    const cutoff = now - SAMPLE_WINDOW_MS;
    return {
      samples: (raw.samples || []).filter(s => s.ts > cutoff),
      lastWarnedAt: raw.lastWarnedAt || 0,
    };
  } catch {
    return { samples: [], lastWarnedAt: 0 };
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch (err) {
    console.warn('[rubber-stamp] save failed:', err?.message);
  }
}

/**
 * Public stats query. Returns { total, rapid, aborted, timedOut,
 * rapidRate, lastWarnedAt }.
 */
export function getStats() {
  const stats = loadStats();
  const total = stats.samples.length;
  const rapid = stats.samples.filter(s => s.kind === 'rapid').length;
  const considered = stats.samples.filter(s => s.kind === 'considered').length;
  const aborted = stats.samples.filter(s => s.kind === 'aborted').length;
  const timedOut = stats.samples.filter(s => s.kind === 'timeout').length;
  const rapidRate = total > 0 ? rapid / total : 0;
  return {
    total, rapid, considered, aborted, timedOut,
    rapidRate: Math.round(rapidRate * 100) / 100,
    lastWarnedAt: stats.lastWarnedAt,
  };
}

/**
 * Reset the rolling window (used by tests + a future Settings
 * "I've adjusted my workflow, start over" button).
 */
export function resetStats() {
  saveStats({ samples: [], lastWarnedAt: 0 });
}

function recordSample(kind) {
  const stats = loadStats();
  stats.samples.push({ kind, ts: Date.now() });
  // Cap the array length so localStorage doesn't grow unbounded
  if (stats.samples.length > 500) stats.samples = stats.samples.slice(-500);
  saveStats(stats);
  maybeWarn(stats);
}

function maybeWarn(stats) {
  const total = stats.samples.length;
  if (total < MIN_SAMPLES) return;
  const rapid = stats.samples.filter(s => s.kind === 'rapid').length;
  const rate = rapid / total;
  if (rate < RUBBER_STAMP_THRESHOLD) return;
  const now = Date.now();
  if (now - (stats.lastWarnedAt || 0) < WARN_COOLDOWN_MS) return;
  stats.lastWarnedAt = now;
  saveStats(stats);
  eventBus.emit('socratic:rubberstamp-warning', {
    rapidRate: Math.round(rate * 100) / 100,
    samples: total,
    threshold: RUBBER_STAMP_THRESHOLD,
  });
}

/**
 * Wire up the tracker. Subscribes to interception:preview /
 * interception:confirm / interception:abort and classifies each
 * outcome. Idempotent — safe to call multiple times (event-bus
 * .on guards via wrapped callbacks).
 */
export function initRubberStampTracker() {
  eventBus.on('interception:preview', ({ id }) => {
    if (id) previewStarts.set(id, Date.now());
  });
  eventBus.on('interception:confirm', ({ id }) => {
    if (!id) return;
    const start = previewStarts.get(id);
    previewStarts.delete(id);
    if (!start) return; // unknown preview — skip
    const elapsed = Date.now() - start;
    recordSample(elapsed < READ_FLOOR_MS ? 'rapid' : 'considered');
  });
  eventBus.on('interception:abort', ({ id, reason }) => {
    if (!id) return;
    previewStarts.delete(id);
    if (reason && /timeout|auto-aborted/i.test(reason)) {
      recordSample('timeout');
    } else {
      recordSample('aborted');
    }
  });
  console.log('[rubber-stamp] subscribed to interception:* events');
}
