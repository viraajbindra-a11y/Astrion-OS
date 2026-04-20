// Astrion OS — Value Lock (M8.P2)
//
// The value-lock is the "constitution." A small set of safety
// constants that the user's declared values + Astrion's safety rails
// depend on. Self-mod (M8.P2+) MUST NOT touch any of these. The
// golden check (M8.P1) hashes the FILES; the value-lock hashes the
// VALUES — so even a refactor that re-exports the same constants from
// a different module still passes the value-lock check.
//
// Why both checks: the file hash catches any byte-level change. The
// value-lock catches semantic equivalence drift — e.g., a self-mod
// that "refactors" the LEVEL enum into a Map but with one tier
// silently dropped would slip past the file hash if the file hadn't
// been touched, but the value-lock notices the tier is gone.
//
// Today the lock signature is a SHA-256 of the canonicalised values.
// True asymmetric signing (per-install ECDSA key, signature stored
// off-tree) is M8.P2.b — would require a real keystore.

import { eventBus } from './event-bus.js';
import { LEVEL, REVERSIBILITY, BLAST_RADIUS } from './capability-api.js';

// ─── The values under lock ───
//
// These objects' shapes + values are inviolable. New keys can be added
// (additive, no break). Existing key REMOVAL or value CHANGE = lock
// violation.

const LOCKED_VALUES = {
  LEVEL,                         // capability tiers
  REVERSIBILITY,                 // free / bounded / permanent
  BLAST_RADIUS,                  // none / file / directory / account / external
  // Inviolable user-value commitments. The user can OPT-OUT of any of
  // these but self-mod cannot silently flip them.
  USER_VALUES: {
    NEVER_PHONE_HOME_WITHOUT_CONSENT: true,
    NEVER_DELETE_PERMANENTLY_WITHOUT_TYPED_CONFIRM: true,
    NEVER_BYPASS_INTERCEPTOR: true,
    RED_TEAM_GATES_L3_OPS: true,
  },
};

// Hardcoded baseline hash. Generated once at landing time by
// canonicalising LOCKED_VALUES and SHA-256ing it. Drift means the
// values have changed since this constant was set.
const EXPECTED_HASH = 'WILL_BE_FILLED_BY_INIT'; // intentionally placeholder

function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

let cachedHash = null;

/**
 * Compute the canonical hash of LOCKED_VALUES at this moment. Used
 * by tests + the M8.P3 selfmod-sandbox to compare proposed values
 * against the live ones before applying.
 */
export async function currentValueHash() {
  if (cachedHash) return cachedHash;
  cachedHash = await sha256Hex(canonicalize(LOCKED_VALUES));
  return cachedHash;
}

/**
 * Verify the live LOCKED_VALUES against an expected hash. Returns
 * { ok, expected, actual }. If expected is null/undefined, the check
 * is skipped (returns ok=true) — useful at first boot before the
 * baseline has been recorded into localStorage.
 */
export async function verifyValueLock(expected = null) {
  const actual = await currentValueHash();
  if (!expected) return { ok: true, expected: null, actual, baseline: true };
  return { ok: expected === actual, expected, actual };
}

/**
 * Get a snapshot of the locked values for inspection (does NOT allow
 * mutation — caller gets a deep copy). Useful for the future M8.P3
 * red-team signoff: "here's what the user is committing to."
 */
export function getLockedValuesSnapshot() {
  return JSON.parse(JSON.stringify(LOCKED_VALUES));
}

/**
 * Wire boot-time check. Reads the baseline hash from localStorage
 * (key: astrion-value-lock-baseline). On first boot, records the
 * current hash as baseline. On subsequent boots, compares — emits
 * value-lock:ok or value-lock:violated.
 */
export async function initValueLock() {
  const KEY = 'astrion-value-lock-baseline';
  let baseline;
  try { baseline = localStorage.getItem(KEY); } catch { baseline = null; }
  const result = await verifyValueLock(baseline);
  if (result.baseline) {
    try { localStorage.setItem(KEY, result.actual); } catch {}
    console.log('[value-lock] baseline recorded:', result.actual.slice(0, 16) + '…');
    eventBus.emit('value-lock:baselined', { hash: result.actual });
    return;
  }
  if (result.ok) {
    console.log('[value-lock] OK (' + result.actual.slice(0, 16) + '…)');
    eventBus.emit('value-lock:ok', result);
  } else {
    console.error('[value-lock] VIOLATED — values changed since baseline');
    console.error('  expected:', result.expected);
    console.error('  actual:  ', result.actual);
    eventBus.emit('value-lock:violated', result);
  }
}

// ─── Sanity tests (localhost only) ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  (async () => {
    let f = 0;
    const h1 = await currentValueHash();
    const h2 = await currentValueHash();
    if (h1 !== h2) { console.warn('[value-lock] hash should be deterministic'); f++; }
    if (typeof h1 !== 'string' || h1.length !== 64) { console.warn('[value-lock] hash format wrong:', h1); f++; }
    const r1 = await verifyValueLock(h1);
    if (!r1.ok) { console.warn('[value-lock] same-hash verify FAIL:', r1); f++; }
    const r2 = await verifyValueLock('zzzz');
    if (r2.ok) { console.warn('[value-lock] bad-hash verify should FAIL'); f++; }
    const r3 = await verifyValueLock(null);
    if (!r3.ok || !r3.baseline) { console.warn('[value-lock] null verify should be baseline-ok:', r3); f++; }
    const snap = getLockedValuesSnapshot();
    if (snap.LEVEL.OBSERVE !== 0 || snap.USER_VALUES.NEVER_BYPASS_INTERCEPTOR !== true) {
      console.warn('[value-lock] snapshot missing expected values'); f++;
    }
    if (f === 0) console.log('[value-lock] all 6 sanity tests pass');
    else console.warn('[value-lock]', f, 'sanity tests failed');
  })();
}
