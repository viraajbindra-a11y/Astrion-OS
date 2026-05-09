// Astrion OS — Sequence Observer
//
// First half of the "Astrion learned something" loop. Watches the
// stream of completed intents (`intent:completed` with success=true)
// and detects when the same N-step sequence has happened ≥
// REPEAT_THRESHOLD times in the recent window. Emits
// `sequence:repeated` once per detection. Skill-proposer.js picks
// that up and asks the user "save as skill?".
//
// What this is NOT
// ────────────────
// Not a planner. Not an arbiter. Not a sender of messages anywhere.
// All actual policy (budget, boldness, asking the user) lives in
// skill-proposer.js + adaptation-engine.js. This module is just the
// pattern matcher.
//
// What "sequence" means
// ─────────────────────
// SEQUENCE_LEN consecutive cap.id values where each event is within
// MAX_GAP_MS of the previous one. A sequence with a > MAX_GAP_MS
// gap inside it doesn't count — those are two separate things the
// user did, not a single workflow. This is the right shape because
// "I got distracted for 20 min then did something different" should
// not bind to the same skill.
//
// Why intent:completed (not app:launched, not Spotlight history)
// ──────────────────────────────────────────────────────────────
// Capability dispatches are the action surface — file ops, AI calls,
// system actions, app launches via `app.open` all flow through
// intent-executor and emit intent:completed. App launches via the
// dock or alt-tab don't (they bypass the intent kernel) and that's
// fine for v1: the kernel-routed actions are the ones a "skill"
// can actually replay.

import { eventBus } from './event-bus.js';

const STORAGE_KEY = 'astrion-sequence-observer-v1';
const MAX_EVENTS = 100;
const SEQUENCE_LEN = 3;
const REPEAT_THRESHOLD = 3;
const MAX_GAP_MS = 5 * 60 * 1000;

let recentEvents = [];          // [{ capId, ts }, …]
let proposedSequences = new Set();   // serialized 'a→b→c' we've already emitted for
let initialized = false;

// Map intent objects (set in intent:started) → capId so we can pair
// the completion event with its capability without having to resolve
// it twice. WeakMap auto-clears once the intent goes out of scope.
const pendingByIntent = new WeakMap();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.recentEvents)) recentEvents = parsed.recentEvents.slice(-MAX_EVENTS);
    if (Array.isArray(parsed.proposed)) proposedSequences = new Set(parsed.proposed);
  } catch {}
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      recentEvents,
      proposed: [...proposedSequences],
    }));
  } catch {}
}

function onEvent(capId) {
  const ts = Date.now();
  recentEvents.push({ capId, ts });
  if (recentEvents.length > MAX_EVENTS) recentEvents = recentEvents.slice(-MAX_EVENTS);
  save();
  detectRepeats();
}

function detectRepeats() {
  if (recentEvents.length < SEQUENCE_LEN) return;
  // Count every SEQUENCE_LEN-tuple ending at index i where all gaps
  // inside the tuple are within MAX_GAP_MS.
  const counts = new Map();
  for (let i = SEQUENCE_LEN - 1; i < recentEvents.length; i++) {
    const seq = [];
    let valid = true;
    for (let j = 0; j < SEQUENCE_LEN; j++) {
      const ev = recentEvents[i - SEQUENCE_LEN + 1 + j];
      if (j > 0) {
        const prev = recentEvents[i - SEQUENCE_LEN + j];
        if (ev.ts - prev.ts > MAX_GAP_MS) { valid = false; break; }
      }
      seq.push(ev.capId);
    }
    if (!valid) continue;
    const key = seq.join('→');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count >= REPEAT_THRESHOLD && !proposedSequences.has(key)) {
      proposedSequences.add(key);
      save();
      const sequence = key.split('→');
      eventBus.emit('sequence:repeated', { sequence, count });
    }
  }
}

export function initSequenceObserver() {
  if (initialized) return;
  initialized = true;
  load();
  eventBus.on('intent:started', ({ intent, cap }) => {
    if (intent && cap?.id) pendingByIntent.set(intent, cap.id);
  });
  eventBus.on('intent:completed', ({ intent, success }) => {
    const capId = pendingByIntent.get(intent);
    pendingByIntent.delete(intent);
    if (!success || !capId) return;
    onEvent(capId);
  });
}

// ─── Read-only diagnostics + extension hooks ───────────────────────

export function listRepeatedSequences() {
  return [...proposedSequences].map(key => ({ sequence: key.split('→') }));
}

export function getRecentEventsCount() {
  return recentEvents.length;
}

// ─── Test helpers (not part of the OS surface) ─────────────────────

/** Reset all state — used by v03 only. */
export function _resetForTests() {
  recentEvents = [];
  proposedSequences = new Set();
  initialized = false;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Inject events directly without going through the event bus. Used by
 * v03 to drive deterministic detection without simulating a full
 * intent flow. Real callers should use the event-bus path.
 */
export function _recordEvent(capId, ts) {
  recentEvents.push({ capId, ts: ts ?? Date.now() });
  if (recentEvents.length > MAX_EVENTS) recentEvents = recentEvents.slice(-MAX_EVENTS);
  detectRepeats();
}

export const _internal = {
  SEQUENCE_LEN,
  REPEAT_THRESHOLD,
  MAX_GAP_MS,
  MAX_EVENTS,
};
