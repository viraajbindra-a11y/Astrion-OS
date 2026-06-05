/*
 * Astrion — Healer Log app
 *
 * The audit + review surface for everything the runtime healer
 * (kernel/healer.js) has proposed. Every entry shows:
 *   - the original error message + file:line
 *   - the AI's one-sentence diagnosis
 *   - the proposed unified diff
 *   - status (pending / applied / discarded) + buttons
 *
 * Apply routes through selfmod-sandbox.applyProposal, which runs the
 * full 6-gate pipeline (golden / value-lock / red-team / content-blocklist
 * / typed-confirm / rollback-plan). If gates fail, the failure reasons
 * are shown — same trust story as manual self-mod proposals.
 *
 * Discard marks the proposal closed without modifying anything.
 *
 * Spotlight access: "Healer Log".
 */

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';
import { listHealerProposals, getHealerStatus, setHealerEnabled } from '../kernel/healer.js';
import { applyProposal, discardProposal } from '../kernel/selfmod-sandbox.js';

export function registerHealerLog() {
  processManager.register('healer-log', {
    name: 'Healer Log',
    icon: '🩹',
    iconClass: 'dock-icon-healer-log',
    singleInstance: true,
    width: 720,
    height: 580,
    minWidth: 540,
    minHeight: 420,
    launch: (contentEl, opts) => initHealerLog(contentEl, opts),
  });
}

function initHealerLog(container, opts = {}) {
  let proposals = [];
  let focusId = opts && opts.proposalId;
  let filter = 'pending';

  container.innerHTML = `
    <style>
      .heal-app { display:flex; flex-direction:column; height:100%; font-family: var(--font); color: white; background: rgba(20,20,24,0.92); }
      .heal-header { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; gap: 12px; flex-wrap: wrap; }
      .heal-title { font-size: 14px; font-weight: 600; }
      .heal-status { font-size: 11px; color: rgba(255,255,255,0.5); }
      .heal-toggle { font-size: 11px; color: rgba(255,255,255,0.7); display:flex; align-items:center; gap: 6px; cursor: pointer; }
      .heal-tabs { padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); display:flex; gap: 8px; }
      .heal-chip { background: rgba(255,255,255,0.06); border: 1px solid transparent; padding: 4px 10px; border-radius: 999px; font-size: 11px; cursor: pointer; user-select: none; }
      .heal-chip.active { background: var(--accent, #ff7a00); color: white; }
      .heal-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
      .heal-empty { padding: 32px 16px; text-align:center; color: rgba(255,255,255,0.45); font-size: 13px; }
      .heal-empty-strong { font-size: 15px; color: rgba(255,255,255,0.7); margin-bottom: 6px; }
      .heal-row { padding: 14px; border-radius: 10px; background: rgba(255,255,255,0.04); margin-bottom: 10px; border-left: 3px solid var(--accent, #ff7a00); }
      .heal-row.focus { box-shadow: 0 0 0 1px rgba(255,122,0,0.4) inset; }
      .heal-row.applied { border-left-color: #4ade80; }
      .heal-row.discarded { border-left-color: rgba(255,255,255,0.2); opacity: 0.55; }
      .heal-row-title { font-size: 13px; font-weight: 600; line-height: 1.4; }
      .heal-row-where { font-size: 11px; color: rgba(255,255,255,0.55); margin-top: 4px; font-family: ui-monospace, monospace; }
      .heal-row-reason { font-size: 12px; color: rgba(255,255,255,0.75); margin-top: 8px; line-height: 1.5; }
      .heal-diff { margin-top: 10px; background: rgba(0,0,0,0.35); border-radius: 6px; padding: 10px; font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.45; white-space: pre; overflow-x: auto; max-height: 220px; }
      .heal-diff .add { color: #4ade80; }
      .heal-diff .del { color: #f87171; }
      .heal-diff .hdr { color: rgba(255,255,255,0.4); }
      .heal-actions { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
      .heal-btn { background: rgba(255,255,255,0.08); border: 1px solid transparent; color: white; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
      .heal-btn.primary { background: var(--accent, #ff7a00); }
      .heal-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .heal-result { margin-top: 10px; font-size: 11px; padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,0.3); }
      .heal-result.ok { color: #4ade80; }
      .heal-result.fail { color: #fca5a5; }
      .heal-result ul { margin: 6px 0 0 18px; padding: 0; }
    </style>
    <div class="heal-app">
      <div class="heal-header">
        <div>
          <div class="heal-title">🩹 Healer Log</div>
          <div class="heal-status" id="heal-status">Loading…</div>
        </div>
        <label class="heal-toggle">
          <input type="checkbox" id="heal-toggle-enabled"/>
          <span>Healer enabled</span>
        </label>
      </div>
      <div class="heal-tabs">
        <span class="heal-chip" data-filter="pending">Pending</span>
        <span class="heal-chip" data-filter="applied">Applied</span>
        <span class="heal-chip" data-filter="discarded">Discarded</span>
        <span class="heal-chip" data-filter="*">All</span>
      </div>
      <div class="heal-body" id="heal-body"></div>
    </div>
  `;

  const statusEl = container.querySelector('#heal-status');
  const bodyEl   = container.querySelector('#heal-body');
  const toggleEl = container.querySelector('#heal-toggle-enabled');

  // Initial toggle state.
  const initialStatus = getHealerStatus();
  toggleEl.checked = initialStatus.enabled;
  toggleEl.addEventListener('change', () => setHealerEnabled(toggleEl.checked));

  // Tab chips.
  container.querySelectorAll('.heal-chip').forEach(chip => {
    if (chip.dataset.filter === filter) chip.classList.add('active');
    chip.addEventListener('click', () => {
      container.querySelectorAll('.heal-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filter = chip.dataset.filter;
      render();
    });
  });

  async function render() {
    const status = getHealerStatus();
    statusEl.textContent =
      `${status.attemptsThisSession}/${status.maxAttemptsPerSession} attempts this session  ·  ` +
      `${status.seenErrors} unique error${status.seenErrors === 1 ? '' : 's'} seen`;

    try {
      proposals = await listHealerProposals(filter);
    } catch (e) {
      bodyEl.innerHTML = `<div class="heal-empty">Couldn't load: ${escapeHtml(e?.message || String(e))}</div>`;
      return;
    }

    if (!proposals.length) {
      bodyEl.innerHTML = `
        <div class="heal-empty">
          <div class="heal-empty-strong">No ${filter === '*' ? '' : filter} entries</div>
          ${filter === 'pending'
            ? `Healer activates when an app throws an uncaught exception.<br>
               When it finds a one-line fix, the proposal appears here.`
            : `Switch tabs to see other states.`}
        </div>`;
      return;
    }

    bodyEl.innerHTML = '';
    for (const p of proposals) {
      bodyEl.appendChild(renderRow(p));
    }
    if (focusId) {
      const el = bodyEl.querySelector(`[data-id="${focusId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function renderRow(p) {
    const div = document.createElement('div');
    div.className = `heal-row ${p.status}`;
    if (p.id === focusId) div.classList.add('focus');
    div.dataset.id = p.id;

    const reason = p.reason || '';
    const errLine = reason.split('\n')[0].replace(/^Healer-proposed fix for runtime error:\s*/, '');
    const explainLine = (reason.match(/AI diagnosis:\s*(.+)$/m) || [, ''])[1];

    div.innerHTML = `
      <div class="heal-row-title">${escapeHtml(errLine)}</div>
      <div class="heal-row-where">${escapeHtml(p.target || '')}</div>
      ${explainLine ? `<div class="heal-row-reason">${escapeHtml(explainLine)}</div>` : ''}
      <div class="heal-diff">${formatDiff(p.diff || '')}</div>
      <div class="heal-actions"></div>
    `;
    const actions = div.querySelector('.heal-actions');

    if (p.status === 'pending') {
      const apply = mkBtn('Apply through gates', 'primary');
      const discard = mkBtn('Discard');
      actions.appendChild(apply);
      actions.appendChild(discard);
      apply.addEventListener('click', () => onApply(p.id, div, apply, discard));
      discard.addEventListener('click', () => onDiscard(p.id, div, apply, discard));
    } else if (p.status === 'applied') {
      const tag = document.createElement('span');
      tag.className = 'heal-result ok';
      tag.textContent = '✓ Applied through self-mod gates';
      actions.appendChild(tag);
    } else if (p.status === 'discarded') {
      const tag = document.createElement('span');
      tag.className = 'heal-result fail';
      tag.textContent = '✕ Discarded' + (p.discardReason ? `: ${p.discardReason}` : '');
      actions.appendChild(tag);
    }
    return div;
  }

  async function onApply(id, row, applyBtn, discardBtn) {
    applyBtn.disabled = true; discardBtn.disabled = true;
    applyBtn.textContent = 'Running 6 gates…';

    const r = await applyProposal(id);
    const out = document.createElement('div');
    if (r.ok) {
      out.className = 'heal-result ok';
      out.textContent = '✓ Applied — all gates passed';
    } else {
      out.className = 'heal-result fail';
      const failed = (r.failed || []).map(f =>
        `<li>${escapeHtml(f.check)}: ${escapeHtml(f.reason || '')}</li>`).join('');
      out.innerHTML =
        `✕ Apply blocked: ${escapeHtml(r.error || 'gates failed')}` +
        (failed ? `<ul>${failed}</ul>` : '');
    }
    row.appendChild(out);
    applyBtn.textContent = 'Apply through gates';
    if (r.ok) {
      applyBtn.style.display = 'none';
      discardBtn.style.display = 'none';
    } else {
      applyBtn.disabled = false; discardBtn.disabled = false;
    }
    setTimeout(render, 1200);
  }

  async function onDiscard(id, row, applyBtn, discardBtn) {
    applyBtn.disabled = true; discardBtn.disabled = true;
    await discardProposal(id, 'user discarded from Healer Log');
    setTimeout(render, 200);
  }

  function mkBtn(text, cls) {
    const b = document.createElement('button');
    b.className = 'heal-btn' + (cls ? ' ' + cls : '');
    b.textContent = text;
    return b;
  }

  function formatDiff(diff) {
    return diff.split('\n').map(line => {
      const safe = escapeHtml(line);
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
        return `<span class="hdr">${safe}</span>`;
      }
      if (line.startsWith('+')) return `<span class="add">${safe}</span>`;
      if (line.startsWith('-')) return `<span class="del">${safe}</span>`;
      return safe;
    }).join('\n');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  }

  // Refresh whenever the healer files a new proposal or state changes.
  const unsubs = [
    eventBus.on('healer:proposal', () => render()),
    eventBus.on('selfmod:proposed', () => render()),
    eventBus.on('healer:toggled', e => { toggleEl.checked = e.enabled; render(); }),
  ];
  container.addEventListener('app:closing', () => unsubs.forEach(u => u && u()));

  render();
}
