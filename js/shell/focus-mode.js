// NOVA OS — Focus / Do Not Disturb Mode
// Suppresses notifications. Shows a crescent moon badge in the menubar when active.
// Optional schedule (e.g., "Work Hours: 9am–5pm weekdays").

import { eventBus } from '../kernel/event-bus.js';

const ENABLED_KEY = 'nova-focus-enabled';
const MODE_KEY    = 'nova-focus-mode';
const SCHEDULE_KEY = 'nova-focus-schedule';

const MODES = {
  none:   { label: 'Off',         icon: '',          color: '#666' },
  dnd:    { label: 'Do Not Disturb', icon: '\uD83C\uDF19', color: '#5856d6' },
  work:   { label: 'Work',           icon: '\uD83D\uDCBC', color: '#007aff' },
  personal:{label: 'Personal',      icon: '\uD83C\uDFE1', color: '#34c759' },
  sleep:  { label: 'Sleep',          icon: '\uD83D\uDCA4', color: '#5e5ce6' },
  gaming: { label: 'Gaming',         icon: '\uD83C\uDFAE', color: '#ff3b30' },
};

let badge = null;

export function initFocusMode() {
  // Inject badge into menubar if slot exists
  tryInjectBadge();

  // Re-check schedule every minute
  setInterval(checkSchedule, 60000);
  checkSchedule();

  updateBadge();
}

export function getFocusState() {
  return {
    enabled: localStorage.getItem(ENABLED_KEY) === 'true',
    mode: localStorage.getItem(MODE_KEY) || 'none',
    modes: MODES,
  };
}

export function setFocusMode(mode) {
  if (!MODES[mode]) return;
  localStorage.setItem(MODE_KEY, mode);
  localStorage.setItem(ENABLED_KEY, mode === 'none' ? 'false' : 'true');
  updateBadge();
  eventBus.emit('focus:changed', { mode });
}

export function isNotificationsSuppressed() {
  if (localStorage.getItem(ENABLED_KEY) !== 'true') return false;
  const mode = localStorage.getItem(MODE_KEY) || 'none';
  return mode !== 'none';
}

function tryInjectBadge() {
  // Look for a slot in the menubar
  const menubar = document.querySelector('#menubar-right, .menubar-right');
  if (!menubar) return;

  if (document.getElementById('focus-badge')) return;

  badge = document.createElement('div');
  badge.id = 'focus-badge';
  badge.style.cssText = `
    display: none;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    font-size: 12px;
    cursor: pointer;
    color: white;
  `;
  badge.addEventListener('click', toggleQuickMenu);

  // Insert before the clock if possible
  const clock = menubar.querySelector('#menubar-clock');
  if (clock) menubar.insertBefore(badge, clock);
  else menubar.prepend(badge);
}

function updateBadge() {
  if (!badge) tryInjectBadge();
  if (!badge) return;

  const { enabled, mode } = getFocusState();
  if (enabled && MODES[mode]) {
    badge.style.display = 'inline-flex';
    badge.innerHTML = `<span>${MODES[mode].icon}</span>`;
    badge.title = `Focus: ${MODES[mode].label}`;
  } else {
    badge.style.display = 'none';
  }
}

function toggleQuickMenu(e) {
  e.stopPropagation();
  const existing = document.getElementById('focus-quick-menu');
  if (existing) { existing.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'focus-quick-menu';
  menu.style.cssText = `
    position: fixed;
    top: 30px;
    right: 200px;
    width: 220px;
    background: rgba(30, 30, 36, 0.95);
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 6px;
    z-index: 95000;
    font-family: var(--font);
    color: white;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    animation: fadeIn 0.15s ease;
  `;

  const current = localStorage.getItem(MODE_KEY) || 'none';

  Object.entries(MODES).forEach(([id, m]) => {
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      background: ${id === current ? 'rgba(0,122,255,0.2)' : 'transparent'};
    `;
    item.addEventListener('mouseenter', () => {
      if (id !== current) item.style.background = 'rgba(255,255,255,0.06)';
    });
    item.addEventListener('mouseleave', () => {
      if (id !== current) item.style.background = 'transparent';
    });
    item.innerHTML = `
      <div style="width: 22px; height: 22px; border-radius: 50%; background: ${m.color}; display:flex; align-items:center; justify-content:center; font-size: 11px;">${m.icon || '\u00D7'}</div>
      <span>${m.label}</span>
    `;
    item.addEventListener('click', () => {
      setFocusMode(id);
      menu.remove();
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', function clickOut(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', clickOut);
      }
    });
  }, 10);
}

function checkSchedule() {
  // Future: load schedule from localStorage and auto-enable modes
  updateBadge();
}
