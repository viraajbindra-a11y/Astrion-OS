// Astrion OS — Self-mod sandbox stub (M8.P2)
//
// The substrate that future M8.P3+ self-mod uses to propose changes
// to its own kernel without touching the live source. Today no actual
// proposals can be applied — this is the type system + the gates,
// landed early so M8.P3 can plug into a stable contract.
//
// Lifecycle:
//   propose(target, diff, reason)  → 'selfmod-proposal' graph node, status='pending'
//   listProposals(status?)         → recent proposals
//   apply(proposalId)              → REFUSES today; will check golden +
//                                    value-lock + red-team signoff in M8.P3
//   discard(proposalId, reason)    → status='discarded'
//
// Why "REFUSES today": shipping the sandbox before the gates would
// give a credible "self-mod is here" surface without the safety story
// behind it. The code below makes the safety story explicit AND
// non-bypassable: apply() returns an error containing the list of
// missing checks. M8.P3 will swap each error string for an actual
// check call.

import { eventBus } from './event-bus.js';
import { graphStore } from './graph-store.js';
import { query as graphQuery } from './graph-query.js';

const PROPOSAL_TYPE = 'selfmod-proposal';

const REQUIRED_CHECKS = [
  'golden-integrity',     // M8.P1 — files match lock
  'value-lock',           // M8.P2 — values match baseline
  'red-team-signoff',     // M8.P3 — adversarial agent approved
  'user-typed-confirm',   // M5.P4 — user typed proposal id to confirm
  'rollback-plan',        // M8.P4 — automatic rollback ready
];

/**
 * Record a new self-mod proposal. Today this is purely descriptive —
 * the proposal lives in the graph, anyone can read it, but apply()
 * refuses to execute. Returns the proposal id.
 *
 * @param {object} input
 * @param {string} input.target      — file path or kernel module being modified
 * @param {string} input.diff        — unified-diff string of the proposed change
 * @param {string} input.reason      — why this change is needed
 * @param {string} [input.proposer]  — agent name or 'user'
 */
export async function proposeSelfMod({ target, diff, reason, proposer = 'system' }) {
  if (!target || typeof target !== 'string') throw new Error('proposeSelfMod: target required');
  if (!diff || typeof diff !== 'string') throw new Error('proposeSelfMod: diff required');
  if (!reason || typeof reason !== 'string') throw new Error('proposeSelfMod: reason required');
  if (diff.length > 50000) throw new Error('proposeSelfMod: diff too large (50KB max)');

  const node = await graphStore.createNode(PROPOSAL_TYPE, {
    target, diff, reason, proposer,
    status: 'pending',
    createdAt: Date.now(),
    appliedAt: null,
    discardedAt: null,
    discardReason: null,
    checksRequired: [...REQUIRED_CHECKS],
    checksPassed: [],
  }, {
    createdBy: { kind: 'system', capabilityId: 'selfmod.propose' },
  });
  eventBus.emit('selfmod:proposed', { id: node.id, target, proposer });
  return node.id;
}

export async function listProposals(status = 'pending', limit = 20) {
  const where = status === '*' ? {} : { 'props.status': status };
  const results = await graphQuery(graphStore, {
    type: 'select', from: PROPOSAL_TYPE,
    where, orderBy: 'createdAt', orderDir: 'desc', limit,
  });
  return results.map(n => ({ id: n.id, ...n.props }));
}

export async function getProposal(id) {
  const node = await graphStore.getNode(id);
  if (!node || node.type !== PROPOSAL_TYPE) return null;
  return { id: node.id, ...node.props };
}

/**
 * Apply a proposal. Walks all 5 required gates in order; ANY failure
 * aborts and the proposal stays pending so the user can review +
 * decide. Today still refuses to actually mutate source — the
 * "approved" path just records the proposal as gated-ok and emits an
 * event. M8.P4 adds the actual write + rollback automation.
 *
 * @param {string} id — proposal id
 * @param {object} [opts]
 * @param {string} [opts.typedConfirm] — must equal the proposal id for
 *                                       the user-typed-confirm gate
 * @returns {Promise<{ok, error?, gatesPassed?, gatesFailed?}>}
 */
export async function applyProposal(id, opts = {}) {
  const proposal = await getProposal(id);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status !== 'pending') return { ok: false, error: 'proposal status is ' + proposal.status };

  const passed = [];
  const failed = [];

  // 1. Golden-integrity: every locked file matches its blessed hash.
  try {
    const { verifyGolden } = await import('./golden-check.js');
    const r = await verifyGolden();
    if (r.ok) passed.push('golden-integrity');
    else failed.push({ check: 'golden-integrity', reason: r.mismatched.length + ' file(s) drifted' });
  } catch (err) { failed.push({ check: 'golden-integrity', reason: err?.message || 'check threw' }); }

  // 2. Value-lock: live LOCKED_VALUES match the recorded baseline.
  try {
    const { verifyValueLock } = await import('./value-lock.js');
    const baseline = (() => { try { return localStorage.getItem('astrion-value-lock-baseline'); } catch { return null; } })();
    const r = await verifyValueLock(baseline);
    if (r.ok) passed.push('value-lock');
    else failed.push({ check: 'value-lock', reason: 'value drift detected' });
  } catch (err) { failed.push({ check: 'value-lock', reason: err?.message || 'check threw' }); }

  // 3. Red-team signoff: adversarial review of the proposal itself.
  // Today uses the same model as the planner with the existing red-team
  // adversarial prompt. M8.P3.b will route this to a DIFFERENT model
  // for true diversity; the current gate is enough to refuse a wildly
  // unsafe proposal AND keeps the same model from rubber-stamping
  // its own output (the system prompt is adversarial enough).
  try {
    const { reviewAction } = await import('./red-team.js');
    const syntheticCap = {
      id: 'selfmod.apply',
      summary: 'Apply self-mod to ' + proposal.target,
      level: 3, reversibility: 'permanent', blastRadius: 'external',
      pointOfNoReturn: true,
    };
    const review = await reviewAction(syntheticCap, {
      proposer: proposal.proposer, reason: proposal.reason,
      diff_preview: proposal.diff.slice(0, 800),
    });
    if (review.ok && review.review?.recommendation === 'proceed') {
      passed.push('red-team-signoff');
    } else if (review.ok) {
      failed.push({ check: 'red-team-signoff', reason: 'recommendation: ' + review.review?.recommendation + ' — ' + (review.review?.summary || '') });
    } else {
      failed.push({ check: 'red-team-signoff', reason: 'red-team unavailable: ' + (review.error || 'unknown') });
    }
  } catch (err) { failed.push({ check: 'red-team-signoff', reason: err?.message || 'check threw' }); }

  // 4. User-typed-confirm: caller MUST pass opts.typedConfirm equal to
  // the proposal id. Reuses the M5.P4 PONR pattern — typing the id is
  // friction tax; rubber-stamping a self-mod is exactly the case the
  // tracker can't catch in retrospect.
  if (opts.typedConfirm === id) {
    passed.push('user-typed-confirm');
  } else {
    failed.push({ check: 'user-typed-confirm', reason: 'opts.typedConfirm must equal proposal id "' + id + '"' });
  }

  // 5. Rollback-plan: proposal must include a rollback diff so M8.P4
  // can revert if golden-check trips after apply. Today we only verify
  // the field is present; the actual rollback execution is M8.P4.
  if (typeof proposal.rollbackDiff === 'string' && proposal.rollbackDiff.length > 0) {
    passed.push('rollback-plan');
  } else {
    failed.push({ check: 'rollback-plan', reason: 'proposal.rollbackDiff missing (required: inverse-diff string for M8.P4 rollback)' });
  }

  // ─── Decision ───
  if (failed.length > 0) {
    return {
      ok: false,
      error: 'self-mod apply blocked: ' + failed.length + ' gate(s) failed',
      gatesPassed: passed,
      gatesFailed: failed,
    };
  }

  // All 5 gates passed. We do NOT actually write to disk yet — that's
  // M8.P4's job (real rollback-protected source mutation). Today we
  // mark the proposal 'approved' so the audit trail is complete and
  // emit selfmod:approved.
  await graphStore.updateNode(id, {
    ...proposal,
    status: 'approved',
    appliedAt: Date.now(),
    checksPassed: passed,
  });
  eventBus.emit('selfmod:approved', { id, gatesPassed: passed });
  return { ok: true, id, gatesPassed: passed, note: 'gates passed; actual source mutation deferred to M8.P4' };
}

export async function discardProposal(id, reason = '') {
  const proposal = await getProposal(id);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status !== 'pending') return { ok: false, error: 'proposal status is ' + proposal.status };
  await graphStore.updateNode(id, {
    ...proposal,
    status: 'discarded',
    discardedAt: Date.now(),
    discardReason: reason,
  });
  eventBus.emit('selfmod:discarded', { id, reason });
  return { ok: true, id };
}

// ─── Sanity tests (localhost only) ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  (async () => {
    let f = 0;
    try {
      await proposeSelfMod({ target: '', diff: 'x', reason: 'r' });
      console.warn('[selfmod-sandbox] empty target should throw'); f++;
    } catch {}
    try {
      await proposeSelfMod({ target: 't', diff: '', reason: 'r' });
      console.warn('[selfmod-sandbox] empty diff should throw'); f++;
    } catch {}
    try {
      await proposeSelfMod({ target: 't', diff: 'x', reason: '' });
      console.warn('[selfmod-sandbox] empty reason should throw'); f++;
    } catch {}
    if (f === 0) console.log('[selfmod-sandbox] all 3 sanity tests pass (proposal validation)');
    else console.warn('[selfmod-sandbox]', f, 'sanity tests failed');
  })();
}
