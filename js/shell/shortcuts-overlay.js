// Astrion OS — Keyboard Shortcuts Overlay
// Press Cmd+/ (or Ctrl+/) to toggle a cheatsheet of all shortcuts.

import { eventBus } from '../kernel/event-bus.js';

let overlay = null;

const SHORTCUTS = [
  { keys: 'Ctrl + Space', action: 'Open Spotlight / Search' },
  { keys: 'Ctrl + /', action: 'Show this shortcuts overlay' },
  { keys: 'Alt + Tab', action: 'Switch between windows' },
  { keys: 'Alt + Scroll', action: 'Window transparency (on titlebar)' },
  { keys: 'Right-click titlebar', action: 'Pin on top, mini mode, close' },
  { keys: 'Ctrl + Shift + P', action: 'Toggle mini mode (PiP)' },
  { keys: 'Ctrl + Shift + T', action: 'Toggle pin on top' },
  { keys: 'Ctrl + Shift + G', action: 'Grid tile all windows' },
  { keys: 'Ctrl + Shift + C', action: 'Cascade all windows' },
  { keys: 'Ctrl + Shift + D', action: 'Toggle dock visibility' },
  { keys: 'Ctrl + .', action: 'Emoji picker' },
  { keys: 'Ctrl + Shift + V', action: 'Clipboard history' },
  { keys: 'Ctrl + Space', action: 'Spotlight search' },
  { keys: 'Escape', action: 'Close current dialog / Spotlight' },
  { keys: 'F4', action: 'Open App Grid (Launchpad)' },
  { keys: 'Arrow Keys', action: 'Navigate files / games' },
  { keys: 'Enter', action: 'Open selected / confirm action' },
  { keys: 'Delete', action: 'Delete selected file' },
  { keys: 'Cmd + A', action: 'Select all (in Finder)' },
  { keys: 'Space', action: 'Quick Look preview (in Finder)' },
];

function createOverlay() {
  const el = document.createElement('div');
  el.id = 'shortcuts-overlay';
  el.style.cssText = `
    position:fixed; inset:0; z-index:99990;
    background:rgba(0,0,0,0.6); backdrop-filter:blur(20px);
    display:flex; align-items:center; justify-content:center;
    animation:fadeIn 0.15s ease-out;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background:rgba(38,38,38,0.95); border:1px solid rgba(255,255,255,0.1);
    border-radius:16px; padding:24px 32px; max-width:480px; width:90%;
    box-shadow:0 20px 60px rgba(0,0,0,0.5); font-family:var(--font); color:white;
  `;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div style="font-size:16px;font-weight:700;">Keyboard Shortcuts</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);">Press Ctrl+/ to close</div>
    </div>
    ${SHORTCUTS.map(s => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font-size:13px;color:rgba(255,255,255,0.8);">${s.action}</span>
        <kbd style="font-size:11px;font-family:var(--font);background:rgba(255,255,255,0.08);padding:3px 8px;border-radius:5px;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.1);white-space:nowrap;">${s.keys}</kbd>
      </div>
    `).join('')}
  `;

  el.appendChild(card);
  el.addEventListener('click', (e) => {
    if (e.target === el) toggle();
  });
  return el;
}

function toggle() {
  if (overlay && overlay.isConnected) {
    overlay.remove();
    overlay = null;
  } else {
    overlay = createOverlay();
    document.body.appendChild(overlay);
  }
}

export function initShortcutsOverlay() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+/ or Cmd+/ toggles the overlay
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      toggle();
    }
    // Escape closes it too
    if (e.key === 'Escape' && overlay && overlay.isConnected) {
      overlay.remove();
      overlay = null;
    }
  });
}
