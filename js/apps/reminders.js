// Astrion OS — Reminders App (graph-backed as of M2.P4)
//
// Legacy shape was nested-by-list ({ Today: [...], Personal: [...] }).
// Migration flattened it: each reminder is a node with a `list` prop.
// Day 4 wires the UI to query `{ type: 'select', from: 'reminder',
// where: { 'props.list': listName } }` instead of indexing a JS object.

import { processManager } from '../kernel/process-manager.js';
import { graphStore } from '../kernel/graph-store.js';
import { query as graphQuery } from '../kernel/graph-query.js';
import { eventBus } from '../kernel/event-bus.js';

const DEFAULT_LISTS = [
  { name: 'Today', items: [
    { text: 'Try out Astrion OS apps', done: true },
    { text: 'Customize wallpaper and accent color', done: false },
    { text: 'Ask Astrion AI a question (Cmd+Space)', done: false },
  ]},
  { name: 'Personal', items: [
    { text: 'Go for a walk', done: false },
    { text: 'Read a book', done: false },
  ]},
  { name: 'Work', items: [
    { text: 'Finish project proposal', done: false },
    { text: 'Code review', done: false },
  ]},
];

async function loadReminders() {
  return graphQuery(graphStore, {
    type: 'select',
    from: 'reminder',
    orderBy: { field: 'createdAt', dir: 'asc' },
    limit: 5000,
  });
}

function groupByList(reminders) {
  const groups = {};
  for (const r of reminders) {
    const list = r.props.list || 'Today';
    if (!groups[list]) groups[list] = [];
    groups[list].push(r);
  }
  return groups;
}

async function seedDefaults() {
  for (const list of DEFAULT_LISTS) {
    for (const item of list.items) {
      await graphStore.createNode('reminder', {
        text: item.text,
        done: item.done,
        list: list.name,
      }, { createdBy: { kind: 'system' } });
    }
  }
}

export function registerReminders() {
  processManager.register('reminders', {
    name: 'Reminders',
    icon: '\u2705',
    iconClass: 'dock-icon-reminders',
    singleInstance: true,
    width: 600,
    height: 450,
    launch: async (container) => {
      await initReminders(container);
    }
  });
}

async function initReminders(container) {
  let all = await loadReminders();
  if (all.length === 0) {
    await seedDefaults();
    all = await loadReminders();
  }
  let groups = groupByList(all);
  let activeList = Object.keys(groups)[0] || 'Today';

  async function addReminder(text) {
    const created = await graphStore.createNode('reminder', {
      text,
      done: false,
      list: activeList,
    });
    all.push(created);
    groups = groupByList(all);
    render();
  }
  async function toggleReminder(id) {
    const r = all.find(x => x.id === id);
    if (!r) return;
    const updated = await graphStore.updateNode(id, { ...r.props, done: !r.props.done });
    const idx = all.findIndex(x => x.id === id);
    if (idx >= 0) all[idx] = updated;
    groups = groupByList(all);
    render();
  }
  async function deleteReminder(id) {
    await graphStore.deleteNode(id);
    all = all.filter(x => x.id !== id);
    groups = groupByList(all);
    render();
  }

  function render() {
    // preserve ordering of lists — put known defaults first, then any custom ones
    const knownOrder = ['Today', 'Personal', 'Work'];
    const listNames = [
      ...knownOrder.filter(n => groups[n]),
      ...Object.keys(groups).filter(n => !knownOrder.includes(n)).sort(),
    ];
    if (!listNames.includes(activeList)) activeList = listNames[0] || 'Today';
    const items = groups[activeList] || [];

    container.innerHTML = `
      <div class="reminders-app">
        <div class="reminders-sidebar">
          ${listNames.map(name => {
            const listItems = groups[name] || [];
            const dot = name === 'Today' ? 'var(--accent)' : name === 'Personal' ? 'var(--green)' : '#ff9500';
            return `<div class="reminders-list-item${name === activeList ? ' active' : ''}" data-list="${escapeAttr(name)}">
              <div class="reminders-list-dot" style="background:${dot}"></div>
              ${escapeHtml(name)}
              <span class="reminders-list-count">${listItems.filter(i => !i.props.done).length}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="reminders-main">
          <div class="reminders-title" style="color:${activeList === 'Today' ? 'var(--accent)' : activeList === 'Personal' ? 'var(--green)' : '#ff9500'}">${escapeHtml(activeList)}</div>
          <div class="reminders-add">
            <input type="text" class="reminders-add-input" placeholder="Add a reminder..." id="rem-input">
            <button class="reminders-add-btn" id="rem-add">Add</button>
          </div>
          <div id="rem-items">
            ${items.map(item => `
              <div class="reminder-item" data-id="${item.id}">
                <div class="reminder-check${item.props.done ? ' done' : ''}" data-action="toggle"></div>
                <span class="reminder-text${item.props.done ? ' done' : ''}">${escapeHtml(item.props.text)}</span>
                <button class="reminder-delete" data-action="delete">\u00D7</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // list switching
    container.querySelectorAll('.reminders-list-item').forEach(el => {
      el.addEventListener('click', () => {
        activeList = el.dataset.list;
        render();
      });
    });

    // add
    const input = container.querySelector('#rem-input');
    const addBtn = container.querySelector('#rem-add');
    const fire = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addReminder(text);
    };
    addBtn.addEventListener('click', fire);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fire(); });

    // toggle + delete
    container.querySelector('#rem-items').addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;
      const itemEl = actionEl.closest('.reminder-item');
      if (!itemEl) return;
      const id = itemEl.dataset.id;
      if (actionEl.dataset.action === 'toggle') toggleReminder(id);
      else if (actionEl.dataset.action === 'delete') deleteReminder(id);
    });
  }

  // live refresh on external graph changes (e.g., intent kernel)
  const unsubCreated = eventBus.on('graph:node:created', async (p) => {
    if (p?.node?.type !== 'reminder') return;
    all = await loadReminders();
    groups = groupByList(all);
    render();
  });
  const unsubDeleted = eventBus.on('graph:node:deleted', async () => {
    all = await loadReminders();
    groups = groupByList(all);
    render();
  });
  const appWindow = container.closest('.window');
  if (appWindow) {
    const obs = new MutationObserver(() => {
      if (!document.body.contains(appWindow)) {
        unsubCreated();
        unsubDeleted();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  render();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}
function escapeAttr(text) {
  return (text == null ? '' : String(text)).replace(/"/g, '&quot;');
}
