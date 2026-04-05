// NOVA OS — Virtual Desktops (Spaces)
// Multiple desktop workspaces. Switch with Ctrl+Left/Right or via the indicator.
// Windows belong to a space; switching spaces hides/shows their windows.

import { windowManager } from '../kernel/window-manager.js';
import { eventBus } from '../kernel/event-bus.js';

const MAX_SPACES = 4;
let spaces = [];          // [{ id, name, windowIds: Set }]
let currentSpace = 0;
let indicator = null;

export function initSpaces() {
  // Initial space 1 — all existing windows live here
  spaces = [{ id: 0, name: 'Desktop 1', windowIds: new Set() }];
  for (const [id] of windowManager.windows) spaces[0].windowIds.add(id);

  // Track new windows — they join the current space
  eventBus.on('window:created', ({ id }) => {
    spaces[currentSpace]?.windowIds.add(id);
  });
  eventBus.on('window:closed', ({ id }) => {
    spaces.forEach(s => s.windowIds.delete(id));
  });

  // Shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Right / Ctrl+Left — switch spaces
    if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      if (e.key === 'ArrowRight') { e.preventDefault(); switchSpace(currentSpace + 1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); switchSpace(currentSpace - 1); }
    }
    // Ctrl+1..4 — jump to a specific space
    if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < spaces.length) switchSpace(idx);
    }
  });

  createIndicator();
}

function switchSpace(targetIdx) {
  // Create new space if going beyond the last
  if (targetIdx >= spaces.length && spaces.length < MAX_SPACES) {
    spaces.push({ id: spaces.length, name: `Desktop ${spaces.length + 1}`, windowIds: new Set() });
  }

  if (targetIdx < 0 || targetIdx >= spaces.length || targetIdx === currentSpace) return;

  const direction = targetIdx > currentSpace ? 1 : -1;
  const oldSpace = spaces[currentSpace];
  const newSpace = spaces[targetIdx];

  // Hide windows from old space
  oldSpace.windowIds.forEach(id => {
    const state = windowManager.windows.get(id);
    if (state) {
      state.el.style.transition = `transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)`;
      state.el.style.transform = `translateX(${-direction * window.innerWidth}px)`;
    }
  });

  setTimeout(() => {
    // Hide old, show new
    oldSpace.windowIds.forEach(id => {
      const state = windowManager.windows.get(id);
      if (state) state.el.style.display = 'none';
    });

    newSpace.windowIds.forEach(id => {
      const state = windowManager.windows.get(id);
      if (state && !state.minimized) {
        state.el.style.display = '';
        state.el.style.transform = `translateX(${direction * window.innerWidth}px)`;
        requestAnimationFrame(() => {
          state.el.style.transform = 'translateX(0)';
        });
      }
    });
  }, 350);

  setTimeout(() => {
    // Clear transforms
    spaces.forEach(s => {
      s.windowIds.forEach(id => {
        const state = windowManager.windows.get(id);
        if (state) {
          state.el.style.transition = '';
          state.el.style.transform = '';
        }
      });
    });
  }, 750);

  currentSpace = targetIdx;
  updateIndicator();
  eventBus.emit('space:changed', { index: currentSpace });
}

function createIndicator() {
  indicator = document.createElement('div');
  indicator.id = 'spaces-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 32px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(30, 30, 36, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px;
    z-index: 9000;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: auto;
  `;

  // Show on hover of top center of screen
  document.addEventListener('mousemove', (e) => {
    const nearTop = e.clientY < 36;
    const nearCenter = Math.abs(e.clientX - window.innerWidth / 2) < 200;
    if (nearTop && nearCenter) {
      indicator.style.opacity = '1';
    } else if (!indicator.matches(':hover')) {
      indicator.style.opacity = '0';
    }
  });

  updateIndicator();
  document.body.appendChild(indicator);
}

function updateIndicator() {
  if (!indicator) return;
  indicator.innerHTML = '';

  for (let i = 0; i < Math.max(spaces.length, 1); i++) {
    const dot = document.createElement('div');
    dot.style.cssText = `
      width: 40px; height: 26px;
      border-radius: 4px;
      background: ${i === currentSpace ? 'var(--accent)' : 'rgba(255,255,255,0.08)'};
      border: 1px solid ${i === currentSpace ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)'};
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      color: white;
      font-family: var(--font);
      font-weight: 500;
      transition: all 0.15s ease;
    `;
    dot.textContent = i + 1;
    dot.addEventListener('click', () => switchSpace(i));
    indicator.appendChild(dot);
  }

  // + button to add new space
  if (spaces.length < MAX_SPACES) {
    const add = document.createElement('div');
    add.style.cssText = `
      width: 26px; height: 26px;
      border-radius: 4px;
      background: rgba(255,255,255,0.04);
      border: 1px dashed rgba(255,255,255,0.15);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: rgba(255,255,255,0.5);
    `;
    add.textContent = '+';
    add.addEventListener('click', () => {
      spaces.push({ id: spaces.length, name: `Desktop ${spaces.length + 1}`, windowIds: new Set() });
      switchSpace(spaces.length - 1);
    });
    indicator.appendChild(add);
  }
}
