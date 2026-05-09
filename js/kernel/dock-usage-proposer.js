// Astrion OS — Dock Usage Proposer
//
// #16 Dock by usage. Watches app launch counts; when an unpinned app
// crosses PIN_THRESHOLD launches in the rolling window, proposes
// pinning it. When a pinned app has gone unused for IDLE_DAYS, proposes
// unpinning. Proposals go through the Adaptation Engine (UI category)
// so they're logged + revertable from the Adaptations panel.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBoldness,
  getBudgetRemaining,
  CATEGORY,
  BOLDNESS,
} from './adaptation-engine.js';
import { getAppLaunchCount, listLeastUsedApps } from './usage-tracker.js';

const PIN_THRESHOLD = 8;        // launches before we propose pinning
const IDLE_DAYS = 14;
const PROPOSED_KEY = 'astrion-dock-usage-proposed-v1';

let initialized = false;

function loadProposed() {
  try {
    const raw = localStorage.getItem(PROPOSED_KEY);
    return new Set(JSON.parse(raw || '[]'));
  } catch { return new Set(); }
}

function saveProposed(set) {
  try { localStorage.setItem(PROPOSED_KEY, JSON.stringify([...set])); } catch {}
}

function isPinned(appId) {
  try {
    const raw = localStorage.getItem('astrion-dock-pinned-v1');
    if (!raw) return false;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.some(p => p?.id === appId);
  } catch { return false; }
}

async function evaluatePin(appId) {
  if (!appId || isPinned(appId)) return;
  if (getBudgetRemaining(CATEGORY.UI) <= 0) return;
  const count = getAppLaunchCount(appId);
  if (count < PIN_THRESHOLD) return;
  const proposed = loadProposed();
  const key = 'pin:' + appId;
  if (proposed.has(key)) return;

  const boldness = getBoldness(CATEGORY.UI);
  if (boldness === BOLDNESS.HIGH) {
    eventBus.emit('dock:pin', { appId, source: 'auto-usage' });
    await logPinAdaptation(appId, count, /*silent*/ true);
    proposed.add(key);
    saveProposed(proposed);
  } else {
    eventBus.emit('dock-usage:proposal', { kind: 'pin', appId, count });
    proposed.add(key);
    saveProposed(proposed);
  }
}

async function logPinAdaptation(appId, count, silent) {
  return recordAdaptation({
    category: CATEGORY.UI,
    summary: `Pinned "${appId}" to the dock`,
    trigger: `You opened it ${count} times — auto-pinned at ${PIN_THRESHOLD}+`,
    silent: !!silent,
    revert: { kind: 'dock:unpin-auto', args: { appId } },
  });
}

async function logUnpinAdaptation(appId, silent) {
  return recordAdaptation({
    category: CATEGORY.UI,
    summary: `Unpinned "${appId}" from the dock`,
    trigger: `Pinned but unused for ${IDLE_DAYS}+ days`,
    silent: !!silent,
    revert: { kind: 'dock:repin-auto', args: { appId } },
  });
}

async function evaluateUnpin() {
  if (getBudgetRemaining(CATEGORY.UI) <= 0) return;
  const sinceMs = IDLE_DAYS * 24 * 60 * 60 * 1000;
  const idle = listLeastUsedApps({ sinceMs });
  // Only consider currently-pinned apps that are idle.
  for (const appId of idle) {
    if (!isPinned(appId)) continue;
    const proposed = loadProposed();
    const key = 'unpin:' + appId;
    if (proposed.has(key)) continue;
    const boldness = getBoldness(CATEGORY.UI);
    if (boldness === BOLDNESS.HIGH) {
      eventBus.emit('dock:unpin', { appId });
      await logUnpinAdaptation(appId, /*silent*/ true);
    } else {
      eventBus.emit('dock-usage:proposal', { kind: 'unpin', appId });
    }
    proposed.add(key);
    saveProposed(proposed);
  }
}

export async function acceptProposal(proposal) {
  if (!proposal || !proposal.appId) return { ok: false, error: 'invalid proposal' };
  if (proposal.kind === 'pin') {
    eventBus.emit('dock:pin', { appId: proposal.appId, source: 'auto-usage' });
    return logPinAdaptation(proposal.appId, proposal.count || 0, false);
  }
  if (proposal.kind === 'unpin') {
    eventBus.emit('dock:unpin', { appId: proposal.appId });
    return logUnpinAdaptation(proposal.appId, false);
  }
  return { ok: false, error: 'unknown proposal kind' };
}

function revertPin(args) {
  if (!args?.appId) return;
  eventBus.emit('dock:unpin', { appId: args.appId });
}

function revertUnpin(args) {
  if (!args?.appId) return;
  eventBus.emit('dock:pin', { appId: args.appId, source: 'reverted' });
}

export function initDockUsageProposer() {
  registerRevertHandler('dock:unpin-auto', revertPin);
  registerRevertHandler('dock:repin-auto', revertUnpin);
  if (initialized) return;
  initialized = true;
  eventBus.on('app:launched', ({ appId }) => { evaluatePin(appId).catch(() => {}); });
  // Daily-ish unpin sweep — fired on every app launch but bounded by
  // proposed-set; cheap and avoids needing a timer.
  eventBus.on('app:launched', () => { evaluateUnpin().catch(() => {}); });
}

export function _resetForTests() {
  initialized = false;
  try { localStorage.removeItem(PROPOSED_KEY); } catch {}
}

export const _internal = { PIN_THRESHOLD, IDLE_DAYS, evaluatePin, evaluateUnpin };
