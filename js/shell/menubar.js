// NOVA OS — Menubar

import { eventBus } from '../kernel/event-bus.js';
import { windowManager } from '../kernel/window-manager.js';
import { processManager } from '../kernel/process-manager.js';
import { lockScreen, showShutdownDialog } from './lock-screen.js';

let activeDropdown = null;

export function initMenubar() {
  updateClock();
  setInterval(updateClock, 1000);

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

  // Apple menu click
  document.getElementById('menubar-apple').addEventListener('click', (e) => {
    e.stopPropagation();
    showDropdown(e.target.closest('.menubar-apple'), [
      { label: 'About NOVA OS', action: () => processManager.launch('settings') },
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
        { label: 'About NOVA OS', action: () => processManager.launch('settings') },
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
