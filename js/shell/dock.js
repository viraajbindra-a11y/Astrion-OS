// NOVA OS — Dock

import { processManager } from '../kernel/process-manager.js';
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
