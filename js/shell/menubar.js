// NOVA OS — Menubar

import { eventBus } from '../kernel/event-bus.js';
import { windowManager } from '../kernel/window-manager.js';
import { processManager } from '../kernel/process-manager.js';
import { lockScreen, showShutdownDialog } from './lock-screen.js';

let activeDropdown = null;

let timeOffset = 0; // ms offset from system clock to real time

/**
 * Brain indicator — signature feature showing which AI answered the last question.
 * S1 (cyan) = fast local model, S2 (purple) = slow cloud model, thinking (yellow pulse).
 * Real routing lands in M3 (dual-process runtime). For now, any code that calls an AI
 * can emit `ai:response` with { brain: 's1' | 's2' } and this updates.
 * Click to see the reasoning trace (stub — panel lands with M4 verifiable computation).
 */
function initBrainIndicator() {
  const el = document.getElementById('menubar-brain');
  const tag = document.getElementById('menubar-brain-tag');
  if (!el || !tag) return;

  // Default state: idle, showing S1 (what most things will use once M3 ships)
  el.dataset.brain = 's1';
  tag.textContent = 'S1';

  eventBus.on('ai:thinking', () => {
    el.dataset.brain = 'thinking';
    tag.textContent = '...';
  });

  eventBus.on('ai:response', ({ brain, confidence, provider }) => {
    const which = (brain || 's1').toLowerCase();
    el.dataset.brain = which;
    // Display label: S1/S2 for real AI, "OFF" for offline/mock
    tag.textContent = which === 'offline' ? 'OFF' : which.toUpperCase();
    const label = which === 'offline'
      ? 'OFFLINE — no real AI connected'
      : which === 's1'
        ? 'S1 — fast local model'
        : 'S2 — slow cloud model';
    const confStr = confidence != null ? ` Confidence ${Math.round(confidence * 100)}%.` : '';
    const provStr = provider ? ` (${provider})` : '';
    el.title = `Brain: ${label}${provStr}.${confStr} (Click for reasoning trace — coming in M4.)`;
  });

  el.addEventListener('click', () => {
    // Stub: M4 will open a slide-out receipt panel here.
    eventBus.emit('notification:show', {
      title: 'Brain indicator',
      message: `Last answer: ${el.dataset.brain.toUpperCase()}. Full reasoning traces ship with M4.`,
      icon: '🧠',
    });
  });
}

export function initMenubar() {
  updateClock();
  setInterval(updateClock, 1000);
  syncTime();

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
      'activity-monitor': 'Task Manager', vault: 'Vault',
      'screen-recorder': 'Screen Recorder', trash: 'Trash',
      installer: 'Installer', messages: 'Messages',
      'sticky-notes': 'Sticky Notes', contacts: 'Contacts',
      maps: 'Maps', 'voice-memos': 'Voice Memos',
      pomodoro: 'Pomodoro', 'pdf-viewer': 'PDF Viewer',
      kanban: 'Kanban', 'habit-tracker': 'Habits',
      'video-player': 'Video Player', 'system-info': 'System Info',
      translator: 'Translator', 'unit-converter': 'Converter',
      'color-picker': 'Color Picker', stopwatch: 'Stopwatch',
      'timer-app': 'Timer', whiteboard: 'Whiteboard',
      'password-gen': 'Password Gen', markdown: 'Markdown',
      'qr-code': 'QR Code', dictionary: 'Dictionary',
      journal: 'Journal', flashcards: 'Flashcards',
      chess: 'Chess', snake: 'Snake', '2048': '2048',
      budget: 'Budget', quotes: 'Quotes',
      'typing-test': 'Typing Test', todo: 'Todo',
      youtube: 'YouTube', 'pixel-art': 'Pixel Art',
      tetris: 'Tetris', minesweeper: 'Minesweeper',
      'matrix-rain': 'Matrix Rain', 'neon-void': 'Neon Void',
      'beat-studio': 'Beat Studio', 'live-chat': 'Live Chat',
      'code-runner': 'Code Runner', 'emoji-search': 'Emoji Search',
      sudoku: 'Sudoku', 'speed-test': 'Speed Test',
      'recipe-book': 'Recipe Book', 'emoji-kitchen': 'Emoji Kitchen',
      animate: 'Animate Studio', 'video-editor': 'Video Editor',
      'ai-art': 'AI Art Generator', 'ai-writer': 'AI Writer', wordle: 'Wordle',
      meditation: 'Meditation', soundboard: 'Soundboard',
      countdown: 'Countdown', 'reaction-test': 'Reaction Test',
      'color-palette': 'Color Palette', 'rock-paper-scissors': 'RPS',
      'tic-tac-toe': 'Tic Tac Toe', 'random-facts': 'Random Facts',
      'bmi-calc': 'BMI Calculator',
    };
    document.getElementById('menubar-app-name').textContent = appNames[app] || title || 'Finder';
  });

  // Search shortcut in menubar
  document.getElementById('menubar-spotlight').addEventListener('click', () => {
    eventBus.emit('spotlight:toggle');
  });

  // Brain indicator — shows which AI answered your last question.
  // S1 = fast local model, S2 = slow cloud model. Signature feature for M3.
  // For now, responds to a global 'ai:response' event. Real S1/S2 routing lands in M3.
  initBrainIndicator();

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
      { label: 'About Astrion OS', action: () => showAboutDialog() },
      { separator: true },
      { label: 'Check for Updates...', action: () => checkForUpdates() },
      { label: 'System Settings...', shortcut: '\u2318,', action: () => processManager.launch('settings') },
      { label: 'App Store...', action: () => processManager.launch('appstore') },
      { separator: true },
      { label: 'Activity Monitor', action: () => processManager.launch('activity-monitor') },
      { label: 'Force Quit...', shortcut: '\u2325\u2318Q', action: () => showForceQuitDialog() },
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
        { label: 'Astrion OS Help', action: () => {
          eventBus.emit('spotlight:toggle');
        }},
        { separator: true },
        { label: 'Keyboard Shortcuts', action: () => {
          eventBus.emit('spotlight:toggle');
        }},
        { label: 'About Astrion OS', action: () => showAboutDialog() },
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

function getRealTime() {
  return new Date(Date.now() + timeOffset);
}

async function syncTime() {
  // Try to get accurate time from web API (works even if system clock is wrong)
  try {
    const before = Date.now();
    const res = await fetch('https://worldtimeapi.org/api/ip', { signal: AbortSignal.timeout(5000) });
    const after = Date.now();
    const data = await res.json();
    const serverTime = new Date(data.datetime).getTime();
    const latency = (after - before) / 2;
    timeOffset = serverTime - before - latency;

    if (Math.abs(timeOffset) > 5000) {
      console.log(`[Clock] Synced: offset ${Math.round(timeOffset / 1000)}s`);
      // Also try to fix system clock via server
      fetch('/api/system/set-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: serverTime }),
      }).catch(() => {});
    }
  } catch {
    // Try fallback: use HTTP Date header from any server
    try {
      const res = await fetch('/api/battery', { signal: AbortSignal.timeout(3000) });
      const serverDate = res.headers.get('date');
      if (serverDate) {
        const serverTime = new Date(serverDate).getTime();
        timeOffset = serverTime - Date.now();
      }
    } catch {}
  }

  // Set system timezone from IP geolocation (worldtimeapi returns timezone)
  try {
    const tzRes = await fetch('https://worldtimeapi.org/api/ip', { signal: AbortSignal.timeout(5000) });
    const tzData = await tzRes.json();
    if (tzData.timezone) {
      fetch('/api/system/set-timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tzData.timezone }),
      }).catch(() => {});
    }
  } catch {}

  // Re-sync every 10 minutes
  setTimeout(syncTime, 600000);
}

function updateClock() {
  const now = getRealTime();
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

async function showForceQuitDialog() {
  document.querySelectorAll('.about-dialog-overlay').forEach(d => d.remove());
  const { trapFocus } = await import('./focus-trap.js');

  const overlay = document.createElement('div');
  overlay.className = 'about-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Force Quit Applications');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:96000;
    display:flex;align-items:center;justify-content:center;
    animation:fadeIn 0.2s ease;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background:rgba(38,38,42,0.95);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);
    border:1px solid rgba(255,255,255,0.1);border-radius:14px;
    width:340px;padding:0;overflow:hidden;
    box-shadow:0 24px 80px rgba(0,0,0,0.6);
    animation:scaleIn 0.2s cubic-bezier(0.16,1,0.3,1);
    font-family:var(--font);
  `;

  const running = processManager.getRunningApps();
  const appRows = running.map(proc => {
    const app = proc.app;
    return `<div class="fq-app-row" role="option" tabindex="0" aria-label="${app?.name || proc.appId}" data-instance="${proc.instanceId}" style="display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:default;font-size:13px;">
      <span style="font-size:18px;" aria-hidden="true">${app?.icon || '\uD83D\uDCC4'}</span>
      <span style="flex:1;">${app?.name || proc.appId}</span>
    </div>`;
  }).join('');

  dialog.innerHTML = `
    <div id="fq-heading" style="padding:16px 16px 8px;font-size:14px;font-weight:600;">Force Quit Applications</div>
    <div style="padding:0 16px 8px;font-size:11px;color:rgba(255,255,255,0.4);">Select an application to force quit</div>
    <div role="listbox" aria-labelledby="fq-heading" style="max-height:200px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.06);">
      ${appRows || '<div style="padding:16px;text-align:center;color:rgba(255,255,255,0.3);font-size:13px;">No applications running</div>'}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;">
      <button id="fq-cancel" aria-label="Cancel" style="padding:6px 16px;background:rgba(255,255,255,0.08);color:white;border:none;border-radius:6px;font-size:13px;font-family:var(--font);cursor:pointer;">Cancel</button>
      <button id="fq-quit" aria-label="Force quit selected app" style="padding:6px 16px;background:var(--red);color:white;border:none;border-radius:6px;font-size:13px;font-family:var(--font);cursor:pointer;font-weight:500;" disabled>Force Quit</button>
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let selectedInstance = null;

  // Click or keyboard-select app rows
  dialog.querySelectorAll('.fq-app-row').forEach(row => {
    const selectRow = () => {
      dialog.querySelectorAll('.fq-app-row').forEach(r => {
        r.style.background = 'none';
        r.setAttribute('aria-selected', 'false');
      });
      row.style.background = 'var(--accent)';
      row.setAttribute('aria-selected', 'true');
      selectedInstance = row.dataset.instance;
      dialog.querySelector('#fq-quit').disabled = false;
    };
    row.addEventListener('click', selectRow);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectRow();
      }
    });
  });

  // Close handler + focus trap
  const close = () => {
    releaseFocusTrap();
    overlay.remove();
  };
  dialog.querySelector('#fq-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Force quit
  dialog.querySelector('#fq-quit').addEventListener('click', () => {
    if (selectedInstance) {
      const proc = processManager.running.get(selectedInstance);
      if (proc) {
        windowManager.close(proc.windowId);
      }
    }
    close();
  });

  const releaseFocusTrap = trapFocus(dialog, {
    onEscape: close,
    initialFocus: '#fq-cancel',
  });
}

function initBattery() {
  const pctEl = document.getElementById('menubar-battery-pct');
  const fillEl = document.getElementById('battery-fill');
  const boltEl = document.getElementById('battery-charging-bolt');
  const wrapEl = document.getElementById('menubar-battery');
  let battery = 100;
  let charging = false;

  function updateDisplay() {
    if (pctEl) {
      pctEl.textContent = battery + '%';
    }
    if (fillEl) {
      const fillWidth = Math.round(14 * (battery / 100));
      fillEl.setAttribute('width', String(Math.max(1, fillWidth)));
      // Color: green when charging, red when low, white otherwise
      if (charging) {
        fillEl.setAttribute('fill', '#34c759');
      } else if (battery <= 20) {
        fillEl.setAttribute('fill', '#ff3b30');
      } else {
        fillEl.setAttribute('fill', 'currentColor');
      }
    }
    // Show/hide charging bolt
    if (boltEl) {
      boltEl.style.display = charging ? 'block' : 'none';
    }
    // Update tooltip
    if (wrapEl) {
      wrapEl.title = `Battery: ${battery}%${charging ? ' — Charging' : battery <= 20 ? ' — Low Battery' : ''}`;
    }
  }

  async function fetchBattery() {
    try {
      const res = await fetch('/api/battery');
      const data = await res.json();
      if (data.available) {
        battery = data.level;
        charging = data.charging;
        updateDisplay();
        localStorage.setItem('nova-battery', String(battery));
        return;
      }
    } catch {}
    battery = parseInt(localStorage.getItem('nova-battery') || '100');
    updateDisplay();
  }

  // Initial read + poll every 10 seconds
  fetchBattery();
  setInterval(fetchBattery, 10000);

  // Fallback drain for web-only mode
  setInterval(() => {
    if (battery > 5 && !charging) {
      battery--;
      localStorage.setItem('nova-battery', String(battery));
      updateDisplay();
    }
  }, 180000);
}

async function showAboutDialog() {
  // Remove any existing about dialog
  document.querySelectorAll('.about-dialog-overlay').forEach(d => d.remove());
  const { trapFocus } = await import('./focus-trap.js');

  const overlay = document.createElement('div');
  overlay.className = 'about-dialog-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'About Astrion OS');
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
    <div style="font-size:22px;font-weight:700;color:white;margin-bottom:4px;">Astrion OS</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:16px;">Version 0.2.0 (Build 2026.04)</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.6;">
      An AI-native operating system built from scratch.<br>
      Designed and developed by <strong style="color:rgba(255,255,255,0.8);">${userName}</strong>.
    </div>
    <div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.3);">
      Kernel: Astrion Kernel 1.0 &bull; Memory: 8 GB &bull; Arch: x86_64
    </div>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:10px;color:rgba(255,255,255,0.25);">
        &copy; 2026 Astrion OS Project. All rights reserved.<br>
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

  const close = () => { releaseFocusTrap(); overlay.remove(); };
  dialog.querySelector('#about-close-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const releaseFocusTrap = trapFocus(dialog, {
    onEscape: close,
    initialFocus: '#about-close-btn',
  });
}

async function checkForUpdates() {
  const { notifications } = await import('../kernel/notifications.js');

  // ELECTRON DESKTOP APP PATH — defer to the Squirrel auto-updater.
  // The main process subscribes to Squirrel events and forwards them
  // back through window.astrionElectron.updater.on* callbacks.
  const electron = window.astrionElectron || window.novaElectron;
  if (electron?.isDesktopApp && electron.updater?.check) {
    notifications.show({
      title: 'Checking for updates…',
      body: 'Contacting GitHub releases',
      icon: '\uD83D\uDD04',
      duration: 3000,
    });
    try {
      const res = await electron.updater.check();
      const state = res?.state || {};
      if (!res?.ok) {
        notifications.show({
          title: 'Update check failed',
          body: res?.error || 'Unknown error',
          icon: '\u26A0\uFE0F',
          actions: [{ label: 'Open Releases', onClick: () => electron.updater.openReleases() }],
        });
        return;
      }
      if (state.downloaded) {
        notifications.show({
          title: `Astrion v${state.version || '?'} ready to install`,
          body: 'Quit and install now?',
          icon: '\uD83C\uDF89',
          duration: 0,
          actions: [
            { label: 'Install', onClick: () => electron.updater.install() },
            { label: 'Later', onClick: () => {} },
          ],
        });
      } else if (state.available) {
        notifications.show({
          title: `Astrion v${state.version || '?'} downloading…`,
          body: 'We\'ll let you know when it\'s ready.',
          icon: '\u2B07\uFE0F',
        });
      } else {
        notifications.show({
          title: 'Astrion OS is up to date',
          body: 'You\'re running the latest release.',
          icon: '\u2705',
        });
      }
    } catch (err) {
      notifications.show({
        title: 'Update check failed',
        body: String(err?.message || err),
        icon: '\u26A0\uFE0F',
      });
    }
    return;
  }

  // WEB-MODE PATH — server-side git pull (legacy self-update)
  notifications.show({
    title: 'Checking for updates…',
    body: 'Contacting Astrion update server',
    icon: '\uD83D\uDD04',
    duration: 3000,
  });

  try {
    const res = await fetch('/api/update/check', { method: 'POST' });
    const data = await res.json();

    if (data.status === 'up-to-date') {
      notifications.show({
        title: 'Astrion OS is up to date',
        body: `Running commit ${data.current?.slice(0, 7) || 'latest'}`,
        icon: '\u2705',
      });
    } else if (data.status === 'updated') {
      notifications.show({
        title: 'Astrion OS updated!',
        body: `Updated to ${data.latest?.slice(0, 7)}. Refresh to see changes.`,
        icon: '\uD83C\uDF89',
        duration: 10000,
        actions: [{ label: 'Refresh Now', onClick: () => location.reload() }],
      });
    } else if (data.status === 'update-available') {
      notifications.show({
        title: 'Update available',
        body: `New version: ${data.latest?.slice(0, 7)}. Installing…`,
        icon: '\u2B07\uFE0F',
      });
    } else {
      notifications.show({
        title: 'Update check failed',
        body: data.error || 'Unknown error',
        icon: '\u26A0\uFE0F',
      });
    }
  } catch (err) {
    notifications.show({
      title: 'Update check failed',
      body: 'Could not reach the update server. Are you online?',
      icon: '\u26A0\uFE0F',
    });
  }
}

// Auto-wire Electron updater events to Astrion notifications on boot.
// Runs once when the menubar initializes; subscribes to push events so
// a background update-download fires an Astrion toast without the user
// having to hit "Check for Updates".
function wireElectronUpdaterEvents() {
  const electron = window.astrionElectron || window.novaElectron;
  if (!electron?.isDesktopApp || !electron.updater) return;
  import('../kernel/notifications.js').then(({ notifications }) => {
    electron.updater.onAvailable?.((info) => {
      notifications.show({
        title: `Astrion v${info?.version || '?'} is downloading`,
        body: 'The new version will install after you quit.',
        icon: '\u2B07\uFE0F',
      });
    });
    electron.updater.onDownloaded?.((info) => {
      notifications.show({
        title: `Astrion v${info?.version || '?'} ready to install`,
        body: 'Restart to apply the update.',
        icon: '\uD83C\uDF89',
        duration: 0,
        actions: [
          { label: 'Restart', onClick: () => electron.updater.install() },
          { label: 'Later', onClick: () => {} },
        ],
      });
    });
    electron.updater.onError?.((info) => {
      console.warn('[updater] error', info);
    });
  });
}
// Fire after DOM is ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(wireElectronUpdaterEvents, 100);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(wireElectronUpdaterEvents, 100));
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
