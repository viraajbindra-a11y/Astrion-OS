// Astrion OS — Verb Aliaser
//
// #11 Verb aliasing. When a Spotlight query misses but is "close" to
// a known capability verb (Levenshtein distance 1-2), or when the user
// teaches an alias explicitly, store the mapping so future queries
// resolve. Adaptation Engine ALIAS category.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBudgetRemaining,
  CATEGORY,
} from './adaptation-engine.js';

const ALIASES_KEY = 'astrion-verb-aliases-v1';

function loadAliases() {
  try { return JSON.parse(localStorage.getItem(ALIASES_KEY) || '{}'); }
  catch { return {}; }
}
function saveAliases(map) { try { localStorage.setItem(ALIASES_KEY, JSON.stringify(map)); } catch {} }

let initialized = false;

/** Add an alias: `phrase` resolves to `targetCapId`. */
export async function bindVerbAlias(phrase, targetCapId, opts = {}) {
  if (!phrase || !targetCapId) return { ok: false, error: 'phrase + targetCapId required' };
  if (getBudgetRemaining(CATEGORY.ALIAS) <= 0) return { ok: false, error: 'alias budget exhausted' };
  const map = loadAliases();
  map[String(phrase).toLowerCase()] = { capId: targetCapId, addedAt: Date.now() };
  saveAliases(map);
  return recordAdaptation({
    category: CATEGORY.ALIAS,
    summary: `Bound "${phrase}" → ${targetCapId}`,
    trigger: opts.trigger || 'User-taught alias',
    revert: { kind: 'verb-alias:remove', args: { phrase: String(phrase).toLowerCase() } },
  });
}

export function resolveVerbAlias(phrase) {
  return loadAliases()[String(phrase || '').toLowerCase()]?.capId;
}

export function listVerbAliases() { return loadAliases(); }

function revert(args) {
  if (!args?.phrase) return;
  const map = loadAliases();
  delete map[args.phrase];
  saveAliases(map);
}

// Levenshtein-1 fuzzy match between user query and known capability verbs.
export function suggestAlias(query, knownVerbs) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 3) return null;
  for (const v of knownVerbs || []) {
    const dist = levenshtein(q, v.toLowerCase());
    if (dist <= 2 && dist > 0) return { suggestion: v, distance: dist };
  }
  return null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function initVerbAliaser() {
  registerRevertHandler('verb-alias:remove', revert);
  if (initialized) return;
  initialized = true;
}

export function _resetForTests() {
  initialized = false;
  try { localStorage.removeItem(ALIASES_KEY); } catch {}
}
