// NOVA OS — Notification System

import { eventBus } from './event-bus.js';

class NotificationManager {
  constructor() {
    this.notifications = [];
    this.container = null;
    this.nextId = 0;
  }

  init() {
    this.container = document.createElement('div');
    this.container.id = 'notification-center';
    this.container.style.cssText = 'position:fixed;top:32px;right:12px;z-index:90000;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:320px;';
    document.body.appendChild(this.container);
  }

  show({ title, body, icon, duration = 4000, actions = [] }) {
    const id = this.nextId++;
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

    eventBus.emit('notification:shown', { id, title });
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
}

export const notifications = new NotificationManager();
