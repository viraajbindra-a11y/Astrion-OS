// NOVA OS — Dock

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';

const dockApps = [
  { id: 'finder', name: 'Finder', icon: '\uD83D\uDCC2', iconClass: 'dock-icon-finder' },
  { id: 'browser', name: 'Browser', icon: '\uD83C\uDF10', iconClass: 'dock-icon-browser' },
  { id: 'notes', name: 'Notes', icon: '\uD83D\uDCDD', iconClass: 'dock-icon-notes' },
  { id: 'text-editor', name: 'Text Editor', icon: '\uD83D\uDCBB', iconClass: 'dock-icon-texteditor' },
  { id: 'terminal', name: 'Terminal', icon: '>_', iconClass: 'dock-icon-terminal' },
  { id: 'music', name: 'Music', icon: '\uD83C\uDFB5', iconClass: 'dock-icon-music' },
  { id: 'calendar', name: 'Calendar', icon: '\uD83D\uDCC5', iconClass: 'dock-icon-calendar' },
  { id: 'calculator', name: 'Calculator', icon: '\uD83D\uDDA9', iconClass: 'dock-icon-calculator' },
  { id: 'photos', name: 'Photos', icon: '\uD83D\uDDBC\uFE0F', iconClass: 'dock-icon-photos' },
  { id: 'draw', name: 'Draw', icon: '\uD83C\uDFA8', iconClass: 'dock-icon-draw' },
  { id: 'appstore', name: 'App Store', icon: '\uD83D\uDECD\uFE0F', iconClass: 'dock-icon-appstore' },
  { id: 'settings', name: 'Settings', icon: '\u2699\uFE0F', iconClass: 'dock-icon-settings' },
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
      <div class="dock-item-icon ${app.iconClass}">${app.icon}</div>
      <div class="dock-item-dot"></div>
    `;

    item.addEventListener('click', () => {
      // Bounce animation
      item.classList.add('bouncing');
      setTimeout(() => item.classList.remove('bouncing'), 600);

      processManager.launch(app.id);
    });

    container.appendChild(item);
  });

  // Update running indicators
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
