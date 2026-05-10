// Astrion OS — Macro Recorder
//
// "I want to save what I just did." Explicit-mode companion to
// sequence-observer's "I noticed you do this 3+ times" implicit-mode
// detection. The user starts recording, runs the OS as normal, stops
// recording, and the captured intent sequence becomes a registered
// skill they can replay by phrase.
//
// Why it matters:
//   - Bypasses code.generate entirely. No AI needed to write code,
//     no tests to pass, no parsing failures. Recording is just
//     pushing intent:completed payloads onto a list.
//   - Closes the failure mode where the user wants to automate
//     something but the codegen pipeline fails on small models.
//   - Pairs with sequence-observer: observer catches patterns the
//     user didn't realize they had; recorder captures patterns the
//     user explicitly wants.
//
// Flow:
//   1. User: `/record start` (or "record macro" in Spotlight)
//      → recorder enters CAPTURING state, indicator badge appears
//   2. User does N things in the OS — each successful intent gets
//      captured as { capId, args, ts }
//   3. User: `/record stop "name" "phrase"` (or just `/record stop`
//      with a follow-up prompt)
//      → recorder builds a .skill source, registers it via
//        skill-registry.installUserSkill, records adaptation
//   4. Later: user types the phrase in Spotlight → skill fires →
//      planner replays the captured sequence
//
// What this does NOT do (deliberately):
//   - Capture mouse/keyboard at the OS level. Macros are at the
//     intent layer, which is what's replayable. Pixel-level
//     recording is a different feature with different safety
//     trade-offs (it'd need raw input events).

import { eventBus } from './event-bus.js';
import { recordAdaptation, registerRevertHandler, CATEGORY } from './adaptation-engine.js';

const MAX_CAPTURE = 50;        // hard cap so a runaway recording doesn't eat memory
const STORAGE_KEY = 'astrion-macros-v1';

const STATE = {
  IDLE: 'idle',
  CAPTURING: 'capturing',
};

let state = STATE.IDLE;
let buffer = [];               // [{ capId, args, ts }, …]
let initialized = false;

// Pair intent:started's cap.id to the intent object; on intent:completed
// (success only), pull cap.id back out. Same pattern as sequence-observer.
const pendingByIntent = new WeakMap();

function loadMacros() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveMacros(list) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {} }

// ─── Public API ────────────────────────────────────────────────────

export function startRecording() {
  if (state === STATE.CAPTURING) return { ok: false, reason: 'already recording' };
  state = STATE.CAPTURING;
  buffer = [];
  eventBus.emit('macro:state-changed', { state, captured: 0 });
  return { ok: true };
}

/**
 * Stop recording. Returns { ok, captured, sequence } so the caller
 * can decide what to do (save, discard, prompt user for name).
 */
export function stopRecording() {
  if (state !== STATE.CAPTURING) return { ok: false, reason: 'not recording' };
  const captured = buffer.slice();
  state = STATE.IDLE;
  buffer = [];
  eventBus.emit('macro:state-changed', { state, captured: captured.length });
  return { ok: true, captured: captured.length, sequence: captured };
}

export function getState() { return { state, captured: buffer.length }; }

/**
 * Save a recorded sequence as a skill the user can re-trigger by
 * phrase. Goes through skill-registry.installUserSkill so the macro
 * is a first-class skill — same revert path as auto-bound skills.
 *
 * @param {object} opts
 * @param {Array<{capId,args}>} opts.sequence
 * @param {string} opts.name     human-friendly name (becomes goal slug)
 * @param {string} opts.phrase   trigger phrase the user types
 */
export async function saveAsSkill(opts) {
  const { sequence, name, phrase } = opts || {};
  if (!Array.isArray(sequence) || sequence.length === 0) {
    return { ok: false, error: 'empty sequence' };
  }
  if (!name || !phrase) return { ok: false, error: 'name + phrase required' };

  // Build a .skill source. The `do` field is a natural-language
  // description of the captured sequence — the planner re-derives
  // the actual cap dispatches at run time. (Same trade-off as
  // skill-proposer auto-bound skills: arg-fidelity is best-effort.)
  const stepsDesc = sequence.map((s, i) => `${i + 1}. ${s.capId}`).join('\\n');
  const source = `goal: ${name}
trigger:
  - phrase: "${phrase.replace(/"/g, '\\\\"')}"
do: |
  Replay the recorded macro: ${name}.
  Steps:
${stepsDesc.split('\\n').map(l => '  ' + l).join('\\n')}
`;

  let skillReg;
  try { skillReg = await import('./skill-registry.js'); }
  catch (err) { return { ok: false, error: 'skill-registry unavailable: ' + err?.message }; }

  const installed = await skillReg.installUserSkill(source);
  if (!installed?.ok) return { ok: false, error: installed?.error || 'install failed' };

  // Persist the macro definition itself (the actual sequence) for
  // anyone wanting to inspect or re-export it. The skill registry
  // only knows the goal/phrase/`do` text.
  const macros = loadMacros();
  macros.push({
    id: 'macro-' + Date.now().toString(36),
    skillName: installed.name,
    name,
    phrase,
    sequence,
    capturedAt: Date.now(),
  });
  saveMacros(macros);

  // Adaptation log so the macro is revertable from the Adaptations
  // panel just like an auto-bound skill.
  recordAdaptation({
    category: CATEGORY.SKILL,
    summary: `Recorded macro "${name}" → ${sequence.length} step${sequence.length === 1 ? '' : 's'}`,
    trigger: 'You said /record stop',
    revert: { kind: 'macro:remove', args: { skillName: installed.name } },
  });

  eventBus.emit('macro:saved', { name, phrase, skillName: installed.name, steps: sequence.length });
  return { ok: true, skillName: installed.name };
}

export function listMacros() { return loadMacros(); }

async function revertMacro(args) {
  if (!args?.skillName) return;
  const skillReg = await import('./skill-registry.js');
  await skillReg.uninstallUserSkill(args.skillName);
  // Drop the macro entry too so /macros doesn't show a ghost.
  const remaining = loadMacros().filter(m => m.skillName !== args.skillName);
  saveMacros(remaining);
}

// ─── Init ──────────────────────────────────────────────────────────

export function initMacroRecorder() {
  registerRevertHandler('macro:remove', revertMacro);
  if (initialized) return;
  initialized = true;
  eventBus.on('intent:started', ({ intent, cap }) => {
    if (intent && cap?.id) pendingByIntent.set(intent, { capId: cap.id, args: cap?.args });
  });
  eventBus.on('intent:completed', ({ intent, success }) => {
    const pending = pendingByIntent.get(intent);
    pendingByIntent.delete(intent);
    if (!success || !pending || state !== STATE.CAPTURING) return;
    if (buffer.length >= MAX_CAPTURE) return; // hard cap
    buffer.push({ capId: pending.capId, args: pending.args || intent?.args || {}, ts: Date.now() });
    eventBus.emit('macro:state-changed', { state, captured: buffer.length });
  });
}

export function _resetForTests() {
  state = STATE.IDLE;
  buffer = [];
  initialized = false;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export const _internal = { MAX_CAPTURE, STATE };
