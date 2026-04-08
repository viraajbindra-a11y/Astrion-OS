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
        <div><span style="color:#58a6ff;">Apps:</span> 29+</div>
        <div><span style="color:#58a6ff;">Resolution:</span> ${window.screen?.width || '?'}x${window.screen?.height || '?'}</div>
        <div style="margin-top:8px; display:flex; gap:4px;">
          ${['#ff3b30','#ff9500','#ffd60a','#34c759','#007aff','#5856d6','#af52de','#ff2d55'].map(c => `<div style="width:24px;height:24px;background:${c};border-radius:4px;"></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}
