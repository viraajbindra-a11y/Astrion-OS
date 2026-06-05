/*
 * Astrion — Healer Toast (surface for the Self-Healing Apps loop)
 *
 * Subscribes to `healer:proposal` (fired by kernel/healer.js when an
 * uncaught error is diagnosed + a fix is proposed through the M8 self-mod
 * sandbox) and shows a notification with [View fix] / [Dismiss] actions.
 *
 * View → opens the Healer Log app, scrolled to the proposal id.
 * Dismiss → just closes; the proposal stays pending in the audit trail
 *           so the user can revisit later. The user must explicitly
 *           accept via the existing self-mod confirmation flow to apply.
 *
 * Mirrors the shape of skill-proposal-toast.js so the surface layer
 * stays consistent (one detection event → one notification → one app).
 */

import { eventBus } from '../kernel/event-bus.js';
import { notifications } from '../kernel/notifications.js';

let initialized = false;

export function initHealerToast() {
  if (initialized) return;
  initialized = true;
  eventBus.on('healer:proposal', onHealerProposal);
  // Optional informational toasts; off by default.
  eventBus.on('healer:no-fix', onHealerNoFix);
}

async function onHealerProposal(p) {
  if (!p || !p.proposalId) return;
  const file = shortenPath(p.target || '');
  const where = file + (p.line ? `:${p.line}` : '');
  const summary = p.message || 'Runtime error caught';
  const explain = p.explanation || 'AI proposed a fix.';

  notifications.show({
    title: 'Healer found a possible fix',
    body: `${summary}\n@ ${where}\n\n${explain}`,
    icon: '🩹',
    duration: 14000,
    actions: [
      { label: 'View fix',  onClick: () => openHealerLog(p.proposalId) },
      { label: 'Dismiss',   onClick: () => {} },
    ],
  });
}

function onHealerNoFix(p) {
  // Quiet by default; only show in debug mode.
  let debug = false;
  try { debug = localStorage.getItem('nova-healer-verbose') === 'true'; } catch {}
  if (!debug) return;
  notifications.show({
    title: 'Healer: no obvious fix',
    body: `${p?.message || '(unknown)'}\n\nFiled for later review.`,
    icon: '🩹',
    duration: 4000,
  });
}

async function openHealerLog(proposalId) {
  try {
    const pm = await import('../kernel/process-manager.js');
    pm.processManager.launch('healer-log', { proposalId });
  } catch {
    notifications.show({
      title: 'Couldn\'t open Healer Log',
      body: 'Try Spotlight → "Healer Log".',
      icon: '⚠️',
      duration: 4000,
    });
  }
}

function shortenPath(p) {
  if (!p) return '';
  try {
    const u = new URL(p, 'http://x');
    return u.pathname.replace(/^.*\/(js\/.*)$/, '$1');
  } catch { return p; }
}

export function _resetForTests() {
  initialized = false;
}
