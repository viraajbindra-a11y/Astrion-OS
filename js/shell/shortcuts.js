// NOVA OS — Global Keyboard Shortcuts

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';
import { eventBus } from '../kernel/event-bus.js';

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;

    // Cmd+N — New Finder window
    if (meta && e.key === 'n' && !e.target.closest('.window-content')) {
      e.preventDefault();
      processManager.launch('finder');
    }

    // Cmd+T — New Terminal
    if (meta && e.key === 't' && !e.target.closest('.window-content')) {
      e.preventDefault();
      processManager.launch('terminal');
    }

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

    // Cmd+, — Open Settings
    if (meta && e.key === ',') {
      e.preventDefault();
      processManager.launch('settings');
    }

    // F11 — Fullscreen toggle (maximize active window)
    if (e.key === 'F11') {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.maximize(windowManager.activeWindowId);
      }
    }
  });
}
