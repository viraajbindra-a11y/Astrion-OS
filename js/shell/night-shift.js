// NOVA OS — Night Shift
// Applies a warm color tint to the screen on a schedule or manually.
// Implemented via a full-screen overlay with mix-blend-mode.

const ENABLED_KEY = 'nova-night-shift-enabled';
const AUTO_KEY    = 'nova-night-shift-auto';
const WARMTH_KEY  = 'nova-night-shift-warmth';
const START_KEY   = 'nova-night-shift-start';
const END_KEY     = 'nova-night-shift-end';

let overlay = null;

export function initNightShift() {
  if (!document.getElementById('night-shift-overlay')) {
    overlay = document.createElement('div');
    overlay.id = 'night-shift-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: rgba(255, 140, 0, 0);
      mix-blend-mode: multiply;
      z-index: 99998;
      transition: background 1s ease;
    `;
    document.body.appendChild(overlay);
  } else {
    overlay = document.getElementById('night-shift-overlay');
  }

  applyCurrentState();

  // Re-check every minute for auto mode
  setInterval(applyCurrentState, 60000);
}

export function setNightShiftEnabled(enabled) {
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  applyCurrentState();
}

export function setNightShiftAuto(auto) {
  localStorage.setItem(AUTO_KEY, auto ? 'true' : 'false');
  applyCurrentState();
}

export function setNightShiftWarmth(warmth) {
  // warmth: 0-100
  localStorage.setItem(WARMTH_KEY, String(warmth));
  applyCurrentState();
}

export function setNightShiftSchedule(startHour, endHour) {
  localStorage.setItem(START_KEY, String(startHour));
  localStorage.setItem(END_KEY,   String(endHour));
  applyCurrentState();
}

export function getNightShiftState() {
  return {
    enabled: localStorage.getItem(ENABLED_KEY) === 'true',
    auto:    localStorage.getItem(AUTO_KEY) === 'true',
    warmth:  parseInt(localStorage.getItem(WARMTH_KEY) || '50'),
    startHour: parseInt(localStorage.getItem(START_KEY) || '20'),
    endHour:   parseInt(localStorage.getItem(END_KEY)   || '7'),
    currentlyActive: isCurrentlyActive(),
  };
}

function isCurrentlyActive() {
  if (localStorage.getItem(ENABLED_KEY) !== 'true') return false;

  const auto = localStorage.getItem(AUTO_KEY) === 'true';
  if (!auto) return true;

  const now = new Date().getHours() + new Date().getMinutes() / 60;
  const start = parseInt(localStorage.getItem(START_KEY) || '20');
  const end = parseInt(localStorage.getItem(END_KEY) || '7');

  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // crosses midnight
}

function applyCurrentState() {
  if (!overlay) return;
  const active = isCurrentlyActive();
  const warmth = parseInt(localStorage.getItem(WARMTH_KEY) || '50');
  const alpha = active ? (warmth / 100) * 0.35 : 0; // cap at 0.35
  overlay.style.background = `rgba(255, 140, 0, ${alpha})`;
}
