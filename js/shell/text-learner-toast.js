// Astrion OS — Text Learner Toast
//
// Closes the silent-detection gap on text-learner.js. Without this:
//   - User reverts terminal.exec 3 times. text-learner notes the pattern.
//     The "always-confirm" preference proposal event fires. Nothing
//     visible happens. The rule never lands because no surface accepts.
//   - User corrects "teh" to "the" 3 times. text-learner notes the
//     pattern. The autocorrect proposal event fires. Same — silent.
//
// This toast subscribes to text-learner:preference-proposal and
// text-learner:autocorrect-proposal and shows actionable banners with
// "Apply" / "Not now" buttons. On Apply it calls the right
// acceptXxxProposal() so the rule lands AND the adaptation is logged
// (and therefore revertable from the Adaptations panel).

import { eventBus } from '../kernel/event-bus.js';
import { notifications } from '../kernel/notifications.js';

let initialized = false;

export function initTextLearnerToast() {
  if (initialized) return;
  initialized = true;
  eventBus.on('text-learner:preference-proposal', onPreferenceProposal);
  eventBus.on('text-learner:autocorrect-proposal', onAutocorrectProposal);
}

async function onPreferenceProposal(proposal) {
  if (!proposal || !proposal.capId) return;
  notifications.show({
    title: 'Astrion noticed a pattern',
    body: `${proposal.trigger}\n\n${proposal.summary}`,
    icon: '🛡',
    duration: 14000,
    actions: [
      { label: 'Apply rule', onClick: () => acceptPreference(proposal) },
      { label: 'Not now', onClick: () => {} },
    ],
  });
}

async function acceptPreference(proposal) {
  let tl;
  try {
    tl = await import('../kernel/text-learner.js');
  } catch (err) {
    notifications.show({
      title: 'Couldn\'t apply rule',
      body: 'text-learner failed to load: ' + (err?.message || String(err)),
      icon: '⚠️', duration: 5000,
    });
    return;
  }
  const r = await tl.acceptPreferenceProposal(proposal);
  if (r.ok) {
    notifications.show({
      title: 'Always-confirm rule applied',
      body: `Astrion will now ask before "${proposal.capId}" runs. Revert from the Adaptations panel.`,
      icon: '✓', duration: 5000,
    });
  } else {
    notifications.show({
      title: 'Couldn\'t apply rule',
      body: r.error || r.reason || 'Unknown error',
      icon: '⚠️', duration: 5000,
    });
  }
}

async function onAutocorrectProposal(proposal) {
  if (!proposal || !proposal.from || !proposal.to) return;
  notifications.show({
    title: 'Astrion noticed a correction',
    body: `${proposal.trigger}\n\n${proposal.summary}`,
    icon: '✏️',
    duration: 14000,
    actions: [
      { label: 'Add rule', onClick: () => acceptAutocorrect(proposal) },
      { label: 'Not now', onClick: () => {} },
    ],
  });
}

async function acceptAutocorrect(proposal) {
  let tl;
  try {
    tl = await import('../kernel/text-learner.js');
  } catch (err) {
    notifications.show({
      title: 'Couldn\'t add rule',
      body: 'text-learner failed to load: ' + (err?.message || String(err)),
      icon: '⚠️', duration: 5000,
    });
    return;
  }
  const r = await tl.acceptAutocorrectProposal(proposal);
  if (r.ok) {
    notifications.show({
      title: 'Autocorrect rule added',
      body: `"${proposal.from}" → "${proposal.to}". Revert from the Adaptations panel.`,
      icon: '✓', duration: 5000,
    });
  } else {
    notifications.show({
      title: 'Couldn\'t add rule',
      body: r.error || r.reason || 'Unknown error',
      icon: '⚠️', duration: 5000,
    });
  }
}

export function _resetForTests() { initialized = false; }
