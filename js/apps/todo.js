// Astrion OS — Todo List (graph-backed as of M2.P4)
import { processManager } from '../kernel/process-manager.js';
import { graphStore } from '../kernel/graph-store.js';
import { query as graphQuery } from '../kernel/graph-query.js';
import { eventBus } from '../kernel/event-bus.js';

async function loadTodos() {
  // Preserve insertion order: legacyIndex on migrated rows, createdAt afterwards.
  // Sorting by createdAt ascending gives stable chronological order.
  return graphQuery(graphStore, {
    type: 'select',
    from: 'todo',
    orderBy: { field: 'createdAt', dir: 'asc' },
    limit: 1000,
  });
}

export function registerTodo() {
  processManager.register('todo', { name: 'Todo', icon: '\u2611\uFE0F', singleInstance: true, width: 440, height: 500,
    launch: async (el) => {
      let todos = await loadTodos();
      let filter = 'all';

      async function addTodo(text) {
        const created = await graphStore.createNode('todo', { text, done: false });
        todos.push(created);
        render();
      }
      async function toggleTodo(id) {
        const t = todos.find(x => x.id === id);
        if (!t) return;
        const updated = await graphStore.updateNode(id, { ...t.props, done: !t.props.done });
        const idx = todos.findIndex(x => x.id === id);
        if (idx >= 0) todos[idx] = updated;
        render();
      }
      async function deleteTodo(id) {
        await graphStore.deleteNode(id);
        todos = todos.filter(x => x.id !== id);
        render();
      }

      function render() {
        const filtered = filter==='all' ? todos
          : filter==='active' ? todos.filter(t => !t.props.done)
          : todos.filter(t => t.props.done);
        const doneCount = todos.filter(t => t.props.done).length;
        el.innerHTML=`<div style="display:flex;flex-direction:column;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:16px;gap:12px;">
          <div style="font-size:16px;font-weight:600;">Todo</div>
          <div style="display:flex;gap:6px;">
            <input id="td-input" placeholder="What needs to be done?" style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:13px;font-family:var(--font);outline:none;">
            <button id="td-add" style="padding:10px 16px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;cursor:pointer;font-family:var(--font);">Add</button>
          </div>
          <div style="display:flex;gap:6px;">${['all','active','done'].map(f=>`<button class="td-filter" data-f="${f}" style="padding:6px 14px;border-radius:16px;border:none;background:${f===filter?'var(--accent)':'rgba(255,255,255,0.06)'};color:white;font-size:11px;cursor:pointer;font-family:var(--font);">${f}</button>`).join('')}</div>
          <div style="flex:1;overflow-y:auto;">${filtered.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <button class="td-check" data-id="${t.id}" style="width:22px;height:22px;border-radius:50%;border:2px solid ${t.props.done?'#34c759':'rgba(255,255,255,0.2)'};background:${t.props.done?'#34c759':'transparent'};color:white;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">${t.props.done?'\u2713':''}</button>
            <span style="flex:1;font-size:13px;${t.props.done?'text-decoration:line-through;opacity:0.5;':''}">${escapeHtml(t.props.text)}</span>
            <button class="td-del" data-id="${t.id}" style="background:none;border:none;color:rgba(255,255,255,0.2);cursor:pointer;font-size:14px;">\u00D7</button>
          </div>`).join('')}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.3);">${doneCount}/${todos.length} completed</div>
        </div>`;
        const input=el.querySelector('#td-input');
        el.querySelector('#td-add').onclick = () => { const t = input.value.trim(); if (t) { input.value = ''; addTodo(t); } };
        input.onkeydown = (e) => { if (e.key === 'Enter') el.querySelector('#td-add').click(); };
        el.querySelectorAll('.td-check').forEach(b => b.onclick = () => toggleTodo(b.dataset.id));
        el.querySelectorAll('.td-del').forEach(b => b.onclick = () => deleteTodo(b.dataset.id));
        el.querySelectorAll('.td-filter').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
        input.focus();
      }

      // refresh on external graph mutations (e.g., intent kernel creates a todo)
      const unsubCreated = eventBus.on('graph:node:created', async (p) => {
        if (p?.node?.type !== 'todo') return;
        todos = await loadTodos();
        render();
      });
      const unsubDeleted = eventBus.on('graph:node:deleted', async () => {
        todos = await loadTodos();
        render();
      });
      const appWindow = el.closest('.window');
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
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}
