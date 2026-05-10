// Astrion OS — Time Routine Toast
//
// Surfaces time-routine:proposal events from time-routine-detector.
// Same pattern as the other toasts: detection happens silently,
// surface asks the user, accept routes through the proposer's
// accept() so the adaptation is logged.

import { eventBus } from '../kernel/event-bus.js';
import { notifications } from '../kernel/notifications.js';

let initialized = false;

export function initTimeRoutineToast() {
  if (initialized) return;
  initialized = true;
  eventBus.on('time-routine:proposal', onProposal);
}

async function onProposal(proposal) {
  if (!proposal || !proposal.id) return;
  notifications.show({
    title: 'Astrion spotted a routine',
    body: `${proposal.trigger}\n\n${proposal.summary}`,
    icon: '🕒',
    duration: 14000,
    actions: [
      { label: 'Save routine', onClick: () => accept(proposal) },
      { label: 'Not now', onClick: () => {} },
    ],
  });
}

async function accept(proposal) {
  const tr = await import('../kernel/time-routine-detector.js');
  const r = await tr.acceptProposal(proposal);
  if (r.ok) {
    notifications.show({
      title: 'Routine saved',
      body: 'Revert from the Adaptations panel.',
      icon: '✓', duration: 4000,
    });
  } else {
    notifications.show({
      title: 'Couldn\'t save routine',
      body: r.error || r.reason || 'Unknown error',
      icon: '⚠️', duration: 5000,
    });
  }
}

export function _resetForTests() { initialized = false; }
