// NOVA OS — Overview
// Press F3 or swipe up with 3 fingers (or click menu item) to see all open
// windows tiled in a grid. Click one to focus it. Press Esc / F3 again to exit.

import { windowManager } from '../kernel/window-manager.js';
import { eventBus } from '../kernel/event-bus.js';

let isActive = false;
let overlay = null;
let originalStates = new Map();

export function initMissionControl() {
  // Listen for F3 / Ctrl+Up to trigger
  document.addEventListener('keydown', (e) => {
    // F3
    if (e.key === 'F3') {
      e.preventDefault();
      toggleMissionControl();
    }
    // Ctrl+Arrow Up
    if (e.ctrlKey && e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleMissionControl();
    }
    // Esc to exit
    if (isActive && e.key === 'Escape') {
      e.preventDefault();
      exitMissionControl();
    }
  });

  eventBus.on('mission-control:toggle', toggleMissionControl);
}

export function toggleMissionControl() {
  if (isActive) exitMissionControl();
  else enterMissionControl();
}

function enterMissionControl() {
  const windows = [...windowManager.windows.values()].filter(w => !w.minimized);
  if (windows.length === 0) return;

  isActive = true;
  originalStates.clear();

  // Capture current styles
  windows.forEach(state => {
    const el = state.el;
    originalStates.set(state.id, {
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
      transform: el.style.transform,
      zIndex: el.style.zIndex,
    });
  });

  // Create overlay backdrop
  overlay = document.createElement('div');
  overlay.id = 'mission-control-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 20, 0.55);
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    z-index: 8;
    animation: mcFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  `;
  document.getElementById('desktop').appendChild(overlay);

  // Add styles
  if (!document.getElementById('mc-styles')) {
    const style = document.createElement('style');
    style.id = 'mc-styles';
    style.textContent = `
      @keyframes mcFadeIn {
        from { opacity: 0; backdrop-filter: blur(0px); }
        to { opacity: 1; backdrop-filter: blur(30px); }
      }
      .window.mc-tile {
        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
        cursor: pointer;
      }
      .window.mc-tile:hover {
        outline: 3px solid rgba(255, 255, 255, 0.5);
        outline-offset: 4px;
      }
      .window.mc-tile.mc-selected {
        outline: 3px solid var(--accent);
        outline-offset: 4px;
      }
      #mission-control-hint {
        position: fixed;
        bottom: 110px;
        left: 50%;
        transform: translateX(-50%);
        color: rgba(255, 255, 255, 0.6);
        font-size: 13px;
        font-family: var(--font);
        z-index: 99999;
        pointer-events: none;
        animation: mcFadeIn 0.4s ease;
      }
    `;
    document.head.appendChild(style);
  }

  // Layout windows in a grid
  const menuH = 60;
  const dockH = 110;
  const gutter = 40;
  const availW = window.innerWidth - gutter * 2;
  const availH = window.innerHeight - menuH - dockH - gutter * 2;

  const n = windows.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const tileW = (availW - (cols - 1) * gutter) / cols;
  const tileH = (availH - (rows - 1) * gutter) / rows;

  windows.forEach((state, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const el = state.el;

    const targetX = gutter + col * (tileW + gutter);
    const targetY = menuH + gutter + row * (tileH + gutter);

    // Scale to fit while preserving aspect ratio
    const origW = el.offsetWidth;
    const origH = el.offsetHeight;
    const scaleX = tileW / origW;
    const scaleY = tileH / origH;
    const scale = Math.min(scaleX, scaleY, 1);
    const scaledW = origW * scale;
    const scaledH = origH * scale;

    // Center inside its cell
    const cellX = targetX + (tileW - scaledW) / 2;
    const cellY = targetY + (tileH - scaledH) / 2;

    el.classList.add('mc-tile');
    el.style.zIndex = '1000';
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${cellX - parseFloat(el.style.left || 0)}px, ${cellY - parseFloat(el.style.top || 0)}px) scale(${scale})`;

    // Click to focus
    el.addEventListener('click', onTileClick);
  });

  // Hint text
  const hint = document.createElement('div');
  hint.id = 'mission-control-hint';
  hint.textContent = 'Click a window to focus · Press Esc or F3 to exit';
  document.body.appendChild(hint);

  // Click background to exit
  overlay.addEventListener('click', exitMissionControl);
}

function onTileClick(e) {
  e.stopPropagation();
  const el = e.currentTarget;
  const id = el.dataset.windowId;
  exitMissionControl(() => {
    if (id) windowManager.focus(id);
  });
}

function exitMissionControl(afterFn) {
  if (!isActive) return;
  isActive = false;

  // Restore window positions
  for (const [id, orig] of originalStates) {
    const state = windowManager.windows.get(id);
    if (!state) continue;
    const el = state.el;
    el.style.transform = '';
    el.style.zIndex = orig.zIndex;
    el.classList.remove('mc-tile', 'mc-selected');
    el.removeEventListener('click', onTileClick);
  }

  if (overlay) {
    overlay.style.animation = 'mcFadeIn 0.3s reverse forwards';
    setTimeout(() => { overlay?.remove(); overlay = null; }, 300);
  }

  const hint = document.getElementById('mission-control-hint');
  if (hint) hint.remove();

  if (afterFn) setTimeout(afterFn, 100);
}
