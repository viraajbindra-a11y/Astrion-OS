// Astrion OS — Branching Storage Layer (M5.P1)
//
// Copy-on-write substrate for safe mutations. The simplest viable
// implementation that gives M5 its key property: an L2+ action can
// be staged in a branch, the user can preview the diff, and only on
// explicit confirm does the change apply to "main reality."
//
// Implementation note: rather than fork the IndexedDB store, a
// branch is a transaction log — a list of pending mutations
// (createNode / updateNode / deleteNode) recorded against the live
// graph. mergeBranch executes the log atomically; discardBranch
// drops it. This avoids duplicating the entire graph for every
// branch (which would be expensive for the 1000+ node graphs M2 is
// already producing) and keeps the model simple enough that M5.P2's
// operation interceptor can wrap any capability execute() call in
// `runOnBranch()` without restructuring.
//
// Branch lifecycle:
//   open → committed | discarded
//
// Tradeoffs:
//   - The transaction log assumes deterministic mutations. If the
//     graph state changes between record and apply (e.g. another
//     branch commits a conflicting change), apply may fail. M5.P3
//     adds a per-branch BASE-VERSION check; for P1 we accept the
//     last-writer-wins behavior because the typical use is single-
//     user single-tab.
//   - Mutations are recorded as method calls, not state diffs. This
//     means branch playback is exactly what the original mutation
//     would have done — no loss of intent (createdBy, capabilityId,
//     etc. all flow through verbatim).

import { graphStore } from './graph-store.js';
import { query as graphQuery } from './graph-query.js';

const BRANCH_TYPE = 'branch';

const STATUS = {
  OPEN: 'open',
  COMMITTED: 'committed',
  DISCARDED: 'discarded',
  REWOUND: 'rewound',
};

// Each branch tags every mutation it produces so M5.P3 rewindBranch
// can find and reverse them later. Format: 'branch.merge:' + branchId
function branchTag(branchId) {
  return 'branch.merge:' + branchId;
}

// ─── Branch creation ───

/**
 * Create a new open branch. Returns the branch id and a `record`
 * helper bound to it. The branch starts with zero mutations.
 *
 * @param {object} [opts]
 * @param {string} [opts.name] — human-readable label
 * @param {string} [opts.intent] — what action this branch represents
 *   (e.g. "delete folder /Desktop/Old"); shown in diff UIs
 * @returns {Promise<{id, name, status, record, createdAt}>}
 */
export async function createBranch(opts = {}) {
  const node = await graphStore.createNode(BRANCH_TYPE, {
    name: opts.name || ('branch-' + Date.now()),
    intent: opts.intent || '',
    status: STATUS.OPEN,
    pendingMutations: [],
    committedAt: null,
    discardedAt: null,
    discardReason: null,
  }, {
    createdBy: { kind: 'system', capabilityId: 'branch.create' },
  });
  return {
    id: node.id,
    name: node.props.name,
    status: STATUS.OPEN,
    createdAt: node.createdAt,
    record: (mutation) => recordMutation(node.id, mutation),
  };
}

/**
 * Append a mutation to a branch's log. Mutation shape:
 *   { kind: 'createNode' | 'updateNode' | 'deleteNode' | 'addEdge',
 *     args: { ... },
 *     describe?: string }  // optional human-readable preview
 *
 * Returns the updated mutation count.
 */
export async function recordMutation(branchId, mutation) {
  if (!branchId) throw new Error('recordMutation: branchId required');
  if (!mutation || !mutation.kind) throw new Error('recordMutation: mutation.kind required');
  const VALID = ['createNode', 'updateNode', 'deleteNode', 'addEdge', 'removeEdge'];
  if (!VALID.includes(mutation.kind)) {
    throw new Error('recordMutation: unknown kind: ' + mutation.kind);
  }
  const node = await graphStore.getNode(branchId);
  if (!node || node.type !== BRANCH_TYPE) throw new Error('branch not found: ' + branchId);
  if (node.props.status !== STATUS.OPEN) {
    throw new Error('branch is not open (status=' + node.props.status + ')');
  }
  const pending = (node.props.pendingMutations || []).concat([{
    kind: mutation.kind,
    args: mutation.args || {},
    describe: mutation.describe || '',
    recordedAt: Date.now(),
  }]);
  await graphStore.updateNode(branchId, { ...node.props, pendingMutations: pending });
  return pending.length;
}

/**
 * Read a branch by id (for diff preview / dashboards).
 */
export async function getBranch(branchId) {
  const node = await graphStore.getNode(branchId);
  if (!node || node.type !== BRANCH_TYPE) return null;
  return { id: node.id, ...node.props };
}

/**
 * List branches by status. Default 'open' (the dashboards' default).
 */
export async function listBranches(status = STATUS.OPEN, limit = 50) {
  const where = status === '*' ? {} : { 'props.status': status };
  const results = await graphQuery(graphStore, {
    type: 'select',
    from: BRANCH_TYPE,
    where,
    orderBy: 'createdAt',
    orderDir: 'desc',
    limit,
  });
  return results.map(n => ({ id: n.id, ...n.props }));
}

/**
 * Produce a diff summary of what will change if this branch is
 * committed. Returns counts per mutation kind plus a list of
 * describes for the UI to render. Does NOT execute anything.
 */
export async function diffBranch(branchId) {
  const branch = await getBranch(branchId);
  if (!branch) throw new Error('branch not found: ' + branchId);
  const counts = { createNode: 0, updateNode: 0, deleteNode: 0, addEdge: 0, removeEdge: 0 };
  const lines = [];
  for (const m of branch.pendingMutations || []) {
    counts[m.kind] = (counts[m.kind] || 0) + 1;
    lines.push({ kind: m.kind, describe: m.describe || mutationDescribe(m), recordedAt: m.recordedAt });
  }
  return {
    branchId,
    name: branch.name,
    intent: branch.intent,
    status: branch.status,
    counts,
    lines,
    total: lines.length,
  };
}

function mutationDescribe(m) {
  switch (m.kind) {
    case 'createNode': return 'create ' + (m.args?.type || 'node');
    case 'updateNode': return 'update ' + (m.args?.id || 'node').slice(0, 8);
    case 'deleteNode': return 'delete ' + (m.args?.id || 'node').slice(0, 8);
    case 'addEdge': return 'edge ' + (m.args?.kind || '?') + ' from ' + (m.args?.from || '?').slice(0, 8);
    case 'removeEdge': return 'remove edge ' + (m.args?.from || '?').slice(0, 8);
    default: return m.kind;
  }
}

/**
 * Apply every mutation in the branch's log to the live graph. On
 * success, marks the branch committed. On any mutation failure,
 * stops and returns the error WITHOUT marking the branch — caller
 * can fix and re-merge or discard.
 *
 * Returns { ok, applied, failedAt?, error? }.
 */
export async function mergeBranch(branchId) {
  const branch = await getBranch(branchId);
  if (!branch) throw new Error('branch not found: ' + branchId);
  if (branch.status !== STATUS.OPEN) {
    throw new Error('branch is not open (status=' + branch.status + ')');
  }
  const pending = branch.pendingMutations || [];
  if (pending.length === 0) {
    // Trivially commit an empty branch.
    await graphStore.updateNode(branchId, {
      ...branch,
      status: STATUS.COMMITTED,
      committedAt: Date.now(),
    });
    return { ok: true, applied: 0 };
  }
  let applied = 0;
  const tag = branchTag(branchId);
  for (let i = 0; i < pending.length; i++) {
    const m = pending[i];
    try {
      // Tag the meta with the branch's capabilityId so M5.P3 rewindBranch
      // can find every mutation this merge produced. graph-store reads
      // meta.capabilityId directly (see createNode line 277, updateNode
      // line 335) and writes it into the mutation record.
      const taggedMeta = {
        ...(m.args?.meta || {}),
        kind: 'system',
        capabilityId: tag,
      };
      await applyMutation({ ...m, args: { ...(m.args || {}), meta: taggedMeta } });
      applied++;
    } catch (err) {
      return { ok: false, applied, failedAt: i, error: err?.message || String(err) };
    }
  }
  await graphStore.updateNode(branchId, {
    ...branch,
    status: STATUS.COMMITTED,
    committedAt: Date.now(),
  });
  return { ok: true, applied };
}

async function applyMutation(m) {
  const meta = (m.args && m.args.meta) || {};
  switch (m.kind) {
    case 'createNode': {
      const { type, props } = m.args || {};
      if (!type) throw new Error('createNode: type required');
      return await graphStore.createNode(type, props || {}, meta);
    }
    case 'updateNode': {
      const { id, props } = m.args || {};
      if (!id) throw new Error('updateNode: id required');
      return await graphStore.updateNode(id, props || {}, meta);
    }
    case 'deleteNode': {
      const { id } = m.args || {};
      if (!id) throw new Error('deleteNode: id required');
      return await graphStore.deleteNode(id, meta);
    }
    case 'addEdge': {
      const { from, kind, to, props } = m.args || {};
      if (!from || !kind || !to) throw new Error('addEdge: from/kind/to required');
      return await graphStore.addEdge(from, kind, to, props || {}, meta);
    }
    case 'removeEdge': {
      const { from, kind, to } = m.args || {};
      if (!from || !kind || !to) throw new Error('removeEdge: from/kind/to required');
      return await graphStore.removeEdge(from, kind, to, meta);
    }
    default: throw new Error('unknown mutation kind: ' + m.kind);
  }
}

/**
 * Reverse every mutation produced by a previous mergeBranch. Walks
 * graph-store's mutation log for entries tagged with this branch's
 * capabilityId and applies graphStore.rewindMutation in reverse
 * timestamp order. Returns {ok, rewound, skipped, errors}.
 *
 * Uses graph-store's existing rewind primitives — each rewind
 * generates a NEW mutation (creating an immutable provenance chain),
 * so re-rewinding a rewound branch returns the live state to where
 * it was before the second rewind. See lesson #60 for the version
 * counter semantics.
 */
export async function rewindBranch(branchId) {
  const branch = await getBranch(branchId);
  if (!branch) throw new Error('branch not found: ' + branchId);
  if (branch.status !== STATUS.COMMITTED) {
    throw new Error('only committed branches can be rewound (status=' + branch.status + ')');
  }
  const tag = branchTag(branchId);
  // Pass inclusive:true so mutations at exactly createdAt are included.
  // (Lesson #137: same-millisecond merges were being silently skipped
  // when the cursor was EXCLUSIVE. Previously we used createdAt-1 as a
  // workaround; the inclusive flag makes the intent explicit.)
  const since = branch.createdAt || 0;
  const all = await graphStore.getMutationsSince(since, { inclusive: true });
  const ours = all.filter(m => m.capabilityId === tag);
  // Reverse chronological order so cascading effects undo correctly
  ours.sort((a, b) => b.timestamp - a.timestamp);

  let rewound = 0, skipped = 0;
  const errors = [];
  for (const mut of ours) {
    try {
      const r = await graphStore.rewindMutation(mut.id, {
        kind: 'system',
        capabilityId: 'branch.rewind:' + branchId,
      });
      if (r.ok && !r.noop) rewound++;
      else if (r.noop) skipped++;
      else errors.push({ mutationId: mut.id, reason: r.reason });
    } catch (err) {
      errors.push({ mutationId: mut.id, reason: err?.message || String(err) });
    }
  }

  // Mark the branch rewound so it can't be rewound again (idempotency)
  await graphStore.updateNode(branchId, {
    ...branch,
    status: STATUS.REWOUND,
    rewoundAt: Date.now(),
    rewoundResults: { rewound, skipped, errorCount: errors.length },
  });
  return { ok: true, rewound, skipped, errors, totalMutations: ours.length };
}

/**
 * Discard a branch without applying its mutations. Soft-delete:
 * the branch node remains for audit, just transitions to discarded
 * status. Pass a reason string for the audit trail.
 */
export async function discardBranch(branchId, reason = '') {
  const branch = await getBranch(branchId);
  if (!branch) throw new Error('branch not found: ' + branchId);
  if (branch.status !== STATUS.OPEN) {
    return { ok: true, alreadyClosed: true, status: branch.status };
  }
  await graphStore.updateNode(branchId, {
    ...branch,
    status: STATUS.DISCARDED,
    discardedAt: Date.now(),
    discardReason: reason,
  });
  return { ok: true, status: STATUS.DISCARDED };
}

/**
 * Helper for capability authors: open a branch, run `fn(record)`,
 * return whatever fn returned plus the branchId. Caller decides
 * whether to merge or discard.
 *
 * Example:
 *   const { branchId, value } = await onBranch({ intent: 'rename' }, async (record) => {
 *     await record({ kind: 'updateNode', args: { id, props: { name: 'new' } } });
 *     return id;
 *   });
 *   const diff = await diffBranch(branchId);
 *   if (await userApproves(diff)) await mergeBranch(branchId);
 *   else await discardBranch(branchId, 'user rejected');
 */
export async function onBranch(opts, fn) {
  const branch = await createBranch(opts);
  let value;
  try {
    value = await fn(branch.record);
  } catch (err) {
    await discardBranch(branch.id, 'thrown: ' + (err?.message || String(err)));
    throw err;
  }
  return { branchId: branch.id, value };
}

export const BRANCH_STATUS = STATUS;
