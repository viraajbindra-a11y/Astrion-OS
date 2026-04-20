// Astrion OS — Chaos Injector (M6.P4.b)
//
// The rubber-stamp tracker (M6.P4) tells the user when their confirm
// rate is suspiciously fast. The chaos injector proves it: every so
// often, after a real L2+ interception resolves, fire a SYNTHETIC
// interception:preview for a clearly-destructive action that never
// actually executes. The user has to read it. If they confirm in
// under 1.5 seconds, they failed the test — get a notification +
// the system records the rubber-stamp.
//
// Why a synthetic event (not interceptedExecute):
//   - We DON'T want any chance of the destructive cap actually
//     running. By emitting the preview directly, we never go through
//     interceptedExecute → cap.execute(). The Spotlight subscriber
//     renders the preview; the user reacts; we listen for the
//     confirm/abort and immediately emit a "this was a test"
//     notification. No real cap is invoked.
//
// Cooldown:
//   - 24h after either outcome (confirmed OR aborted). Chaos is rare
//     by design — once-a-day max so users don't develop chaos-
//     immunity through pattern recognition.
//
// Trigger:
//   - 5% probability after EVERY real interception:confirm or
//     interception:abort. Combined with the 24h cooldown the actual
//     fire rate is at most 1/day.
//   - 30s delay after the triggering preview resolves so the chaos
//     doesn't sandwich the real one.
//
// Honesty:
//   - Once the user confirms or aborts, an immediate notification
//     reveals it was a chaos test. No "we secretly tracked you"
//     vibe — the user knows within 1 second of their decision.

import { eventBus } from './event-bus.js';

const COOLDOWN_KEY = 'astrion-chaos-cooldown-until';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const TRIGGER_PROBABILITY = 0.05; // 5% after each real interception
const POST_DELAY_MS = 30000; // 30s after the real one resolves
const RAPID_THRESHOLD_MS = 1500;

const previewStarts = new Map(); // chaos id → epoch ms

function inCooldown() {
  try {
    const until = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
    return Date.now() < until;
  } catch { return false; }
}

function setCooldown(ms = COOLDOWN_MS) {
  try { localStorage.setItem(COOLDOWN_KEY, String(Date.now() + ms)); } catch {}
}

export function getChaosState() {
  try {
    const until = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
    return {
      inCooldown: Date.now() < until,
      cooldownUntil: until,
      msUntilNext: Math.max(0, until - Date.now()),
    };
  } catch { return { inCooldown: false, cooldownUntil: 0, msUntilNext: 0 }; }
}

export function clearChaosCooldown() {
  try { localStorage.removeItem(COOLDOWN_KEY); } catch {}
}

// Hand-picked plausible-but-clearly-destructive plans. The user should
// read and recognize "this isn't what I asked for." All have id prefixed
// with 'chaos:' so any code that accidentally looks them up via the
// real cap registry returns nothing.
const CHAOS_PRESETS = [
  {
    cap: {
      id: 'chaos:files.delete',
      summary: 'Delete /Documents/Tax Records 2025/',
      level: 2, reversibility: 'NONE', blastRadius: 'DIRECTORY',
      pointOfNoReturn: false,
    },
    args: { path: '/Documents/Tax Records 2025/' },
  },
  {
    cap: {
      id: 'chaos:files.delete',
      summary: 'Delete entire Pictures folder',
      level: 2, reversibility: 'NONE', blastRadius: 'DIRECTORY',
      pointOfNoReturn: false,
    },
    args: { path: '/Pictures/' },
  },
  {
    cap: {
      id: 'chaos:settings.reset',
      summary: 'Reset every Astrion setting to defaults',
      level: 2, reversibility: 'BOUNDED', blastRadius: 'GLOBAL',
      pointOfNoReturn: false,
    },
    args: { scope: 'all' },
  },
  {
    cap: {
      id: 'chaos:vault.purge',
      summary: 'Delete all vault entries (passwords, notes, secrets)',
      level: 2, reversibility: 'NONE', blastRadius: 'GLOBAL',
      pointOfNoReturn: false,
    },
    args: { confirm: true },
  },
];

function pickChaos() {
  const i = Math.floor(Math.random() * CHAOS_PRESETS.length);
  return CHAOS_PRESETS[i];
}

function newChaosId() {
  return 'chaos-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Fire a chaos preview right now. Bypasses cooldown / probability
 * gates — for tests + a manual Spotlight "chaos test" command.
 * Returns the chaos preview id.
 */
export function fireChaosNow() {
  const id = newChaosId();
  const preset = pickChaos();
  previewStarts.set(id, Date.now());
  eventBus.emit('interception:preview', {
    id,
    cap: preset.cap,
    args: preset.args,
    timeoutMs: 60000,
    requiresTypedConfirmation: false,
  });
  return id;
}

function maybeFireChaos() {
  if (inCooldown()) return;
  if (Math.random() >= TRIGGER_PROBABILITY) return;
  // Defer so the chaos doesn't sandwich the just-resolved real one.
  setTimeout(() => {
    if (inCooldown()) return; // re-check at fire time
    fireChaosNow();
  }, POST_DELAY_MS);
}

function handleChaosResolution(id, kind, reason) {
  const start = previewStarts.get(id);
  previewStarts.delete(id);
  if (!start) return; // not a chaos id
  const elapsed = Date.now() - start;
  setCooldown();
  if (kind === 'confirm') {
    const rapid = elapsed < RAPID_THRESHOLD_MS;
    if (rapid) {
      eventBus.emit('chaos:stamped', { elapsedMs: elapsed, id });
      eventBus.emit('notification:show', {
        title: '🧪 Chaos test — you confirmed in ' + (elapsed / 1000).toFixed(1) + 's',
        message: 'That preview was a fake. Nothing was deleted. The L2 gate only works if you read previews carefully.',
        icon: '🧪',
        duration: 14000,
      });
    } else {
      eventBus.emit('chaos:stamped-but-considered', { elapsedMs: elapsed, id });
      eventBus.emit('notification:show', {
        title: '🧪 Chaos test',
        message: 'You confirmed a fake destructive plan. Nothing was deleted, but consider whether you really wanted to delete that.',
        icon: '🧪',
        duration: 10000,
      });
    }
  } else if (kind === 'abort') {
    eventBus.emit('chaos:caught', { elapsedMs: elapsed, id, reason });
    eventBus.emit('notification:show', {
      title: '✓ Chaos test — good catch',
      message: 'That preview was a fake destructive plan. Aborting was the right call. (Tests are throttled to 1/day.)',
      icon: '✓',
      duration: 8000,
    });
  }
}

/**
 * Wire chaos injection. Listens for real interception outcomes and
 * occasionally schedules a chaos preview ~30s later. Also catches
 * the chaos's own confirm/abort events to score the user.
 */
export function initChaosInjector() {
  eventBus.on('interception:confirm', ({ id }) => {
    if (typeof id === 'string' && id.startsWith('chaos-')) {
      handleChaosResolution(id, 'confirm');
      return;
    }
    maybeFireChaos();
  });
  eventBus.on('interception:abort', ({ id, reason }) => {
    if (typeof id === 'string' && id.startsWith('chaos-')) {
      handleChaosResolution(id, 'abort', reason);
      return;
    }
    maybeFireChaos();
  });
  console.log('[chaos-injector] wired (5% trigger after each real L2+ resolution; 24h cooldown)');
}

// ─── Sanity tests ───

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  let f = 0;
  // Cooldown helpers
  clearChaosCooldown();
  if (inCooldown()) { console.warn('[chaos] cooldown should be empty after clear'); f++; }
  setCooldown(5000);
  if (!inCooldown()) { console.warn('[chaos] cooldown should be active after set'); f++; }
  clearChaosCooldown();

  // CHAOS_PRESETS sanity
  if (CHAOS_PRESETS.length < 2) { console.warn('[chaos] need >= 2 presets'); f++; }
  for (const p of CHAOS_PRESETS) {
    if (!p.cap?.id?.startsWith('chaos:')) { console.warn('[chaos] preset missing chaos: prefix:', p.cap?.id); f++; }
    if (p.cap.level < 2) { console.warn('[chaos] preset must be L2+:', p.cap?.id); f++; }
  }

  if (f === 0) console.log('[chaos] all sanity tests pass (' + CHAOS_PRESETS.length + ' presets)');
  else console.warn('[chaos]', f, 'sanity tests failed');
}
