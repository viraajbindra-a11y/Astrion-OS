// Astrion OS — Generation Bridge
//
// #13 Workflow generator — describe a workflow in plain English,
//      Astrion proposes a routine made of existing capabilities.
// #14 Format converter on demand — paste data + "convert to X",
//      Astrion writes a one-shot skill.
//
// Both are explicit user-initiated entry points to generation. Unlike
// intent-miss-proposer (which catches passive misses), these are
// invoked directly from Spotlight intents:
//
//   "/workflow run my morning email check"   → workflow generator
//   "/convert this CSV to JSON"              → format converter
//
// For v1 these emit proposal events that hook into the existing
// spec/test/code generators. The actual code-gen happens through the
// same pipeline as intent-miss-proposer's accept(); this module just
// adds richer entry points.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBudgetRemaining,
  CATEGORY,
} from './adaptation-engine.js';

let initialized = false;

/**
 * #13 Workflow generator — propose a routine from a NL description.
 */
export async function proposeWorkflow(description) {
  if (!description || typeof description !== 'string') return { ok: false, error: 'description required' };
  if (getBudgetRemaining(CATEGORY.ROUTINE) <= 0) return { ok: false, error: 'routine budget exhausted' };
  const proposal = {
    id: 'workflow-' + Date.now().toString(36),
    description: description.trim(),
    summary: `Generate a workflow for: "${description.trim()}"`,
    trigger: 'You asked Astrion to build a workflow',
  };
  eventBus.emit('workflow:proposal', proposal);
  return { ok: true, proposal };
}

export async function acceptWorkflow(proposal) {
  if (!proposal?.description) return { ok: false, error: 'invalid proposal' };
  const recorded = recordAdaptation({
    category: CATEGORY.ROUTINE,
    summary: proposal.summary || `Generated workflow: ${proposal.description}`,
    trigger: proposal.trigger || 'User-requested workflow generation',
    revert: { kind: 'workflow:remove', args: { id: proposal.id } },
  });
  if (!recorded.ok) return { ok: false, error: recorded.reason };
  eventBus.emit('workflow:generate', { description: proposal.description });
  return { ok: true, adaptationId: recorded.entry.id };
}

function revertWorkflow(args) {
  if (args?.id) eventBus.emit('workflow:revert', { id: args.id });
}

/**
 * #14 Format converter — propose a one-shot skill that converts
 * `data` into the format described by `target`.
 */
export async function proposeFormatConversion(data, target) {
  if (!data || !target) return { ok: false, error: 'data + target required' };
  if (getBudgetRemaining(CATEGORY.SKILL) <= 0) return { ok: false, error: 'skill budget exhausted' };
  const proposal = {
    id: 'fmt-' + Date.now().toString(36),
    data: typeof data === 'string' ? data.slice(0, 4000) : '',
    target: String(target).trim(),
    summary: `Generate one-shot converter to ${target}`,
    trigger: 'You asked Astrion to convert pasted data',
  };
  eventBus.emit('format-convert:proposal', proposal);
  return { ok: true, proposal };
}

export async function acceptFormatConversion(proposal) {
  if (!proposal?.target) return { ok: false, error: 'invalid proposal' };
  const recorded = recordAdaptation({
    category: CATEGORY.SKILL,
    summary: `Built one-shot converter to ${proposal.target}`,
    trigger: proposal.trigger || 'User-requested format conversion',
    revert: { kind: 'format-convert:remove', args: { id: proposal.id } },
  });
  if (!recorded.ok) return { ok: false, error: recorded.reason };
  eventBus.emit('format-convert:generate', { data: proposal.data, target: proposal.target });
  return { ok: true, adaptationId: recorded.entry.id };
}

function revertFormat(args) {
  if (args?.id) eventBus.emit('format-convert:revert', { id: args.id });
}

export function initGenerationBridge() {
  registerRevertHandler('workflow:remove',       revertWorkflow);
  registerRevertHandler('format-convert:remove', revertFormat);
  if (initialized) return;
  initialized = true;
}

export function _resetForTests() { initialized = false; }
