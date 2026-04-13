// NOVA OS — Task Manager / Activity Monitor
// Full system task manager with real process data, CPU/memory/disk/network
// charts, services management, and process kill. Reads from server
// endpoints that use /proc, ps, systemctl on the ISO.

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';
import { notifications } from '../kernel/notifications.js';

export function registerActivityMonitor() {
  processManager.register('activity-monitor', {
    name: 'Task Manager',
    icon: '\uD83D\uDCCA',
    iconClass: 'dock-icon-activity',
    singleInstance: true,
    width: 860,
    height: 560,
    minWidth: 700,
    minHeight: 400,
    launch: (contentEl, instanceId) => {
      initTaskManager(contentEl, instanceId);
    }
  });
}

function initTaskManager(container, instanceId) {
  let activeTab = 'processes';
  let sortKey = 'cpu';
  let sortDesc = true;
  let searchFilter = '';
  let refreshTimer = null;
  let cpuHistory = [];
  let memHistory = [];

  function render() {
    container.innerHTML = `
      <div class="tm" style="display:flex; flex-direction:column; height:100%; font-family:var(--font); color:white; background:#1a1a22;">
        <div class="tm-tabs" style="display:flex; border-bottom:1px solid rgba(255,255,255,0.08); padding:0 12px; gap:0;">
          ${['processes', 'performance', 'services'].map(tab =>
            `<button class="tm-tab" data-tab="${tab}" style="
              padding:10px 18px; border:none; font-size:12px; font-weight:${activeTab === tab ? '600' : '400'};
              color:${activeTab === tab ? 'white' : 'rgba(255,255,255,0.5)'};
              background:${activeTab === tab ? 'rgba(255,255,255,0.08)' : 'transparent'};
              border-bottom:2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'};
              cursor:pointer; font-family:var(--font); text-transform:capitalize;
            ">${tab}</button>`
          ).join('')}
          <div style="flex:1;"></div>
          ${activeTab === 'processes' ? `<input type="text" id="tm-search" placeholder="Search…" value="${searchFilter}" style="margin:6px 0; padding:5px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.05); color:white; font-size:11px; font-family:var(--font); outline:none; width:160px;">` : ''}
        </div>
        <div id="tm-content" style="flex:1; overflow:auto;"></div>
      </div>
    `;

    container.querySelectorAll('.tm-tab').forEach(btn => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(); });
    });

    const search = container.querySelector('#tm-search');
    if (search) {
      search.addEventListener('input', () => { searchFilter = search.value; loadTab(); });
      search.focus();
    }

    loadTab();
  }

  async function loadTab() {
    const content = container.querySelector('#tm-content');
    if (!content) return;

    if (activeTab === 'processes') await renderProcesses(content);
    else if (activeTab === 'performance') await renderPerformance(content);
    else if (activeTab === 'services') await renderServices(content);
  }

  async function renderProcesses(el) {
    try {
      const res = await fetch('/api/system/processes');
      const { processes } = await res.json();

      let filtered = processes;
      if (searchFilter) {
        const q = searchFilter.toLowerCase();
        filtered = processes.filter(p => p.command.toLowerCase().includes(q) || p.user.includes(q) || String(p.pid).includes(q));
      }

      // Sort
      filtered.sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        return sortDesc ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
      });

      // Limit to top 100
      filtered = filtered.slice(0, 100);

      const headers = [
        { key: 'command', label: 'Name', width: '35%' },
        { key: 'pid', label: 'PID', width: '8%' },
        { key: 'user', label: 'User', width: '10%' },
        { key: 'cpu', label: 'CPU %', width: '10%' },
        { key: 'mem', label: 'Mem %', width: '10%' },
        { key: 'rss', label: 'Memory', width: '12%' },
        { key: 'stat', label: 'Status', width: '8%' },
      ];

      el.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:11px;">
          <thead>
            <tr style="position:sticky; top:0; background:#1a1a22; z-index:1;">
              ${headers.map(h => `
                <th data-sort="${h.key}" style="
                  text-align:left; padding:8px 10px; font-weight:500; cursor:pointer;
                  color:${sortKey === h.key ? 'var(--accent)' : 'rgba(255,255,255,0.5)'};
                  width:${h.width}; border-bottom:1px solid rgba(255,255,255,0.06);
                  user-select:none; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;
                ">${h.label} ${sortKey === h.key ? (sortDesc ? '\u25BC' : '\u25B2') : ''}</th>
              `).join('')}
              <th style="width:7%; padding:8px 10px; border-bottom:1px solid rgba(255,255,255,0.06);"></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(p => {
              const name = p.command.split('/').pop().split(' ')[0] || p.command;
              const memMB = (p.rss / 1024).toFixed(1);
              const cpuColor = p.cpu > 50 ? '#ff3b30' : p.cpu > 20 ? '#ff9500' : 'rgba(255,255,255,0.8)';
              const memColor = p.mem > 50 ? '#ff3b30' : p.mem > 20 ? '#ff9500' : 'rgba(255,255,255,0.8)';
              return `
                <tr class="tm-row" data-pid="${p.pid}" style="transition:background 0.1s;">
                  <td style="padding:6px 10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:0;" title="${esc(p.command)}">${esc(name)}</td>
                  <td style="padding:6px 10px; font-family:var(--mono,monospace); color:rgba(255,255,255,0.5);">${p.pid}</td>
                  <td style="padding:6px 10px; color:rgba(255,255,255,0.5);">${p.user}</td>
                  <td style="padding:6px 10px; color:${cpuColor}; font-weight:${p.cpu > 10 ? '600' : '400'};">${p.cpu.toFixed(1)}</td>
                  <td style="padding:6px 10px; color:${memColor};">${p.mem.toFixed(1)}</td>
                  <td style="padding:6px 10px; color:rgba(255,255,255,0.6);">${memMB} MB</td>
                  <td style="padding:6px 10px; color:rgba(255,255,255,0.4);">${p.stat}</td>
                  <td style="padding:6px 4px;">
                    <button class="tm-kill" data-pid="${p.pid}" title="End process" style="
                      background:rgba(255,59,48,0.15); border:none; color:#ff6b6b;
                      width:24px; height:24px; border-radius:5px; cursor:pointer;
                      font-size:12px; display:none;
                    ">\u00D7</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div style="padding:8px 12px; font-size:10px; color:rgba(255,255,255,0.3); border-top:1px solid rgba(255,255,255,0.06);">
          ${filtered.length} processes${searchFilter ? ` matching "${esc(searchFilter)}"` : ''} \u00B7 Sorted by ${sortKey} ${sortDesc ? '\u25BC' : '\u25B2'}
        </div>
      `;

      // Event delegation on the stable content element — avoids re-adding
      // per-element listeners on every 2-second refresh cycle.
      el.onclick = async (e) => {
        // Sort header click
        const th = e.target.closest('[data-sort]');
        if (th) {
          if (sortKey === th.dataset.sort) sortDesc = !sortDesc;
          else { sortKey = th.dataset.sort; sortDesc = true; }
          loadTab();
          return;
        }
        // Kill button click
        const killBtn = e.target.closest('.tm-kill');
        if (killBtn) {
          e.stopPropagation();
          const pid = killBtn.dataset.pid;
          if (!confirm(`Kill process ${pid}?`)) return;
          await fetch('/api/system/kill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pid }),
          });
          notifications.show({ title: 'Process killed', body: `PID ${pid}`, icon: '\uD83D\uDED1', duration: 2000 });
          loadTab();
        }
      };
      el.onmouseover = (e) => {
        const row = e.target.closest('.tm-row');
        if (row) {
          row.style.background = 'rgba(255,255,255,0.04)';
          const kb = row.querySelector('.tm-kill');
          if (kb) kb.style.display = 'block';
        }
      };
      el.onmouseout = (e) => {
        const row = e.target.closest('.tm-row');
        if (row) {
          row.style.background = '';
          const kb = row.querySelector('.tm-kill');
          if (kb) kb.style.display = 'none';
        }
      };
    } catch (err) {
      el.innerHTML = `<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Could not load processes<br><span style="font-size:11px;">${err.message}</span></div>`;
    }
  }

  async function renderPerformance(el) {
    try {
      const [cpuRes, memRes, diskRes, netRes] = await Promise.all([
        fetch('/api/system/cpu').then(r => r.json()),
        fetch('/api/system/memory').then(r => r.json()),
        fetch('/api/system/disk').then(r => r.json()),
        fetch('/api/system/network-stats').then(r => r.json()),
      ]);

      cpuHistory.push(cpuRes.usage);
      memHistory.push(Math.round((memRes.used / memRes.total) * 100));
      if (cpuHistory.length > 60) cpuHistory.shift();
      if (memHistory.length > 60) memHistory.shift();

      const upH = Math.floor(cpuRes.uptime / 3600);
      const upM = Math.floor((cpuRes.uptime % 3600) / 60);

      el.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px;">
          <!-- CPU -->
          <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
              <span style="font-size:13px; font-weight:600;">CPU</span>
              <span style="font-size:24px; font-weight:300; color:var(--accent);">${cpuRes.usage}%</span>
            </div>
            <canvas id="tm-cpu-chart" width="360" height="100" style="width:100%; height:100px; border-radius:8px; background:rgba(0,0,0,0.3);"></canvas>
            <div style="margin-top:10px; font-size:10px; color:rgba(255,255,255,0.4); line-height:1.8;">
              ${cpuRes.model}<br>
              ${cpuRes.cores} cores \u00B7 Uptime: ${upH}h ${upM}m
            </div>
          </div>

          <!-- Memory -->
          <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
              <span style="font-size:13px; font-weight:600;">Memory</span>
              <span style="font-size:24px; font-weight:300; color:#34c759;">${memRes.used} / ${memRes.total} MB</span>
            </div>
            <canvas id="tm-mem-chart" width="360" height="100" style="width:100%; height:100px; border-radius:8px; background:rgba(0,0,0,0.3);"></canvas>
            <div style="margin-top:10px; font-size:10px; color:rgba(255,255,255,0.4); line-height:1.8;">
              Available: ${memRes.available} MB \u00B7 Cached: ${memRes.cached} MB<br>
              Swap: ${memRes.swapUsed} / ${memRes.swapTotal} MB
            </div>
          </div>

          <!-- Disk -->
          <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:16px;">
            <div style="font-size:13px; font-weight:600; margin-bottom:12px;">Disk</div>
            ${(diskRes.disks || []).map(d => `
              <div style="margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                  <span style="color:rgba(255,255,255,0.7);">${d.mount}</span>
                  <span style="color:rgba(255,255,255,0.5);">${d.used} / ${d.size} (${d.percent})</span>
                </div>
                <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                  <div style="height:100%; width:${d.percent}; background:#ff9500; border-radius:3px;"></div>
                </div>
              </div>
            `).join('') || '<div style="font-size:11px; color:rgba(255,255,255,0.3);">No disks</div>'}
          </div>

          <!-- Network -->
          <div style="background:rgba(255,255,255,0.03); border-radius:12px; padding:16px;">
            <div style="font-size:13px; font-weight:600; margin-bottom:12px;">Network</div>
            ${(netRes.interfaces || []).map(i => `
              <div style="margin-bottom:10px;">
                <div style="font-size:11px; font-weight:500; color:rgba(255,255,255,0.7); margin-bottom:4px;">${i.name}</div>
                <div style="display:flex; gap:20px; font-size:10px; color:rgba(255,255,255,0.5);">
                  <span>\u2B07 ${formatBytes(i.rxBytes)}</span>
                  <span>\u2B06 ${formatBytes(i.txBytes)}</span>
                  <span>${i.rxPackets} pkts in</span>
                  <span>${i.txPackets} pkts out</span>
                </div>
              </div>
            `).join('') || '<div style="font-size:11px; color:rgba(255,255,255,0.3);">No interfaces</div>'}
          </div>
        </div>
      `;

      // Draw charts
      drawChart('tm-cpu-chart', cpuHistory, '#007aff');
      drawChart('tm-mem-chart', memHistory, '#34c759');
    } catch (err) {
      el.innerHTML = `<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Could not load performance data<br><span style="font-size:11px;">${err.message}</span></div>`;
    }
  }

  async function renderServices(el) {
    try {
      const res = await fetch('/api/system/services');
      const { services } = await res.json();

      el.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:11px;">
          <thead>
            <tr style="position:sticky; top:0; background:#1a1a22; z-index:1;">
              <th style="text-align:left; padding:8px 10px; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.06);">Service</th>
              <th style="text-align:left; padding:8px 10px; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.06);">Status</th>
              <th style="text-align:left; padding:8px 10px; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.06);">Sub</th>
              <th style="text-align:left; padding:8px 10px; color:rgba(255,255,255,0.5); font-size:10px; text-transform:uppercase; border-bottom:1px solid rgba(255,255,255,0.06);">Description</th>
            </tr>
          </thead>
          <tbody>
            ${services.slice(0, 80).map(s => {
              const color = s.active === 'active' ? '#34c759' : s.active === 'failed' ? '#ff3b30' : 'rgba(255,255,255,0.4)';
              return `
                <tr style="transition:background 0.1s;" onmouseenter="this.style.background='rgba(255,255,255,0.04)'" onmouseleave="this.style.background=''">
                  <td style="padding:6px 10px; font-family:var(--mono,monospace); font-size:10px;">${esc(s.name)}</td>
                  <td style="padding:6px 10px; color:${color}; font-weight:500;">${s.active}</td>
                  <td style="padding:6px 10px; color:rgba(255,255,255,0.5);">${s.sub}</td>
                  <td style="padding:6px 10px; color:rgba(255,255,255,0.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px;">${esc(s.description)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <div style="padding:8px 12px; font-size:10px; color:rgba(255,255,255,0.3); border-top:1px solid rgba(255,255,255,0.06);">
          ${services.length} services
        </div>
      `;
    } catch (err) {
      el.innerHTML = `<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Could not load services<br><span style="font-size:11px;">${err.message}</span></div>`;
    }
  }

  function drawChart(canvasId, data, color) {
    const canvas = container.querySelector(`#${canvasId}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let y = 0; y <= 100; y += 25) {
      const py = h - (y / 100) * h;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    }

    // Data line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    const step = w / (60 - 1);
    const offset = 60 - data.length;
    data.forEach((val, i) => {
      const x = (offset + i) * step;
      const y = h - (val / 100) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill under line
    ctx.lineTo((offset + data.length - 1) * step, h);
    ctx.lineTo(offset * step, h);
    ctx.closePath();
    ctx.fillStyle = color.replace(')', ',0.1)').replace('rgb', 'rgba');
    ctx.fill();
  }

  render();

  // Auto-refresh every 2 seconds
  refreshTimer = setInterval(loadTab, 2000);

  // Cleanup observer
  const observer = new MutationObserver(() => {
    if (!document.contains(container)) {
      clearInterval(refreshTimer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
