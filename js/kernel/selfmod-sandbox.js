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
 * Apply a proposal. REFUSES today — the gates check list returns
 * non-empty so the apply path always errors out with a clear list of
 * missing pieces. M8.P3 will replace each placeholder check with a
 * real one.
 *
 * @returns {Promise<{ok, error?, missingChecks?}>}
 */
export async function applyProposal(id /* , opts */) {
  const proposal = await getProposal(id);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status !== 'pending') return { ok: false, error: 'proposal status is ' + proposal.status };

  // Today: every required check is "not implemented." The error string
  // names them all so reviewers see exactly what's missing.
  const missingChecks = [...REQUIRED_CHECKS]; // M8.P3 will narrow this list
  return {
    ok: false,
    error: 'self-mod apply gated: ' + missingChecks.length + ' required checks not yet wired',
    missingChecks,
  };
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
