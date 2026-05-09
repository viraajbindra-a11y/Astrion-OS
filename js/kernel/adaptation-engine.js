// Astrion OS — Adaptation Engine
//
// The substrate every "Astrion learned something" feature plugs into.
//
// THE THESIS
// ──────────
// Astrion is meant to grow with you. But auto-evolution without
// transparency = creepy. Auto-evolution without an undo = hostile.
// Auto-evolution without a frequency cap = annoying. So before any
// feature can adapt the OS, it has to go through this module:
//
//   - Every adaptation is LOGGED (append-only, persisted, capped).
//   - Every adaptation has a WHY (trigger string the user sees).
//   - Every adaptation is REVERTABLE (kind+args dispatch to handler).
//   - Every category has a DAILY BUDGET (no badgering).
//   - Every category has a BOLDNESS setting (low/medium/high — "ask
//     vs do" knob the user owns).
//
// Features that adapt the OS call recordAdaptation(...) instead of
// mutating state directly. The engine enforces budgets, logs the
// change, and gives the user a single screen to audit + revert.
//
// What this is NOT
// ────────────────
// Not a planner. Not a learner. Not a model. The intelligence (which
// patterns count as a "save as skill?" trigger, which skills the AI
// thinks you'd want) lives in feature modules. This module is the
// audit + revert + governance layer they all share.
//
// Companion: docs/SAFETY.md ("How Astrion Stays Safe") — adaptation
// is the inverse of safety; this module is what keeps it inside the
// safety story.

import { eventBus } from './event-bus.js';

const STORAGE_KEY = 'astrion-adaptations-v1';
const SETTINGS_KEY = 'astrion-adaptation-settings-v1';
const MAX_LOG = 500;

// Categories. Add a new one only when its semantics genuinely differ
// from these — boldness defaults + budget defaults are per-category
// so adding one is a real architectural decision.
export const CATEGORY = Object.freeze({
  SKILL: 'skill',             // proposed/accepted skills from observed sequences
  ROUTINE: 'routine',         // time-of-day or sequence routines
  ALIAS: 'alias',             // verb/noun aliases the user taught Astrion
  AUTOCORRECT: 'autocorrect', // text-correction rules
  PREFERENCE: 'preference',   // rules learned from repeated undo/cancel
  UI: 'ui',                   // dock pinning, spotlight defaults, app order
  GRAPH: 'graph',             // auto-links, auto-tags between graph nodes
});

const VALID_CATEGORIES = new Set(Object.values(CATEGORY));

// Boldness levels. "low" = always ask, "medium" = ask the first time
// then auto-apply, "high" = silent adapt with notification.
export const BOLDNESS = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });
const VALID_BOLDNESS = new Set(Object.values(BOLDNESS));

// Defaults. Conservative on anything that touches semantics (skills,
// routines, autocorrect — wrong adaptation is annoying). Bolder on
// pure UI (dock order — wrong adaptation is barely noticeable).
const DEFAULT_BOLDNESS = {
  skill:       BOLDNESS.MEDIUM,
  routine:     BOLDNESS.LOW,
  alias:       BOLDNESS.MEDIUM,
  autocorrect: BOLDNESS.LOW,
  preference:  BOLDNESS.MEDIUM,
  ui:          BOLDNESS.HIGH,
  graph:       BOLDNESS.HIGH,
};

const DEFAULT_BUDGETS = {
  skill:       3,
  routine:     2,
  alias:       5,
  autocorrect: 5,
  preference:  3,
  ui:          10,
  graph:       50,
};

// ─── Persistence ─────────────────────────────────────────────────────

function loadLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveLog(log) {
  try {
    if (log.length > MAX_LOG) log = log.slice(-MAX_LOG);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { boldness: {}, budgets: {} };
    const parsed = JSON.parse(raw);
    return {
      boldness: parsed.boldness && typeof parsed.boldness === 'object' ? parsed.boldness : {},
      budgets:  parsed.budgets  && typeof parsed.budgets  === 'object' ? parsed.budgets  : {},
    };
  } catch { return { boldness: {}, budgets: {} }; }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

// ─── Settings API ────────────────────────────────────────────────────

export function getBoldness(category) {
  if (!VALID_CATEGORIES.has(category)) return BOLDNESS.LOW;
  const s = loadSettings();
  return s.boldness[category] || DEFAULT_BOLDNESS[category] || BOLDNESS.LOW;
}

export function setBoldness(category, level) {
  if (!VALID_CATEGORIES.has(category)) throw new Error('invalid category: ' + category);
  if (!VALID_BOLDNESS.has(level)) throw new Error('invalid boldness: ' + level);
  const s = loadSettings();
  s.boldness[category] = level;
  saveSettings(s);
  eventBus.emit('adaptation:settings-changed', { category, kind: 'boldness', value: level });
}

export function getDailyBudget(category) {
  if (!VALID_CATEGORIES.has(category)) return 0;
  const s = loadSettings();
  const n = s.budgets[category];
  return typeof n === 'number' && n >= 0 ? n : (DEFAULT_BUDGETS[category] || 0);
}

export function setDailyBudget(category, n) {
  if (!VALID_CATEGORIES.has(category)) throw new Error('invalid category: ' + category);
  if (typeof n !== 'number' || n < 0) throw new Error('budget must be a non-negative number');
  const s = loadSettings();
  s.budgets[category] = n;
  saveSettings(s);
  eventBus.emit('adaptation:settings-changed', { category, kind: 'budget', value: n });
}

// ─── Budget tracking ─────────────────────────────────────────────────

function dayKey(t = Date.now()) {
  // Local-day key so "daily budget" matches the user's wall clock.
  const d = new Date(t);
  return d.getFullYear() + '-' + (d.getMonth() + 1).toString().padStart(2, '0')
    + '-' + d.getDate().toString().padStart(2, '0');
}

function countToday(category) {
  const today = dayKey();
  const log = loadLog();
  let n = 0;
  for (const e of log) {
    if (e.category === category && !e.reverted && dayKey(e.appliedAt) === today) n++;
  }
  return n;
}

export function getBudgetRemaining(category) {
  if (!VALID_CATEGORIES.has(category)) return 0;
  return Math.max(0, getDailyBudget(category) - countToday(category));
}

// ─── Revert handler registry ─────────────────────────────────────────
// Features register handlers for the revert "kinds" they emit. Engine
// dispatches by kind when revertAdaptation is called.

const REVERT_HANDLERS = new Map();

export function registerRevertHandler(kind, fn) {
  if (typeof kind !== 'string' || !kind) throw new Error('kind must be a non-empty string');
  if (typeof fn !== 'function') throw new Error('fn must be a function');
  REVERT_HANDLERS.set(kind, fn);
}

// ─── Recording ───────────────────────────────────────────────────────

let nextSeq = 0;

function newId() {
  nextSeq++;
  return 'adapt-' + Date.now().toString(36) + '-' + nextSeq.toString(36);
}

/**
 * Record an adaptation. Returns { ok, entry } on success; { ok: false,
 * reason } if the budget is exhausted or the input is invalid.
 *
 * @param {object} opts
 * @param {string} opts.category — one of CATEGORY.*
 * @param {string} opts.summary — what changed, in user-facing prose
 * @param {string} opts.trigger — why this fired, in user-facing prose
 * @param {boolean} [opts.silent] — true if applied without confirm (high boldness)
 * @param {{kind: string, args: object}} opts.revert — how to undo
 */
export function recordAdaptation(opts) {
  if (!opts || !VALID_CATEGORIES.has(opts.category)) {
    return { ok: false, reason: 'invalid category' };
  }
  if (typeof opts.summary !== 'string' || !opts.summary.trim()) {
    return { ok: false, reason: 'summary required' };
  }
  if (typeof opts.trigger !== 'string' || !opts.trigger.trim()) {
    return { ok: false, reason: 'trigger required' };
  }
  if (!opts.revert || typeof opts.revert.kind !== 'string') {
    return { ok: false, reason: 'revert.kind required' };
  }
  if (getBudgetRemaining(opts.category) <= 0) {
    return { ok: false, reason: 'daily budget exhausted for ' + opts.category };
  }

  const entry = {
    id: newId(),
    category: opts.category,
    summary: opts.summary.trim(),
    trigger: opts.trigger.trim(),
    silent: !!opts.silent,
    appliedAt: Date.now(),
    revert: { kind: opts.revert.kind, args: opts.revert.args || {} },
    reverted: false,
  };

  const log = loadLog();
  log.push(entry);
  saveLog(log);
  eventBus.emit('adaptation:recorded', entry);
  return { ok: true, entry };
}

// ─── Listing ─────────────────────────────────────────────────────────

/**
 * @param {object} [filter]
 * @param {string} [filter.category]
 * @param {number} [filter.since] — appliedAt >= this timestamp
 * @param {number} [filter.limit]
 * @param {boolean} [filter.includeReverted] — default false
 */
export function listAdaptations(filter = {}) {
  let log = loadLog();
  if (filter.category) log = log.filter(e => e.category === filter.category);
  if (typeof filter.since === 'number') log = log.filter(e => e.appliedAt >= filter.since);
  if (!filter.includeReverted) log = log.filter(e => !e.reverted);
  // Most recent first.
  log = log.slice().sort((a, b) => b.appliedAt - a.appliedAt);
  if (typeof filter.limit === 'number' && filter.limit >= 0) log = log.slice(0, filter.limit);
  return log;
}

// ─── Reverting ───────────────────────────────────────────────────────

/**
 * Revert an adaptation by id. Looks up the registered handler for the
 * adaptation's revert.kind, calls it with revert.args, and marks the
 * entry reverted (kept in the log for audit; just hidden from default
 * listings).
 *
 * Returns { ok, error? }.
 */
export async function revertAdaptation(id) {
  const log = loadLog();
  const idx = log.findIndex(e => e.id === id);
  if (idx < 0) return { ok: false, error: 'adaptation not found' };
  const entry = log[idx];
  if (entry.reverted) return { ok: false, error: 'already reverted' };

  const handler = REVERT_HANDLERS.get(entry.revert.kind);
  if (!handler) {
    return { ok: false, error: 'no revert handler registered for kind: ' + entry.revert.kind };
  }

  try {
    await handler(entry.revert.args, entry);
  } catch (err) {
    return { ok: false, error: 'revert handler threw: ' + (err?.message || String(err)) };
  }

  entry.reverted = true;
  entry.revertedAt = Date.now();
  log[idx] = entry;
  saveLog(log);
  eventBus.emit('adaptation:reverted', entry);
  return { ok: true };
}

// ─── Diagnostics ─────────────────────────────────────────────────────

/** Total adaptations today across all categories. Useful for UI summaries. */
export function getTodaysCount() {
  const today = dayKey();
  return loadLog().filter(e => !e.reverted && dayKey(e.appliedAt) === today).length;
}

/**
 * For tests. Wipes the log + settings. Not exported via the OS surface;
 * only used by v03.
 */
export function _resetForTests() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
  REVERT_HANDLERS.clear();
  nextSeq = 0;
}
