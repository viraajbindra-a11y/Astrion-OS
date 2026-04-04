// NOVA OS — Global Keyboard Shortcuts

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';
import { eventBus } from '../kernel/event-bus.js';

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    const inWindowContent = e.target.closest('.window-content');

    // === App Launchers ===

    // Cmd+N — New Finder window
    if (meta && e.key === 'n' && !inWindowContent) {
      e.preventDefault();
      processManager.launch('finder');
    }

    // Cmd+T — New Terminal
    if (meta && e.key === 't' && !inWindowContent) {
      e.preventDefault();
      processManager.launch('terminal');
    }

    // Cmd+, — Open Settings
    if (meta && e.key === ',') {
      e.preventDefault();
      processManager.launch('settings');
    }

    // Ctrl+Alt+T — Terminal (Linux-style)
    if (e.ctrlKey && e.altKey && e.key === 't') {
      e.preventDefault();
      processManager.launch('terminal');
    }

    // Ctrl+Alt+F — File Manager
    if (e.ctrlKey && e.altKey && e.key === 'f') {
      e.preventDefault();
      processManager.launch('finder');
    }

    // Ctrl+Alt+B — Browser
    if (e.ctrlKey && e.altKey && e.key === 'b') {
      e.preventDefault();
      processManager.launch('browser');
    }

    // === Window Management ===

    // Cmd+W — Close focused window
    if (meta && e.key === 'w') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.close(windowManager.activeWindowId);
      }
    }

    // Cmd+M — Minimize focused window
    if (meta && e.key === 'm' && !e.shiftKey) {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.minimize(windowManager.activeWindowId);
      }
    }

    // Cmd+H — Hide/minimize all windows
    if (meta && e.key === 'h') {
      e.preventDefault();
      for (const [id, state] of windowManager.windows) {
        if (!state.minimized) windowManager.minimize(id);
      }
    }

    // F11 — Fullscreen toggle
    if (e.key === 'F11') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.maximize(windowManager.activeWindowId);
      }
    }

    // Cmd+Shift+Left — Snap window left half
    if (meta && e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        snapWindow(windowManager.activeWindowId, 'left');
      }
    }

    // Cmd+Shift+Right — Snap window right half
    if (meta && e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        snapWindow(windowManager.activeWindowId, 'right');
      }
    }

    // Cmd+Shift+Up — Maximize
    if (meta && e.shiftKey && e.key === 'ArrowUp') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.maximize(windowManager.activeWindowId);
      }
    }

    // Alt+Tab — Cycle windows
    if (e.altKey && e.key === 'Tab') {
      e.preventDefault();
      cycleWindows();
    }

    // Cmd+` — Cycle between windows of same app
    if (meta && e.key === '`') {
      e.preventDefault();
      cycleWindows();
    }

    // === Screenshots ===
    // Cmd+Shift+3 — Screenshot (full desktop)
    if (meta && e.shiftKey && e.key === '3') {
      e.preventDefault();
      eventBus.emit('screenshot:take', 'full');
    }

    // Cmd+Shift+4 — Screenshot (selection) placeholder
    if (meta && e.shiftKey && e.key === '4') {
      e.preventDefault();
      eventBus.emit('screenshot:take', 'selection');
    }

    // === System ===
    // Cmd+L — Lock screen
    if (meta && e.key === 'l' && !inWindowContent) {
      e.preventDefault();
      eventBus.emit('system:lock');
    }

    // Cmd+Q — Quit app (close all windows of active app)
    if (meta && e.key === 'q') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.close(windowManager.activeWindowId);
      }
    }
  });
}

function snapWindow(windowId, side) {
  const winEl = document.getElementById(windowId);
  if (!winEl) return;

  const menubarH = 28;
  const dockH = 70;
  const sw = window.innerWidth;
  const sh = window.innerHeight - menubarH - dockH;

  if (side === 'left') {
    winEl.style.left = '0px';
    winEl.style.top = menubarH + 'px';
    winEl.style.width = (sw / 2) + 'px';
    winEl.style.height = sh + 'px';
  } else if (side === 'right') {
    winEl.style.left = (sw / 2) + 'px';
    winEl.style.top = menubarH + 'px';
    winEl.style.width = (sw / 2) + 'px';
    winEl.style.height = sh + 'px';
  }
}

function cycleWindows() {
  const windows = Array.from(windowManager.windows.entries())
    .filter(([id, s]) => !s.minimized)
    .map(([id]) => id);

  if (windows.length < 2) return;

  const currentIdx = windows.indexOf(windowManager.activeWindowId);
  const nextIdx = (currentIdx + 1) % windows.length;
  windowManager.focus(windows[nextIdx]);
}
