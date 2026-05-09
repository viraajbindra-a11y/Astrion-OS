// Astrion OS — Text Learner
//
// Two adaptation features that learn from user keystrokes / undos:
//
//   #7  Repeated undo → preference rule
//      When the same capability is reverted (via branch.rewind or the
//      Adaptations panel's revert button) N+ times, propose a preference
//      rule that auto-rejects future calls to that capability OR shows
//      a stronger confirmation gate.
//
//   #8  Repeated correction → autocorrect
//      When the same text correction (delete X, type Y) happens N+
//      times, propose an autocorrect rule. Live corrections come from
//      a `text-edit:replace` event that note-style apps emit.
//
// Both go through the Adaptation Engine (PREFERENCE + AUTOCORRECT
// categories respectively).

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBudgetRemaining,
  CATEGORY,
} from './adaptation-engine.js';

const REVERT_THRESHOLD = 3;
const CORRECTION_THRESHOLD = 3;
const REVERT_KEY  = 'astrion-text-learner-reverts-v1';
const CORRECT_KEY = 'astrion-text-learner-corrections-v1';
const PROPOSED_KEY = 'astrion-text-learner-proposed-v1';
const AUTOCORRECT_RULES_KEY = 'astrion-autocorrect-rules-v1';
const PREFERENCE_RULES_KEY  = 'astrion-preference-rules-v1';

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return p ?? fallback;
  } catch { return fallback; }
}

function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function getProposedSet() { return new Set(loadJson(PROPOSED_KEY, [])); }
function setProposedSet(set) { saveJson(PROPOSED_KEY, [...set]); }

let initialized = false;

// ─── Repeated undo (preference) ───────────────────────────────────

function noteRevert(capId) {
  if (!capId) return;
  const counts = loadJson(REVERT_KEY, {});
  counts[capId] = (counts[capId] || 0) + 1;
  saveJson(REVERT_KEY, counts);
  if (counts[capId] >= REVERT_THRESHOLD) maybeProposePreference(capId, counts[capId]);
}

function maybeProposePreference(capId, count) {
  if (getBudgetRemaining(CATEGORY.PREFERENCE) <= 0) return;
  const key = 'pref-block:' + capId;
  const proposed = getProposedSet();
  if (proposed.has(key)) return;
  proposed.add(key);
  setProposedSet(proposed);
  eventBus.emit('text-learner:preference-proposal', {
    id: 'pref-' + capId,
    capId,
    count,
    summary: `Always confirm before "${capId}"`,
    trigger: `You\'ve undone "${capId}" ${count} times — that's a sign Astrion should ask harder before running it`,
  });
}

export async function acceptPreferenceProposal(proposal) {
  if (!proposal?.capId) return { ok: false, error: 'invalid proposal' };
  const rules = loadJson(PREFERENCE_RULES_KEY, {});
  rules[proposal.capId] = { mode: 'always-confirm', addedAt: Date.now() };
  saveJson(PREFERENCE_RULES_KEY, rules);
  return recordAdaptation({
    category: CATEGORY.PREFERENCE,
    summary: proposal.summary,
    trigger: proposal.trigger,
    revert: { kind: 'preference:remove', args: { capId: proposal.capId } },
  });
}

function revertPreference(args) {
  if (!args?.capId) return;
  const rules = loadJson(PREFERENCE_RULES_KEY, {});
  delete rules[args.capId];
  saveJson(PREFERENCE_RULES_KEY, rules);
}

export function isAlwaysConfirm(capId) {
  const rules = loadJson(PREFERENCE_RULES_KEY, {});
  return rules[capId]?.mode === 'always-confirm';
}

// ─── Autocorrect ──────────────────────────────────────────────────

function noteCorrection(from, to) {
  if (!from || !to || from === to) return;
  if (from.length > 80 || to.length > 80) return; // ignore big edits
  const key = from + '' + to;
  const counts = loadJson(CORRECT_KEY, {});
  counts[key] = (counts[key] || 0) + 1;
  saveJson(CORRECT_KEY, counts);
  if (counts[key] >= CORRECTION_THRESHOLD) maybeProposeAutocorrect(from, to, counts[key]);
}

function maybeProposeAutocorrect(from, to, count) {
  if (getBudgetRemaining(CATEGORY.AUTOCORRECT) <= 0) return;
  const key = 'autocorrect:' + from + '|' + to;
  const proposed = getProposedSet();
  if (proposed.has(key)) return;
  proposed.add(key);
  setProposedSet(proposed);
  eventBus.emit('text-learner:autocorrect-proposal', {
    id: 'ac-' + Date.now().toString(36),
    from,
    to,
    count,
    summary: `Auto-replace "${from}" with "${to}"`,
    trigger: `You\'ve made this exact correction ${count} times`,
  });
}

export async function acceptAutocorrectProposal(proposal) {
  if (!proposal?.from || !proposal?.to) return { ok: false, error: 'invalid proposal' };
  const rules = loadJson(AUTOCORRECT_RULES_KEY, []);
  rules.push({ from: proposal.from, to: proposal.to, addedAt: Date.now() });
  saveJson(AUTOCORRECT_RULES_KEY, rules);
  return recordAdaptation({
    category: CATEGORY.AUTOCORRECT,
    summary: proposal.summary,
    trigger: proposal.trigger,
    revert: { kind: 'autocorrect:remove', args: { from: proposal.from, to: proposal.to } },
  });
}

function revertAutocorrect(args) {
  if (!args?.from || !args?.to) return;
  let rules = loadJson(AUTOCORRECT_RULES_KEY, []);
  rules = rules.filter(r => !(r.from === args.from && r.to === args.to));
  saveJson(AUTOCORRECT_RULES_KEY, rules);
}

export function listAutocorrectRules() {
  return loadJson(AUTOCORRECT_RULES_KEY, []);
}

/** Apply autocorrect rules to a text snippet — used by note-style apps. */
export function applyAutocorrect(text) {
  let out = String(text || '');
  for (const r of loadJson(AUTOCORRECT_RULES_KEY, [])) {
    if (r.from && r.to) out = out.split(r.from).join(r.to);
  }
  return out;
}

// ─── Init ──────────────────────────────────────────────────────────

export function initTextLearner() {
  registerRevertHandler('preference:remove',  revertPreference);
  registerRevertHandler('autocorrect:remove', revertAutocorrect);
  if (initialized) return;
  initialized = true;
  // Branch rewinds = "undo this".
  eventBus.on('branch:reverted', ({ capabilityId }) => noteRevert(capabilityId));
  eventBus.on('adaptation:reverted', (entry) => {
    // If the user kept reverting a particular cap that came from skill
    // or generation flows, capture that signal too.
    if (entry?.revert?.kind === 'skill:remove') noteRevert('skill:' + (entry.revert.args?.name || ''));
  });
  // Live text corrections from note-style apps.
  eventBus.on('text-edit:replace', ({ from, to }) => noteCorrection(from, to));
}

// ─── Test helpers ─────────────────────────────────────────────────

export function _resetForTests() {
  initialized = false;
  for (const k of [REVERT_KEY, CORRECT_KEY, PROPOSED_KEY, AUTOCORRECT_RULES_KEY, PREFERENCE_RULES_KEY]) {
    try { localStorage.removeItem(k); } catch {}
  }
}

export const _internal = {
  REVERT_THRESHOLD,
  CORRECTION_THRESHOLD,
  noteRevert,
  noteCorrection,
};
