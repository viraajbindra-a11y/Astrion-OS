// NOVA OS — Vault (Password Manager)
// Stores passwords / secrets encrypted with AES-GCM, unlocked via a master password.
// Real cryptography — the vault blob on disk is useless without the master password.

import { processManager } from '../kernel/process-manager.js';
import {
  hashPassword, verifyPassword,
  encryptWithPassword, decryptWithPassword,
  generatePassword, passwordStrength,
} from '../kernel/crypto.js';
import { notifications } from '../kernel/notifications.js';

const VAULT_KEY = 'nova-vault-encrypted';
const MASTER_HASH_KEY = 'nova-vault-master-hash';
const AUTOLOCK_KEY = 'nova-vault-autolock-min';

// Runtime state — the decrypted vault lives in memory only until locked
let state = {
  locked: true,
  masterPassword: null,
  entries: [],
  lockTimer: null,
};

export function registerVault() {
  processManager.register('vault', {
    name: 'Vault',
    icon: '\uD83D\uDD10',
    singleInstance: true,
    width: 820,
    height: 560,
    minWidth: 600,
    minHeight: 400,
    launch: (contentEl) => initVault(contentEl),
  });
}

function initVault(container) {
  if (state.locked) renderUnlock(container);
  else renderVault(container);
}

// ─── Lock Screen ──────────────────────────────────────────────────────

function renderUnlock(container) {
  const hasVault = !!localStorage.getItem(MASTER_HASH_KEY);

  container.innerHTML = `
    <div class="vault-lock" style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      height:100%; font-family:var(--font); color:white;
      background:linear-gradient(180deg, rgba(20,20,30,0.6), rgba(10,10,20,0.8));
    ">
      <div style="font-size:72px; margin-bottom:12px;">${hasVault ? '\uD83D\uDD10' : '\uD83D\uDD11'}</div>
      <div style="font-size:22px; font-weight:600; margin-bottom:6px;">${hasVault ? 'Astrion Vault' : 'Set Up Astrion Vault'}</div>
      <div style="font-size:12px; color:rgba(255,255,255,0.5); margin-bottom:24px; text-align:center; max-width:400px; padding:0 20px;">
        ${hasVault
          ? 'Enter your master password to unlock'
          : 'Create a master password to secure your passwords and notes. This password cannot be recovered — choose carefully.'}
      </div>

      <div style="display:flex; flex-direction:column; gap:10px; width:320px;">
        <input id="vault-master-input" type="password" placeholder="Master password" autocomplete="off"
          style="padding:11px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.12);
                 background:rgba(255,255,255,0.06); color:white; font-size:14px;
                 font-family:var(--font); outline:none;">
        ${!hasVault ? `
          <input id="vault-master-confirm" type="password" placeholder="Confirm password" autocomplete="off"
            style="padding:11px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.12);
                   background:rgba(255,255,255,0.06); color:white; font-size:14px;
                   font-family:var(--font); outline:none;">
          <div id="vault-strength" style="height:4px; border-radius:2px; background:rgba(255,255,255,0.08);"></div>
        ` : ''}
        <button id="vault-unlock-btn" style="
          padding:11px; border-radius:8px; border:none; background:var(--accent); color:white;
          font-size:14px; font-weight:500; cursor:pointer; font-family:var(--font);
        ">${hasVault ? 'Unlock' : 'Create Vault'}</button>
        <div id="vault-error" style="color:#ff6b6b; font-size:12px; text-align:center; min-height:16px;"></div>
      </div>
    </div>
  `;

  const input = container.querySelector('#vault-master-input');
  const confirmInput = container.querySelector('#vault-master-confirm');
  const strengthBar = container.querySelector('#vault-strength');
  const errEl = container.querySelector('#vault-error');
  const btn = container.querySelector('#vault-unlock-btn');

  input.focus();

  if (!hasVault && strengthBar) {
    input.addEventListener('input', () => {
      const s = passwordStrength(input.value);
      const colors = ['#555', '#ff3b30', '#ff9500', '#ffcc00', '#34c759'];
      strengthBar.style.background = `linear-gradient(90deg, ${colors[s]} ${(s + 1) * 20}%, rgba(255,255,255,0.08) ${(s + 1) * 20}%)`;
    });
  }

  async function unlock() {
    errEl.textContent = '';
    const pw = input.value;

    if (!pw) { errEl.textContent = 'Password required'; return; }

    btn.disabled = true;
    btn.textContent = hasVault ? 'Unlocking…' : 'Creating…';

    if (!hasVault) {
      if (pw !== confirmInput.value) {
        errEl.textContent = 'Passwords do not match';
        btn.disabled = false;
        btn.textContent = 'Create Vault';
        return;
      }
      if (pw.length < 8) {
        errEl.textContent = 'Use at least 8 characters';
        btn.disabled = false;
        btn.textContent = 'Create Vault';
        return;
      }
      // Create vault
      const hash = await hashPassword(pw);
      localStorage.setItem(MASTER_HASH_KEY, hash);
      state.entries = [];
      const blob = await encryptWithPassword(JSON.stringify(state.entries), pw);
      localStorage.setItem(VAULT_KEY, blob);
      state.masterPassword = pw;
      state.locked = false;
      startAutoLock();
      renderVault(container);
      notifications.show({ title: 'Vault created', body: 'Your secure vault is ready', icon: '\uD83D\uDD10' });
      return;
    }

    // Unlock existing
    const ok = await verifyPassword(pw, localStorage.getItem(MASTER_HASH_KEY));
    if (!ok) {
      errEl.textContent = 'Incorrect master password';
      btn.disabled = false;
      btn.textContent = 'Unlock';
      input.value = '';
      input.focus();
      return;
    }

    const blob = localStorage.getItem(VAULT_KEY);
    const plain = blob ? await decryptWithPassword(blob, pw) : '[]';
    state.entries = JSON.parse(plain || '[]');
    state.masterPassword = pw;
    state.locked = false;
    startAutoLock();
    renderVault(container);
  }

  btn.addEventListener('click', unlock);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  if (confirmInput) confirmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
}

// ─── Main Vault UI ────────────────────────────────────────────────────

function renderVault(container) {
  container.innerHTML = `
    <div class="vault-app" style="display:flex; height:100%; font-family:var(--font); color:white; background:#1a1a22;">
      <!-- Sidebar -->
      <div style="width:260px; border-right:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column;">
        <div style="padding:14px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:13px; font-weight:600;">\uD83D\uDD10 Vault</div>
          <button id="vault-lock-btn" title="Lock" style="background:rgba(255,255,255,0.08); border:none; color:white; width:26px; height:26px; border-radius:6px; cursor:pointer;">\uD83D\uDD12</button>
        </div>
        <input id="vault-search" placeholder="Search…" style="margin:10px; padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.05); color:white; font-family:var(--font); font-size:12px; outline:none;">
        <div id="vault-list" style="flex:1; overflow-y:auto; padding:0 8px;"></div>
        <div style="padding:10px; border-top:1px solid rgba(255,255,255,0.06);">
          <button id="vault-add-btn" style="width:100%; padding:9px; border-radius:8px; border:none; background:var(--accent); color:white; font-family:var(--font); font-size:12px; font-weight:500; cursor:pointer;">+ New Entry</button>
        </div>
      </div>

      <!-- Detail panel -->
      <div id="vault-detail" style="flex:1; padding:24px; overflow-y:auto;">
        <div style="display:flex; align-items:center; justify-content:center; height:100%; color:rgba(255,255,255,0.3); font-size:13px;">
          Select an entry or create a new one
        </div>
      </div>
    </div>
  `;

  const list = container.querySelector('#vault-list');
  const detail = container.querySelector('#vault-detail');
  const searchInput = container.querySelector('#vault-search');

  let selectedId = null;

  function renderList(filter = '') {
    const items = state.entries
      .filter(e => !filter || e.title.toLowerCase().includes(filter.toLowerCase()) || e.username?.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title));

    if (items.length === 0) {
      list.innerHTML = `<div style="padding:24px 8px; text-align:center; color:rgba(255,255,255,0.3); font-size:12px;">${filter ? 'No matches' : 'No entries yet'}</div>`;
      return;
    }

    list.innerHTML = items.map(e => `
      <div class="vault-item" data-id="${e.id}" style="
        padding:10px 12px; border-radius:8px; cursor:pointer; margin-bottom:2px;
        display:flex; align-items:center; gap:10px;
        background:${e.id === selectedId ? 'rgba(0,122,255,0.18)' : 'transparent'};
      ">
        <div style="width:28px; height:28px; border-radius:6px; background:${stringColor(e.title)}; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600;">${e.title[0]?.toUpperCase() || '?'}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(e.title)}</div>
          <div style="font-size:10px; color:rgba(255,255,255,0.4); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(e.username || '')}</div>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.vault-item').forEach(el => {
      el.addEventListener('click', () => {
        selectedId = el.dataset.id;
        renderList(searchInput.value);
        renderDetail(state.entries.find(e => e.id === selectedId));
      });
    });
  }

  function renderDetail(entry) {
    if (!entry) {
      detail.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:rgba(255,255,255,0.3); font-size:13px;">Select an entry</div>`;
      return;
    }

    detail.innerHTML = `
      <div style="max-width:480px;">
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:20px;">
          <div style="width:56px; height:56px; border-radius:12px; background:${stringColor(entry.title)}; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:600;">${entry.title[0]?.toUpperCase() || '?'}</div>
          <input id="vault-edit-title" value="${escapeHtml(entry.title)}" style="flex:1; font-size:20px; font-weight:600; background:transparent; border:none; color:white; outline:none; font-family:var(--font);">
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          ${field('Username / Email', 'vault-edit-username', entry.username || '', 'text')}
          ${passwordField('vault-edit-password', entry.password || '')}
          ${field('Website', 'vault-edit-url', entry.url || '', 'url')}
          ${field('Notes', 'vault-edit-notes', entry.notes || '', 'textarea')}
        </div>

        <div style="display:flex; gap:8px; margin-top:20px;">
          <button id="vault-save-btn" style="padding:9px 20px; border-radius:8px; border:none; background:var(--accent); color:white; font-family:var(--font); font-size:12px; font-weight:500; cursor:pointer;">Save</button>
          <button id="vault-delete-btn" style="padding:9px 20px; border-radius:8px; border:1px solid rgba(255,59,48,0.4); background:transparent; color:#ff6b6b; font-family:var(--font); font-size:12px; font-weight:500; cursor:pointer;">Delete</button>
          <div style="flex:1;"></div>
          <div id="vault-updated" style="align-self:center; font-size:11px; color:rgba(255,255,255,0.3);">Updated ${timeAgo(entry.updated)}</div>
        </div>
      </div>
    `;

    // Save
    detail.querySelector('#vault-save-btn').addEventListener('click', async () => {
      entry.title = detail.querySelector('#vault-edit-title').value;
      entry.username = detail.querySelector('#vault-edit-username').value;
      entry.password = detail.querySelector('#vault-edit-password').value;
      entry.url = detail.querySelector('#vault-edit-url').value;
      entry.notes = detail.querySelector('#vault-edit-notes').value;
      entry.updated = Date.now();
      await persist();
      renderList(searchInput.value);
      notifications.show({ title: 'Entry saved', body: entry.title, icon: '\u2705', duration: 2000 });
    });

    // Delete
    detail.querySelector('#vault-delete-btn').addEventListener('click', async () => {
      if (!confirm(`Delete "${entry.title}"?`)) return;
      state.entries = state.entries.filter(e => e.id !== entry.id);
      selectedId = null;
      await persist();
      renderList(searchInput.value);
      detail.innerHTML = `<div style="display:flex; align-items:center; justify-content:center; height:100%; color:rgba(255,255,255,0.3); font-size:13px;">Entry deleted</div>`;
    });

    // Copy buttons
    detail.querySelectorAll('[data-copy-from]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = detail.querySelector('#' + btn.dataset.copyFrom);
        if (!input) return;
        navigator.clipboard.writeText(input.value).then(() => {
          notifications.show({ title: 'Copied', body: btn.dataset.copyFrom.includes('password') ? 'Password copied to clipboard' : 'Copied to clipboard', icon: '\uD83D\uDCCB', duration: 2000 });
        });
      });
    });

    // Show/hide password
    detail.querySelectorAll('[data-toggle-pw]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = detail.querySelector('#' + btn.dataset.togglePw);
        if (input.type === 'password') { input.type = 'text'; btn.textContent = '\uD83D\uDE48'; }
        else { input.type = 'password'; btn.textContent = '\uD83D\uDC41'; }
      });
    });

    // Generate password
    detail.querySelectorAll('[data-generate]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = detail.querySelector('#' + btn.dataset.generate);
        input.value = generatePassword(20);
        input.type = 'text';
      });
    });
  }

  async function persist() {
    const blob = await encryptWithPassword(JSON.stringify(state.entries), state.masterPassword);
    localStorage.setItem(VAULT_KEY, blob);
  }

  // Event handlers
  searchInput.addEventListener('input', () => renderList(searchInput.value));

  container.querySelector('#vault-add-btn').addEventListener('click', async () => {
    const id = 'e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const entry = {
      id, title: 'New Entry', username: '', password: generatePassword(20),
      url: '', notes: '', created: Date.now(), updated: Date.now(),
    };
    state.entries.push(entry);
    selectedId = id;
    await persist();
    renderList();
    renderDetail(entry);
  });

  container.querySelector('#vault-lock-btn').addEventListener('click', () => {
    lockVault();
    renderUnlock(container);
  });

  renderList();
}

function field(label, id, value, type) {
  if (type === 'textarea') {
    return `
      <div>
        <div style="font-size:11px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">${label}</div>
        <textarea id="${id}" rows="3" style="width:100%; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; font-family:var(--font); font-size:13px; outline:none; resize:vertical; box-sizing:border-box;">${escapeHtml(value)}</textarea>
      </div>
    `;
  }
  return `
    <div>
      <div style="font-size:11px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">${label}</div>
      <div style="display:flex; gap:6px;">
        <input id="${id}" type="${type}" value="${escapeHtml(value)}" style="flex:1; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; font-family:var(--font); font-size:13px; outline:none;">
        <button data-copy-from="${id}" style="padding:0 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; cursor:pointer; font-size:12px;">Copy</button>
      </div>
    </div>
  `;
}

function passwordField(id, value) {
  return `
    <div>
      <div style="font-size:11px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Password</div>
      <div style="display:flex; gap:6px;">
        <input id="${id}" type="password" value="${escapeHtml(value)}" style="flex:1; padding:9px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; font-family:var(--mono, monospace); font-size:13px; outline:none;">
        <button data-toggle-pw="${id}" title="Show/hide" style="padding:0 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; cursor:pointer; font-size:12px;">\uD83D\uDC41</button>
        <button data-generate="${id}" title="Generate strong password" style="padding:0 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; cursor:pointer; font-size:12px;">\uD83C\uDFB2</button>
        <button data-copy-from="${id}" title="Copy password" style="padding:0 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:white; cursor:pointer; font-size:12px;">Copy</button>
      </div>
    </div>
  `;
}

// ─── Auto-lock ────────────────────────────────────────────────────────

function startAutoLock() {
  if (state.lockTimer) clearTimeout(state.lockTimer);
  const minutes = parseInt(localStorage.getItem(AUTOLOCK_KEY) || '5');
  if (minutes > 0) {
    state.lockTimer = setTimeout(() => lockVault(), minutes * 60 * 1000);
  }
}

function lockVault() {
  state.locked = true;
  state.masterPassword = null;
  state.entries = [];
  if (state.lockTimer) clearTimeout(state.lockTimer);
  state.lockTimer = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function stringColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 60%, 40%)`;
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
