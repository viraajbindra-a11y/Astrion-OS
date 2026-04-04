// NOVA OS — Window Manager

import { eventBus } from './event-bus.js';

class WindowManager {
  constructor() {
    this.windows = new Map();
    this.topZ = 100;
    this.activeWindowId = null;
    this.container = null;
  }

  init() {
    this.container = document.getElementById('windows-container');

    // Click desktop to deactivate windows
    document.getElementById('desktop').addEventListener('mousedown', (e) => {
      if (e.target.id === 'desktop' || e.target.id === 'desktop-icons' || e.target.closest('#desktop-icons')) {
        this.deactivateAll();
      }
    });
  }

  create({ id, title, app, x, y, width = 700, height = 480, minWidth = 300, minHeight = 200 }) {
    if (this.windows.has(id)) {
      this.focus(id);
      return this.windows.get(id).el.querySelector('.window-content');
    }

    // Center if no position given
    if (x === undefined) x = Math.max(50, (window.innerWidth - width) / 2 + (this.windows.size * 24));
    if (y === undefined) y = Math.max(40, (window.innerHeight - height) / 3 + (this.windows.size * 24));

    const el = document.createElement('div');
    el.className = 'window';
    el.id = `window-${id}`;
    el.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${++this.topZ}`;
    el.dataset.windowId = id;

    el.innerHTML = `
      <div class="window-titlebar" data-window="${id}">
        <div class="window-buttons">
          <button class="win-btn close" data-action="close" title="Close"></button>
          <button class="win-btn minimize" data-action="minimize" title="Minimize"></button>
          <button class="win-btn maximize" data-action="maximize" title="Maximize"></button>
        </div>
        <span class="window-title">${title}</span>
      </div>
      <div class="window-content" id="window-content-${id}"></div>
      <div class="resize-handle resize-r" data-dir="r"></div>
      <div class="resize-handle resize-b" data-dir="b"></div>
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

    state.el.classList.add('closing');
    setTimeout(() => {
      state.el.remove();
      this.windows.delete(id);
      eventBus.emit('window:closed', { id, app: state.app });

      // Focus next window
      if (this.activeWindowId === id) {
        const remaining = [...this.windows.values()].filter(w => !w.minimized);
        if (remaining.length > 0) {
          remaining.sort((a, b) => parseInt(b.el.style.zIndex) - parseInt(a.el.style.zIndex));
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

    // Animate to dock
    const el = state.el;
    const dockCenter = window.innerWidth / 2;
    const dockY = window.innerHeight - 40;
    el.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.35s ease';
    el.style.transformOrigin = 'center bottom';
    el.style.transform = `scale(0.1) translateY(${dockY - el.offsetTop}px)`;
    el.style.opacity = '0';

    setTimeout(() => {
      el.style.display = 'none';
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
    }, 350);

    state.minimized = true;
    eventBus.emit('window:minimized', { id });

    // Focus next window
    if (this.activeWindowId === id) {
      const remaining = [...this.windows.values()].filter(w => !w.minimized);
      if (remaining.length > 0) {
        remaining.sort((a, b) => parseInt(b.el.style.zIndex) - parseInt(a.el.style.zIndex));
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
    el.style.transform = 'scale(0.1)';
    el.style.opacity = '0';
    el.style.display = '';

    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease';
      el.style.transform = 'scale(1)';
      el.style.opacity = '1';
      setTimeout(() => { el.style.transition = ''; }, 300);
    });

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
  }

  _setupDrag(el, id) {
    const titlebar = el.querySelector('.window-titlebar');
    let offsetX, offsetY, dragging = false;

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
    const snapZone = 8;

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
    const snapZone = 8;

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
