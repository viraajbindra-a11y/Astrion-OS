// NOVA OS — Hot Corners
// Move the cursor into a corner of the screen to trigger an action.
// Configurable in Settings. Defaults:
//   top-right    → Notification Center
//   bottom-right → Show Desktop
//   top-left     → Overview
//   bottom-left  → App Grid

import { eventBus } from '../kernel/event-bus.js';
import { windowManager } from '../kernel/window-manager.js';

const CONFIG_KEY = 'nova-hot-corners';
const DEFAULT_CONFIG = {
  'top-left': 'mission-control',
  'top-right': 'notifications',
  'bottom-left': 'launchpad',
  'bottom-right': 'show-desktop',
};

const TRIGGER_SIZE = 4;   // px from corner
const DWELL_MS = 500;     // hold mouse in corner for this long

let config = null;
let activeCorner = null;
let dwellTimer = null;
let lastTrigger = 0;

export function initHotCorners() {
  loadConfig();

  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', clearDwell);
}

function loadConfig() {
  try {
    config = JSON.parse(localStorage.getItem(CONFIG_KEY)) || { ...DEFAULT_CONFIG };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
}

export function setHotCorner(corner, action) {
  loadConfig();
  config[corner] = action;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function getHotCorners() {
  loadConfig();
  return { ...config };
}

function onMove(e) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const corner = detectCorner(e.clientX, e.clientY, w, h);

  if (corner !== activeCorner) {
    clearDwell();
    activeCorner = corner;
    if (corner && config[corner] && config[corner] !== 'none') {
      dwellTimer = setTimeout(() => trigger(corner), DWELL_MS);
    }
  }
}

function detectCorner(x, y, w, h) {
  if (x <= TRIGGER_SIZE && y <= TRIGGER_SIZE) return 'top-left';
  if (x >= w - TRIGGER_SIZE && y <= TRIGGER_SIZE) return 'top-right';
  if (x <= TRIGGER_SIZE && y >= h - TRIGGER_SIZE) return 'bottom-left';
  if (x >= w - TRIGGER_SIZE && y >= h - TRIGGER_SIZE) return 'bottom-right';
  return null;
}

function clearDwell() {
  if (dwellTimer) { clearTimeout(dwellTimer); dwellTimer = null; }
  activeCorner = null;
}

function trigger(corner) {
  // Debounce — don't re-fire too quickly
  const now = Date.now();
  if (now - lastTrigger < 1000) return;
  lastTrigger = now;

  const action = config[corner];
  switch (action) {
    case 'mission-control':
      eventBus.emit('mission-control:toggle');
      break;
    case 'notifications':
      eventBus.emit('notifications:toggle');
      break;
    case 'launchpad':
      eventBus.emit('launchpad:toggle');
      break;
    case 'show-desktop':
      toggleShowDesktop();
      break;
    case 'spotlight':
      eventBus.emit('spotlight:toggle');
      break;
    case 'lock-screen':
      eventBus.emit('system:lock');
      break;
  }
}

let desktopHidden = false;
let savedStates = [];

function toggleShowDesktop() {
  if (!desktopHidden) {
    savedStates = [];
    for (const [id, state] of windowManager.windows) {
      if (!state.minimized) {
        savedStates.push(id);
        windowManager.minimize(id);
      }
    }
    desktopHidden = true;
  } else {
    savedStates.forEach(id => {
      if (windowManager.windows.has(id)) windowManager.unminimize(id);
    });
    savedStates = [];
    desktopHidden = false;
  }
}
