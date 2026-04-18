// Astrion OS — Operation Interceptor (M5.P2)
//
// Generalises the M2 Agent Core L2+ preview gate from "plan steps"
// to "any capability execute() call". When a capability with
// level >= LEVEL.REAL is about to run, the interceptor emits a
// preview event, waits for the user to confirm or abort, and only
// proceeds on explicit confirmation. Auto-abort after a timeout.
//
// This is the user-facing safety contract: L2+ ops never just
// happen — the user (or, after M6, the red-team agent) approves
// every one. The L2+ preview gate that already exists in
// intent-executor for plan steps is the prior-art. M5.P2 makes
// the same gate available to any caller via interceptedExecute().
//
// What this does NOT do (deferred to M5.P2.b):
//   - Stage the operation in a branch (M5.P1 substrate is ready;
//     wiring it requires capabilities to cooperate by routing graph
//     writes through a branch context, which is invasive).
//   - Diff UI rendering — the interceptor emits the data; a UI
//     subscriber renders it (Spotlight already does for plan:preview).
//
// Event contract:
//   interception:preview  { id, cap: {id, level, summary,
//                            blastRadius, reversibility},
//                            args, recordedAt }
//   interception:confirm  { id }   (subscriber emits when user OKs)
//   interception:abort    { id, reason }  (user cancels OR timeout)
//
// The id is opaque to subscribers — pass it back unchanged.

import { eventBus } from './event-bus.js';
import { LEVEL } from './capability-api.js';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_PENDING = 32; // hard cap to keep memory bounded

const pending = new Map();

function newId() {
  return 'icpt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Ask for user confirmation before executing a capability. Resolves
 * to `true` (confirmed) or `false` (aborted/timeout). Subscribers
 * (Spotlight, etc.) listen for `interception:preview` and respond
 * with `interception:confirm` or `interception:abort`.
 *
 * @param {Capability} cap
 * @param {object} args
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] — override the 60s default
 * @returns {Promise<{ok: boolean, reason?: string, id: string}>}
 */
export function requestConfirmation(cap, args, opts = {}) {
  if (pending.size >= MAX_PENDING) {
    // Hard fail rather than queue indefinitely.
    return Promise.resolve({ ok: false, reason: 'too many pending interceptions', id: '' });
  }
  const id = newId();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const onConfirm = ({ id: replyId }) => {
      if (replyId !== id) return;
      cleanup();
      resolve({ ok: true, id });
    };
    const onAbort = ({ id: replyId, reason }) => {
      if (replyId !== id) return;
      cleanup();
      resolve({ ok: false, reason: reason || 'aborted', id });
    };
    const cleanup = () => {
      eventBus.off('interception:confirm', onConfirm);
      eventBus.off('interception:abort', onAbort);
      clearTimeout(timer);
      pending.delete(id);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, reason: 'auto-aborted after ' + timeoutMs + 'ms', id });
    }, timeoutMs);

    pending.set(id, { cap: cap.id, recordedAt: Date.now() });
    eventBus.on('interception:confirm', onConfirm);
    eventBus.on('interception:abort', onAbort);

    eventBus.emit('interception:preview', {
      id,
      cap: {
        id: cap.id,
        verb: cap.verb,
        target: cap.target,
        level: cap.level,
        summary: cap.summary,
        blastRadius: cap.blastRadius,
        reversibility: cap.reversibility,
      },
      args,
      recordedAt: Date.now(),
      timeoutMs,
    });
  });
}

/**
 * Wrap a capability.execute() call with the L2+ preview gate. If
 * cap.level < LEVEL.REAL OR opts.skipInterception is true, runs
 * directly. Otherwise opens the gate first.
 *
 * Returns the same shape capability.execute() returns. On user
 * abort, returns { ok: false, error: 'aborted: ...' }.
 *
 * @param {Capability} cap
 * @param {object} args
 * @param {object} [opts]
 * @param {boolean} [opts.skipInterception]
 * @param {number} [opts.timeoutMs]
 */
export async function interceptedExecute(cap, args, opts = {}) {
  if (!cap || typeof cap.execute !== 'function') {
    return { ok: false, error: 'invalid capability' };
  }
  if (cap.level < LEVEL.REAL || opts.skipInterception) {
    return await cap.execute(args);
  }
  const confirmation = await requestConfirmation(cap, args, opts);
  if (!confirmation.ok) {
    return {
      ok: false,
      error: 'aborted: ' + (confirmation.reason || 'user cancelled'),
      interceptionId: confirmation.id,
    };
  }
  return await cap.execute(args);
}

/**
 * Convenience for callers that want a "auto-confirm-after-N-seconds"
 * for headless/automation contexts. Returns a confirmation function
 * that resolves true after the delay. Use sparingly — bypassing the
 * user's review is the whole thing M5 exists to prevent.
 */
export function autoConfirmAfter(ms) {
  return (id) => setTimeout(() => eventBus.emit('interception:confirm', { id }), ms);
}

/** Inspect what's pending — for the dashboard / diagnostics. */
export function listPending() {
  return Array.from(pending.entries()).map(([id, v]) => ({ id, ...v }));
}
