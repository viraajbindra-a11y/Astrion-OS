// NOVA OS — Dock

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';
import { eventBus } from '../kernel/event-bus.js';

// Core apps in dock — rest accessible via App Grid (F4) or Search (Cmd+Space)
const dockApps = [
  { id: 'finder', name: 'Finder' },
  { id: 'browser', name: 'Browser' },
  { id: 'notes', name: 'Notes' },
  { id: 'terminal', name: 'Terminal' },
  { id: 'messages', name: 'Messages' },
  { id: 'music', name: 'Music' },
  { id: 'photos', name: 'Photos' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'calculator', name: 'Calculator' },
  { id: 'weather', name: 'Weather' },
  { id: 'maps', name: 'Maps' },
  { id: 'beat-studio', name: 'Beat Studio' },
  { id: 'vault', name: 'Vault' },
  { id: 'appstore', name: 'App Store' },
  { id: 'settings', name: 'Settings' },
  { id: 'trash', name: 'Trash' },
];

export function initDock() {
  const container = document.getElementById('dock-container');
  container.innerHTML = '';
  container.setAttribute('role', 'toolbar');
  container.setAttribute('aria-label', 'App dock');

  dockApps.forEach(app => {
    const item = document.createElement('div');
    item.className = 'dock-item';
    item.dataset.appId = app.id;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `Open ${app.name}`);
    item.setAttribute('tabindex', '0');
    item.innerHTML = `
      <div class="dock-item-tooltip">${app.name}</div>
      <div class="dock-item-icon">
        <img src="assets/icons/${app.id === 'text-editor' ? 'text-editor' : app.id}.svg" alt="${app.name}" draggable="false">
      </div>
      <div class="dock-item-dot"></div>
    `;

    const launchApp = () => {
      item.classList.add('bouncing');
      setTimeout(() => item.classList.remove('bouncing'), 600);
      processManager.launch(app.id);
    };

    item.addEventListener('click', launchApp);
    // Middle-click to close all windows of this app
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) { // middle click
        e.preventDefault();
        for (const [id, state] of windowManager.windows) {
          if (state.app === app.id) windowManager.close(id);
        }
      }
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        launchApp();
      }
    });

    container.appendChild(item);
  });

  eventBus.on('app:launched', updateRunningDots);
  eventBus.on('app:terminated', updateRunningDots);
  eventBus.on('window:closed', () => setTimeout(updateRunningDots, 200));

  // ─── Dock Badges (notification counts) ───
  // Apps can emit dock:badge to show a count on their dock icon.
  // Example: eventBus.emit('dock:badge', { appId: 'messages', count: 3 })
  eventBus.on('dock:badge', ({ appId, count }) => {
    const item = container.querySelector(`.dock-item[data-app-id="${appId}"]`);
    if (!item) return;
    let badge = item.querySelector('.dock-badge');
    if (count <= 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'dock-badge';
      badge.style.cssText = `
        position:absolute; top:-2px; right:-2px; min-width:16px; height:16px;
        background:#ff3b30; color:white; font-size:9px; font-weight:700;
        border-radius:8px; display:flex; align-items:center; justify-content:center;
        padding:0 4px; pointer-events:none; font-family:var(--font);
        box-shadow:0 1px 3px rgba(0,0,0,0.4);
      `;
      item.style.position = 'relative';
      item.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
  });

  // ─── Dock Magnification ───
  setupDockMagnification(container);
}

function setupDockMagnification(container) {
  const MAX_SCALE = 1.5;
  const FALLOFF = 140; // px of influence around cursor

  container.addEventListener('mousemove', (e) => {
    const items = container.querySelectorAll('.dock-item');
    items.forEach(item => {
      const rect = item.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(e.clientX - center);

      if (distance > FALLOFF) {
        item.style.transform = 'scale(1)';
        return;
      }
      const t = 1 - distance / FALLOFF;
      const scale = 1 + (MAX_SCALE - 1) * t * t; // quadratic falloff
      item.style.transform = `scale(${scale}) translateY(${-6 * t}px)`;
      item.style.transformOrigin = 'bottom center';
    });
  });

  container.addEventListener('mouseleave', () => {
    container.querySelectorAll('.dock-item').forEach(item => {
      item.style.transform = 'scale(1)';
    });
  });
}

function updateRunningDots() {
  document.querySelectorAll('.dock-item').forEach(item => {
    const appId = item.dataset.appId;
    if (processManager.isRunning(appId)) {
      item.classList.add('running');
    } else {
      item.classList.remove('running');
    }
  });
}
