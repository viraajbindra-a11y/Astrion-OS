// Astrion OS — Plan Rehearser (onBranch-based preview)
//
// Takes a plan (from intent-planner) and "rehearses" it in a branch:
// for every graph-mutating step, records the intended mutation into
// the branch's pendingMutations instead of calling the cap's execute.
// Returns a diff + branchId so the UI can show the user what the plan
// WOULD do before they approve it for real.
//
// Key design:
//   - Only caps whose side-effects are graph writes can be rehearsed.
//     We inspect cap.id and hand-map to the shape of mutation each one
//     produces. Unknown caps and non-graph caps (terminal.exec,
//     notifications, volume.set, etc.) are listed separately as
//     "would-run-for-real-on-approve" so the user sees the full picture.
//   - Branch auto-discards on throw (via onBranch). Caller decides
//     whether to merge or discard based on user approval.
//   - Does NOT run the steps for real. Approval is a SEPARATE call to
//     executePlan by the caller. This keeps the rehearser side-effect
//     free (cheap, retryable).

import { onBranch, diffBranch, mergeBranch, discardBranch } from './branch-manager.js';

// Hand-coded: for each graph-writing cap, what shape of mutation(s)
// it would produce. Kept narrow + conservative — anything not listed
// falls through to "unrehearsable, runs on approve."
const GRAPH_WRITERS = {
  'notes.create': (args) => [{
    kind: 'createNode',
    args: {
      type: 'note',
      props: {
        title: args.name || 'Untitled note',
        content: (args.items || []).join('\n') || args.topic || '',
        date: new Date().toISOString(),
      },
    },
    describe: `create note "${args.name || 'Untitled note'}"`,
  }],
  'todo.create': (args) => [{
    kind: 'createNode',
    args: { type: 'todo', props: { text: args.name || args.text || 'Untitled todo', done: false } },
    describe: `create todo "${args.name || args.text || 'Untitled todo'}"`,
  }],
  'reminder.create': (args) => [{
    kind: 'createNode',
    args: { type: 'reminder', props: { text: args.name || 'Reminder', when: args.when || null } },
    describe: `create reminder "${args.name || 'Reminder'}"`,
  }],
  'files.createFolder': (args) => [{
    kind: 'createNode',
    args: { type: 'folder', props: { path: args.path, name: args.name } },
    describe: `create folder ${args.path || ''}/${args.name || ''}`,
  }],
  'files.createFile': (args) => [{
    kind: 'createNode',
    args: { type: 'file', props: { parent: args.parent, name: args.name, content: args.content } },
    describe: `create file ${args.parent || ''}/${args.name || ''}`,
  }],
};

/**
 * Is this cap known to write to the graph in a way we can rehearse?
 */
export function isRehearsable(capId) {
  return Object.prototype.hasOwnProperty.call(GRAPH_WRITERS, capId);
}

/**
 * Rehearse a plan in a new branch.
 *
 * @param {object} plan — { steps: [{cap, args, binds}, ...] }
 * @param {object} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   branchId?: string,
 *   diff?: object,          // from diffBranch()
 *   unrehearsable?: Array,  // caps whose side-effects can't be previewed
 *   error?: string,
 * }>}
 */
export async function rehearsePlan(plan, opts = {}) {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, error: 'empty plan' };
  }
  const intent = opts.query || plan.reasoning || '';
  const unrehearsable = [];
  const result = await onBranch({ intent: 'rehearse: ' + intent.slice(0, 120), name: 'rehearsal' }, async (record) => {
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const writer = GRAPH_WRITERS[step.cap];
      if (!writer) {
        unrehearsable.push({
          index: i,
          cap: step.cap,
          args: step.args,
          reason: 'not a known graph writer',
        });
        continue;
      }
      const mutations = writer(step.args || {});
      for (const m of mutations) {
        await record({
          ...m,
          args: { ...m.args, meta: { kind: 'system', capabilityId: 'rehearsal' } },
        });
      }
    }
    return { stepCount: plan.steps.length };
  });
  const diff = await diffBranch(result.branchId);
  return {
    ok: true,
    branchId: result.branchId,
    diff,
    unrehearsable,
  };
}

/**
 * After rehearsePlan: user approved. Discard the rehearsal branch
 * (it was preview-only; the real executePlan runs independently) and
 * return a signal the caller can act on.
 *
 * Deliberately does NOT auto-run executePlan — the caller owns that
 * because the real run has its own L2+ gate that may differ from the
 * preview.
 */
export async function acceptRehearsal(branchId) {
  if (!branchId) return { ok: false, error: 'branchId required' };
  await discardBranch(branchId, 'accepted into real execution');
  return { ok: true, note: 'rehearsal branch discarded — run executePlan for real effects' };
}

/**
 * User rejected. Discard the branch with a clear audit reason.
 */
export async function rejectRehearsal(branchId, reason = 'user-rejected') {
  if (!branchId) return { ok: false, error: 'branchId required' };
  await discardBranch(branchId, reason);
  return { ok: true };
}

/**
 * Summarize a diff for quick one-line user display.
 */
export function summarizeDiff(diff) {
  if (!diff) return '(no diff)';
  const parts = [];
  const c = diff.counts || {};
  if (c.createNode) parts.push(`+${c.createNode} node${c.createNode > 1 ? 's' : ''}`);
  if (c.updateNode) parts.push(`~${c.updateNode}`);
  if (c.deleteNode) parts.push(`-${c.deleteNode}`);
  if (c.addEdge)    parts.push(`+${c.addEdge} edge${c.addEdge > 1 ? 's' : ''}`);
  if (c.removeEdge) parts.push(`-${c.removeEdge} edge${c.removeEdge > 1 ? 's' : ''}`);
  return parts.length ? parts.join(', ') : '0 mutations';
}
