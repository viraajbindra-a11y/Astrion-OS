// NOVA OS — Menubar

import { eventBus } from '../kernel/event-bus.js';
import { windowManager } from '../kernel/window-manager.js';
import { processManager } from '../kernel/process-manager.js';
import { lockScreen, showShutdownDialog } from './lock-screen.js';

let activeDropdown = null;

export function initMenubar() {
  updateClock();
  setInterval(updateClock, 1000);

  // Simulated battery — starts at 100%, drains very slowly
  initBattery();

  // Update app name when window focuses
  eventBus.on('window:focused', ({ title, app }) => {
    const appNames = {
      finder: 'Finder', browser: 'Browser', notes: 'Notes',
      terminal: 'Terminal', calculator: 'Calculator', music: 'Music',
      calendar: 'Calendar', draw: 'Draw', appstore: 'App Store',
      settings: 'Settings', 'text-editor': 'Text Editor', photos: 'Photos',
      weather: 'Weather', clock: 'Clock', reminders: 'Reminders',
    };
    document.getElementById('menubar-app-name').textContent = appNames[app] || title || 'Finder';
  });

  // Spotlight shortcut in menubar
  document.getElementById('menubar-spotlight').addEventListener('click', () => {
    eventBus.emit('spotlight:toggle');
  });

  // Notification bell — toggle notification center
  document.getElementById('menubar-notif-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    eventBus.emit('notifications:toggle');
  });

  // Update notification badge count
  eventBus.on('notification:shown', ({ count }) => {
    const badge = document.getElementById('menubar-notif-badge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 9 ? '9+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  });

  // Apple menu click
  document.getElementById('menubar-apple').addEventListener('click', (e) => {
    e.stopPropagation();
    showDropdown(e.target.closest('.menubar-apple'), [
      { label: 'About NOVA OS', action: () => showAboutDialog() },
      { separator: true },
      { label: 'System Settings...', shortcut: '\u2318,', action: () => processManager.launch('settings') },
      { label: 'App Store...', action: () => processManager.launch('appstore') },
      { separator: true },
      { separator: true },
      { label: 'Lock Screen', shortcut: '\u2318L', action: () => lockScreen() },
      { separator: true },
      { label: 'Shut Down...', action: () => showShutdownDialog() },
    ]);
  });

  // Menu item clicks
  document.querySelectorAll('.menubar-menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = item.textContent.trim();
      showDropdown(item, getMenuItems(menu));
    });
  });

  // Close dropdown when clicking elsewhere
  document.addEventListener('click', closeDropdown);
}

function getMenuItems(menu) {
  switch (menu) {
    case 'File':
      return [
        { label: 'New Window', shortcut: '\u2318N', action: () => processManager.launch('finder') },
        { label: 'New Terminal', shortcut: '\u2318T', action: () => processManager.launch('terminal') },
        { separator: true },
        { label: 'Open...', shortcut: '\u2318O', disabled: true },
        { label: 'Save', shortcut: '\u2318S', disabled: true },
        { label: 'Save As...', shortcut: '\u21E7\u2318S', disabled: true },
        { separator: true },
        { label: 'Close Window', shortcut: '\u2318W', action: () => {
          if (windowManager.activeWindowId) windowManager.close(windowManager.activeWindowId);
        }},
      ];
    case 'Edit':
      return [
        { label: 'Undo', shortcut: '\u2318Z', action: () => document.execCommand('undo') },
        { label: 'Redo', shortcut: '\u21E7\u2318Z', action: () => document.execCommand('redo') },
        { separator: true },
        { label: 'Cut', shortcut: '\u2318X', action: () => document.execCommand('cut') },
        { label: 'Copy', shortcut: '\u2318C', action: () => document.execCommand('copy') },
        { label: 'Paste', shortcut: '\u2318V', action: () => document.execCommand('paste') },
        { label: 'Select All', shortcut: '\u2318A', action: () => document.execCommand('selectAll') },
      ];
    case 'View':
      return [
        { label: 'Enter Full Screen', shortcut: '\u2303\u2318F', action: () => {
          if (windowManager.activeWindowId) windowManager.maximize(windowManager.activeWindowId);
        }},
        { separator: true },
        { label: 'Show Dock', checked: true },
        { label: 'Show Desktop Icons', checked: true },
      ];
    case 'Window':
      return [
        { label: 'Minimize', shortcut: '\u2318M', action: () => {
          if (windowManager.activeWindowId) windowManager.minimize(windowManager.activeWindowId);
        }},
        { label: 'Zoom', action: () => {
          if (windowManager.activeWindowId) windowManager.maximize(windowManager.activeWindowId);
        }},
        { separator: true },
        ...getOpenWindows(),
      ];
    case 'Help':
      return [
        { label: 'NOVA OS Help', action: () => {
          eventBus.emit('spotlight:toggle');
        }},
        { separator: true },
        { label: 'Keyboard Shortcuts', action: () => {
          eventBus.emit('spotlight:toggle');
        }},
        { label: 'About NOVA OS', action: () => showAboutDialog() },
      ];
    default:
      return [{ label: 'No items', disabled: true }];
  }
}

function getOpenWindows() {
  const items = [];
  for (const [id, state] of windowManager.windows) {
    items.push({
      label: state.title,
      checked: state.focused,
      action: () => {
        if (state.minimized) windowManager.unminimize(id);
        else windowManager.focus(id);
      }
    });
  }
  if (items.length === 0) {
    items.push({ label: 'No windows open', disabled: true });
  }
  return items;
}

function showDropdown(anchor, items) {
  closeDropdown();

  const dropdown = document.createElement('div');
  dropdown.id = 'menubar-dropdown';
  dropdown.style.cssText = `
    position: fixed;
    top: 28px;
    background: rgba(38, 38, 42, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 4px;
    min-width: 220px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    z-index: 95000;
    animation: fadeIn 0.1s ease;
  `;

  // Position under the clicked menu item
  const rect = anchor.getBoundingClientRect();
  dropdown.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';

  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 8px;';
      dropdown.appendChild(sep);
      return;
    }

    const el = document.createElement('div');
    el.style.cssText = `
      padding: 5px 12px;
      border-radius: 4px;
      cursor: default;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: ${item.disabled ? 'rgba(255,255,255,0.25)' : 'white'};
      pointer-events: ${item.disabled ? 'none' : 'auto'};
    `;

    const label = document.createElement('span');
    label.textContent = (item.checked ? '\u2713 ' : '') + item.label;
    el.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement('span');
      shortcut.textContent = item.shortcut;
      shortcut.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.3);margin-left:20px;';
      el.appendChild(shortcut);
    }

    el.addEventListener('mouseenter', () => {
      if (!item.disabled) el.style.background = 'var(--accent)';
    });
    el.addEventListener('mouseleave', () => {
      el.style.background = 'none';
    });

    if (item.action && !item.disabled) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        item.action();
      });
    }

    dropdown.appendChild(el);
  });

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
}

function closeDropdown() {
  if (activeDropdown) {
    activeDropdown.remove();
    activeDropdown = null;
  }
}

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  const day = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const clockEl = document.getElementById('menubar-clock');
  clockEl.textContent = `${day}  ${time}`;

  // Setup click handler for calendar dropdown (once)
  if (!clockEl.dataset.init) {
    clockEl.dataset.init = 'true';
    clockEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleClockDropdown();
    });
  }
}

function initBattery() {
  let battery = parseInt(localStorage.getItem('nova-battery') || '100');
  const pctEl = document.getElementById('menubar-battery-pct');
  const fillEl = document.getElementById('battery-fill');

  function updateBattery() {
    if (pctEl) pctEl.textContent = battery + '%';
    if (fillEl) {
      const fillWidth = Math.round(14 * (battery / 100));
      fillEl.setAttribute('width', String(Math.max(1, fillWidth)));
    }
  }

  updateBattery();

  // Drain 1% every 3 minutes (simulated)
  setInterval(() => {
    if (battery > 5) {
      battery--;
      localStorage.setItem('nova-battery', String(battery));
      updateBattery();
    }
  }, 180000);

  // If it's been a while, simulate charging back up
  const lastTime = parseInt(localStorage.getItem('nova-battery-time') || '0');
  const now = Date.now();
  if (now - lastTime > 3600000) { // More than 1 hour since last session
    battery = 100;
    localStorage.setItem('nova-battery', '100');
    updateBattery();
  }
  localStorage.setItem('nova-battery-time', String(now));
}

function showAboutDialog() {
  // Remove any existing about dialog
  document.querySelectorAll('.about-dialog-overlay').forEach(d => d.remove());

  const overlay = document.createElement('div');
  overlay.className = 'about-dialog-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:96000;
    display:flex;align-items:center;justify-content:center;
    animation:fadeIn 0.2s ease;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background:rgba(38,38,42,0.95);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);
    border:1px solid rgba(255,255,255,0.1);border-radius:16px;
    width:320px;padding:32px 28px;text-align:center;
    box-shadow:0 24px 80px rgba(0,0,0,0.6);
    animation:scaleIn 0.2s cubic-bezier(0.16,1,0.3,1);
    font-family:var(--font);
  `;

  const userName = localStorage.getItem('nova-username') || 'User';

  dialog.innerHTML = `
    <div style="margin-bottom:16px;">
      <svg width="64" height="64" viewBox="0 0 80 80" fill="none">
        <defs>
          <linearGradient id="about-grad" x1="0" y1="0" x2="80" y2="80">
            <stop offset="0%" stop-color="#007aff"/>
            <stop offset="100%" stop-color="#5856d6"/>
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r="38" fill="url(#about-grad)"/>
        <circle cx="40" cy="40" r="36" stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none"/>
        <path d="M28 40 L40 28 L52 40 L40 52 Z" fill="white" opacity="0.95"/>
        <circle cx="40" cy="40" r="6" fill="white"/>
      </svg>
    </div>
    <div style="font-size:22px;font-weight:700;color:white;margin-bottom:4px;">NOVA OS</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:16px;">Version 1.0.0 (Build 2026.04)</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.6;">
      An AI-native operating system built from scratch.<br>
      Designed and developed by <strong style="color:rgba(255,255,255,0.8);">${userName}</strong>.
    </div>
    <div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.3);">
      Kernel: NOVA Kernel 1.0 &bull; Memory: 8 GB &bull; Arch: x86_64
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:10px;color:rgba(255,255,255,0.25);">
        &copy; 2026 NOVA OS Project. All rights reserved.<br>
        Built with vanilla JavaScript, CSS, and love.
      </div>
    </div>
    <button id="about-close-btn" style="
      margin-top:16px;padding:6px 28px;background:var(--accent);color:white;border:none;
      border-radius:8px;font-size:13px;font-family:var(--font);cursor:pointer;font-weight:500;
    ">OK</button>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Close handlers
  const close = () => overlay.remove();
  dialog.querySelector('#about-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); }
  });
}

function toggleClockDropdown() {
  let dd = document.getElementById('clock-dropdown');
  if (dd) { dd.remove(); return; }

  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const today = now.getDate();
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let calGrid = dayNames.map(d => `<div style="font-size:10px;color:rgba(255,255,255,0.4);text-align:center;padding:4px 0;">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) calGrid += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today;
    calGrid += `<div style="text-align:center;padding:4px 0;font-size:12px;${isToday ? 'background:var(--accent);border-radius:50%;color:white;font-weight:600;' : 'color:rgba(255,255,255,0.8);'}">${d}</div>`;
  }

  dd = document.createElement('div');
  dd.id = 'clock-dropdown';
  dd.style.cssText = `position:fixed;top:28px;right:8px;width:260px;background:rgba(38,38,42,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px;box-shadow:0 15px 50px rgba(0,0,0,0.5);z-index:95000;animation:scaleIn 0.15s ease-out;`;
  dd.innerHTML = `
    <div style="text-align:center;margin-bottom:12px;">
      <div style="font-size:28px;font-weight:600;">${now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true})}</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);">${now.toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
    </div>
    <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;">
      <div style="font-size:13px;font-weight:600;text-align:center;margin-bottom:8px;">${monthNames[month]} ${year}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">${calGrid}</div>
    </div>
  `;

  document.getElementById('desktop').appendChild(dd);

  // Update time every second
  const timer = setInterval(() => {
    const el = document.getElementById('clock-dropdown');
    if (!el) { clearInterval(timer); return; }
    const n = new Date();
    el.querySelector('div > div').textContent = n.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});
  }, 1000);

  // Close on click outside
  const closeHandler = (e) => {
    if (!dd.contains(e.target) && e.target.id !== 'menubar-clock') {
      dd.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}
