// NOVA OS — Launchpad (App Grid Overlay)

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';

let isOpen = false;

const appColors = {
  finder: 'linear-gradient(145deg, #1e88e5, #1565c0)',
  browser: 'linear-gradient(145deg, #42a5f5, #1565c0)',
  notes: 'linear-gradient(145deg, #fdd835, #f9a825)',
  'text-editor': 'linear-gradient(145deg, #5c6bc0, #3949ab)',
  terminal: 'linear-gradient(145deg, #212121, #000000)',
  music: 'linear-gradient(145deg, #ec407a, #ad1457)',
  calendar: 'linear-gradient(145deg, #ef5350, #c62828)',
  calculator: 'linear-gradient(145deg, #616161, #424242)',
  draw: 'linear-gradient(145deg, #e53935, #c62828)',
  appstore: 'linear-gradient(145deg, #42a5f5, #1e88e5)',
  settings: 'linear-gradient(145deg, #546e7a, #37474f)',
};

export function initLaunchpad() {
  // F4 or dedicated gesture to open
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F4') {
      e.preventDefault();
      toggle();
    }
  });

  eventBus.on('launchpad:toggle', toggle);
}

function toggle() {
  if (isOpen) close();
  else open();
}

function open() {
  const el = document.createElement('div');
  el.id = 'launchpad';

  const apps = processManager.getAllApps();
  const searchInput = document.createElement('input');
  searchInput.className = 'launchpad-search';
  searchInput.placeholder = 'Search apps...';
  searchInput.type = 'text';

  el.appendChild(searchInput);

  const grid = document.createElement('div');
  grid.className = 'launchpad-grid';

  function renderApps(filter = '') {
    grid.innerHTML = '';
    const filtered = filter
      ? apps.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
      : apps;

    filtered.forEach(app => {
      const appEl = document.createElement('div');
      appEl.className = 'launchpad-app';
      appEl.innerHTML = `
        <div class="launchpad-app-icon" style="background:${appColors[app.id] || 'linear-gradient(145deg,#555,#333)'}">${app.icon}</div>
        <div class="launchpad-app-name">${app.name}</div>
      `;
      appEl.addEventListener('click', () => {
        processManager.launch(app.id);
        close();
      });
      grid.appendChild(appEl);
    });
  }

  searchInput.addEventListener('input', () => renderApps(searchInput.value));

  el.appendChild(grid);
  renderApps();

  // Click background to close
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  // Escape to close
  const escHandler = (e) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  document.getElementById('desktop').appendChild(el);
  searchInput.focus();
  isOpen = true;
}

function close() {
  const el = document.getElementById('launchpad');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 200);
  }
  isOpen = false;
}
