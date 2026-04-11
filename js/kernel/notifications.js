// Astrion OS — Notification System with Notification Center
//
// Polish Sprint (2026-04-11): history now persists via localStorage so
// reloads don't wipe the notification log. Capped at 200 entries; the
// in-memory visible queue is still ephemeral.

import { eventBus } from './event-bus.js';

const STORAGE_KEY = 'astrion-notification-history';
const MAX_HISTORY = 200;

class NotificationManager {
  constructor() {
    this.notifications = [];
    this.history = []; // stored notification history
    this.container = null;
    this.centerPanel = null;
    this.nextId = 0;
    this.isOpen = false;
    this._loadHistory();
  }

  _loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.history = parsed.slice(-MAX_HISTORY);
        // ensure nextId doesn't collide with any restored entries
        const maxId = this.history.reduce((m, n) => (typeof n.id === 'number' && n.id > m ? n.id : m), -1);
        if (maxId >= 0) this.nextId = maxId + 1;
      }
    } catch (err) {
      console.warn('[notifications] failed to load history', err);
    }
  }

  _persistHistory() {
    try {
      // cap before writing to keep storage bounded
      if (this.history.length > MAX_HISTORY) {
        this.history = this.history.slice(-MAX_HISTORY);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch (err) {
      // quota exceeded or private mode — warn once, keep going
      if (!this._persistWarned) {
        this._persistWarned = true;
        console.warn('[notifications] history persistence failed', err);
      }
    }
  }

  init() {
    this.container = document.createElement('div');
    this.container.id = 'notification-center';
    this.container.style.cssText = 'position:fixed;top:32px;right:12px;z-index:90000;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:320px;';
    document.body.appendChild(this.container);

    // Create notification center panel (slide-out)
    this.centerPanel = document.createElement('div');
    this.centerPanel.id = 'notification-panel';
    this.centerPanel.style.cssText = `
      position:fixed; top:28px; right:0; width:340px; height:calc(100vh - 28px - 78px);
      background:rgba(30,30,34,0.92); backdrop-filter:blur(30px); -webkit-backdrop-filter:blur(30px);
      border-left:1px solid rgba(255,255,255,0.08); z-index:85000;
      transform:translateX(100%); transition:transform 0.3s cubic-bezier(0.16,1,0.3,1);
      display:flex; flex-direction:column; font-family:var(--font);
    `;
    this.centerPanel.innerHTML = `
      <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;font-size:14px;color:white;">Notifications</span>
        <button id="notif-clear-all" style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;font-family:var(--font);">Clear All</button>
      </div>
      <div id="notif-history" style="flex:1;overflow-y:auto;padding:8px;"></div>
    `;
    document.body.appendChild(this.centerPanel);

    // Clear all button
    this.centerPanel.querySelector('#notif-clear-all').addEventListener('click', () => {
      this.history = [];
      this._persistHistory();
      this._renderHistory();
    });

    // If history was restored from localStorage before the DOM existed,
    // render it now so the count badge reflects persisted notifications.
    if (this.history.length > 0) {
      eventBus.emit('notification:shown', { id: -1, title: 'restored', count: this.history.length });
    }

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.centerPanel.contains(e.target) && !e.target.closest('#menubar-notif-btn')) {
        this.closePanel();
      }
    });

    // Listen for toggle event (from menubar)
    eventBus.on('notifications:toggle', () => this.togglePanel());
  }

  togglePanel() {
    if (this.isOpen) this.closePanel();
    else this.openPanel();
  }

  openPanel() {
    this._renderHistory();
    this.centerPanel.style.transform = 'translateX(0)';
    this.isOpen = true;
  }

  closePanel() {
    this.centerPanel.style.transform = 'translateX(100%)';
    this.isOpen = false;
  }

  _renderHistory() {
    const histEl = this.centerPanel.querySelector('#notif-history');
    if (this.history.length === 0) {
      histEl.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:13px;">No notifications</div>`;
      return;
    }
    histEl.innerHTML = '';
    // Show newest first
    [...this.history].reverse().forEach((notif, i) => {
      const el = document.createElement('div');
      el.style.cssText = `
        background:rgba(255,255,255,0.04); border-radius:10px; padding:10px 12px;
        margin-bottom:6px; cursor:default; transition:background 0.15s;
      `;
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.08)');
      el.addEventListener('mouseleave', () => el.style.background = 'rgba(255,255,255,0.04)');

      const timeAgo = this._timeAgo(notif.time);
      el.innerHTML = `
        <div style="display:flex;gap:8px;align-items:flex-start;">
          ${notif.icon ? `<div style="font-size:20px;flex-shrink:0;">${notif.icon}</div>` : ''}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span style="font-weight:600;font-size:12px;color:white;">${notif.title}</span>
              <span style="font-size:10px;color:rgba(255,255,255,0.3);flex-shrink:0;">${timeAgo}</span>
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px;line-height:1.4;">${notif.body}</div>
          </div>
        </div>
      `;
      histEl.appendChild(el);
    });
  }

  _timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  show({ title, body, icon, duration = 4000, actions = [], urgent = false }) {
    const id = this.nextId++;

    // Always add to history (now persisted to localStorage, cap at MAX_HISTORY)
    this.history.push({ id, title, body, icon, time: Date.now() });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this._persistHistory();

    // Suppress visible banner if Focus mode is on (unless marked urgent)
    if (!urgent) {
      try {
        const focusEnabled = localStorage.getItem('nova-focus-enabled') === 'true';
        const mode = localStorage.getItem('nova-focus-mode') || 'none';
        if (focusEnabled && mode !== 'none') {
          eventBus.emit('notification:shown', { id, title, count: this.history.length });
          return id;
        }
      } catch {}
    }

    const el = document.createElement('div');
    el.style.cssText = `
      pointer-events:auto;
      background:rgba(40,40,40,0.92);
      backdrop-filter:blur(20px);
      -webkit-backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.1);
      border-radius:12px;
      padding:12px 14px;
      color:white;
      font-size:13px;
      font-family:var(--font);
      box-shadow:0 8px 30px rgba(0,0,0,0.4);
      animation:slideUp 0.3s cubic-bezier(0.16,1,0.3,1);
      cursor:default;
      display:flex;
      gap:10px;
      align-items:flex-start;
      transition:opacity 0.3s, transform 0.3s;
    `;

    const iconHtml = icon ? `<div style="font-size:24px;flex-shrink:0;margin-top:2px;">${icon}</div>` : '';
    let actionsHtml = '';
    if (actions.length > 0) {
      actionsHtml = `<div style="display:flex;gap:6px;margin-top:6px;">${actions.map((a, i) =>
        `<button data-action="${i}" style="background:rgba(255,255,255,0.1);border:none;color:white;padding:4px 12px;border-radius:6px;font-size:11px;font-family:var(--font);cursor:pointer;">${a.label}</button>`
      ).join('')}</div>`;
    }

    el.innerHTML = `
      ${iconHtml}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;margin-bottom:2px;">${title}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);line-height:1.4;">${body}</div>
        ${actionsHtml}
      </div>
      <button style="background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:16px;padding:0 2px;line-height:1;" data-close="true">&times;</button>
    `;

    // Action button handlers
    if (actions.length > 0) {
      el.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.action);
          if (actions[idx].onClick) actions[idx].onClick();
          this.dismiss(id, el);
        });
      });
    }

    // Close button
    el.querySelector('[data-close]').addEventListener('click', () => this.dismiss(id, el));

    // Click to dismiss
    el.addEventListener('click', (e) => {
      if (!e.target.closest('button')) this.dismiss(id, el);
    });

    this.container.appendChild(el);
    this.notifications.push({ id, el });

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => this.dismiss(id, el), duration);
    }

    // Update badge in menubar
    eventBus.emit('notification:shown', { id, title, count: this.history.length });
    return id;
  }

  dismiss(id, el) {
    if (!el.parentNode) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    setTimeout(() => {
      el.remove();
      this.notifications = this.notifications.filter(n => n.id !== id);
    }, 300);
  }

  clear() {
    this.notifications.forEach(n => this.dismiss(n.id, n.el));
  }

  getCount() {
    return this.history.length;
  }
}

export const notifications = new NotificationManager();
