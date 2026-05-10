// Astrion OS — Dock Usage Toast
//
// Surfaces dock-usage:proposal events. Only fires when the user has
// dropped UI category boldness from the default HIGH (silent
// auto-pin) to MEDIUM/LOW — at HIGH the proposer just pins/unpins
// and logs the adaptation directly. This is the path for users who
// want to confirm dock changes themselves.

import { eventBus } from '../kernel/event-bus.js';
import { notifications } from '../kernel/notifications.js';

let initialized = false;

export function initDockUsageToast() {
  if (initialized) return;
  initialized = true;
  eventBus.on('dock-usage:proposal', onProposal);
}

async function onProposal(proposal) {
  if (!proposal || !proposal.appId) return;
  const verb = proposal.kind === 'pin' ? 'Pin' : 'Unpin';
  const reason = proposal.kind === 'pin'
    ? `You opened "${proposal.appId}" ${proposal.count} times — pin to dock?`
    : `"${proposal.appId}" has been pinned but unused — unpin?`;
  notifications.show({
    title: `${verb} ${proposal.appId}?`,
    body: reason,
    icon: '📌',
    duration: 12000,
    actions: [
      { label: verb, onClick: () => accept(proposal) },
      { label: 'Not now', onClick: () => {} },
    ],
  });
}

async function accept(proposal) {
  const dock = await import('../kernel/dock-usage-proposer.js');
  const r = await dock.acceptProposal(proposal);
  if (r?.ok) {
    notifications.show({
      title: proposal.kind === 'pin' ? 'Pinned' : 'Unpinned',
      body: `Revert from the Adaptations panel.`,
      icon: '✓', duration: 4000,
    });
  } else {
    notifications.show({
      title: 'Couldn\'t apply',
      body: r?.error || r?.reason || 'Unknown error',
      icon: '⚠️', duration: 5000,
    });
  }
}

export function _resetForTests() { initialized = false; }
