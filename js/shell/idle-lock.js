// NOVA OS — Idle Auto-Lock
// Locks the screen automatically after N minutes of inactivity.
// Configurable in Settings > Security.

import { eventBus } from '../kernel/event-bus.js';

const IDLE_TIMEOUT_KEY = 'nova-idle-lock-min';
const DEFAULT_TIMEOUT = 10; // 10 minutes

let lastActivity = Date.now();
let checkInterval = null;

export function initIdleLock() {
  // Track activity
  const activityEvents = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'focus'];
  activityEvents.forEach(evt => {
    document.addEventListener(evt, onActivity, { passive: true });
  });

  // Check every 30 seconds
  checkInterval = setInterval(checkIdle, 30000);
}

function onActivity() {
  lastActivity = Date.now();
}

function checkIdle() {
  const timeoutMin = parseInt(localStorage.getItem(IDLE_TIMEOUT_KEY) || String(DEFAULT_TIMEOUT));
  if (timeoutMin <= 0) return; // disabled

  const idleMs = Date.now() - lastActivity;
  const idleMin = idleMs / 60000;

  if (idleMin >= timeoutMin) {
    console.log(`[IdleLock] Locking after ${idleMin.toFixed(1)} minutes idle`);
    eventBus.emit('system:lock');
    lastActivity = Date.now(); // reset so we don't re-lock repeatedly
  }
}

export function setIdleTimeout(minutes) {
  localStorage.setItem(IDLE_TIMEOUT_KEY, String(minutes));
}

export function getIdleTimeout() {
  return parseInt(localStorage.getItem(IDLE_TIMEOUT_KEY) || String(DEFAULT_TIMEOUT));
}
