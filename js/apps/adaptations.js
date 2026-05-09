// Astrion OS — Adaptations App
//
// Audit + revert UI for everything the Adaptation Engine has done.
// Without this surface, "Astrion learned something" is one-way: the
// toast asks, the change happens, and the only revert path is
// adapt.revertAdaptation(id) from DevTools. With this surface, every
// adaptation is browseable + revertable + the per-category boldness +
// daily-budget settings are user-editable.
//
// This is the credibility primitive that makes the auto-evolution
// loop trustworthy.

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';
import {
  listAdaptations,
  revertAdaptation,
  getBoldness,
  setBoldness,
  getDailyBudget,
  setDailyBudget,
  getBudgetRemaining,
  getTodaysCount,
  CATEGORY,
  BOLDNESS,
} from '../kernel/adaptation-engine.js';

const CATEGORY_LABELS = {
  skill:       { label: 'Skills',       icon: '🎯', desc: 'Workflows Astrion bound from observed sequences' },
  routine:     { label: 'Routines',     icon: '🕒', desc: 'Time-of-day or trigger-based action chains' },
  alias:       { label: 'Aliases',      icon: '↔︎', desc: 'Words you taught Astrion (verb / noun aliases)' },
  autocorrect: { label: 'Autocorrect',  icon: '✏︎', desc: 'Text-correction rules learned from your edits' },
  preference:  { label: 'Preferences',  icon: '⚙︎', desc: 'Rules learned from repeated undo / cancel' },
  ui:          { label: 'UI',           icon: '🎨', desc: 'Dock pinning, Spotlight defaults, app order' },
  graph:       { label: 'Graph',        icon: '🔗', desc: 'Auto-links and auto-tags between notes / todos / events' },
};

const BOLDNESS_LABELS = {
  low:    'Always ask',
  medium: 'Ask first time',
  high:   'Adapt silently',
};

export function registerAdaptations() {
  processManager.register('adaptations', {
    name: 'Adaptations',
    icon: '✨',
    iconClass: 'dock-icon-adaptations',
    singleInstance: true,
    width: 720,
    height: 560,
    minWidth: 540,
    minHeight: 420,
    launch: (contentEl) => initAdaptations(contentEl),
  });
}

function initAdaptations(container) {
  let activeFilter = 'all';
  let showReverted = false;

  container.innerHTML = `
    <style>
      .adapt-app { display:flex; flex-direction:column; height:100%; font-family: var(--font); color: white; background: rgba(20,20,24,0.92); }
      .adapt-header { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; gap: 12px; flex-wrap: wrap; }
      .adapt-title { font-size: 14px; font-weight: 600; }
      .adapt-counts { font-size: 11px; color: rgba(255,255,255,0.5); }
      .adapt-toolbar { padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); display:flex; gap: 8px; align-items:center; flex-wrap: wrap; }
      .adapt-chip { background: rgba(255,255,255,0.06); border: 1px solid transparent; padding: 4px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; user-select: none; }
      .adapt-chip.active { background: var(--accent); color: white; }
      .adapt-toggle { margin-left: auto; font-size: 11px; color: rgba(255,255,255,0.6); display:flex; align-items:center; gap: 6px; cursor: pointer; }
      .adapt-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
      .adapt-empty { padding: 32px 16px; text-align:center; color: rgba(255,255,255,0.45); font-size: 13px; }
      .adapt-empty-strong { font-size: 15px; color: rgba(255,255,255,0.7); margin-bottom: 6px; }
      .adapt-row { display:flex; gap: 12px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.04); margin-bottom: 8px; align-items: flex-start; }
      .adapt-row.reverted { opacity: 0.5; }
      .adapt-row-icon { font-size: 18px; line-height: 1; padding-top: 2px; }
      .adapt-row-main { flex: 1; min-width: 0; }
      .adapt-row-summary { font-size: 13px; font-weight: 500; }
      .adapt-row-meta { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 4px; line-height: 1.5; word-break: break-word; }
      .adapt-row-cat { display:inline-block; padding: 1px 6px; border-radius: 4px; background: rgba(255,255,255,0.08); margin-right: 6px; font-size: 10px; }
      .adapt-revert-btn { background: rgba(255,69,58,0.15); border: 1px solid rgba(255,69,58,0.3); color: #ff8a82; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-family: var(--font); white-space: nowrap; }
      .adapt-revert-btn:hover { background: rgba(255,69,58,0.25); }
      .adapt-reverted-tag { font-size: 10px; color: rgba(255,255,255,0.4); padding: 4px 8px; }
      .adapt-settings { border-top: 1px solid rgba(255,255,255,0.06); padding: 14px 16px; background: rgba(255,255,255,0.02); max-height: 220px; overflow-y: auto; flex-shrink: 0; }
      .adapt-settings h3 { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7); margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.6px; }
      .adapt-settings-row { display:grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 6px 0; font-size: 12px; }
      .adapt-settings-row + .adapt-settings-row { border-top: 1px solid rgba(255,255,255,0.04); }
      .adapt-settings-cat { display:flex; align-items:center; gap: 6px; color: rgba(255,255,255,0.85); }
      .adapt-bold-select, .adapt-budget-input { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); color: white; font-family: var(--font); font-size: 11px; padding: 4px 8px; border-radius: 6px; }
      .adapt-budget-input { width: 56px; text-align: center; }
    </style>
    <div class="adapt-app">
      <div class="adapt-header">
        <div>
          <div class="adapt-title">Adaptations</div>
          <div class="adapt-counts" id="adapt-counts"></div>
        </div>
      </div>
      <div class="adapt-toolbar" id="adapt-toolbar"></div>
      <div class="adapt-body" id="adapt-body"></div>
      <div class="adapt-settings">
        <h3>Per-category settings</h3>
        <div id="adapt-settings-list"></div>
      </div>
    </div>
  `;

  const toolbar = container.querySelector('#adapt-toolbar');
  const body = container.querySelector('#adapt-body');
  const countsEl = container.querySelector('#adapt-counts');
  const settingsListEl = container.querySelector('#adapt-settings-list');

  function renderToolbar() {
    const chips = ['all', ...Object.keys(CATEGORY_LABELS)];
    toolbar.innerHTML = chips.map(c => {
      const label = c === 'all' ? 'All' : CATEGORY_LABELS[c].label;
      const icon = c === 'all' ? '✦' : CATEGORY_LABELS[c].icon;
      return `<div class="adapt-chip${c === activeFilter ? ' active' : ''}" data-filter="${c}">${icon} ${label}</div>`;
    }).join('') + `
      <label class="adapt-toggle">
        <input type="checkbox" id="adapt-show-reverted" ${showReverted ? 'checked' : ''} style="margin: 0;">
        Show reverted
      </label>`;
    toolbar.querySelectorAll('[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        renderAll();
      });
    });
    toolbar.querySelector('#adapt-show-reverted').addEventListener('change', (e) => {
      showReverted = e.target.checked;
      renderList();
    });
  }

  function renderCounts() {
    const total = getTodaysCount();
    const totalAll = listAdaptations({ includeReverted: true }).length;
    countsEl.textContent = `${total} today · ${totalAll} all-time`;
  }

  function renderList() {
    const filter = activeFilter === 'all' ? {} : { category: activeFilter };
    if (showReverted) filter.includeReverted = true;
    const items = listAdaptations(filter);
    if (items.length === 0) {
      body.innerHTML = `
        <div class="adapt-empty">
          <div class="adapt-empty-strong">Nothing to show yet.</div>
          <div>Astrion will list every change it makes here, with a one-click revert. Categories you can tune are below.</div>
        </div>`;
      return;
    }
    body.innerHTML = items.map(e => {
      const cat = CATEGORY_LABELS[e.category] || { label: e.category, icon: '·' };
      const when = relTime(e.appliedAt);
      const silentTag = e.silent ? '<span class="adapt-row-cat">silent</span>' : '';
      const revertedTag = e.reverted ? `<span class="adapt-row-cat">reverted ${relTime(e.revertedAt)}</span>` : '';
      const revertBtn = e.reverted
        ? `<span class="adapt-reverted-tag">reverted</span>`
        : `<button class="adapt-revert-btn" data-id="${e.id}">Revert</button>`;
      return `
        <div class="adapt-row${e.reverted ? ' reverted' : ''}">
          <div class="adapt-row-icon">${cat.icon}</div>
          <div class="adapt-row-main">
            <div class="adapt-row-summary">
              <span class="adapt-row-cat">${cat.label}</span>
              ${silentTag}${revertedTag}
              ${escapeHtml(e.summary)}
            </div>
            <div class="adapt-row-meta">${escapeHtml(e.trigger)} · ${when}</div>
          </div>
          ${revertBtn}
        </div>`;
    }).join('');
    body.querySelectorAll('.adapt-revert-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Reverting…';
        const r = await revertAdaptation(btn.dataset.id);
        if (!r.ok) {
          btn.disabled = false;
          btn.textContent = 'Revert failed';
          btn.title = r.error || 'Unknown error';
        }
        // adaptation:reverted will trigger a re-render via the listener.
      });
    });
  }

  function renderSettings() {
    const cats = Object.keys(CATEGORY_LABELS);
    settingsListEl.innerHTML = cats.map(c => {
      const cat = CATEGORY_LABELS[c];
      const bold = getBoldness(c);
      const budget = getDailyBudget(c);
      const remaining = getBudgetRemaining(c);
      return `
        <div class="adapt-settings-row">
          <div class="adapt-settings-cat">${cat.icon} <strong>${cat.label}</strong> · <span style="color:rgba(255,255,255,0.45);">${cat.desc}</span></div>
          <select class="adapt-bold-select" data-cat="${c}">
            ${Object.values(BOLDNESS).map(level =>
              `<option value="${level}" ${level === bold ? 'selected' : ''}>${BOLDNESS_LABELS[level]}</option>`
            ).join('')}
          </select>
          <span style="display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.6);font-size:11px;">
            <input type="number" min="0" max="999" value="${budget}" data-budget="${c}" class="adapt-budget-input">
            /day · ${remaining} left
          </span>
        </div>`;
    }).join('');
    settingsListEl.querySelectorAll('[data-cat]').forEach(sel => {
      sel.addEventListener('change', () => {
        try { setBoldness(sel.dataset.cat, sel.value); }
        catch (err) { console.warn('[adaptations] setBoldness failed', err); }
      });
    });
    settingsListEl.querySelectorAll('[data-budget]').forEach(input => {
      input.addEventListener('change', () => {
        const n = parseInt(input.value, 10);
        if (Number.isFinite(n) && n >= 0) {
          try { setDailyBudget(input.dataset.budget, n); renderSettings(); }
          catch (err) { console.warn('[adaptations] setDailyBudget failed', err); }
        }
      });
    });
  }

  function renderAll() {
    renderToolbar();
    renderCounts();
    renderList();
    renderSettings();
  }

  // Live updates while the panel is open.
  const onChange = () => {
    if (!container.isConnected) return;
    renderAll();
  };
  eventBus.on('adaptation:recorded', onChange);
  eventBus.on('adaptation:reverted', onChange);
  eventBus.on('adaptation:settings-changed', onChange);

  renderAll();
}

// ─── helpers ───────────────────────────────────────────────────────

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
