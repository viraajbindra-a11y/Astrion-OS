// Astrion OS — Intent Miss Proposer
//
// Detects two app-generation triggers from Spotlight queries:
//
//   #3 — Spotlight miss → "want me to build that?"
//      When the same query has been rejected by the intent parser
//      twice within the last 7 days, propose generating an app for it.
//      Threshold = 2 because the second time someone types the same
//      thing they're definitely looking for it.
//
//   #4 — "I wish I had…" intent
//      Phrases like "I wish I had", "I want a", "I need a", "build me",
//      "make me a" trigger an immediate generation proposal regardless
//      of intent-parser confidence. This is the explicit user-initiated
//      app-generation path.
//
// On accept, this module fires `intent-miss:generate` carrying the
// description; the spec/test/code generators (M1+) pick it up and run
// the candidate-app pipeline. The actual generation lives in
// capability-providers (spec.generate / tests.generate / code.generate)
// — this module just decides WHEN to ask.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBoldness,
  getBudgetRemaining,
  CATEGORY,
  BOLDNESS,
} from './adaptation-engine.js';

const MISS_KEY = 'astrion-intent-miss-history-v1';
const PROPOSED_KEY = 'astrion-intent-miss-proposed-v1';
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REPEAT_THRESHOLD = 2;

// Phrases that go straight to the generation proposal.
const WISH_PATTERNS = [
  /^i wish i had\s+/i,
  /^i want (a|an|to)\s+/i,
  /^i need (a|an|to)\s+/i,
  /^build me (a|an)\s+/i,
  /^make me (a|an)\s+/i,
  /^can you build/i,
];

let initialized = false;

function loadMisses() {
  try {
    const raw = localStorage.getItem(MISS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveMisses(list) {
  try { localStorage.setItem(MISS_KEY, JSON.stringify(list)); } catch {}
}

function loadProposed() {
  try {
    const raw = localStorage.getItem(PROPOSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}

function saveProposed(set) {
  try { localStorage.setItem(PROPOSED_KEY, JSON.stringify([...set])); } catch {}
}

function isWishPhrase(query) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();
  for (const re of WISH_PATTERNS) {
    if (re.test(trimmed)) {
      // Strip the matched prefix to get the description.
      const desc = trimmed.replace(re, '').trim();
      if (desc.length >= 3) return desc;
    }
  }
  return null;
}

function normalize(query) {
  return String(query || '').trim().toLowerCase();
}

function recordMiss(query) {
  const norm = normalize(query);
  if (!norm || norm.length < 3) return null;
  const now = Date.now();
  let list = loadMisses();
  // Drop entries outside the rolling window.
  list = list.filter(e => now - e.ts < HISTORY_WINDOW_MS);
  list.push({ q: norm, ts: now });
  saveMisses(list);
  // Count how often this query has been rejected within the window.
  const count = list.filter(e => e.q === norm).length;
  return { norm, count };
}

function shouldProposeRepeat(query) {
  const r = recordMiss(query);
  if (!r) return null;
  if (r.count < REPEAT_THRESHOLD) return null;
  const proposed = loadProposed();
  if (proposed.has(r.norm)) return null;
  return r.norm;
}

function buildProposal(description, source) {
  return {
    id: 'gen-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    description,
    source, // 'wish' | 'repeat'
    summary: source === 'wish'
      ? `Generate an app for: "${description}"`
      : `You've asked for "${description}" before. Try generating an app for it?`,
    trigger: source === 'wish'
      ? 'You said "I wish/want/need…" in Spotlight'
      : `Spotlight didn\'t match this query — repeated ${REPEAT_THRESHOLD}+ times in the last 7 days`,
  };
}

function emitProposal(proposal) {
  eventBus.emit('intent-miss:proposal', proposal);
  // Mark as proposed so we don't badger.
  if (proposal.source === 'repeat') {
    const proposed = loadProposed();
    proposed.add(normalize(proposal.description));
    saveProposed(proposed);
  }
}

/**
 * Public entry point — call this from Spotlight before falling back
 * to free-text AI on a miss. Returns an action token Spotlight can
 * use to render a "Want me to build that?" hint inline:
 *   - { kind: 'wish', description } if it's a wish-phrase
 *   - { kind: 'repeat', description } if it's a repeat-miss
 *   - null if nothing to propose
 */
export function inspectQuery(query) {
  if (!initialized) return null;
  if (getBudgetRemaining(CATEGORY.PREFERENCE) <= 0) return null;
  const wishDesc = isWishPhrase(query);
  if (wishDesc) {
    const proposal = buildProposal(wishDesc, 'wish');
    emitProposal(proposal);
    return { kind: 'wish', description: wishDesc, proposal };
  }
  const repeatDesc = shouldProposeRepeat(query);
  if (repeatDesc) {
    const proposal = buildProposal(repeatDesc, 'repeat');
    emitProposal(proposal);
    return { kind: 'repeat', description: repeatDesc, proposal };
  }
  return null;
}

/**
 * Accept a proposal. Records the adaptation + emits intent-miss:generate
 * which the generation pipeline (M1.P2 spec-generator) can subscribe to.
 */
export async function accept(proposal) {
  if (!proposal?.description) return { ok: false, error: 'no description' };
  const recorded = recordAdaptation({
    category: CATEGORY.PREFERENCE,
    summary: `Asked Astrion to generate an app for: "${proposal.description}"`,
    trigger: proposal.trigger,
    revert: { kind: 'intent-miss:cancel-generation', args: { description: proposal.description } },
  });
  if (!recorded.ok) return { ok: false, error: recorded.reason };
  eventBus.emit('intent-miss:generate', { description: proposal.description, source: proposal.source });
  return { ok: true, adaptationId: recorded.entry.id };
}

export function reject(proposal) {
  eventBus.emit('intent-miss:rejected', { id: proposal?.id });
}

async function revertHandler(args) {
  // Generation is fire-and-forget for v1; reverting just signals the
  // pipeline to drop any unfinished candidate. The generated-app graph
  // node (if any reached 'docked' status) can be archived separately.
  eventBus.emit('intent-miss:revert', { description: args?.description });
}

export function initIntentMissProposer() {
  registerRevertHandler('intent-miss:cancel-generation', revertHandler);
  if (initialized) return;
  initialized = true;
  // Listen for explicit intent-rejected events too — keeps a passive
  // history even when Spotlight doesn't call inspectQuery directly.
  eventBus.on('intent:rejected', ({ intent }) => {
    const q = intent?.rawQuery || intent?.summary;
    if (q) recordMiss(q);
  });
}

// ─── Test helpers ──────────────────────────────────────────────────

export function _resetForTests() {
  initialized = false;
  try { localStorage.removeItem(MISS_KEY); } catch {}
  try { localStorage.removeItem(PROPOSED_KEY); } catch {}
}

export const _internal = {
  WISH_PATTERNS,
  REPEAT_THRESHOLD,
  HISTORY_WINDOW_MS,
  isWishPhrase,
  recordMiss,
  buildProposal,
};
