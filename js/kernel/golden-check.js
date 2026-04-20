// Astrion OS — Golden file integrity check (M8.P1)
//
// Boot-time verification that the safety-critical files (defined in
// /tools/sign-golden.mjs and hashed into /golden.lock.json) haven't
// drifted from their blessed hashes. If ANY golden file fails, emit
// 'golden:tampered' so downstream subscribers (M8 self-mod, future
// alarm UI) can react.
//
// Why this matters: M8 will introduce self-modifying capabilities.
// Without an integrity check, a self-mod that subtly weakens the
// interceptor or the red-team would silently degrade safety. The
// golden lock is the canary — any unexpected diff trips it.
//
// Limits today (no signature, no enforcement):
//   - The lockfile is plain JSON in the repo. A determined attacker
//     who can write to disk can update both the file AND the lock.
//     The defense is: lockfile changes are visible in git diff +
//     human review at PR time.
//   - golden-check.js is itself in the golden list — so tampering
//     with the verifier flips the check on the verifier's own hash.
//   - When tampering is detected, today we emit + console.error.
//     Future M8.P3 will gate self-mod registration on a clean check.

import { eventBus } from './event-bus.js';

const LOCK_URL = '/golden.lock.json';

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify every file listed in golden.lock.json against its current
 * served bytes. Returns { ok, total, mismatched: [{path, expected, got}] }.
 * Never throws — the check is best-effort and degraded results still
 * emit, so the user sees them.
 */
export async function verifyGolden() {
  let lock;
  try {
    const res = await fetch(LOCK_URL);
    if (!res.ok) throw new Error('lockfile fetch ' + res.status);
    lock = await res.json();
  } catch (err) {
    eventBus.emit('golden:lockfile-missing', { error: err?.message || String(err) });
    console.warn('[golden-check] lockfile missing — skipping integrity check:', err?.message);
    return { ok: false, total: 0, mismatched: [], error: err?.message };
  }
  const entries = Object.entries(lock.files || {});
  const mismatched = [];
  for (const [path, expected] of entries) {
    if (expected === null) continue; // placeholder slot
    let body;
    try {
      const r = await fetch('/' + path);
      if (!r.ok) throw new Error('fetch ' + r.status);
      body = await r.text();
    } catch (err) {
      mismatched.push({ path, expected, got: null, error: err?.message });
      continue;
    }
    const got = await sha256Hex(body);
    if (got !== expected) mismatched.push({ path, expected, got });
  }
  const result = { ok: mismatched.length === 0, total: entries.length, mismatched };
  if (result.ok) {
    eventBus.emit('golden:ok', { total: result.total });
    console.log('[golden-check] integrity OK (' + result.total + ' files)');
  } else {
    eventBus.emit('golden:tampered', result);
    console.error('[golden-check] TAMPERED:', mismatched.map(m => m.path).join(', '));
  }
  return result;
}

/**
 * Wire boot-time verification. Idempotent. Calls verifyGolden() once
 * and emits the result. Subscribers (e.g., M8 self-mod) should listen
 * for golden:tampered and refuse to enable self-mod capabilities.
 */
export function initGoldenCheck() {
  // Defer slightly so the kernel finishes its critical-path init before
  // the integrity scan competes for fetch bandwidth.
  setTimeout(() => { verifyGolden().catch(() => {}); }, 1500);
}
