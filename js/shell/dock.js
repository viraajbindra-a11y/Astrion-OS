// Astrion OS — Dock
//
// User-controlled dock with persistent pinning, drag-reorder, right-
// click context menu, and App Store install hook. Replaces the old
// hardcoded `dockApps` constant — what shows up in the dock now lives
// in localStorage['astrion-dock-pinned-v1'] and the user controls it.
//
// Default pinned set (first-boot users) = the 16 essentials. Existing
// users get the same set on first migrate. Add/remove/reorder is real
// data, persisted, and visible across reloads.

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';
import { eventBus } from '../kernel/event-bus.js';
import { loadGeneratedApps } from '../kernel/generated-app-loader.js';
import { notifications } from '../kernel/notifications.js';

const PINNED_KEY = 'astrion-dock-pinned-v1';

// Default pinned apps for new users + the migration baseline.
// Source tag distinguishes built-ins from installed/generated for the
// optional badge UI; keeps every pin in one ordered list.
const DEFAULT_PINNED = [
  { id: 'finder',      source: 'builtin' },
  { id: 'browser',     source: 'builtin' },
  { id: 'notes',       source: 'builtin' },
  { id: 'terminal',    source: 'builtin' },
  { id: 'messages',    source: 'builtin' },
  { id: 'music',       source: 'builtin' },
  { id: 'photos',      source: 'builtin' },
  { id: 'calendar',    source: 'builtin' },
  { id: 'calculator',  source: 'builtin' },
  { id: 'weather',     source: 'builtin' },
  { id: 'maps',        source: 'builtin' },
  { id: 'beat-studio', source: 'builtin' },
  { id: 'vault',       source: 'builtin' },
  { id: 'appstore',    source: 'builtin' },
  { id: 'settings',    source: 'builtin' },
  { id: 'trash',       source: 'builtin' },
];

// Track auto-pin behavior for App Store installs. After the first 3
// installs we switch to "ask each time"; gives new users a working
// dock without overwhelming long-time users.
const AUTOPIN_THRESHOLD = 3;
const INSTALL_COUNTER_KEY = 'astrion-dock-install-counter';

// ─── Persistence ───────────────────────────────────────

function loadPinned() {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(x => x && typeof x.id === 'string')) {
        return parsed;
      }
    }
  } catch {}
  // First-boot or corrupted: seed with defaults.
  const init = [...DEFAULT_PINNED];
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(init)); } catch {}
  return init;
}

function savePinned(list) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(list)); } catch {}
}

function readInstallCounter() {
  try {
    const n = parseInt(localStorage.getItem(INSTALL_COUNTER_KEY) || '0', 10);
    return isFinite(n) ? n : 0;
  } catch { return 0; }
}
function bumpInstallCounter() {
  const n = readInstallCounter() + 1;
  try { localStorage.setItem(INSTALL_COUNTER_KEY, String(n)); } catch {}
  return n;
}

// ─── Pin operations ────────────────────────────────────

function pinApp(id, source = 'builtin') {
  const list = loadPinned();
  if (list.some(x => x.id === id)) return false;
  list.push({ id, source });
  savePinned(list);
  redrawDock();
  return true;
}

function unpinApp(id) {
  const list = loadPinned().filter(x => x.id !== id);
  savePinned(list);
  redrawDock();
}

function reorderPin(id, targetIndex) {
  const list = loadPinned();
  const item = list.find(x => x.id === id);
  if (!item) return;
  const filtered = list.filter(x => x.id !== id);
  const safeIndex = Math.max(0, Math.min(filtered.length, targetIndex));
  filtered.splice(safeIndex, 0, item);
  savePinned(filtered);
  redrawDock();
}

function isPinned(id) {
  return loadPinned().some(x => x.id === id);
}

// ─── Rendering ─────────────────────────────────────────

let dockContainer = null;

function renderDockItem(container, app) {
  const item = document.createElement('div');
  item.className = 'dock-item';
  if (app.source === 'generated') item.classList.add('dock-item-generated');
  if (app.source === 'installed') item.classList.add('dock-item-installed');
  item.dataset.appId = app.id;
  item.dataset.source = app.source || 'builtin';
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `Open ${app.name}`);
  item.setAttribute('tabindex', '0');
  item.setAttribute('draggable', 'true');

  const iconHtml = (app.source === 'generated' || app.source === 'installed')
    ? `<div style="font-size:34px;line-height:1;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">${app.iconText || app.icon || '✨'}</div>`
    : `<img src="assets/icons/${app.id === 'text-editor' ? 'text-editor' : app.id}.svg" alt="${app.name}" draggable="false">`;

  item.innerHTML = `
    <div class="dock-item-tooltip">${app.name}</div>
    <div class="dock-item-icon">${iconHtml}</div>
    <div class="dock-item-dot"></div>
  `;

  const launchApp = () => {
    item.classList.add('bouncing');
    setTimeout(() => item.classList.remove('bouncing'), 600);
    processManager.launch(app.id);
  };

  item.addEventListener('click', launchApp);
  item.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
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
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showDockContextMenu(app, e.clientX, e.clientY);
  });

  // Drag to reorder. dataTransfer carries the app id; on drop we
  // compute the target index from where the cursor is in the dock.
  item.addEventListener('dragstart', (e) => {
    item.classList.add('dock-item-dragging');
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/astrion-app', app.id);
    } catch {}
  });
  item.addEventListener('dragend', () => {
    item.classList.remove('dock-item-dragging');
    container.querySelectorAll('.dock-item-drop-before, .dock-item-drop-after')
      .forEach(el => el.classList.remove('dock-item-drop-before', 'dock-item-drop-after'));
  });

  container.appendChild(item);
}

async function appendGeneratedApps(container) {
  let entries = [];
  try { entries = await loadGeneratedApps(); }
  catch (err) { console.warn('[dock] loadGeneratedApps failed:', err?.message); return; }
  // Generated apps live AFTER pinned items, in their own implicit slot.
  // Don't double-render if any are also explicitly pinned.
  const pinnedSet = new Set(loadPinned().map(x => x.id));
  for (const entry of entries) {
    if (pinnedSet.has(entry.id)) continue;
    renderDockItem(container, {
      id: entry.id,
      name: entry.name,
      iconText: entry.iconText,
      source: 'generated',
    });
  }
}

function redrawDock() {
  if (!dockContainer) return;
  dockContainer.innerHTML = '';
  const pinned = loadPinned();
  for (const pin of pinned) {
    // Resolve pin → app definition. processManager has the registered
    // app metadata; if it's not registered (uninstalled), skip silently.
    const def = processManager.getAppDefinition?.(pin.id) || null;
    const fallbackName = pin.id.charAt(0).toUpperCase() + pin.id.slice(1).replace(/-/g, ' ');
    if (!def && pin.source === 'builtin') {
      // Built-ins are expected to register at boot; if missing,
      // assume not yet ready and render anyway (icon path is static).
      renderDockItem(dockContainer, {
        id: pin.id,
        name: fallbackName,
        source: 'builtin',
      });
      continue;
    }
    if (!def) continue; // installed/generated app gone — skip
    renderDockItem(dockContainer, {
      id: pin.id,
      name: def.name || fallbackName,
      icon: def.icon,
      iconText: def.icon,
      source: pin.source || 'builtin',
    });
  }
  appendGeneratedApps(dockContainer);
  updateRunningDots();
}

// ─── Context menu ──────────────────────────────────────

let activeMenu = null;

function showDockContextMenu(app, x, y) {
  closeContextMenu();
  const pinned = isPinned(app.id);
  const isRunning = processManager.isRunning(app.id);

  const menu = document.createElement('div');
  menu.className = 'dock-menu';
  menu.style.cssText = `
    position: fixed; z-index: 9999;
    background: rgba(28, 28, 38, 0.96);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    min-width: 200px;
    font-family: var(--font, -apple-system, system-ui, sans-serif);
    font-size: 12px;
    color: white;
  `;

  const items = [
    { label: 'Open', click: () => processManager.launch(app.id) },
  ];
  if (isRunning) {
    items.push({ label: 'Close all windows', click: () => {
      for (const [id, state] of windowManager.windows) {
        if (state.app === app.id) windowManager.close(id);
      }
    }});
  }
  items.push({ divider: true });
  if (pinned) {
    items.push({ label: 'Unpin from Dock', click: () => unpinApp(app.id) });
  } else {
    items.push({ label: 'Pin to Dock', click: () => pinApp(app.id, app.source || 'installed') });
  }
  items.push({ divider: true });
  items.push({ label: 'Show in Launchpad', click: () => eventBus.emit('launchpad:toggle') });

  for (const it of items) {
    if (it.divider) {
      const hr = document.createElement('div');
      hr.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08); margin:4px 0;';
      menu.appendChild(hr);
      continue;
    }
    const btn = document.createElement('button');
    btn.textContent = it.label;
    btn.style.cssText = `
      display: block; width: 100%; padding: 7px 12px;
      background: transparent; border: none; color: white;
      font-size: 12px; text-align: left; cursor: pointer;
      border-radius: 5px; font-family: inherit;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(90,200,250,0.15)';
      btn.style.color = '#5ac8fa';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
      btn.style.color = 'white';
    });
    btn.addEventListener('click', () => {
      closeContextMenu();
      try { it.click(); } catch (err) { console.warn('[dock] menu action failed:', err); }
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  activeMenu = menu;

  // Position after appending so we can read the rendered size.
  const rect = menu.getBoundingClientRect();
  const mx = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
  const my = Math.min(Math.max(8, y - rect.height - 8), window.innerHeight - rect.height - 8);
  menu.style.left = mx + 'px';
  menu.style.top = my + 'px';

  // Close on outside click / Esc.
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick, { once: true });
    document.addEventListener('keydown', onEscClose);
  }, 0);
}

function onOutsideClick(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeContextMenu();
}
function onEscClose(e) {
  if (e.key === 'Escape') closeContextMenu();
}
function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  document.removeEventListener('keydown', onEscClose);
}

// ─── Drag-and-drop reorder ─────────────────────────────

function setupDragDrop(container) {
  container.addEventListener('dragover', (e) => {
    // Only handle our own drag payload.
    const payload = e.dataTransfer && (
      Array.from(e.dataTransfer.types || []).includes('text/astrion-app')
    );
    if (!payload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const target = e.target.closest?.('.dock-item');
    container.querySelectorAll('.dock-item-drop-before, .dock-item-drop-after')
      .forEach(el => el.classList.remove('dock-item-drop-before', 'dock-item-drop-after'));
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    target.classList.add(before ? 'dock-item-drop-before' : 'dock-item-drop-after');
  });

  container.addEventListener('drop', (e) => {
    let appId = '';
    try { appId = e.dataTransfer.getData('text/astrion-app') || ''; } catch {}
    if (!appId) return;
    e.preventDefault();

    const target = e.target.closest?.('.dock-item');
    container.querySelectorAll('.dock-item-drop-before, .dock-item-drop-after')
      .forEach(el => el.classList.remove('dock-item-drop-before', 'dock-item-drop-after'));

    // Compute target index in the pinned list.
    const list = loadPinned();
    const all = [...container.querySelectorAll('.dock-item[data-source="builtin"], .dock-item[data-source="installed"]')];
    let targetIndex = list.length; // append by default
    if (target) {
      const targetId = target.dataset.appId;
      const baseIdx = list.findIndex(x => x.id === targetId);
      if (baseIdx >= 0) {
        const rect = target.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;
        targetIndex = before ? baseIdx : baseIdx + 1;
      }
    }
    // Only reorder if the dragged app is actually pinned. If user
    // dragged a generated app (not pinned), pin it at the target
    // position automatically (drag = pin gesture).
    if (list.some(x => x.id === appId)) {
      reorderPin(appId, targetIndex);
    } else {
      const def = processManager.getAppDefinition?.(appId);
      const source = def ? 'installed' : 'builtin';
      const next = [...list];
      next.splice(targetIndex, 0, { id: appId, source });
      savePinned(next);
      redrawDock();
    }
  });
}

// ─── Init ──────────────────────────────────────────────

export function initDock() {
  dockContainer = document.getElementById('dock-container');
  dockContainer.innerHTML = '';
  dockContainer.setAttribute('role', 'toolbar');
  dockContainer.setAttribute('aria-label', 'App dock');

  redrawDock();
  setupDragDrop(dockContainer);

  eventBus.on('dock:reload', redrawDock);
  eventBus.on('app:launched', updateRunningDots);
  eventBus.on('app:terminated', updateRunningDots);
  eventBus.on('window:closed', () => setTimeout(updateRunningDots, 200));

  // App Store install hook — the first few installs auto-pin so new
  // users build a useful dock fast; after the threshold, prompt with
  // a notification action.
  eventBus.on('app:installed', ({ appId, name, icon }) => {
    if (!appId) return;
    const count = bumpInstallCounter();
    if (count <= AUTOPIN_THRESHOLD) {
      pinApp(appId, 'installed');
      notifications.show({
        title: `${name || appId} added to Dock`,
        body: 'Right-click the icon to unpin.',
        icon: icon || '✨',
        duration: 3500,
      });
    } else {
      notifications.show({
        title: `${name || appId} installed`,
        body: 'Open it from Search or Launchpad.',
        icon: icon || '✨',
        duration: 5000,
        actions: [
          { label: 'Pin to Dock', onClick: () => pinApp(appId, 'installed') },
        ],
      });
    }
  });

  // Public API for other UI surfaces (Spotlight, Launchpad, App Store
  // detail view) to manage pinning.
  eventBus.on('dock:pin',   ({ appId, source }) => pinApp(appId, source));
  eventBus.on('dock:unpin', ({ appId })         => unpinApp(appId));

  // ─── Dock Badges (notification counts) ───
  eventBus.on('dock:badge', ({ appId, count }) => {
    const item = dockContainer.querySelector(`.dock-item[data-app-id="${appId}"]`);
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

  setupDockMagnification(dockContainer);
}

function setupDockMagnification(container) {
  const MAX_SCALE = 1.5;
  const FALLOFF = 140;
  container.addEventListener('mousemove', (e) => {
    const items = container.querySelectorAll('.dock-item');
    items.forEach(item => {
      // Don't magnify a dragging item — the drag preview handles it.
      if (item.classList.contains('dock-item-dragging')) return;
      const rect = item.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(e.clientX - center);
      if (distance > FALLOFF) {
        item.style.transform = 'scale(1)';
        return;
      }
      const t = 1 - distance / FALLOFF;
      const scale = 1 + (MAX_SCALE - 1) * t * t;
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

// ─── Public API exports — for scripted pinning, settings UIs, etc.

export const dockApi = {
  pin: pinApp,
  unpin: unpinApp,
  reorder: reorderPin,
  isPinned,
  list: loadPinned,
};
