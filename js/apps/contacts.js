// Astrion OS — Contacts App
// Simple contact manager with name, phone, email, notes.

import { processManager } from '../kernel/process-manager.js';

const CONTACTS_KEY = 'nova-contacts';

export function registerContacts() {
  processManager.register('contacts', {
    name: 'Contacts',
    icon: '\uD83D\uDC65',
    singleInstance: true,
    width: 750,
    height: 500,
    launch: (contentEl) => initContacts(contentEl),
  });
}

function getContacts() {
  try { return JSON.parse(localStorage.getItem(CONTACTS_KEY)) || []; }
  catch { return []; }
}

function saveContacts(contacts) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

function initContacts(container) {
  let contacts = getContacts();
  let selected = null;
  let search = '';

  function render() {
    const filtered = search
      ? contacts.filter(c => (c.name + c.email + c.phone).toLowerCase().includes(search.toLowerCase()))
      : contacts;

    container.innerHTML = `
      <div style="display:flex; height:100%; font-family:var(--font); color:white; background:#1a1a22;">
        <div style="width:250px; border-right:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column;">
          <div style="padding:10px;">
            <input type="text" id="ct-search" placeholder="Search contacts..." value="${esc(search)}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.05);color:white;font-size:12px;font-family:var(--font);outline:none;box-sizing:border-box;">
          </div>
          <div id="ct-list" style="flex:1; overflow-y:auto;">
            ${filtered.sort((a, b) => a.name.localeCompare(b.name)).map(c => `
              <div class="ct-item" data-id="${c.id}" style="
                padding:10px 14px; cursor:pointer; display:flex; align-items:center; gap:10px;
                background:${c.id === selected ? 'rgba(0,122,255,0.15)' : 'transparent'};
              ">
                <div style="width:32px; height:32px; border-radius:50%; background:${strColor(c.name)};
                  display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:600; flex-shrink:0;">
                  ${(c.name || '?')[0].toUpperCase()}
                </div>
                <div style="flex:1; min-width:0;">
                  <div style="font-size:13px; font-weight:500;">${esc(c.name)}</div>
                  <div style="font-size:10px; color:rgba(255,255,255,0.4);">${esc(c.phone || c.email || '')}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <div style="padding:10px; border-top:1px solid rgba(255,255,255,0.06);">
            <button id="ct-add" style="width:100%;padding:8px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font);">+ New Contact</button>
          </div>
        </div>
        <div id="ct-detail" style="flex:1; padding:24px; overflow-y:auto;">
          ${selected ? renderDetail(contacts.find(c => c.id === selected)) : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.3);font-size:13px;">Select a contact</div>'}
        </div>
      </div>
    `;

    container.querySelector('#ct-search').addEventListener('input', (e) => { search = e.target.value; render(); });
    container.querySelectorAll('.ct-item').forEach(el => {
      el.addEventListener('click', () => { selected = el.dataset.id; render(); });
    });
    container.querySelector('#ct-add').addEventListener('click', () => {
      const c = { id: 'c-' + Date.now(), name: 'New Contact', phone: '', email: '', notes: '', created: Date.now() };
      contacts.push(c);
      selected = c.id;
      saveContacts(contacts);
      render();
    });

    // Detail save/delete
    const saveBtn = container.querySelector('#ct-save');
    const deleteBtn = container.querySelector('#ct-delete');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const c = contacts.find(c => c.id === selected);
        if (!c) return;
        c.name = container.querySelector('#ct-name').value;
        c.phone = container.querySelector('#ct-phone').value;
        c.email = container.querySelector('#ct-email').value;
        c.notes = container.querySelector('#ct-notes').value;
        saveContacts(contacts);
        render();
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        contacts = contacts.filter(c => c.id !== selected);
        selected = null;
        saveContacts(contacts);
        render();
      });
    }
  }

  function renderDetail(c) {
    if (!c) return '';
    return `
      <div style="max-width:400px;">
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px;">
          <div style="width:64px; height:64px; border-radius:50%; background:${strColor(c.name)};
            display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:600;">${(c.name || '?')[0].toUpperCase()}</div>
          <input id="ct-name" value="${esc(c.name)}" style="flex:1;font-size:20px;font-weight:600;background:transparent;border:none;color:white;outline:none;font-family:var(--font);">
        </div>
        ${field('Phone', 'ct-phone', c.phone || '', 'tel')}
        ${field('Email', 'ct-email', c.email || '', 'email')}
        ${field('Notes', 'ct-notes', c.notes || '', 'textarea')}
        <div style="display:flex; gap:8px; margin-top:20px;">
          <button id="ct-save" style="padding:9px 20px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:12px;font-weight:500;cursor:pointer;font-family:var(--font);">Save</button>
          <button id="ct-delete" style="padding:9px 20px;border-radius:8px;border:1px solid rgba(255,59,48,0.4);background:transparent;color:#ff6b6b;font-size:12px;cursor:pointer;font-family:var(--font);">Delete</button>
        </div>
      </div>
    `;
  }

  function field(label, id, value, type) {
    if (type === 'textarea') {
      return `<div style="margin-bottom:12px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${label}</div>
        <textarea id="${id}" rows="3" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:white;font-family:var(--font);font-size:13px;outline:none;resize:vertical;box-sizing:border-box;">${esc(value)}</textarea>
      </div>`;
    }
    return `<div style="margin-bottom:12px;">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${label}</div>
      <input id="${id}" type="${type}" value="${esc(value)}" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:white;font-family:var(--font);font-size:13px;outline:none;box-sizing:border-box;">
    </div>`;
  }

  render();
}

function strColor(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 40%)`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
