// Astrion OS — Time-of-Day Routine Detector
//
// #9 Time-of-day routine. Companion to sequence-observer that
// looks for sequences anchored to a specific hour-of-day. If the
// same N-step sequence happens at the same hour on 3+ different days
// in the rolling window, propose binding it as a routine.
//
// Different from skill-from-sequence (which looks for 3+ repeats
// regardless of time): this looks for a habit. Morning email-check.
// 5pm wind-down. The hour anchor is part of the trigger.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBoldness,
  getBudgetRemaining,
  CATEGORY,
  BOLDNESS,
} from './adaptation-engine.js';

const STORAGE_KEY = 'astrion-time-routine-detector-v1';
const MAX_EVENTS = 200;
const SEQUENCE_LEN = 2;
const REPEAT_THRESHOLD = 3;
const HOUR_TOLERANCE = 1; // ±1 hour counts as "same time"

let recentEvents = [];
let proposed = new Set();
let initialized = false;

const pendingByIntent = new WeakMap();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (Array.isArray(p.events)) recentEvents = p.events.slice(-MAX_EVENTS);
    if (Array.isArray(p.proposed)) proposed = new Set(p.proposed);
  } catch {}
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ events: recentEvents, proposed: [...proposed] })); }
  catch {}
}

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function onEvent(capId, ts) {
  const t = ts || Date.now();
  recentEvents.push({ capId, ts: t, hour: new Date(t).getHours(), day: dayKey(t) });
  if (recentEvents.length > MAX_EVENTS) recentEvents = recentEvents.slice(-MAX_EVENTS);
  detect();
  save();
}

function detect() {
  if (recentEvents.length < SEQUENCE_LEN) return;
  // Find SEQUENCE_LEN-tuples that share an hour bucket on 3+ distinct days.
  const buckets = new Map(); // key = `${hour}|${capA}→${capB}`, value = Set<dayKey>
  for (let i = SEQUENCE_LEN - 1; i < recentEvents.length; i++) {
    const a = recentEvents[i - 1];
    const b = recentEvents[i];
    if (a.day !== b.day) continue;
    if (Math.abs(a.hour - b.hour) > HOUR_TOLERANCE) continue;
    const key = `${a.hour}|${a.capId}→${b.capId}`;
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key).add(a.day);
  }
  for (const [key, days] of buckets) {
    if (days.size < REPEAT_THRESHOLD) continue;
    if (proposed.has(key)) continue;
    proposed.add(key);
    const [hour, seq] = key.split('|');
    const sequence = seq.split('→');
    const proposal = {
      id: 'time-routine-' + key.replace(/[^a-z0-9]+/gi, '-').slice(0, 60),
      sequence,
      hour: Number(hour),
      days: days.size,
      summary: `Run "${sequence.join(' → ')}" routine around ${hour}:00`,
      trigger: `You ran this on ${days.size} different days, all around ${hour}:00`,
    };
    const boldness = getBoldness(CATEGORY.ROUTINE);
    if (boldness === BOLDNESS.HIGH) {
      acceptProposal(proposal).catch(() => {});
    } else {
      eventBus.emit('time-routine:proposal', proposal);
    }
  }
}

export async function acceptProposal(proposal) {
  if (!proposal?.id) return { ok: false, error: 'invalid proposal' };
  if (getBudgetRemaining(CATEGORY.ROUTINE) <= 0) return { ok: false, error: 'routine budget exhausted' };
  return recordAdaptation({
    category: CATEGORY.ROUTINE,
    summary: proposal.summary,
    trigger: proposal.trigger,
    revert: { kind: 'time-routine:remove', args: { id: proposal.id } },
  });
}

function revert(args) {
  if (args?.id) proposed.delete(args.id);
  save();
}

export function initTimeRoutineDetector() {
  registerRevertHandler('time-routine:remove', revert);
  if (initialized) return;
  initialized = true;
  load();
  eventBus.on('intent:started',   ({ intent, cap }) => { if (intent && cap?.id) pendingByIntent.set(intent, cap.id); });
  eventBus.on('intent:completed', ({ intent, success }) => {
    const cap = pendingByIntent.get(intent);
    pendingByIntent.delete(intent);
    if (success && cap) onEvent(cap);
  });
}

export function _resetForTests() {
  initialized = false;
  recentEvents = [];
  proposed = new Set();
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function _recordEvent(capId, ts) { load(); onEvent(capId, ts); }

export const _internal = { SEQUENCE_LEN, REPEAT_THRESHOLD, HOUR_TOLERANCE };
