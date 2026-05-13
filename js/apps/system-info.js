// Astrion OS — System Info (neofetch-style)
// Shows system information in a clean display.

import { processManager } from '../kernel/process-manager.js';

export function registerSystemInfo() {
  processManager.register('system-info', {
    name: 'System Info',
    icon: '\u2139\uFE0F',
    singleInstance: true,
    width: 600,
    height: 420,
    launch: (contentEl) => initSystemInfo(contentEl),
  });
}

async function initSystemInfo(container) {
  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,255,255,0.4);font-family:var(--font);">Loading...</div>`;

  let cpu = { model: 'Unknown', cores: '?', usage: 0, uptime: 0 };
  let mem = { total: 0, used: 0 };

  try {
    const [cpuRes, memRes] = await Promise.all([
      fetch('/api/system/cpu').then(r => r.json()).catch(() => cpu),
      fetch('/api/system/memory').then(r => r.json()).catch(() => mem),
    ]);
    cpu = cpuRes; mem = memRes;
  } catch {}

  const upH = Math.floor((cpu.uptime || 0) / 3600);
  const upM = Math.floor(((cpu.uptime || 0) % 3600) / 60);
  const userName = localStorage.getItem('nova-username') || 'astrion';
  const appCount = processManager.getAllApps().length;
  // Read the boot timeline persisted by boot.js. Last entry is the
  // total wall-clock boot duration (excluding wizard / login waits
  // since we mark login:complete before flush).
  let bootLabel = 'unknown';
  try {
    const t = JSON.parse(localStorage.getItem('nova-boot-timing') || 'null');
    if (t && Array.isArray(t.marks) && t.marks.length) {
      const total = t.marks[t.marks.length - 1].ms;
      const desktopVisible = t.marks.find(m => m.label === 'desktop:visible');
      bootLabel = desktopVisible
        ? `${desktopVisible.ms} ms to desktop · ${total} ms shell ready`
        : `${total} ms`;
    }
  } catch {}

  container.innerHTML = `
    <div style="display:flex; gap:24px; padding:24px; height:100%; font-family:'JetBrains Mono','Fira Code',monospace; font-size:12px; color:#c9d1d9; background:#0a0a14; align-items:center;">
      <div style="flex-shrink:0;">
        <svg width="120" height="120" viewBox="0 0 80 80" fill="none">
          <defs>
            <linearGradient id="si-grad" x1="0" y1="0" x2="80" y2="80">
              <stop offset="0%" stop-color="#007aff"/>
              <stop offset="100%" stop-color="#5856d6"/>
            </linearGradient>
          </defs>
          <circle cx="40" cy="40" r="38" fill="url(#si-grad)"/>
          <circle cx="40" cy="40" r="36" stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none"/>
          <path d="M28 40 L40 28 L52 40 L40 52 Z" fill="white" opacity="0.95"/>
          <circle cx="40" cy="40" r="6" fill="white"/>
        </svg>
      </div>
      <div style="line-height:1.8;">
        <div><span style="color:#58a6ff;font-weight:bold;">${userName}@astrion-os</span></div>
        <div style="color:rgba(255,255,255,0.2);">─────────────────────</div>
        <div><span style="color:#58a6ff;">OS:</span> Astrion OS 1.0 (Andromeda)</div>
        <div><span style="color:#58a6ff;">Kernel:</span> Astrion Kernel 1.0</div>
        <div><span style="color:#58a6ff;">Shell:</span> nova-shell (native GTK3)</div>
        <div><span style="color:#58a6ff;">CPU:</span> ${cpu.model || 'Unknown'}</div>
        <div><span style="color:#58a6ff;">Cores:</span> ${cpu.cores || '?'}</div>
        <div><span style="color:#58a6ff;">Memory:</span> ${mem.used || '?'} MB / ${mem.total || '?'} MB</div>
        <div><span style="color:#58a6ff;">Uptime:</span> ${upH}h ${upM}m</div>
        <div><span style="color:#58a6ff;">Browser:</span> Astrion Browser (WebKitGTK)</div>
        <div><span style="color:#58a6ff;">Apps:</span> ${appCount}</div>
        <div><span style="color:#58a6ff;">Boot:</span> ${bootLabel}</div>
        <div><span style="color:#58a6ff;">Resolution:</span> ${window.screen?.width || '?'}x${window.screen?.height || '?'}</div>
        <div style="margin-top:8px; display:flex; gap:4px;">
          ${['#ff3b30','#ff9500','#ffd60a','#34c759','#007aff','#5856d6','#af52de','#ff2d55'].map(c => `<div style="width:24px;height:24px;background:${c};border-radius:4px;"></div>`).join('')}
        </div>
      </div>
    </div>
    <div id="si-boot-detail" style="padding:16px 24px 24px;font-family:'JetBrains Mono','Fira Code',monospace;font-size:11px;color:#c9d1d9;background:#0a0a14;border-top:1px solid rgba(255,255,255,0.04);">${renderBootDetail()}</div>
  `;
}

// Per-phase boot timeline — surfaces lesson #178's instrumentation
// (kernel/storage/apps/desktop/etc. marks persisted to localStorage)
// as a real diagnostic the user can read. Today's row from the
// lazy-load pass (commits 972a09b + 6cfafc3) puts the 75/76 apps off
// the cold-boot critical path; this view makes that visible.
function renderBootDetail() {
  let timing;
  try { timing = JSON.parse(localStorage.getItem('nova-boot-timing') || 'null'); } catch { timing = null; }
  if (!timing || !Array.isArray(timing.marks) || timing.marks.length === 0) {
    return `<div style="opacity:0.5;">No boot timing recorded yet — refresh the page once to populate.</div>`;
  }
  const marks = timing.marks;
  const total = marks[marks.length - 1].ms;
  // Per-phase delta = mark.ms - prev.ms (or mark.ms for the first).
  const rows = marks.map((m, i) => {
    const prev = i > 0 ? marks[i - 1].ms : 0;
    const delta = m.ms - prev;
    const pct = total > 0 ? (delta / total) * 100 : 0;
    return { label: m.label, atMs: m.ms, deltaMs: delta, pct };
  });
  const maxDelta = Math.max(1, ...rows.map(r => r.deltaMs));
  const barRow = (r) => {
    const w = Math.max(1, Math.round((r.deltaMs / maxDelta) * 100));
    const color = r.deltaMs < 50 ? '#34c759' : r.deltaMs < 200 ? '#ffd60a' : r.deltaMs < 500 ? '#ff9500' : '#ff3b30';
    return `<div style="display:grid;grid-template-columns:160px 60px 40px 1fr;gap:8px;align-items:center;padding:3px 0;">
      <span style="color:#9be3ff;">${r.label}</span>
      <span style="color:rgba(255,255,255,0.65);text-align:right;">+${r.deltaMs} ms</span>
      <span style="color:rgba(255,255,255,0.4);text-align:right;">${r.pct.toFixed(1)}%</span>
      <div style="height:8px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${w}%;background:${color};border-radius:3px;"></div>
      </div>
    </div>`;
  };
  // Cold-boot module count = number of /js/apps/*.js entries fetched
  // during the page lifecycle so far. Read live from PerformanceResourceTiming.
  const appModulesLoaded = performance.getEntriesByType('resource')
    .filter(e => e.name.includes('/js/apps/'))
    .map(e => e.name.split('/apps/')[1])
    .filter(Boolean);
  const totalAppCount = (typeof processManager !== 'undefined' ? processManager.getAllApps().length : 0);
  const lazyDeferred = Math.max(0, totalAppCount - appModulesLoaded.length);
  return `
    <div style="font-size:12px;color:#a6e3a1;margin-bottom:10px;">Boot timeline · ${total} ms total</div>
    ${rows.map(barRow).join('')}
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.04);font-size:11px;color:rgba(255,255,255,0.65);line-height:1.7;">
      <div>App modules loaded so far: <span style="color:#9be3ff;">${appModulesLoaded.length}</span> / ${totalAppCount} registered
        <span style="color:rgba(255,255,255,0.4);"> · ${lazyDeferred} deferred via lazy stubs</span></div>
      <div style="color:rgba(255,255,255,0.4);font-size:10px;margin-top:2px;">First few loaded: ${appModulesLoaded.slice(0, 4).join(', ') || '(none)'}${appModulesLoaded.length > 4 ? ' …' : ''}</div>
    </div>
  `;
}
