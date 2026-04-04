// NOVA OS — Reminders App

import { processManager } from '../kernel/process-manager.js';

export function registerReminders() {
  processManager.register('reminders', {
    name: 'Reminders',
    icon: '\u2705',
    iconClass: 'dock-icon-reminders',
    singleInstance: true,
    width: 600,
    height: 450,
    launch: (contentEl) => {
      initReminders(contentEl);
    }
  });
}

function initReminders(container) {
  const STORAGE_KEY = 'nova-reminders';
  let lists = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {
    'Today': [
      { text: 'Try out NOVA OS apps', done: true },
      { text: 'Customize wallpaper and accent color', done: false },
      { text: 'Ask NOVA AI a question (Cmd+Space)', done: false },
    ],
    'Personal': [
      { text: 'Go for a walk', done: false },
      { text: 'Read a book', done: false },
    ],
    'Work': [
      { text: 'Finish project proposal', done: false },
      { text: 'Code review', done: false },
    ],
  };
  let activeList = Object.keys(lists)[0];

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  }

  function render() {
    const items = lists[activeList] || [];
    const doneCount = items.filter(i => i.done).length;

    container.innerHTML = `
      <div class="reminders-app">
        <div class="reminders-sidebar">
          ${Object.entries(lists).map(([name, items]) => `
            <div class="reminders-list-item${name === activeList ? ' active' : ''}" data-list="${name}">
              <div class="reminders-list-dot" style="background:${name === 'Today' ? 'var(--accent)' : name === 'Personal' ? 'var(--green)' : '#ff9500'}"></div>
              ${name}
              <span class="reminders-list-count">${items.filter(i => !i.done).length}</span>
            </div>
          `).join('')}
        </div>
        <div class="reminders-main">
          <div class="reminders-title" style="color:${activeList === 'Today' ? 'var(--accent)' : activeList === 'Personal' ? 'var(--green)' : '#ff9500'}">${activeList}</div>
          <div class="reminders-add">
            <input type="text" class="reminders-add-input" placeholder="Add a reminder..." id="rem-input">
            <button class="reminders-add-btn" id="rem-add">Add</button>
          </div>
          <div id="rem-items">
            ${items.map((item, i) => `
              <div class="reminder-item" data-idx="${i}">
                <div class="reminder-check${item.done ? ' done' : ''}" data-action="toggle"></div>
                <span class="reminder-text${item.done ? ' done' : ''}">${item.text}</span>
                <button class="reminder-delete" data-action="delete">\u00D7</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // List switching
    container.querySelectorAll('.reminders-list-item').forEach(el => {
      el.addEventListener('click', () => {
        activeList = el.dataset.list;
        render();
      });
    });

    // Add reminder
    const input = container.querySelector('#rem-input');
    const addBtn = container.querySelector('#rem-add');
    const addReminder = () => {
      const text = input.value.trim();
      if (!text) return;
      lists[activeList].unshift({ text, done: false });
      save();
      render();
    };
    addBtn.addEventListener('click', addReminder);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addReminder(); });

    // Toggle and delete
    container.querySelector('#rem-items').addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item) return;
      const idx = parseInt(item.closest('.reminder-item').dataset.idx);
      if (item.dataset.action === 'toggle') {
        lists[activeList][idx].done = !lists[activeList][idx].done;
      } else if (item.dataset.action === 'delete') {
        lists[activeList].splice(idx, 1);
      }
      save();
      render();
    });
  }

  render();
}
