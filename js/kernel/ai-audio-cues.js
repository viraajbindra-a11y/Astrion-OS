// Astrion OS — AI audio cues
//
// Tiny event subscribers that play a short sound on key AI moments.
// Makes the OS feel "alive" — you HEAR the AI thinking + finishing
// + asking for approval, not just see it.
//
// Each cue uses the existing kernel/sound.js SoundSystem so the user's
// global sound preference (sounds.isEnabled) is honored. Per-cue
// opt-out via localStorage flag `astrion-ai-audio-mute=1` so demo
// presenters can kill them entirely without disabling all sounds.

import { eventBus } from './event-bus.js';
import { sounds } from './sound.js';

let initialized = false;
let lastFireMs = {};

function isMuted() {
  try { return localStorage.getItem('astrion-ai-audio-mute') === '1'; }
  catch { return false; }
}

/* Some events fire in storms (every plan:step:start). Throttle each
 * cue type to fire at most once per N ms. */
function throttle(key, ms) {
  const now = Date.now();
  if (lastFireMs[key] && now - lastFireMs[key] < ms) return false;
  lastFireMs[key] = now;
  return true;
}

function play(method, throttleKey, throttleMs) {
  if (isMuted()) return;
  if (throttleKey && !throttle(throttleKey, throttleMs)) return;
  try { sounds[method]?.(); } catch {}
}

export function initAIAudioCues() {
  if (initialized) return;
  initialized = true;

  /* AI starts thinking — subtle tap. Throttle so a burst of nested
   * planner calls doesn't spam. */
  eventBus.on('ai:thinking', () => play('tap', 'thinking', 800));

  /* AI returns a response — soft notification. Same throttle. */
  eventBus.on('ai:response', () => play('notification', 'response', 800));

  /* L2+ gate appears — warning. This NEEDS user attention. */
  eventBus.on('interception:preview', () => play('warning', 'gate', 500));

  /* Plan completed cleanly — success. */
  eventBus.on('plan:completed', () => play('success', 'completed', 1500));

  /* Plan failed — error. */
  eventBus.on('plan:failed', () => play('error', 'failed', 1500));

  /* Self-upgrade applied to disk — success (the big one). */
  eventBus.on('self-upgrade:applied', () => play('success', 'selfmod', 2000));

  /* Self-upgrade rollback — notification (matter-of-fact, not warning). */
  eventBus.on('self-upgrade:rolled-back', () => play('notification', 'rollback', 2000));

  /* Self-mod proposal approved (5 gates passed) — success. */
  eventBus.on('selfmod:approved', () => play('success', 'approved', 2000));

  console.log('[ai-audio-cues] ready (mute via localStorage astrion-ai-audio-mute=1)');
}
