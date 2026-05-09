// Astrion OS — Skill Proposer
//
// Second half of the "Astrion learned something" loop. Subscribes to
// `sequence:repeated` from sequence-observer.js, asks the user whether
// to bind the sequence as a skill, and (on accept) writes a real .skill
// file via skill-registry.installUserSkill + logs the change through
// adaptation-engine so it can be reverted from the Adaptations panel.
//
// Boldness controls the ask shape:
//   - LOW    → emit `skill:proposal`; never auto-install. UI surface
//              decides what to do (toast, banner, ignored).
//   - MEDIUM → same as LOW (default for skill category — we always ask
//              before binding because a wrong skill is annoying).
//   - HIGH   → auto-install + log silently. Reserved for users who
//              opt in; default boldness is MEDIUM so this doesn't fire
//              by default.
//
// Daily budget is enforced via adaptation-engine. If the user has
// already accepted N skills today (default 3), no further proposals
// fire until tomorrow. The detection still happens — we just don't
// pester.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBoldness,
  getBudgetRemaining,
  CATEGORY,
  BOLDNESS,
} from './adaptation-engine.js';

let initialized = false;

export function initSkillProposer() {
  // Register the revert handler unconditionally — it's idempotent
  // (Map.set replaces any prior entry) and the engine's _resetForTests
  // wipes handlers, so a re-init after reset MUST re-register or
  // revertAdaptation will fail with "no revert handler" on a real
  // accept->revert flow.
  registerRevertHandler('skill:remove', revertHandler);
  if (initialized) return;
  initialized = true;
  eventBus.on('sequence:repeated', onRepeated);
}

async function onRepeated({ sequence, count }) {
  if (!Array.isArray(sequence) || sequence.length === 0) return;
  if (getBudgetRemaining(CATEGORY.SKILL) <= 0) return; // no badgering
  const proposal = buildProposal(sequence, count);
  const boldness = getBoldness(CATEGORY.SKILL);
  if (boldness === BOLDNESS.HIGH) {
    // Auto-install. Caller opted into bold mode.
    await accept(proposal);
    return;
  }
  // LOW + MEDIUM: ask. Anyone listening can bind it via accept().
  eventBus.emit('skill:proposal', proposal);
}

/**
 * Build a proposal record from a detected sequence. Pure: no IO, no
 * side effects. Exposed via `_internal` for tests.
 */
function buildProposal(sequence, count) {
  const slug = sequence.map(s => s.replace(/[^a-z0-9]+/gi, '-')).join('-').toLowerCase();
  const id = ('auto-' + slug).slice(0, 50) + '-' + Date.now().toString(36).slice(-4);
  const summary = `Run "${sequence.join(' → ')}"`;
  const phrases = [
    sequence.join(' '),
    `do my ${sequence[0].split('.')[0]} routine`,
  ];
  return {
    id,
    sequence,
    count,
    summary,
    phrases,
    trigger: `You ran this sequence ${count} times recently`,
  };
}

/**
 * Accept a proposal. Installs the .skill via skill-registry and logs
 * the adaptation. If recording the adaptation fails (e.g. budget),
 * the skill install is rolled back so the two states stay consistent.
 *
 * Returns { ok, skill?, adaptationId?, error? }.
 */
export async function accept(proposal) {
  if (!proposal || !proposal.id) return { ok: false, error: 'invalid proposal' };
  const source = buildSkillSource(proposal);
  let skillReg;
  try {
    skillReg = await import('./skill-registry.js');
  } catch (err) {
    return { ok: false, error: 'skill-registry import failed: ' + (err?.message || err) };
  }
  let installed;
  try {
    installed = await skillReg.installUserSkill(source);
  } catch (err) {
    return { ok: false, error: 'install threw: ' + (err?.message || err) };
  }
  if (!installed?.ok) {
    return { ok: false, error: installed?.error || 'install failed' };
  }
  // Use the actual registered name — installUserSkill may rename on
  // collision. Revert MUST target what's actually in the registry.
  const skillName = installed.name;
  const recorded = recordAdaptation({
    category: CATEGORY.SKILL,
    summary: `Saved "${proposal.summary}" as skill "${skillName}"`,
    trigger: proposal.trigger,
    revert: { kind: 'skill:remove', args: { name: skillName } },
  });
  if (!recorded.ok) {
    // Roll back the install so we don't leak a registered skill that
    // has no corresponding adaptation entry to revert.
    try { skillReg.uninstallUserSkill(skillName); } catch {}
    return { ok: false, error: recorded.reason };
  }
  eventBus.emit('skill:installed', { skill: skillName, adaptationId: recorded.entry.id });
  return { ok: true, skill: skillName, adaptationId: recorded.entry.id };
}

/** Reject a proposal — currently just emits an event for telemetry. */
export function reject(proposalId) {
  eventBus.emit('skill:rejected', { proposalId });
}

function buildSkillSource(proposal) {
  const triggerLines = proposal.phrases.map(p => `  - phrase: "${p.replace(/"/g, '\\"')}"`).join('\n');
  // Plain YAML-ish format the skill-parser accepts. Goal becomes the
  // user-facing skill name. Trigger items are objects with `phrase:`
  // (the parser's required shape — not a flat string list).
  // The `do` field is natural-language; the planner re-derives the
  // action sequence at run time. Faithful replay of args is a future
  // enhancement (would require a `do.steps:` array extension to the
  // skill format).
  return `goal: ${proposal.id}
trigger:
${triggerLines}
do: Run my ${proposal.sequence.join(' then ')} routine.
`;
}

async function revertHandler(args) {
  if (!args?.name) throw new Error('skill:remove revert needs args.name');
  const skillReg = await import('./skill-registry.js');
  await skillReg.uninstallUserSkill(args.name);
}

// ─── Test helpers ──────────────────────────────────────────────────

export function _resetForTests() {
  initialized = false;
}

export const _internal = { buildProposal, buildSkillSource };
