// Astrion OS — Skill Proposal Toast
//
// The visible "Astrion learned something" surface. Subscribes to
// `skill:proposal` (fired by skill-proposer when sequence-observer
// detects a 3-step pattern repeated 3+ times) and shows a notification
// with "Save as skill" / "Not now" actions.
//
// Two paths:
//   - Save → proposer.accept() — installs the skill, records the
//     adaptation, fires a confirmation toast with the new skill name.
//   - Not now → proposer.reject() — emits skill:rejected for telemetry,
//     no install. The proposer's already-proposed memory means we
//     won't re-ask for this exact sequence in the same session.
//
// What this is NOT
// ────────────────
// Not a fallback path for app generation, not the chat panel
// equivalent. Just the toast surface for the auto-evolution loop's
// flagship feature. Other adaptation categories (graph auto-link,
// dock pinning) have their own surfaces.

import { eventBus } from '../kernel/event-bus.js';
import { notifications } from '../kernel/notifications.js';

let initialized = false;

export function initSkillProposalToast() {
  if (initialized) return;
  initialized = true;
  eventBus.on('skill:proposal', onProposal);
}

async function onProposal(proposal) {
  if (!proposal || !proposal.id) return;
  const summary = proposal.summary || `Run ${proposal.sequence?.join(' → ') || '...'}`;
  const trigger = proposal.trigger || `Repeated sequence detected.`;

  notifications.show({
    title: 'Astrion noticed a pattern',
    body: `${trigger}\n\n${summary}`,
    icon: '✨',
    duration: 12000,
    actions: [
      { label: 'Save as skill', onClick: () => acceptProposal(proposal) },
      { label: 'Not now',       onClick: () => rejectProposal(proposal) },
    ],
  });
}

async function acceptProposal(proposal) {
  let proposer;
  try {
    proposer = await import('../kernel/skill-proposer.js');
  } catch (err) {
    notifications.show({
      title: 'Couldn\'t save skill',
      body: 'skill-proposer module failed to load: ' + (err?.message || String(err)),
      icon: '⚠️',
      duration: 6000,
    });
    return;
  }
  const result = await proposer.accept(proposal);
  if (result.ok) {
    notifications.show({
      title: 'Skill saved',
      body: `"${result.skill}" is now bound. Open the Adaptations app to revert.`,
      icon: '✓',
      duration: 5000,
      actions: [
        { label: 'Open Adaptations', onClick: () => {
            try {
              import('../kernel/process-manager.js').then(m => m.processManager.launch('adaptations'));
            } catch {}
          } },
      ],
    });
  } else {
    notifications.show({
      title: 'Couldn\'t save skill',
      body: result.error || 'Unknown error.',
      icon: '⚠️',
      duration: 6000,
    });
  }
}

async function rejectProposal(proposal) {
  try {
    const proposer = await import('../kernel/skill-proposer.js');
    proposer.reject(proposal.id);
  } catch {}
}

// Test helper.
export function _resetForTests() {
  initialized = false;
}
