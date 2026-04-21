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

    // Cmd+Shift+P — Toggle mini mode (PiP) for focused window
    if (meta && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.toggleMini(windowManager.activeWindowId);
      }
    }

    // Cmd+Shift+T — Toggle pin-on-top for focused window
    if (meta && e.shiftKey && (e.key === 't' || e.key === 'T') && !e.altKey) {
      e.preventDefault();
      if (windowManager.activeWindowId) {
        windowManager.togglePin(windowManager.activeWindowId);
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

    // Ctrl+Alt+Arrow — Snap to corners (quadrant layout)
    if (e.ctrlKey && e.altKey && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      if (e.shiftKey) {
        // Ctrl+Alt+Shift+Left/Right → bottom corners
        e.preventDefault();
        const zone = e.key === 'ArrowLeft' ? 'bottom-left' : 'bottom-right';
        if (windowManager.activeWindowId) {
          const fakeX = zone.includes('left') ? 0 : window.innerWidth;
          const fakeY = window.innerHeight - 50;
          windowManager._handleSnap(fakeX, fakeY, windowManager.activeWindowId);
        }
      } else if (meta) {
        // Ctrl+Cmd+Left/Right → top corners
        e.preventDefault();
        const fakeX = e.key === 'ArrowLeft' ? 0 : window.innerWidth;
        const fakeY = 30;
        if (windowManager.activeWindowId) {
          windowManager._handleSnap(fakeX, fakeY, windowManager.activeWindowId);
        }
      }
    }

    // Alt+Tab — Cycle windows
    if (e.altKey && e.key === 'Tab') {
      e.preventDefault();
      cycleWindows();
    }

    // Cmd+` — Cycle between windows of SAME app
    if (meta && e.key === '`') {
      e.preventDefault();
      cycleSameAppWindows();
    }

    // Ctrl+Shift+G — Grid tile all open windows
    if (meta && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      tileWindows();
    }

    // Ctrl+Shift+C — Cascade windows
    if (meta && e.shiftKey && (e.key === 'c' || e.key === 'C') && !e.altKey) {
      e.preventDefault();
      cascadeWindows();
    }

    // Ctrl+Shift+D — Toggle dock visibility
    if (meta && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      const dock = document.getElementById('dock');
      if (dock) {
        const isHidden = dock.style.transform === 'translateY(100%)';
        dock.style.transition = 'transform 0.3s cubic-bezier(0.16,1,0.3,1)';
        dock.style.transform = isHidden ? '' : 'translateY(100%)';
        setTimeout(() => { dock.style.transition = ''; }, 350);
      }
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

    // Cmd+Shift+5 — Screen Recorder
    if (meta && e.shiftKey && e.key === '5') {
      e.preventDefault();
      processManager.launch('screen-recorder');
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

/**
 * Tile all open (non-minimized) windows in a grid layout.
 * 1 window = maximize. 2 = side-by-side. 3+ = grid.
 */
function tileWindows() {
  const windows = Array.from(windowManager.windows.entries())
    .filter(([id, s]) => !s.minimized);
  if (windows.length === 0) return;

  const menuH = 28;
  const dockH = 78;
  const sw = window.innerWidth;
  const sh = window.innerHeight - menuH - dockH;
  const gap = 4;

  if (windows.length === 1) {
    // Just maximize
    windowManager.maximize(windows[0][0]);
    return;
  }

  // Calculate grid dimensions
  const cols = Math.ceil(Math.sqrt(windows.length));
  const rows = Math.ceil(windows.length / cols);
  const cellW = Math.floor((sw - gap * (cols + 1)) / cols);
  const cellH = Math.floor((sh - gap * (rows + 1)) / rows);

  windows.forEach(([id, state], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cellW + gap);
    const y = menuH + gap + row * (cellH + gap);

    state.el.style.transition = 'all 0.25s cubic-bezier(0.16,1,0.3,1)';
    Object.assign(state.el.style, {
      left: x + 'px',
      top: y + 'px',
      width: cellW + 'px',
      height: cellH + 'px',
    });
    setTimeout(() => { state.el.style.transition = ''; }, 300);

    // Undo maximized state if set
    if (state.maximized) state.maximized = false;
  });
}

/**
 * Cascade all open windows diagonally from top-left.
 */
function cascadeWindows() {
  const windows = Array.from(windowManager.windows.entries())
    .filter(([id, s]) => !s.minimized);
  if (windows.length === 0) return;

  const menuH = 28;
  const offset = 30;
  const baseW = Math.min(700, window.innerWidth - 200);
  const baseH = Math.min(480, window.innerHeight - 200);

  windows.forEach(([id, state], i) => {
    const x = 40 + i * offset;
    const y = menuH + 20 + i * offset;
    state.el.style.transition = 'all 0.25s cubic-bezier(0.16,1,0.3,1)';
    Object.assign(state.el.style, {
      left: x + 'px', top: y + 'px',
      width: baseW + 'px', height: baseH + 'px',
    });
    state.el.style.zIndex = 100 + i;
    setTimeout(() => { state.el.style.transition = ''; }, 300);
    if (state.maximized) state.maximized = false;
  });
  // Focus the last (topmost) window
  if (windows.length > 0) windowManager.focus(windows[windows.length - 1][0]);
}

function cycleSameAppWindows() {
  const active = windowManager.windows.get(windowManager.activeWindowId);
  if (!active) return;
  const sameApp = Array.from(windowManager.windows.entries())
    .filter(([id, s]) => !s.minimized && s.app === active.app)
    .map(([id]) => id);
  if (sameApp.length < 2) return;
  const currentIdx = sameApp.indexOf(windowManager.activeWindowId);
  const nextIdx = (currentIdx + 1) % sameApp.length;
  windowManager.focus(sameApp[nextIdx]);
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
