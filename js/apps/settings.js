// NOVA OS — Settings App

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';
import { getTodaySummary, getDailyCap, setDailyCap, resetBudget } from '../kernel/budget-manager.js';
import { getAllAccuracy, getEscalatedCategories } from '../kernel/calibration-tracker.js';

export function registerSettings() {
  processManager.register('settings', {
    name: 'Settings',
    icon: '\u2699\uFE0F',
    iconClass: 'dock-icon-settings',
    singleInstance: true,
    width: 700,
    height: 500,
    launch: (contentEl) => {
      initSettings(contentEl);
    }
  });
}

const wallpapers = [
  // Hero wallpaper — contributed by friend (see tasks/contributions.md)
  { id: 'astrion-brain', name: 'Astrion Brain', colors: 'url("assets/wallpapers/astrion-brain.png")' },
  // Real SVG wallpapers
  { id: 'aurora',    name: 'Aurora',    colors: 'url("assets/wallpapers/aurora.svg")' },
  { id: 'ocean',     name: 'Sunset Bay', colors: 'url("assets/wallpapers/ocean.svg")' },
  { id: 'nebula',    name: 'Nebula',    colors: 'url("assets/wallpapers/nebula.svg")' },
  { id: 'mountains', name: 'Mountains', colors: 'url("assets/wallpapers/mountains.svg")' },
  { id: 'geometry',  name: 'Geometry',  colors: 'url("assets/wallpapers/geometry.svg")' },
  { id: 'forest',    name: 'Forest',    colors: 'url("assets/wallpapers/forest.svg")' },
  // Legacy gradient wallpapers (still available)
  { id: 'gradient-purple', name: 'Purple Gradient', colors: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460, #533483)' },
  { id: 'gradient-blue', name: 'Blue Gradient', colors: 'linear-gradient(135deg, #0c1445, #1a237e, #283593, #1565c0)' },
  { id: 'gradient-dark', name: 'Midnight', colors: 'linear-gradient(135deg, #0a0a0a, #1a1a1a, #2d2d2d, #1a1a1a)' },
  { id: 'gradient-sunset', name: 'Sunset', colors: 'linear-gradient(135deg, #1a0a2e, #4a1942, #7b2d5f, #b0413e)' },
  { id: 'gradient-space', name: 'Deep Space', colors: 'radial-gradient(ellipse at 30% 50%, #1a0533 0%, #0a0a1a 50%, #000000 100%)' },
  { id: 'gradient-neon', name: 'Neon City', colors: 'linear-gradient(135deg, #0a0020, #1a0050, #3a00a0, #ff00ff33)' },
];

function initSettings(container) {
  const currentWallpaper = localStorage.getItem('nova-wallpaper') || 'astrion-brain';
  let activeSection = 'appearance';

  const sections = {
    appearance: { icon: '\uD83C\uDFA8', name: 'Appearance' },
    display: { icon: '\uD83D\uDCBB', name: 'Display' },
    desktop: { icon: '\uD83D\uDDA5\uFE0F', name: 'Desktop & Dock' },
    keyboard: { icon: '\u2328\uFE0F', name: 'Keyboard' },
    sound: { icon: '\uD83D\uDD0A', name: 'Sound' },
    ai: { icon: '\u2728', name: 'AI Assistant' },
    about: { icon: '\u2139\uFE0F', name: 'About Astrion OS' },
  };

  container.innerHTML = `
    <div class="settings-app">
      <div class="settings-sidebar" id="settings-sidebar"></div>
      <div class="settings-main" id="settings-main"></div>
    </div>
  `;

  const sidebar = container.querySelector('#settings-sidebar');
  const main = container.querySelector('#settings-main');

  // Render sidebar
  sidebar.innerHTML = Object.entries(sections).map(([id, s]) => `
    <div class="settings-sidebar-item${id === activeSection ? ' active' : ''}" data-section="${id}">
      <span class="settings-sidebar-icon">${s.icon}</span> ${s.name}
    </div>
  `).join('');

  sidebar.addEventListener('click', (e) => {
    const item = e.target.closest('.settings-sidebar-item');
    if (!item) return;
    activeSection = item.dataset.section;
    sidebar.querySelectorAll('.settings-sidebar-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    renderSection();
  });

  function renderSection() {
    switch (activeSection) {
      case 'appearance': renderAppearance(); break;
      case 'display': renderDisplay(); break;
      case 'desktop': renderDesktop(); break;
      case 'keyboard': renderKeyboard(); break;
      case 'sound': renderSound(); break;
      case 'ai': renderAI(); break;
      case 'about': renderAbout(); break;
    }
  }

  async function renderDisplay() {
    const main = container.querySelector('#settings-main');
    main.innerHTML = `<div style="padding:24px;"><div style="font-size:13px; color:rgba(255,255,255,0.4);">Loading display info...</div></div>`;

    try {
      const res = await fetch('/api/display/info');
      const info = await res.json();

      main.innerHTML = `
        <div style="padding:24px;">
          <h2 style="font-size:20px; font-weight:600; margin:0 0 4px;">Display</h2>
          <p style="font-size:12px; color:rgba(255,255,255,0.4); margin:0 0 24px;">Output: ${info.output || 'Unknown'} \u00B7 Current: ${info.current || 'auto'}</p>

          <div style="font-size:13px; font-weight:600; margin-bottom:12px;">Resolution</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:8px; margin-bottom:28px;">
            ${(info.resolutions || []).map(r => `
              <button class="res-btn" data-res="${r.resolution}" style="
                padding:12px; border-radius:10px; cursor:pointer; font-family:var(--font);
                border:2px solid ${r.active ? 'var(--accent)' : 'rgba(255,255,255,0.08)'};
                background:${r.active ? 'rgba(0,122,255,0.15)' : 'rgba(255,255,255,0.04)'};
                color:white; font-size:13px; font-weight:${r.active ? '600' : '400'};
                text-align:center;
              ">
                ${r.resolution}
                <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px;">${r.rate} Hz${r.active ? ' \u2713' : ''}</div>
              </button>
            `).join('')}
          </div>

          <div style="font-size:13px; font-weight:600; margin-bottom:12px;">UI Zoom</div>
          <div style="display:flex; gap:8px; margin-bottom:28px;">
            ${[1.0, 1.25, 1.5, 1.75, 2.0].map(z => {
              const currentZoom = parseFloat(localStorage.getItem('nova-ui-zoom') || '1.5');
              const active = Math.abs(currentZoom - z) < 0.01;
              return `<button class="zoom-btn" data-zoom="${z}" style="
                padding:10px 18px; border-radius:8px; cursor:pointer; font-family:var(--font);
                border:2px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.08)'};
                background:${active ? 'rgba(0,122,255,0.15)' : 'rgba(255,255,255,0.04)'};
                color:white; font-size:13px; font-weight:${active ? '600' : '400'};
              ">${z}x</button>`;
            }).join('')}
          </div>
          <div style="font-size:11px; color:rgba(255,255,255,0.35);">
            UI Zoom changes require a page reload to take effect.
            Zoom is applied via the WebKit rendering engine and scales all UI elements uniformly.
          </div>
        </div>
      `;

      // Resolution buttons
      main.querySelectorAll('.res-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const res = btn.dataset.res;
          btn.textContent = 'Applying...';
          await fetch('/api/display/set-resolution', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resolution: res }),
          });
          setTimeout(() => renderDisplay(), 1000);
        });
      });

      // Zoom buttons — writes config file + restarts renderer
      main.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const zoom = parseFloat(btn.dataset.zoom);
          btn.textContent = 'Saving...';
          localStorage.setItem('nova-ui-zoom', String(zoom));
          try {
            const res = await fetch('/api/display/set-zoom', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ zoom }),
            });
            const data = await res.json();
            if (data.ok) {
              btn.textContent = 'Restarting...';
              // Give server time to write config, then renderer restarts
              setTimeout(() => {
                // Page will reload when renderer restarts
              }, 1000);
            } else {
              btn.textContent = 'Failed';
              setTimeout(() => renderDisplay(), 1500);
            }
          } catch {
            btn.textContent = 'Error';
            setTimeout(() => renderDisplay(), 1500);
          }
        });
      });

    } catch (err) {
      main.innerHTML = `<div style="padding:24px; color:rgba(255,255,255,0.4);">Display settings unavailable<br><span style="font-size:11px;">${err.message}</span></div>`;
    }
  }

  function renderAppearance() {
    main.innerHTML = `
      <div class="settings-section-title">Appearance</div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Theme</div>
            <div class="settings-row-desc">Choose your visual theme</div>
          </div>
          <select class="settings-select" id="setting-theme">
            <option value="dark" selected>Dark</option>
            <option value="light" disabled>Light (Coming Soon)</option>
          </select>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Accent Color</div>
            <div class="settings-row-desc">Used for buttons and highlights</div>
          </div>
          <div style="display:flex;gap:8px;">
            <div style="width:22px;height:22px;border-radius:50%;background:#007aff;cursor:pointer;border:2px solid white;"></div>
            <div style="width:22px;height:22px;border-radius:50%;background:#5856d6;cursor:pointer;" data-color="#5856d6"></div>
            <div style="width:22px;height:22px;border-radius:50%;background:#ff2d55;cursor:pointer;" data-color="#ff2d55"></div>
            <div style="width:22px;height:22px;border-radius:50%;background:#ff9500;cursor:pointer;" data-color="#ff9500"></div>
            <div style="width:22px;height:22px;border-radius:50%;background:#28c840;cursor:pointer;" data-color="#28c840"></div>
          </div>
        </div>
      </div>
      <div class="settings-section-title" style="margin-top:24px">Wallpaper</div>
      <div class="settings-wallpaper-grid">
        ${wallpapers.map(w => `
          <div class="settings-wallpaper-option${w.id === currentWallpaper ? ' active' : ''}" data-wallpaper="${w.id}" title="${w.name}">
            <div class="settings-wallpaper-color" style="background:${w.colors}"></div>
          </div>
        `).join('')}
      </div>
    `;

    // Wallpaper selection
    main.querySelectorAll('.settings-wallpaper-option').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.wallpaper;
        const wp = wallpapers.find(w => w.id === id);
        if (!wp) return;

        localStorage.setItem('nova-wallpaper', id);
        document.getElementById('desktop').style.backgroundImage = wp.colors;
        document.getElementById('desktop').style.backgroundColor = '';

        main.querySelectorAll('.settings-wallpaper-option').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
      });
    });

    // Accent color
    main.querySelectorAll('[data-color]').forEach(el => {
      el.addEventListener('click', () => {
        document.documentElement.style.setProperty('--accent', el.dataset.color);
        localStorage.setItem('nova-accent', el.dataset.color);
        main.querySelectorAll('[data-color]').forEach(e => e.style.border = 'none');
        el.style.border = '2px solid white';
      });
    });
  }

  function renderDesktop() {
    const dockMagnify = localStorage.getItem('nova-dock-magnify') !== 'false';

    main.innerHTML = `
      <div class="settings-section-title">Desktop & Dock</div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Dock Size</div>
            <div class="settings-row-desc">Adjust the dock icon size</div>
          </div>
          <input type="range" min="36" max="64" value="${localStorage.getItem('nova-dock-size') || '48'}" style="width:120px;accent-color:var(--accent);" id="dock-size-slider">
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Dock Magnification</div>
            <div class="settings-row-desc">Enlarge icons when hovering</div>
          </div>
          <button class="settings-toggle${dockMagnify ? ' on' : ''}" id="toggle-magnify"></button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Show Desktop Icons</div>
          </div>
          <button class="settings-toggle on" id="toggle-desktop-icons"></button>
        </div>
      </div>
    `;

    main.querySelector('#dock-size-slider').addEventListener('input', function() {
      const size = this.value + 'px';
      localStorage.setItem('nova-dock-size', this.value);
      document.querySelectorAll('.dock-item-icon').forEach(icon => {
        icon.style.width = size;
        icon.style.height = size;
      });
    });

    main.querySelector('#toggle-magnify').addEventListener('click', function() {
      this.classList.toggle('on');
      localStorage.setItem('nova-dock-magnify', this.classList.contains('on'));
    });

    main.querySelector('#toggle-desktop-icons').addEventListener('click', function() {
      this.classList.toggle('on');
      document.getElementById('desktop-icons').style.display = this.classList.contains('on') ? '' : 'none';
    });
  }

  function renderAI() {
    const currentProvider = localStorage.getItem('nova-ai-provider') || 'auto';
    const ollamaUrl = localStorage.getItem('nova-ai-ollama-url') || 'http://localhost:11434';
    const ollamaModel = localStorage.getItem('nova-ai-ollama-model') || 'llama3.2';

    main.innerHTML = `
      <div class="settings-section-title">AI Assistant</div>

      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">AI Provider</div>
            <div class="settings-row-desc">Choose where AI responses come from</div>
          </div>
          <select class="settings-select" id="ai-provider">
            <option value="auto" ${currentProvider === 'auto' ? 'selected' : ''}>Auto (try Ollama → Anthropic → offline)</option>
            <option value="ollama" ${currentProvider === 'ollama' ? 'selected' : ''}>Ollama (local/remote LLM)</option>
            <option value="anthropic" ${currentProvider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude API key)</option>
            <option value="mock" ${currentProvider === 'mock' ? 'selected' : ''}>Offline (demo mode)</option>
          </select>
        </div>
      </div>

      <div class="settings-group">
        <div style="padding:8px 14px 4px; font-size:11px; font-weight:600; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px;">Ollama Settings</div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Ollama URL</div>
            <div class="settings-row-desc">Local: http://localhost:11434 — Remote: http://192.168.x.x:11434</div>
          </div>
          <input type="text" id="ai-ollama-url" class="settings-select" value="${ollamaUrl}" style="width:260px; font-family:var(--mono,monospace); font-size:12px;">
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Model</div>
            <div class="settings-row-desc">e.g. llama3.2, mistral, phi3, gemma2</div>
          </div>
          <input type="text" id="ai-ollama-model" class="settings-select" value="${ollamaModel}" style="width:180px; font-family:var(--mono,monospace); font-size:12px;">
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Test Connection</div>
            <div class="settings-row-desc" id="ai-test-status">Click to verify Ollama is reachable</div>
          </div>
          <button class="settings-toggle" id="ai-test-btn" style="padding:6px 14px; border-radius:6px; border:none; background:var(--accent); color:white; font-size:12px; cursor:pointer; font-family:var(--font);">Test</button>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">AI in Apps</div>
            <div class="settings-row-desc">Enable AI features in Notes, Terminal, Messages</div>
          </div>
          <button class="settings-toggle on"></button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Search AI</div>
            <div class="settings-row-desc">Press Cmd+Space to ask Astrion anything</div>
          </div>
          <button class="settings-toggle on"></button>
        </div>
      </div>
    `;

    // ─── M3 Budget & Calibration Dashboard ───
    renderAIBudgetDashboard();

    // Save provider on change
    main.querySelector('#ai-provider').addEventListener('change', (e) => {
      localStorage.setItem('nova-ai-provider', e.target.value);
    });

    // Save Ollama URL on change
    main.querySelector('#ai-ollama-url').addEventListener('change', (e) => {
      localStorage.setItem('nova-ai-ollama-url', e.target.value.trim());
    });

    // Save model on change
    main.querySelector('#ai-ollama-model').addEventListener('change', (e) => {
      localStorage.setItem('nova-ai-ollama-model', e.target.value.trim());
    });

    // Test connection
    main.querySelector('#ai-test-btn').addEventListener('click', async () => {
      const status = main.querySelector('#ai-test-status');
      const url = main.querySelector('#ai-ollama-url').value.trim();
      const model = main.querySelector('#ai-ollama-model').value.trim();
      status.textContent = 'Testing...';
      status.style.color = 'rgba(255,255,255,0.5)';

      try {
        const res = await fetch('/api/ai/ollama', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url,
            model,
            system: 'Reply with just "OK" and nothing else.',
            messages: [{ role: 'user', content: 'Test' }],
          }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (data.reply) {
          status.textContent = '\u2705 Connected! Model: ' + (data.model || model);
          status.style.color = '#34c759';
        } else {
          status.textContent = '\u274C Failed: ' + (data.error || 'No response');
          status.style.color = '#ff3b30';
        }
      } catch (err) {
        status.textContent = '\u274C ' + err.message;
        status.style.color = '#ff3b30';
      }
    });
  }

  async function renderAIBudgetDashboard() {
    const summary = getTodaySummary();
    const s1Stats = await getAllAccuracy('s1');
    const escalated = await getEscalatedCategories();

    const pct = Math.min(100, summary.percentUsed);
    const barColor = pct > 80 ? '#ff3b30' : pct > 50 ? '#ffcc00' : '#34c759';

    // Build category rows for calibration table
    const catRows = Object.entries(s1Stats).map(([cat, s]) => {
      const accColor = s.accuracy >= 0.7 ? '#34c759' : s.accuracy >= 0.5 ? '#ffcc00' : '#ff3b30';
      const esc = escalated.find(e => e.category === cat);
      return `<tr>
        <td style="padding:4px 8px; font-size:12px; color:white;">${cat}</td>
        <td style="padding:4px 8px; font-size:12px; color:${accColor}; font-weight:600;">${Math.round(s.accuracy * 100)}%</td>
        <td style="padding:4px 8px; font-size:12px; color:rgba(255,255,255,0.5);">${s.total}</td>
        <td style="padding:4px 8px; font-size:12px; color:rgba(255,255,255,0.5);">${s.avgResponseMs}ms</td>
        <td style="padding:4px 8px; font-size:12px; color:${esc ? '#ff3b30' : '#34c759'};">${esc ? '→ S2' : 'S1'}</td>
      </tr>`;
    }).join('');

    const dashboardHtml = `
      <div class="settings-group" style="margin-top:16px;">
        <div style="padding:8px 14px 4px; font-size:11px; font-weight:600; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px;">Cloud AI Budget (S2)</div>
        <div class="settings-row">
          <div style="flex:1;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span style="font-size:12px; color:white;">$${summary.totalCostUsd.toFixed(4)} spent today</span>
              <span style="font-size:12px; color:rgba(255,255,255,0.5);">$${summary.dailyCapUsd.toFixed(2)} cap</span>
            </div>
            <div style="height:8px; background:rgba(255,255,255,0.1); border-radius:4px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:6px;">
              <span style="font-size:11px; color:rgba(255,255,255,0.4);">${summary.callCount} calls</span>
              <span style="font-size:11px; color:rgba(255,255,255,0.4);">$${summary.remainingUsd.toFixed(4)} remaining</span>
            </div>
          </div>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Daily Cap</div>
            <div class="settings-row-desc">Max cloud AI spending per day (USD)</div>
          </div>
          <input type="number" id="ai-daily-cap" class="settings-select" value="${summary.dailyCapUsd}" step="0.10" min="0.01" max="50" style="width:80px; font-family:var(--mono,monospace); font-size:12px; text-align:right;">
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Reset Today's Budget</div>
            <div class="settings-row-desc">Clear the daily spending counter</div>
          </div>
          <button class="settings-toggle" id="ai-reset-budget" style="padding:6px 14px; border-radius:6px; border:none; background:#ff3b30; color:white; font-size:12px; cursor:pointer; font-family:var(--font);">Reset</button>
        </div>
      </div>

      <div class="settings-group" style="margin-top:16px;">
        <div style="padding:8px 14px 4px; font-size:11px; font-weight:600; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px;">Brain Calibration (S1 Accuracy)</div>
        ${catRows.length > 0 ? `
        <div style="padding:8px 14px;">
          <table style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                <th style="padding:4px 8px; font-size:11px; color:rgba(255,255,255,0.4); text-align:left; font-weight:500;">Category</th>
                <th style="padding:4px 8px; font-size:11px; color:rgba(255,255,255,0.4); text-align:left; font-weight:500;">Accuracy</th>
                <th style="padding:4px 8px; font-size:11px; color:rgba(255,255,255,0.4); text-align:left; font-weight:500;">Samples</th>
                <th style="padding:4px 8px; font-size:11px; color:rgba(255,255,255,0.4); text-align:left; font-weight:500;">Avg Time</th>
                <th style="padding:4px 8px; font-size:11px; color:rgba(255,255,255,0.4); text-align:left; font-weight:500;">Brain</th>
              </tr>
            </thead>
            <tbody>${catRows}</tbody>
          </table>
        </div>
        ` : `
        <div class="settings-row">
          <div>
            <div class="settings-row-label" style="color:rgba(255,255,255,0.4);">No calibration data yet</div>
            <div class="settings-row-desc">Use Spotlight or Messages to generate samples. After 5+ samples per category, weak categories auto-escalate to S2.</div>
          </div>
        </div>
        `}
        ${escalated.length > 0 ? `
        <div style="padding:4px 14px 8px;">
          <div style="font-size:11px; color:#ff3b30;">⚠ ${escalated.length} categor${escalated.length === 1 ? 'y' : 'ies'} escalated to S2 (accuracy < 70%): ${escalated.map(e => e.category).join(', ')}</div>
        </div>
        ` : ''}
      </div>
    `;

    // Append to main content
    main.insertAdjacentHTML('beforeend', dashboardHtml);

    // Wire up cap change
    main.querySelector('#ai-daily-cap')?.addEventListener('change', (e) => {
      setDailyCap(parseFloat(e.target.value) || 0.50);
    });

    // Wire up reset
    main.querySelector('#ai-reset-budget')?.addEventListener('click', () => {
      resetBudget();
      renderAI(); // re-render the whole section
    });
  }

  function renderKeyboard() {
    const shortcuts = [
      ['Cmd+Space', 'Open Search'],
      ['Cmd+N', 'New Finder window'],
      ['Cmd+T', 'New Terminal'],
      ['Cmd+W', 'Close window'],
      ['Cmd+M', 'Minimize window'],
      ['Cmd+H', 'Hide all windows'],
      ['Cmd+Q', 'Quit app'],
      ['Cmd+,', 'Open Settings'],
      ['Cmd+L', 'Lock screen'],
      ['Cmd+Shift+Left', 'Snap window left'],
      ['Cmd+Shift+Right', 'Snap window right'],
      ['Cmd+Shift+Up', 'Maximize window'],
      ['Alt+Tab', 'Cycle windows'],
      ['Ctrl+Alt+T', 'Open Terminal'],
      ['Ctrl+Alt+F', 'Open File Manager'],
      ['Ctrl+Alt+B', 'Open Browser'],
      ['F4', 'Open App Grid'],
      ['F11', 'Toggle fullscreen'],
      ['Cmd+Shift+3', 'Screenshot'],
    ];

    main.innerHTML = `
      <div class="settings-section-title">Keyboard Shortcuts</div>
      <div class="settings-group">
        ${shortcuts.map(([key, desc]) => `
          <div class="settings-row" style="padding:6px 0;">
            <div class="settings-row-label" style="flex:1;font-size:13px;">${desc}</div>
            <div style="display:flex;gap:4px;">
              ${key.split('+').map(k => `<kbd style="background:rgba(255,255,255,0.08);padding:3px 8px;border-radius:5px;font-size:11px;font-family:var(--font);color:var(--text-secondary);border:1px solid rgba(255,255,255,0.1);">${k}</kbd>`).join('<span style="color:rgba(255,255,255,0.2);line-height:24px;">+</span>')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderSound() {
    const volume = localStorage.getItem('nova-volume') || '80';
    const soundEffects = localStorage.getItem('nova-sound-effects') !== 'false';

    main.innerHTML = `
      <div class="settings-section-title">Sound</div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">System Volume</div>
            <div class="settings-row-desc">Main output volume</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">🔈</span>
            <input type="range" min="0" max="100" value="${volume}" style="width:120px;accent-color:var(--accent);" id="volume-slider">
            <span style="font-size:16px;">🔊</span>
            <span style="font-size:12px;color:var(--text-tertiary);width:30px;" id="volume-label">${volume}%</span>
          </div>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Sound Effects</div>
            <div class="settings-row-desc">Play sounds for system actions</div>
          </div>
          <button class="settings-toggle${soundEffects ? ' on' : ''}" id="toggle-sound-fx"></button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Notification Sounds</div>
            <div class="settings-row-desc">Play a sound when notifications arrive</div>
          </div>
          <button class="settings-toggle on" id="toggle-notif-sound"></button>
        </div>
      </div>
      <div class="settings-group" style="margin-top:16px;">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Output Device</div>
          </div>
          <select class="settings-select">
            <option>Built-in Speakers</option>
            <option disabled>Bluetooth Audio</option>
          </select>
        </div>
      </div>
    `;

    main.querySelector('#volume-slider').addEventListener('input', function() {
      localStorage.setItem('nova-volume', this.value);
      main.querySelector('#volume-label').textContent = this.value + '%';
    });

    main.querySelector('#toggle-sound-fx').addEventListener('click', function() {
      this.classList.toggle('on');
      localStorage.setItem('nova-sound-effects', this.classList.contains('on'));
    });

    main.querySelector('#toggle-notif-sound')?.addEventListener('click', function() {
      this.classList.toggle('on');
    });
  }

  function renderAbout() {
    main.innerHTML = `
      <div class="settings-about">
        <div class="settings-about-logo">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="40" r="36" stroke="var(--accent)" stroke-width="2"/>
            <path d="M28 40 L40 28 L52 40 L40 52 Z" fill="var(--accent)"/>
            <circle cx="40" cy="40" r="6" fill="var(--accent)"/>
          </svg>
        </div>
        <div class="settings-about-name">Astrion OS</div>
        <div class="settings-about-version">Version 0.1.0 (Early Prototype)</div>
        <div class="settings-about-info">
          An AI-native operating system built for the future.
          <br><br>
          AI deeply integrated into every app and workflow.
          <br>
          Cross-platform via web technology.
          <br><br>
          Built with love by the Astrion team.
          <br><br>
          \u00A9 ${new Date().getFullYear()} Astrion OS Project
        </div>
      </div>
    `;
  }

  renderSection();
}

// Apply saved wallpaper on boot — defaults to the Astrion Brain hero
// wallpaper (contributed by a friend — see tasks/contributions.md) if no
// user preference has been saved yet.
export function applyWallpaper() {
  const id = localStorage.getItem('nova-wallpaper') || 'astrion-brain';
  const wp = wallpapers.find(w => w.id === id);
  if (wp) {
    const desktop = document.getElementById('desktop');
    if (!desktop) return;
    desktop.style.backgroundImage = wp.colors;
    desktop.style.backgroundSize = 'cover';
    desktop.style.backgroundPosition = 'center';
    desktop.style.backgroundRepeat = 'no-repeat';
    desktop.style.backgroundColor = '';
  }
}

// Apply saved accent color on boot
export function applyAccentColor() {
  const color = localStorage.getItem('nova-accent');
  if (color) {
    document.documentElement.style.setProperty('--accent', color);
  }
}
