// Astrion OS — Window Manager
//
// Polish Sprint Day 5 (2026-04-11): multi-monitor awareness.
//
// getActiveDisplay() returns the bounds of the display that currently
// contains the Astrion window, so new app windows get centered within
// THAT display (instead of falling off a primary monitor when Astrion
// is on a secondary one). Uses the Window Management API
// (window.getScreenDetails, Chromium 100+) when available, with a
// graceful fallback to window.screen + window.innerWidth on everything
// else. The API isn't pre-fetched on boot — that would trigger a
// permission prompt users didn't ask for. Apps that need multi-display
// info call refreshScreenDetails() explicitly.

import { eventBus } from './event-bus.js';

class WindowManager {
  constructor() {
    this.windows = new Map();
    this.topZ = 100;
    this.activeWindowId = null;
    this.container = null;
    this._screenDetails = null;    // lazy-loaded via refreshScreenDetails()
    this._screenDetailsRequested = false;
  }

  init() {
    this.container = document.getElementById('windows-container');

    // Click desktop to deactivate windows (desktop may not exist in native app mode)
    const desktop = document.getElementById('desktop');
    if (desktop) {
      desktop.addEventListener('mousedown', (e) => {
        if (e.target.id === 'desktop' || e.target.id === 'desktop-icons' || e.target.closest('#desktop-icons')) {
          this.deactivateAll();
        }
      });
    }

    // Reflow window positions when the primary display resizes. This
    // doesn't move open windows; it just clamps new window positions
    // going forward.
    window.addEventListener('resize', () => {
      eventBus.emit('display:changed', { screens: this.getAllDisplays() });
    });
  }

  // ---------- multi-monitor API ----------

  // Returns the display bounds for the screen that contains the current
  // Astrion window. Sync; relies on cached screen details if available,
  // otherwise falls back to window.screen / window.innerWidth|Height.
  //
  // Shape: { id, x, y, width, height, dpi, isPrimary, label }
  // Where (x, y) are the absolute top-left of the display's usable area,
  // and (width, height) are the usable dimensions (excluding OS chrome).
  getActiveDisplay() {
    if (this._screenDetails && this._screenDetails.currentScreen) {
      const c = this._screenDetails.currentScreen;
      return {
        id: c.label || 'active',
        x: typeof c.availLeft === 'number' ? c.availLeft : 0,
        y: typeof c.availTop === 'number' ? c.availTop : 0,
        width: c.availWidth || c.width || window.innerWidth,
        height: c.availHeight || c.height || window.innerHeight,
        dpi: (c.devicePixelRatio || window.devicePixelRatio || 1) * 96,
        isPrimary: !!c.isPrimary,
        label: c.label || 'Active display',
      };
    }
    // Fallback: single-display using window.screen
    const s = window.screen || {};
    return {
      id: 'primary',
      x: 0,
      y: 0,
      width: window.innerWidth || s.availWidth || 1280,
      height: window.innerHeight || s.availHeight || 720,
      dpi: (window.devicePixelRatio || 1) * 96,
      isPrimary: true,
      label: 'Primary display',
    };
  }

  // Returns all known displays. If screen details haven't been refreshed,
  // returns a single-element array (primary only). Apps that actually need
  // multi-display info should call refreshScreenDetails() first.
  getAllDisplays() {
    if (this._screenDetails && Array.isArray(this._screenDetails.screens)) {
      return this._screenDetails.screens.map((s, i) => ({
        id: s.label || `screen-${i}`,
        x: typeof s.availLeft === 'number' ? s.availLeft : 0,
        y: typeof s.availTop === 'number' ? s.availTop : 0,
        width: s.availWidth || s.width || 0,
        height: s.availHeight || s.height || 0,
        dpi: (s.devicePixelRatio || 1) * 96,
        isPrimary: !!s.isPrimary,
        label: s.label || `Display ${i + 1}`,
      }));
    }
    return [this.getActiveDisplay()];
  }

  // Async. Requests multi-screen details via the Window Management API.
  // Triggers a user permission prompt the first time it's called in a
  // browsing session. Returns the list of displays, or null if the API
  // is unavailable / permission denied. Caches the result so subsequent
  // calls are free.
  async refreshScreenDetails() {
    if (this._screenDetails) return this.getAllDisplays();
    if (this._screenDetailsRequested) return null;
    this._screenDetailsRequested = true;
    if (typeof window.getScreenDetails !== 'function') {
      // API not available — the fallback getActiveDisplay() handles it
      return null;
    }
    try {
      const details = await window.getScreenDetails();
      this._screenDetails = details;
      // React to hot-plug, monitor arrangement changes, etc.
      if (details.addEventListener) {
        details.addEventListener('screenschange', () => {
          eventBus.emit('display:changed', { screens: this.getAllDisplays() });
        });
        details.addEventListener('currentscreenchange', () => {
          eventBus.emit('display:active-changed', { display: this.getActiveDisplay() });
        });
      }
      eventBus.emit('display:changed', { screens: this.getAllDisplays() });
      return this.getAllDisplays();
    } catch (err) {
      // user denied or API errored — silent fallback to single-display
      console.warn('[window-manager] getScreenDetails unavailable:', err?.message || err);
      return null;
    }
  }

  // Compute the top-left (x, y) for centering a window of the given size
  // within the currently-active display. Respects per-call cascade offset
  // so stacked windows don't pile on the same pixel.
  centerInActiveDisplay(width, height, cascadeOffset = 0) {
    const d = this.getActiveDisplay();
    const x = Math.max(d.x + 50, Math.round(d.x + (d.width - width) / 2 + cascadeOffset));
    const y = Math.max(d.y + 40, Math.round(d.y + (d.height - height) / 3 + cascadeOffset));
    return { x, y };
  }

  create({ id, title, app, x, y, width = 700, height = 480, minWidth = 300, minHeight = 200 }) {
    if (this.windows.has(id)) {
      this.focus(id);
      return this.windows.get(id).el.querySelector('.window-content');
    }

    // Center within the active display if no position given (multi-monitor
    // aware — falls back to viewport on single-display setups).
    if (x === undefined || y === undefined) {
      const centered = this.centerInActiveDisplay(width, height, this.windows.size * 24);
      if (x === undefined) x = centered.x;
      if (y === undefined) y = centered.y;
    }

    const el = document.createElement('div');
    el.className = 'window';
    el.id = `window-${id}`;
    el.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${++this.topZ}`;
    el.dataset.windowId = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', title);

    el.innerHTML = `
      <div class="window-titlebar" data-window="${id}">
        <div class="window-buttons">
          <button class="win-btn close" data-action="close" title="Close" aria-label="Close window"></button>
          <button class="win-btn minimize" data-action="minimize" title="Minimize" aria-label="Minimize window"></button>
          <button class="win-btn maximize" data-action="maximize" title="Maximize" aria-label="Maximize window"></button>
        </div>
        <span class="window-title">${title}</span>
      </div>
      <div class="window-content" id="window-content-${id}"></div>
      <div class="resize-handle resize-t" data-dir="t"></div>
      <div class="resize-handle resize-r" data-dir="r"></div>
      <div class="resize-handle resize-b" data-dir="b"></div>
      <div class="resize-handle resize-tl" data-dir="tl"></div>
      <div class="resize-handle resize-tr" data-dir="tr"></div>
      <div class="resize-handle resize-br" data-dir="br"></div>
      <div class="resize-handle resize-bl" data-dir="bl"></div>
      <div class="resize-handle resize-l" data-dir="l"></div>
    `;

    this.container.appendChild(el);

    const state = {
      id, title, app, el,
      minimized: false,
      maximized: false,
      prevBounds: null,
      minWidth, minHeight,
    };

    this.windows.set(id, state);
    this._setupDrag(el, id);
    this._setupResize(el, id, minWidth, minHeight);
    this._setupButtons(el, id);
    this._setupFocusOnClick(el, id);
    this.focus(id);

    eventBus.emit('window:created', { id, title, app });
    return el.querySelector('.window-content');
  }

  focus(id) {
    const state = this.windows.get(id);
    if (!state) return;

    // Deactivate all
    for (const [wid, w] of this.windows) {
      w.el.classList.remove('active');
      w.el.classList.add('inactive');
    }

    state.el.style.zIndex = ++this.topZ;
    state.el.classList.add('active');
    state.el.classList.remove('inactive');
    this.activeWindowId = id;

    eventBus.emit('window:focused', { id, title: state.title, app: state.app });
  }

  deactivateAll() {
    for (const [wid, w] of this.windows) {
      w.el.classList.remove('active');
      w.el.classList.add('inactive');
    }
    this.activeWindowId = null;
    eventBus.emit('window:focused', { id: null, title: 'Finder', app: 'finder' });
  }

  close(id) {
    const state = this.windows.get(id);
    if (!state) return;

    // Abort any in-progress drag to release pointer capture & clean up
    if (state._abortDrag) state._abortDrag();

    state.el.classList.add('closing');
    setTimeout(() => {
      state.el.remove();
      this.windows.delete(id);
      eventBus.emit('window:closed', { id, app: state.app });

      // Focus next window
      if (this.activeWindowId === id) {
        const remaining = [...this.windows.values()].filter(w => !w.minimized);
        if (remaining.length > 0) {
          remaining.sort((a, b) => (parseInt(b.el.style.zIndex) || 0) - (parseInt(a.el.style.zIndex) || 0));
          this.focus(remaining[0].id);
        } else {
          this.activeWindowId = null;
          eventBus.emit('window:focused', { id: null, title: 'Finder', app: 'finder' });
        }
      }
    }, 180);
  }

  minimize(id) {
    const state = this.windows.get(id);
    if (!state) return;

    const el = state.el;
    // Use genie animation from CSS
    el.style.transformOrigin = 'center bottom';
    el.classList.add('minimizing');

    setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('minimizing');
    }, 400);

    state.minimized = true;
    eventBus.emit('window:minimized', { id });

    // Focus next window
    if (this.activeWindowId === id) {
      const remaining = [...this.windows.values()].filter(w => !w.minimized);
      if (remaining.length > 0) {
        remaining.sort((a, b) => (parseInt(b.el.style.zIndex) || 0) - (parseInt(a.el.style.zIndex) || 0));
        this.focus(remaining[0].id);
      } else {
        this.activeWindowId = null;
        eventBus.emit('window:focused', { id: null, title: 'Finder', app: 'finder' });
      }
    }
  }

  unminimize(id) {
    const state = this.windows.get(id);
    if (!state) return;
    const el = state.el;
    el.style.display = '';
    el.style.transformOrigin = 'center bottom';
    el.classList.add('restoring');

    setTimeout(() => {
      el.classList.remove('restoring');
    }, 350);

    state.minimized = false;
    this.focus(id);
    eventBus.emit('window:unminimized', { id });
  }

  maximize(id) {
    const state = this.windows.get(id);
    if (!state) return;

    if (state.maximized) {
      // Restore
      const b = state.prevBounds;
      Object.assign(state.el.style, {
        left: b.left, top: b.top, width: b.width, height: b.height
      });
      state.el.classList.remove('maximized');
      state.maximized = false;
    } else {
      // Save current bounds
      state.prevBounds = {
        left: state.el.style.left,
        top: state.el.style.top,
        width: state.el.style.width,
        height: state.el.style.height,
      };
      const menuH = 28;
      const dockH = 78;
      Object.assign(state.el.style, {
        left: '0px', top: menuH + 'px',
        width: '100vw',
        height: `calc(100vh - ${menuH}px - ${dockH}px)`,
      });
      state.el.classList.add('maximized');
      state.maximized = true;
    }
  }

  isOpen(id) {
    return this.windows.has(id);
  }

  getState(id) {
    return this.windows.get(id);
  }

  setTitle(id, title) {
    const state = this.windows.get(id);
    if (!state) return;
    state.title = title;
    state.el.querySelector('.window-title').textContent = title;
    state.el.setAttribute('aria-label', title);
  }

  _setupDrag(el, id) {
    const titlebar = el.querySelector('.window-titlebar');
    let offsetX, offsetY, dragging = false;

    const abortDrag = () => {
      dragging = false;
      el.style.transition = '';
      const preview = document.getElementById('snap-preview');
      if (preview) preview.style.display = 'none';
    };

    // Store abort fn on the window state so close() can call it
    const state = this.windows.get(id);
    if (state) state._abortDrag = abortDrag;

    titlebar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.window-buttons')) return;
      const state = this.windows.get(id);
      if (state?.maximized) return;

      dragging = true;
      offsetX = e.clientX - el.offsetLeft;
      offsetY = e.clientY - el.offsetTop;
      el.style.transition = 'none';
      this.focus(id);
      titlebar.setPointerCapture(e.pointerId);
    });

    titlebar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      el.style.left = `${e.clientX - offsetX}px`;
      el.style.top = `${Math.max(28, e.clientY - offsetY)}px`;

      // Show snap preview
      this._updateSnapPreview(e.clientX, e.clientY);
    });

    titlebar.addEventListener('pointerup', (e) => {
      if (dragging) {
        this._handleSnap(e.clientX, e.clientY, id);
      }
      dragging = false;
      el.style.transition = '';
    });

    // Double-click titlebar to maximize
    titlebar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.window-buttons')) return;
      this.maximize(id);
    });
  }

  _setupResize(el, id, minW, minH) {
    const handles = el.querySelectorAll('.resize-handle');

    handles.forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const dir = handle.dataset.dir;
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = el.offsetWidth;
        const startH = el.offsetHeight;
        const startL = el.offsetLeft;
        const startT = el.offsetTop;

        this.focus(id);
        handle.setPointerCapture(e.pointerId);
        el.style.transition = 'none';

        const onMove = (e) => {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;

          if (dir.includes('r')) {
            el.style.width = Math.max(minW, startW + dx) + 'px';
          }
          if (dir.includes('b')) {
            el.style.height = Math.max(minH, startH + dy) + 'px';
          }
          if (dir.includes('l')) {
            const newW = Math.max(minW, startW - dx);
            if (newW > minW) {
              el.style.width = newW + 'px';
              el.style.left = (startL + dx) + 'px';
            }
          }
          if (dir.includes('t') && !dir.includes('ex')) {
            const newH = Math.max(minH, startH - dy);
            if (newH > minH) {
              el.style.height = newH + 'px';
              el.style.top = Math.max(28, startT + dy) + 'px';
            }
          }
        };

        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          el.style.transition = '';
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
      });
    });
  }

  _setupButtons(el, id) {
    el.querySelector('.window-buttons').addEventListener('click', (e) => {
      const btn = e.target.closest('.win-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'close') this.close(id);
      else if (action === 'minimize') this.minimize(id);
      else if (action === 'maximize') this.maximize(id);
    });
  }

  _setupFocusOnClick(el, id) {
    el.addEventListener('mousedown', () => {
      if (this.activeWindowId !== id) {
        this.focus(id);
      }
    });
  }

  // Window snapping
  _updateSnapPreview(x, y) {
    let preview = document.getElementById('snap-preview');
    const menuH = 28;
    const dockH = 78;
    const snapZone = 24;

    if (x <= snapZone) {
      // Snap left
      if (!preview) preview = this._createSnapPreview();
      Object.assign(preview.style, { left: '0', top: menuH + 'px', width: '50vw', height: `calc(100vh - ${menuH}px - ${dockH}px)`, display: 'block' });
    } else if (x >= window.innerWidth - snapZone) {
      // Snap right
      if (!preview) preview = this._createSnapPreview();
      Object.assign(preview.style, { left: '50vw', top: menuH + 'px', width: '50vw', height: `calc(100vh - ${menuH}px - ${dockH}px)`, display: 'block' });
    } else if (y <= menuH + 4) {
      // Snap maximize
      if (!preview) preview = this._createSnapPreview();
      Object.assign(preview.style, { left: '0', top: menuH + 'px', width: '100vw', height: `calc(100vh - ${menuH}px - ${dockH}px)`, display: 'block' });
    } else {
      if (preview) preview.style.display = 'none';
    }
  }

  _handleSnap(x, y, id) {
    const preview = document.getElementById('snap-preview');
    if (preview) { preview.style.display = 'none'; }

    const state = this.windows.get(id);
    if (!state) return;

    const menuH = 28;
    const dockH = 78;
    const snapZone = 24;

    if (x <= snapZone) {
      state.prevBounds = { left: state.el.style.left, top: state.el.style.top, width: state.el.style.width, height: state.el.style.height };
      state.el.style.transition = 'all 0.2s ease';
      Object.assign(state.el.style, { left: '0px', top: menuH + 'px', width: '50vw', height: `calc(100vh - ${menuH}px - ${dockH}px)` });
    } else if (x >= window.innerWidth - snapZone) {
      state.prevBounds = { left: state.el.style.left, top: state.el.style.top, width: state.el.style.width, height: state.el.style.height };
      state.el.style.transition = 'all 0.2s ease';
      Object.assign(state.el.style, { left: '50vw', top: menuH + 'px', width: '50vw', height: `calc(100vh - ${menuH}px - ${dockH}px)` });
    } else if (y <= menuH + 4) {
      this.maximize(id);
    }
  }

  _createSnapPreview() {
    const el = document.createElement('div');
    el.id = 'snap-preview';
    el.style.cssText = 'position:fixed;background:rgba(0,122,255,0.15);border:2px solid rgba(0,122,255,0.4);border-radius:10px;z-index:9;pointer-events:none;transition:all 0.15s ease;display:none;';
    document.getElementById('desktop').appendChild(el);
    return el;
  }
}

export const windowManager = new WindowManager();
