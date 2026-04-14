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
        <img class="window-title-icon" src="/assets/icons/${app}.svg" alt="" style="width:14px;height:14px;border-radius:3px;margin-right:4px;vertical-align:middle;" onerror="this.style.display='none'">
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
      pinned: false,
      prevBounds: null,
      minWidth, minHeight,
    };

    this.windows.set(id, state);
    this._setupDrag(el, id);
    this._setupResize(el, id, minWidth, minHeight);
    this._setupButtons(el, id);
    this._setupFocusOnClick(el, id);
    this._setupTitlebarMenu(el, id);
    this._setupOpacityControl(el);
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

    // Pinned windows stay above everything (z-index 90000+)
    if (state.pinned) {
      state.el.style.zIndex = 90000 + (++this.topZ % 1000);
    } else {
      state.el.style.zIndex = ++this.topZ;
    }
    // Re-enforce ALL pinned windows stay on top
    for (const [wid, w] of this.windows) {
      if (w.pinned && wid !== id) {
        w.el.style.zIndex = 90000 + (++this.topZ % 1000);
      }
    }

    state.el.classList.add('active');
    state.el.classList.remove('inactive');
    this.activeWindowId = id;

    eventBus.emit('window:focused', { id, title: state.title, app: state.app });
  }

  /**
   * Toggle always-on-top for a window. Pinned windows float above all others.
   */
  togglePin(id) {
    const state = this.windows.get(id);
    if (!state) return;
    state.pinned = !state.pinned;
    state.el.classList.toggle('pinned', state.pinned);
    if (state.pinned) {
      state.el.style.zIndex = 90000 + (++this.topZ % 1000);
    } else {
      state.el.style.zIndex = ++this.topZ;
    }
    eventBus.emit('window:pinned', { id, pinned: state.pinned, app: state.app });
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

  /**
   * Toggle mini/PiP mode — shrinks window to a small always-on-top floating
   * widget in the bottom-right corner. Great for music, video, or chat.
   */
  toggleMini(id) {
    const state = this.windows.get(id);
    if (!state) return;

    if (state.miniMode) {
      // Restore from mini
      Object.assign(state.el.style, {
        width: state.miniPrev.width,
        height: state.miniPrev.height,
        left: state.miniPrev.left,
        top: state.miniPrev.top,
        borderRadius: '',
        transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
      });
      state.el.classList.remove('mini-mode');
      state.miniMode = false;
      state.pinned = false;
      state.el.classList.remove('pinned');
      state.el.style.zIndex = ++this.topZ;
      setTimeout(() => { state.el.style.transition = ''; }, 300);
      eventBus.emit('window:mini-exit', { id, app: state.app });
    } else {
      // Enter mini mode
      state.miniPrev = {
        width: state.el.style.width,
        height: state.el.style.height,
        left: state.el.style.left,
        top: state.el.style.top,
      };
      const dockH = 78;
      const miniW = 320, miniH = 200;
      state.el.style.transition = 'all 0.25s cubic-bezier(0.16,1,0.3,1)';
      Object.assign(state.el.style, {
        width: miniW + 'px',
        height: miniH + 'px',
        left: (window.innerWidth - miniW - 16) + 'px',
        top: (window.innerHeight - dockH - miniH - 16) + 'px',
        borderRadius: '14px',
      });
      state.el.classList.add('mini-mode');
      state.miniMode = true;
      state.pinned = true;
      state.el.classList.add('pinned');
      state.el.style.zIndex = 90000 + (++this.topZ % 1000);
      setTimeout(() => { state.el.style.transition = ''; }, 300);
      eventBus.emit('window:mini-enter', { id, app: state.app });
    }
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

  // Right-click titlebar context menu — pin, close, minimize, etc.
  _setupTitlebarMenu(el, id) {
    const titlebar = el.querySelector('.window-titlebar');
    titlebar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Remove any existing titlebar menu
      document.querySelectorAll('.wm-context-menu').forEach(m => m.remove());

      const state = this.windows.get(id);
      if (!state) return;

      const menu = document.createElement('div');
      menu.className = 'wm-context-menu';
      menu.style.cssText = `
        position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;
        background: rgba(30, 30, 36, 0.95); backdrop-filter: blur(30px);
        -webkit-backdrop-filter: blur(30px);
        border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
        padding: 4px; z-index: 99998; font-family: var(--font);
        min-width: 180px; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
        animation: wmMenuFade 0.12s ease;
      `;

      const items = [
        { label: state.pinned ? '📌 Unpin from Top' : '📌 Pin on Top', action: () => this.togglePin(id) },
        { label: state.miniMode ? '⬜ Exit Mini Mode' : '🖼 Mini Mode (PiP)', action: () => this.toggleMini(id) },
        { label: state.maximized ? '↙ Restore' : '⬜ Maximize', action: () => this.maximize(id) },
        { label: '➖ Minimize', action: () => this.minimize(id) },
        { sep: true },
        { label: '✕ Close', action: () => this.close(id), danger: true },
      ];

      items.forEach(item => {
        if (item.sep) {
          const sep = document.createElement('div');
          sep.style.cssText = 'height:1px; background:rgba(255,255,255,0.08); margin:4px 8px;';
          menu.appendChild(sep);
          return;
        }
        const row = document.createElement('div');
        row.textContent = item.label;
        row.style.cssText = `
          padding: 7px 12px; border-radius: 6px; font-size: 12px;
          color: ${item.danger ? '#ff6b6b' : 'rgba(255,255,255,0.9)'};
          cursor: pointer; transition: background 0.1s;
        `;
        row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.08)');
        row.addEventListener('mouseleave', () => row.style.background = 'transparent');
        row.addEventListener('click', () => { menu.remove(); item.action(); });
        menu.appendChild(row);
      });

      // Inject menu animation once
      if (!document.getElementById('wm-menu-styles')) {
        const s = document.createElement('style');
        s.id = 'wm-menu-styles';
        s.textContent = `
          @keyframes wmMenuFade { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
        `;
        document.head.appendChild(s);
      }

      document.body.appendChild(menu);

      // Close on outside click
      const closeMenu = (ev) => {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', closeMenu); }
      };
      setTimeout(() => document.addEventListener('mousedown', closeMenu), 10);
    });
  }

  // Alt+scroll on titlebar adjusts window opacity (20% → 100%)
  _setupOpacityControl(el) {
    const titlebar = el.querySelector('.window-titlebar');
    titlebar.addEventListener('wheel', (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      const current = parseFloat(el.style.opacity) || 1;
      const next = Math.max(0.2, Math.min(1, current + (e.deltaY > 0 ? -0.05 : 0.05)));
      el.style.opacity = next;
    }, { passive: false });
  }

  // Window snapping — edges for half-screen, corners for quarter-screen
  _getSnapZone(x, y) {
    const menuH = 28;
    const dockH = 78;
    const snap = 24;        // edge zone width
    const corner = 60;      // corner zone extends further from edge
    const W = window.innerWidth;
    const H = window.innerHeight;
    const halfW = '50vw';
    const fullW = '100vw';
    const halfH = `calc((100vh - ${menuH}px - ${dockH}px) / 2)`;
    const fullH = `calc(100vh - ${menuH}px - ${dockH}px)`;
    const midY = menuH + (H - menuH - dockH) / 2;

    // Corner zones (check before edges — corners are a subset of edges)
    if (x <= snap && y <= menuH + corner) {
      return { left: '0', top: menuH + 'px', width: halfW, height: halfH, zone: 'top-left' };
    }
    if (x <= snap && y >= H - dockH - corner) {
      return { left: '0', top: `calc(${menuH}px + ${halfH})`, width: halfW, height: halfH, zone: 'bottom-left' };
    }
    if (x >= W - snap && y <= menuH + corner) {
      return { left: halfW, top: menuH + 'px', width: halfW, height: halfH, zone: 'top-right' };
    }
    if (x >= W - snap && y >= H - dockH - corner) {
      return { left: halfW, top: `calc(${menuH}px + ${halfH})`, width: halfW, height: halfH, zone: 'bottom-right' };
    }
    // Edge zones
    if (x <= snap) {
      return { left: '0', top: menuH + 'px', width: halfW, height: fullH, zone: 'left' };
    }
    if (x >= W - snap) {
      return { left: halfW, top: menuH + 'px', width: halfW, height: fullH, zone: 'right' };
    }
    if (y <= menuH + 4) {
      return { left: '0', top: menuH + 'px', width: fullW, height: fullH, zone: 'maximize' };
    }
    return null;
  }

  _updateSnapPreview(x, y) {
    const zone = this._getSnapZone(x, y);
    let preview = document.getElementById('snap-preview');

    if (zone) {
      if (!preview) preview = this._createSnapPreview();
      Object.assign(preview.style, { left: zone.left, top: zone.top, width: zone.width, height: zone.height, display: 'block' });
    } else {
      if (preview) preview.style.display = 'none';
    }
  }

  _handleSnap(x, y, id) {
    const preview = document.getElementById('snap-preview');
    if (preview) preview.style.display = 'none';

    const state = this.windows.get(id);
    if (!state) return;

    const zone = this._getSnapZone(x, y);
    if (!zone) return;

    if (zone.zone === 'maximize') {
      this.maximize(id);
      return;
    }

    state.prevBounds = { left: state.el.style.left, top: state.el.style.top, width: state.el.style.width, height: state.el.style.height };
    state.el.style.transition = 'all 0.2s ease';
    Object.assign(state.el.style, { left: zone.left, top: zone.top, width: zone.width, height: zone.height });
  }

  _createSnapPreview() {
    const el = document.createElement('div');
    el.id = 'snap-preview';
    el.style.cssText = 'position:fixed;background:rgba(0,122,255,0.15);border:2px solid rgba(0,122,255,0.4);border-radius:10px;z-index:9;pointer-events:none;transition:all 0.15s ease;display:none;';
    document.getElementById('desktop').appendChild(el);
    return el;
  }
  // ─── Window Layout Save/Restore (#23 from the research list) ───
  // Save the positions/sizes of all open windows. Restore them later.

  saveLayout(name = 'default') {
    const layout = [];
    for (const [id, state] of this.windows) {
      if (state.minimized) continue;
      layout.push({
        app: state.app,
        left: state.el.style.left,
        top: state.el.style.top,
        width: state.el.style.width,
        height: state.el.style.height,
      });
    }
    const saved = JSON.parse(localStorage.getItem('nova-window-layouts') || '{}');
    saved[name] = { windows: layout, savedAt: Date.now() };
    localStorage.setItem('nova-window-layouts', JSON.stringify(saved));
    return layout.length;
  }

  restoreLayout(name = 'default') {
    const saved = JSON.parse(localStorage.getItem('nova-window-layouts') || '{}');
    const layout = saved[name];
    if (!layout || !layout.windows) return 0;
    let restored = 0;
    for (const win of layout.windows) {
      if (!win.app) continue;
      // Import processManager lazily to avoid circular dependency
      import('./process-manager.js').then(({ processManager }) => {
        processManager.launch(win.app);
        // Apply saved position after the window renders
        setTimeout(() => {
          const state = [...this.windows.values()].find(s => s.app === win.app);
          if (state) {
            Object.assign(state.el.style, {
              left: win.left, top: win.top, width: win.width, height: win.height,
            });
          }
        }, 200);
      });
      restored++;
    }
    return restored;
  }

  getSavedLayouts() {
    return Object.keys(JSON.parse(localStorage.getItem('nova-window-layouts') || '{}'));
  }
}

export const windowManager = new WindowManager();
