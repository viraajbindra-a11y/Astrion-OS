// NOVA OS — Dock

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';

const dockApps = [
  { id: 'finder', name: 'Finder' },
  { id: 'browser', name: 'Browser' },
  { id: 'notes', name: 'Notes' },
  { id: 'text-editor', name: 'Text Editor' },
  { id: 'terminal', name: 'Terminal' },
  { id: 'music', name: 'Music' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'calculator', name: 'Calculator' },
  { id: 'photos', name: 'Photos' },
  { id: 'weather', name: 'Weather' },
  { id: 'clock', name: 'Clock' },
  { id: 'reminders', name: 'Reminders' },
  { id: 'draw', name: 'Draw' },
  { id: 'appstore', name: 'App Store' },
  { id: 'settings', name: 'Settings' },
];

export function initDock() {
  const container = document.getElementById('dock-container');
  container.innerHTML = '';

  dockApps.forEach(app => {
    const item = document.createElement('div');
    item.className = 'dock-item';
    item.dataset.appId = app.id;
    item.innerHTML = `
      <div class="dock-item-tooltip">${app.name}</div>
      <div class="dock-item-icon">
        <img src="assets/icons/${app.id === 'text-editor' ? 'text-editor' : app.id}.svg" alt="${app.name}" draggable="false">
      </div>
      <div class="dock-item-dot"></div>
    `;

    item.addEventListener('click', () => {
      item.classList.add('bouncing');
      setTimeout(() => item.classList.remove('bouncing'), 600);
      processManager.launch(app.id);
    });

    container.appendChild(item);
  });

  eventBus.on('app:launched', updateRunningDots);
  eventBus.on('app:terminated', updateRunningDots);
  eventBus.on('window:closed', () => setTimeout(updateRunningDots, 200));
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
