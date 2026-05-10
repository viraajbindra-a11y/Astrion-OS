// NOVA OS — App Grid (App Grid Overlay)

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';
import { isToy } from '../kernel/app-categories.js';
// 2026-05-09 round 2 — toys you actually play surface first (#19).
// Pure cosmetic ordering, no removal.
import { rankToys } from '../kernel/spotlight-defaults.js';

let isOpen = false;
let toysFolderOpen = false;
// 2026-05-11: pin the escape-key listener at module scope so close() can
// always find and remove it. Previously close(escHandler) only got the
// handler when called from the click-outside or escape paths; F4 → F4
// (open via toggle, then close via toggle) leaked one keydown listener
// per open/close cycle because toggle() called close() with no arg.
let activeEscHandler = null;

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
  toysFolderOpen = false;
  const el = document.createElement('div');
  el.id = 'launchpad';

  const apps = processManager.getAllApps();
  const realApps = apps.filter(a => !isToy(a.id));
  const toyApps = apps.filter(a => isToy(a.id));

  const searchInput = document.createElement('input');
  searchInput.className = 'launchpad-search';
  searchInput.placeholder = 'Search apps...';
  searchInput.type = 'text';

  el.appendChild(searchInput);

  const grid = document.createElement('div');
  grid.className = 'launchpad-grid';

  function appTileHtml(app) {
    return `
      <div class="launchpad-app-icon">
        <img src="assets/icons/${app.id}.svg" alt="${app.name}" draggable="false" style="width:100%;height:100%;border-radius:15px;object-fit:cover;">
      </div>
      <div class="launchpad-app-name">${app.name}</div>
    `;
  }

  function renderApps(filter = '') {
    grid.innerHTML = '';
    const filterLower = filter.toLowerCase();

    if (filter) {
      // When searching, flatten everything — toys included — so users can find
      // them. Real apps come first so the search bias matches the folder layout.
      const matchedReal = realApps.filter(a => a.name.toLowerCase().includes(filterLower));
      const matchedToys = toyApps.filter(a => a.name.toLowerCase().includes(filterLower));

      [...matchedReal, ...matchedToys].forEach(app => {
        const appEl = document.createElement('div');
        appEl.className = 'launchpad-app';
        appEl.innerHTML = appTileHtml(app);
        appEl.addEventListener('click', () => {
          processManager.launch(app.id);
          close();
        });
        grid.appendChild(appEl);
      });
      return;
    }

    if (toysFolderOpen) {
      // Folder-open view: a back tile + every toy. Usage-ordered so
      // the toys you actually play are at the front (#19).
      const back = document.createElement('div');
      back.className = 'launchpad-app';
      back.title = 'Back to apps';
      back.innerHTML = `
        <div class="launchpad-app-icon" style="background:linear-gradient(145deg,#444,#222);display:flex;align-items:center;justify-content:center;font-size:48px;color:rgba(255,255,255,0.85);">&larr;</div>
        <div class="launchpad-app-name">Back</div>
      `;
      back.addEventListener('click', () => {
        toysFolderOpen = false;
        renderApps('');
      });
      grid.appendChild(back);

      const orderedToys = rankToys(toyApps);
      orderedToys.forEach(app => {
        const appEl = document.createElement('div');
        appEl.className = 'launchpad-app';
        appEl.innerHTML = appTileHtml(app);
        appEl.addEventListener('click', () => {
          processManager.launch(app.id);
          close();
        });
        grid.appendChild(appEl);
      });
      return;
    }

    // Default view: real apps, then a single Toys folder tile.
    realApps.forEach(app => {
      const appEl = document.createElement('div');
      appEl.className = 'launchpad-app';
      appEl.innerHTML = appTileHtml(app);
      appEl.addEventListener('click', () => {
        processManager.launch(app.id);
        close();
      });
      grid.appendChild(appEl);
    });

    if (toyApps.length > 0) {
      const folder = document.createElement('div');
      folder.className = 'launchpad-app launchpad-folder';
      folder.title = 'Toys';
      // Mini grid of up to four toy icons inside the folder tile, like macOS folders.
      const previews = toyApps.slice(0, 4).map(t =>
        `<img src="assets/icons/${t.id}.svg" alt="" draggable="false" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">`
      ).join('');
      folder.innerHTML = `
        <div class="launchpad-app-icon" style="background:rgba(255,255,255,0.08);backdrop-filter:blur(10px);display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:8px;box-sizing:border-box;align-items:center;justify-items:center;">
          ${previews}
        </div>
        <div class="launchpad-app-name">Toys</div>
      `;
      folder.addEventListener('click', () => {
        toysFolderOpen = true;
        renderApps('');
      });
      grid.appendChild(folder);
    }
  }

  searchInput.addEventListener('input', () => renderApps(searchInput.value));

  el.appendChild(grid);
  renderApps();

  // Click background to close
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });

  // Escape closes the toys folder if open, otherwise closes Launchpad.
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      if (toysFolderOpen) {
        toysFolderOpen = false;
        renderApps(searchInput.value);
        return;
      }
      close();
    }
  };
  // Defensive: clear any prior handler before registering a new one.
  // open() shouldn't be reachable while isOpen is true, but if it is
  // (e.g. an event-bus race), this prevents listener accumulation.
  if (activeEscHandler) document.removeEventListener('keydown', activeEscHandler);
  activeEscHandler = escHandler;
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
  if (activeEscHandler) {
    document.removeEventListener('keydown', activeEscHandler);
    activeEscHandler = null;
  }
  isOpen = false;
  toysFolderOpen = false;
}
