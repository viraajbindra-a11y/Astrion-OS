// NOVA OS — Settings App

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';
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
    skills: { icon: '\uD83E\uDDE9', name: 'Skills' },
    safety: { icon: '\uD83D\uDEE1\uFE0F', name: 'Safety' },
    system: { icon: '\uD83D\uDCE6', name: 'System Config' },
    security: { icon: '\uD83D\uDD12', name: 'Security & Privacy' },
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
      case 'skills': renderSkills(); break;
      case 'safety': renderSafety(); break;
      case 'system': renderSystemConfig(); break;
      case 'security': renderSecurity(); break;
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
    const ollamaModel = localStorage.getItem('nova-ai-ollama-model') || 'qwen2.5:7b';

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
            <div class="settings-row-desc">e.g. qwen2.5:7b, qwen2.5:1.5b, llama3.2, phi3 — pull via <code>ollama pull MODEL</code></div>
          </div>
          <input type="text" id="ai-ollama-model" list="ai-model-suggestions" class="settings-select" value="${ollamaModel}" style="width:180px; font-family:var(--mono,monospace); font-size:12px;">
          <datalist id="ai-model-suggestions"></datalist>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Red-team model <span style="font-size:10px; color:rgba(255,255,255,0.4); font-weight:normal;">(M8.P3.b)</span></div>
            <div class="settings-row-desc" id="ai-redteam-pull-status">A DIFFERENT model from above reviews every L2+ action. Blank = use primary. True second-opinion safety — pull a different family (e.g. llama3.2) for real diversity.</div>
          </div>
          <div style="display:flex; gap:6px;">
            <input type="text" id="ai-redteam-model" list="ai-model-suggestions" class="settings-select" value="${localStorage.getItem('nova-ai-redteam-model') || ''}" placeholder="e.g. llama3.2" style="width:140px; font-family:var(--mono,monospace); font-size:12px;">
            <button id="ai-redteam-pull-btn" style="padding:6px 10px; border-radius:6px; border:none; background:#8b5cf6; color:white; font-size:11px; cursor:pointer; font-family:var(--font);">Pull</button>
          </div>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Available models <span style="font-size:10px; color:rgba(255,255,255,0.4); font-weight:normal;">(pulled in this Ollama)</span></div>
            <div class="settings-row-desc" id="ai-model-list-status">Click Refresh to list models — picks them up in the dropdowns above</div>
          </div>
          <button id="ai-refresh-models-btn" style="padding:6px 14px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:transparent; color:rgba(255,255,255,0.8); font-size:12px; cursor:pointer; font-family:var(--font);">Refresh</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Test Connection</div>
            <div class="settings-row-desc" id="ai-test-status">Click to verify Ollama is reachable</div>
          </div>
          <button class="settings-toggle" id="ai-test-btn" style="padding:6px 14px; border-radius:6px; border:none; background:var(--accent); color:white; font-size:12px; cursor:pointer; font-family:var(--font);">Test</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Download Model</div>
            <div class="settings-row-desc" id="ai-pull-status">Pull the named model into the running Ollama (size: 0.5b ≈ 400MB, 7b ≈ 4GB)</div>
          </div>
          <button class="settings-toggle" id="ai-pull-btn" style="padding:6px 14px; border-radius:6px; border:none; background:#8b5cf6; color:white; font-size:12px; cursor:pointer; font-family:var(--font);">Pull</button>
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

    // Fetch available models from the configured Ollama host + populate
    // the <datalist>. Runs on Settings render AND on Refresh click so the
    // user can add/remove models externally and sync without a reload.
    async function refreshOllamaModels() {
      const urlInput = main.querySelector('#ai-ollama-url');
      const url = (urlInput && urlInput.value.trim()) || 'http://localhost:11434';
      const status = main.querySelector('#ai-model-list-status');
      const list = main.querySelector('#ai-model-suggestions');
      if (!list) return;
      if (status) status.textContent = 'Fetching models from ' + url + '\u2026';
      try {
        const res = await fetch('/api/ai/ollama-tags?url=' + encodeURIComponent(url), {
          signal: AbortSignal.timeout(6000),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'fetch failed');
        list.innerHTML = data.models.map(m => {
          const gb = m.size_bytes ? (m.size_bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB' : '';
          return `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)} ${gb}</option>`;
        }).join('');
        if (status) status.textContent = data.models.length + ' model' + (data.models.length === 1 ? '' : 's') + ' pulled — type in the fields above to filter';
      } catch (err) {
        if (status) status.textContent = '\u2717 ' + (err?.message || 'fetch failed') + ' \u00B7 the datalist will stay empty until Ollama is reachable';
      }
    }
    main.querySelector('#ai-refresh-models-btn')?.addEventListener('click', refreshOllamaModels);
    // Auto-fire once on tab open (fire-and-forget)
    refreshOllamaModels();

    // M8.P3.b — save red-team model override
    main.querySelector('#ai-redteam-model').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (v) localStorage.setItem('nova-ai-redteam-model', v);
      else localStorage.removeItem('nova-ai-redteam-model');
    });

    // M8.P3.b — pull the red-team model into Ollama. Streams ndjson
    // progress from /api/ai/ollama-pull just like the primary-model
    // pull button above.
    main.querySelector('#ai-redteam-pull-btn').addEventListener('click', async () => {
      const url = main.querySelector('#ai-ollama-url').value.trim();
      const model = main.querySelector('#ai-redteam-model').value.trim();
      const status = main.querySelector('#ai-redteam-pull-status');
      const btn = main.querySelector('#ai-redteam-pull-btn');
      if (!model) {
        status.textContent = '✗ Type a model name first (e.g. llama3.2).';
        status.style.color = '#ff3b30';
        return;
      }
      btn.disabled = true; btn.textContent = 'Pulling…';
      status.style.color = 'rgba(255,255,255,0.65)';
      status.textContent = `Starting pull for ${model}…`;
      try {
        const res = await fetch('/api/ai/ollama-pull', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, model }),
        });
        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '');
          status.textContent = '✗ Pull rejected: ' + (errText || res.statusText);
          status.style.color = '#ff3b30';
          btn.disabled = false; btn.textContent = 'Pull';
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let lastStatus = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.error) { lastStatus = '✗ ' + obj.error; }
              else if (obj.status) {
                let pct = '';
                if (obj.completed && obj.total) pct = ' ' + Math.round((obj.completed / obj.total) * 100) + '%';
                lastStatus = obj.status + pct;
              }
              status.textContent = lastStatus;
            } catch {}
          }
        }
        status.textContent = '✓ Done. Red-team model ' + model + ' is ready. Saved.';
        status.style.color = '#34c759';
        localStorage.setItem('nova-ai-redteam-model', model);
      } catch (err) {
        status.textContent = '✗ ' + err.message;
        status.style.color = '#ff3b30';
      }
      btn.disabled = false; btn.textContent = 'Pull';
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

    // Pull model — streams ndjson progress from /api/ai/ollama-pull
    main.querySelector('#ai-pull-btn').addEventListener('click', async () => {
      const status = main.querySelector('#ai-pull-status');
      const btn = main.querySelector('#ai-pull-btn');
      const url = main.querySelector('#ai-ollama-url').value.trim();
      const model = main.querySelector('#ai-ollama-model').value.trim();
      if (!model) { status.textContent = 'Set a model name first'; return; }
      btn.disabled = true; btn.textContent = 'Pulling…';
      status.style.color = 'rgba(255,255,255,0.65)';
      status.textContent = `Starting pull for ${model}…`;
      try {
        const res = await fetch('/api/ai/ollama-pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, model }),
        });
        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '');
          status.textContent = '\u274C Pull rejected: ' + (errText || res.statusText);
          status.style.color = '#ff3b30';
          btn.disabled = false; btn.textContent = 'Pull';
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let lastStatus = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.error) { lastStatus = '\u274C ' + obj.error; }
              else if (obj.status) {
                let pct = '';
                if (obj.completed && obj.total) {
                  pct = ' ' + Math.round((obj.completed / obj.total) * 100) + '%';
                }
                lastStatus = obj.status + pct;
              }
              status.textContent = lastStatus;
            } catch {}
          }
        }
        status.textContent = '\u2705 Done. Model ' + model + ' is ready.';
        status.style.color = '#34c759';
      } catch (err) {
        status.textContent = '\u274C ' + err.message;
        status.style.color = '#ff3b30';
      }
      btn.disabled = false; btn.textContent = 'Pull';
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

  // ─── Skills (M7.P4 first cut): list installed skills + per-skill enable/disable ───
  async function renderSkills() {
    const main = container.querySelector('#settings-main');
    main.innerHTML = `<div style="padding:24px;color:rgba(255,255,255,0.4);">Loading skills…</div>`;
    let mod;
    try { mod = await import('../kernel/skill-registry.js'); }
    catch (err) { main.innerHTML = `<div style="padding:24px;color:#ff5f57;">Skill registry failed: ${err.message}</div>`; return; }
    await mod.loadSkillRegistry();
    const skills = mod.listSkills();
    const enabledCount = skills.filter(s => s.enabled).length;
    const levelColor = { L0: '#a6e3a1', L1: '#8be9fd', L2: '#fab387', L3: '#ff5555' };
    // M7 scheduler fire history — per-skill lastFired + count
    let fireHistory = {};
    try {
      const sched = await import('../kernel/skill-scheduler.js');
      fireHistory = sched.getFireHistory();
    } catch {}
    const fmtAge = (ts) => {
      if (!ts) return null;
      const ms = Date.now() - ts;
      if (ms < 60_000) return Math.round(ms/1000) + 's ago';
      if (ms < 3_600_000) return Math.round(ms/60_000) + 'm ago';
      if (ms < 86_400_000) return Math.round(ms/3_600_000) + 'h ago';
      return Math.round(ms/86_400_000) + 'd ago';
    };

    const userCount = skills.filter(s => s.userInstalled).length;
    main.innerHTML = `
      <div style="padding:24px;max-width:780px;">
        <h2 style="font-size:20px;font-weight:600;margin:0 0 4px;">Skills</h2>
        <p style="font-size:12px;color:rgba(255,255,255,0.4);margin:0 0 24px;">${enabledCount} of ${skills.length} skills enabled (${userCount} user-installed). Disabled skills won't dispatch from Spotlight phrase triggers; they fall through to the normal planner.</p>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">
          ${skills.map(s => `
            <div class="skill-row" data-name="${escapeHtml(s.name)}" style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:12px;${s.userInstalled ? 'border-left:3px solid #cba6f7;' : ''}">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
                  <span style="font-size:13px;font-weight:600;">${escapeHtml(s.goal)}</span>
                  <span style="font-size:10px;color:${levelColor[s.level] || '#fff'};text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(s.level || 'L?')}</span>
                  ${s.userInstalled ? '<span style="font-size:10px;color:#cba6f7;text-transform:uppercase;letter-spacing:0.5px;">user</span>' : ''}
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px;font-family:ui-monospace,monospace;">${escapeHtml(s.name)} · triggers: ${s.phrases.map(p => '"' + escapeHtml(p) + '"').join(', ') || '(no phrases)'}</div>
                ${(() => {
                  const hist = fireHistory[s.name] || [];
                  if (!hist.length) return '';
                  const last = hist[hist.length - 1];
                  return `<div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:3px;">🔔 fired ${hist.length}× · last ${fmtAge(last.ts)} (${escapeHtml(last.source)})</div>`;
                })()}
              </div>
              ${s.userInstalled ? `<button class="skill-uninstall" data-name="${escapeHtml(s.name)}" style="padding:6px 12px;font-size:11px;border-radius:6px;border:1px solid rgba(255,85,85,0.3);background:transparent;color:#ff8888;font-family:var(--font);cursor:pointer;">Uninstall</button>` : ''}
              <label style="position:relative;display:inline-block;width:42px;height:24px;cursor:pointer;">
                <input type="checkbox" class="skill-toggle" data-name="${escapeHtml(s.name)}" ${s.enabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
                <span style="position:absolute;inset:0;background:${s.enabled ? 'var(--accent)' : 'rgba(255,255,255,0.15)'};border-radius:24px;transition:background 0.2s;"></span>
                <span style="position:absolute;top:2px;left:${s.enabled ? '20px' : '2px'};width:20px;height:20px;background:white;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>
              </label>
            </div>
          `).join('')}
        </div>

        <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:18px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">🧩 Install custom skill</div>
          <p style="font-size:12px;color:rgba(255,255,255,0.55);margin:0 0 12px;">Paste a <code>.skill</code> file. See <code>docs/skill-language.md</code> for the format. User-installed skills go in localStorage and survive reload.</p>
          <textarea id="install-skill-source" placeholder="goal: Show me the time\ntrigger:\n  - phrase: &quot;what time&quot;\ndo: |\n  Open the Clock app focused on the current time." rows="9" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e0e0e0;padding:10px 12px;font-family:ui-monospace,monospace;font-size:12px;resize:vertical;box-sizing:border-box;"></textarea>
          <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
            <button id="install-skill-btn" style="padding:8px 18px;background:var(--accent);color:white;border:none;border-radius:6px;font-family:var(--font);font-size:12px;cursor:pointer;font-weight:600;">Install</button>
            <span id="install-skill-status" style="font-size:11px;color:rgba(255,255,255,0.55);"></span>
          </div>
        </div>
      </div>
    `;

    main.querySelectorAll('.skill-toggle').forEach(input => {
      input.addEventListener('change', (e) => {
        mod.setSkillEnabled(e.target.dataset.name, e.target.checked);
        renderSkills();
      });
    });
    main.querySelectorAll('.skill-uninstall').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = mod.uninstallUserSkill(btn.dataset.name);
        if (r.ok) renderSkills();
      });
    });
    main.querySelector('#install-skill-btn').addEventListener('click', async () => {
      const txt = main.querySelector('#install-skill-source').value;
      const status = main.querySelector('#install-skill-status');
      const r = await mod.installUserSkill(txt);
      if (r.ok) {
        status.textContent = '✓ Installed as ' + r.name;
        status.style.color = '#a6e3a1';
        main.querySelector('#install-skill-source').value = '';
        setTimeout(() => renderSkills(), 800);
      } else {
        status.textContent = '✗ ' + r.error;
        status.style.color = '#ff5555';
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ─── Safety dashboard: rubber-stamp tracker stats + chaos cooldown ───
  async function renderSafety() {
    const main = container.querySelector('#settings-main');
    main.innerHTML = `<div style="padding:24px;color:rgba(255,255,255,0.4);">Loading safety stats…</div>`;
    let stats, chaos;
    try {
      stats = (await import('../kernel/rubber-stamp-tracker.js')).getStats();
      chaos = (await import('../kernel/chaos-injector.js')).getChaosState();
    } catch (err) {
      main.innerHTML = `<div style="padding:24px;color:#ff5f57;">Failed to load safety stats: ${err.message}</div>`;
      return;
    }
    const ratePct = Math.round((stats.rapidRate || 0) * 100);
    const rateColor = ratePct >= 80 ? '#ff5f57' : ratePct >= 50 ? '#fab387' : '#a6e3a1';
    const fmtAge = (ts) => {
      if (!ts) return 'never';
      const ms = Date.now() - ts;
      if (ms < 60000) return Math.round(ms/1000) + 's ago';
      if (ms < 3600000) return Math.round(ms/60000) + 'm ago';
      if (ms < 86400000) return Math.round(ms/3600000) + 'h ago';
      return Math.round(ms/86400000) + 'd ago';
    };
    const fmtDuration = (ms) => {
      if (ms <= 0) return 'now';
      if (ms < 3600000) return Math.round(ms/60000) + 'm';
      if (ms < 86400000) return Math.round(ms/3600000) + 'h';
      return Math.round(ms/86400000) + 'd';
    };

    main.innerHTML = `
      <div style="padding:24px;max-width:680px;">
        <h2 style="font-size:20px;font-weight:600;margin:0 0 4px;">Safety</h2>
        <p style="font-size:12px;color:rgba(255,255,255,0.4);margin:0 0 24px;">How carefully you read L2+ approval previews. (M6.P4 + M6.P4.b)</p>

        <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:18px;margin-bottom:18px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;">
            <div style="font-size:14px;font-weight:600;">Rubber-stamp tracker</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.4);">7-day rolling window · last warning ${fmtAge(stats.lastWarnedAt)}</div>
          </div>

          <div style="display:flex;align-items:baseline;gap:16px;margin-bottom:18px;">
            <div style="font-size:42px;font-weight:600;color:${rateColor};line-height:1;">${ratePct}%</div>
            <div style="flex:1;">
              <div style="font-size:13px;color:rgba(255,255,255,0.85);">rapid-confirm rate</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.45);">confirms under 1.5s as a fraction of considered+rapid. Warning fires above 80% over 20+ samples.</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;text-align:center;font-family:ui-monospace,monospace;">
            ${[
              ['rapid', stats.rapid, '#fab387'],
              ['considered', stats.considered, '#a6e3a1'],
              ['aborted', stats.aborted, '#cba6f7'],
              ['timed out', stats.timedOut, 'rgba(255,255,255,0.4)'],
              ['total', stats.total, '#fff'],
            ].map(([l, n, c]) => `
              <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:10px 6px;">
                <div style="font-size:18px;font-weight:600;color:${c};line-height:1;">${n ?? 0}</div>
                <div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:4px;text-transform:uppercase;letter-spacing:0.4px;">${l}</div>
              </div>
            `).join('')}
          </div>

          <button id="reset-rubber" style="margin-top:16px;padding:8px 14px;background:transparent;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.18);border-radius:6px;font-family:var(--font);font-size:12px;cursor:pointer;">I've adjusted my workflow — reset stats</button>
        </div>

        <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:18px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
            <div style="font-size:14px;font-weight:600;">Chaos test injection</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.4);">5% trigger after each L2+ resolution · 24h cooldown</div>
          </div>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:12px;">
            Occasionally fires a fake destructive preview. If you confirm in under 1.5 seconds the system flags it — nothing actually runs (the chaos cap is synthetic).
          </div>
          <div style="display:flex;align-items:center;gap:12px;font-size:12px;">
            <span style="color:rgba(255,255,255,0.5);">Status:</span>
            <span style="color:${chaos.inCooldown ? '#a6e3a1' : '#fab387'};font-weight:600;">
              ${chaos.inCooldown ? `cooling down — next chaos in ${fmtDuration(chaos.msUntilNext)}` : 'armed (no current cooldown)'}
            </span>
          </div>
          <div style="margin-top:14px;display:flex;gap:8px;">
            <button id="clear-chaos" style="padding:8px 14px;background:transparent;color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.18);border-radius:6px;font-family:var(--font);font-size:12px;cursor:pointer;">Clear cooldown</button>
            <button id="fire-chaos" style="padding:8px 14px;background:rgba(255,159,64,0.2);color:#fab387;border:1px solid #fab387;border-radius:6px;font-family:var(--font);font-size:12px;cursor:pointer;">🧪 Test myself now</button>
          </div>
        </div>

        <div id="self-upgrade-history-panel" style="background:rgba(255,255,255,0.04);border-radius:10px;padding:18px;margin-top:16px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">🤖 Self-upgrade audit trail</div>
          <p style="font-size:12px;color:rgba(255,255,255,0.55);margin:0 0 12px;">
            Every self-upgrade proposal Astrion has generated — pending, applied, rolled-back, and discarded. M8.P5 writes to disk, so this list is the truth of what the AI has actually changed. Use "Undo" on any applied entry to restore the pre-upgrade content.
          </p>
          <div id="self-upgrade-history-list" style="display:flex;flex-direction:column;gap:6px;">Loading…</div>
        </div>
      </div>
    `;

    main.querySelector('#reset-rubber').addEventListener('click', async () => {
      const { resetStats } = await import('../kernel/rubber-stamp-tracker.js');
      resetStats();
      renderSafety();
    });
    main.querySelector('#clear-chaos').addEventListener('click', async () => {
      const { clearChaosCooldown } = await import('../kernel/chaos-injector.js');
      clearChaosCooldown();
      renderSafety();
    });
    main.querySelector('#fire-chaos').addEventListener('click', async () => {
      const { fireChaosNow, clearChaosCooldown } = await import('../kernel/chaos-injector.js');
      clearChaosCooldown();
      fireChaosNow();
    });

    // ─── Self-upgrade history (M8.P5 audit surface) ───
    renderSelfUpgradeHistory();
  }

  async function renderSelfUpgradeHistory() {
    const list = container.querySelector('#self-upgrade-history-list');
    if (!list) return;
    let entries = [];
    try {
      const upg = await import('../kernel/self-upgrader.js');
      entries = await upg.listUpgradeHistory(30);
    } catch (err) {
      list.innerHTML = `<div style="font-size:11px;color:#ff5555;">Load failed: ${escapeHtml(err.message)}</div>`;
      return;
    }
    if (entries.length === 0) {
      list.innerHTML = `<div style="font-size:11px;color:rgba(255,255,255,0.45);font-style:italic;padding:10px 0;">No self-upgrade proposals yet. Type "upgrade yourself" in Spotlight.</div>`;
      return;
    }
    const statusColor = {
      pending: '#fab387',
      approved: '#a6e3a1',
      'rolled-back': '#cba6f7',
      discarded: 'rgba(255,255,255,0.5)',
    };
    const fmtTime = (ts) => {
      if (!ts) return '';
      const d = Date.now() - ts;
      if (d < 60_000) return Math.round(d/1000) + 's ago';
      if (d < 3_600_000) return Math.round(d/60_000) + 'm ago';
      if (d < 86_400_000) return Math.round(d/3_600_000) + 'h ago';
      return Math.round(d/86_400_000) + 'd ago';
    };
    list.innerHTML = entries.map(e => {
      const color = statusColor[e.status] || '#fff';
      const whenTs = e.rolledBackAt || e.appliedAt || e.discardedAt || e.createdAt;
      return `
        <div class="self-upgrade-row" data-id="${escapeHtml(e.id)}" style="background:rgba(255,255,255,0.03);border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
          <span style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;min-width:74px;">${escapeHtml(e.status || '?')}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:500;"><code style="background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:3px;font-size:11px;">${escapeHtml(e.target || '?')}</code></div>
            <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px;line-height:1.4;">${escapeHtml(e.reason || '')}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:2px;">${escapeHtml(e.model || 'unknown model')} \u00B7 ${escapeHtml(fmtTime(whenTs))}</div>
          </div>
          ${e.status === 'approved'
            ? `<button class="self-upgrade-undo" data-id="${escapeHtml(e.id)}" style="padding:5px 10px;border-radius:5px;border:1px solid rgba(203,166,247,0.5);background:transparent;color:#cba6f7;font-size:10px;cursor:pointer;font-family:var(--font);white-space:nowrap;">\u21A9 Undo</button>`
            : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.self-upgrade-undo').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.textContent = 'Restoring…';
        btn.disabled = true;
        const upg = await import('../kernel/self-upgrader.js');
        const r = await upg.rollbackUpgrade(id);
        if (r.ok) {
          renderSelfUpgradeHistory();
        } else {
          btn.textContent = 'Failed';
          alert('Rollback failed: ' + (r.error || 'unknown'));
        }
      });
    });
  }

  // ─── System Config: declarative export/import ───
  function renderSystemConfig() {
    const CONFIG_KEYS = [
      'nova-wallpaper', 'nova-accent', 'nova-username', 'nova-ui-zoom',
      'nova-dock-size', 'nova-dock-magnify', 'nova-ai-provider',
      'nova-ai-ollama-url', 'nova-ai-ollama-model', 'nova-volume',
      'nova-sound-effects', 'nova-focus-mode', 'nova-focus-enabled',
      'nova-screensaver-timeout', 'nova-idle-timeout',
      'astrion-s2-budget-settings',
    ];

    main.innerHTML = `
      <div class="settings-section-title">System Configuration</div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Export System Config</div>
            <div class="settings-row-desc">Save all your preferences as a JSON file. Restore them on any Astrion install.</div>
          </div>
          <button id="cfg-export" style="padding:6px 16px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:12px;cursor:pointer;font-family:var(--font);">Export</button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Import System Config</div>
            <div class="settings-row-desc">Restore preferences from a previously exported config file.</div>
          </div>
          <label style="padding:6px 16px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:12px;cursor:pointer;font-family:var(--font);">
            Import
            <input type="file" accept=".json" id="cfg-import" style="display:none;">
          </label>
        </div>
      </div>
      <div class="settings-group" style="margin-top:16px;">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Current Config Preview</div>
            <div class="settings-row-desc">What would be exported</div>
          </div>
        </div>
        <pre id="cfg-preview" style="background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;font-size:11px;font-family:var(--mono,monospace);color:rgba(255,255,255,0.6);max-height:200px;overflow:auto;margin:0 0 8px;"></pre>
      </div>
      <div id="cfg-status" style="padding:8px 0;font-size:12px;color:rgba(255,255,255,0.5);"></div>
    `;

    // Build config object
    const config = { _astrion_config: true, _version: '0.3.0', _exported: new Date().toISOString() };
    for (const key of CONFIG_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) config[key] = val;
    }
    main.querySelector('#cfg-preview').textContent = JSON.stringify(config, null, 2);

    // Export
    main.querySelector('#cfg-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `astrion-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      main.querySelector('#cfg-status').textContent = 'Config exported!';
      main.querySelector('#cfg-status').style.color = '#50fa7b';
    });

    // Import
    main.querySelector('#cfg-import').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!imported._astrion_config) throw new Error('Not an Astrion config file');
          let count = 0;
          for (const [key, val] of Object.entries(imported)) {
            if (key.startsWith('_')) continue;
            localStorage.setItem(key, val);
            count++;
          }
          main.querySelector('#cfg-status').textContent = `Imported ${count} settings. Reload to apply.`;
          main.querySelector('#cfg-status').style.color = '#50fa7b';
        } catch (err) {
          main.querySelector('#cfg-status').textContent = 'Import failed: ' + err.message;
          main.querySelector('#cfg-status').style.color = '#ff5f57';
        }
      };
      reader.readAsText(file);
    });
  }

  // ─── Security & Privacy: capability tiers + app permissions ───
  function renderSecurity() {
    const levels = [
      { level: 'L0', name: 'Observe', desc: 'Read-only access. Can see data but not change anything.', color: '#50fa7b' },
      { level: 'L1', name: 'Edit Sandbox', desc: 'Can create/modify data in scratch space only.', color: '#8be9fd' },
      { level: 'L2', name: 'Edit Real', desc: 'Can touch real user data. Requires per-session unlock.', color: '#f1fa8c' },
      { level: 'L3', name: 'Self-Modify', desc: 'Can change Astrion\'s own code. Requires per-action unlock + red-team review.', color: '#ff5f57' },
    ];

    main.innerHTML = `
      <div class="settings-section-title">Security & Privacy</div>
      <div class="settings-group">
        <div style="padding:8px 0 12px;">
          <div class="settings-row-label">Capability Tier System</div>
          <div class="settings-row-desc">Every AI action is assigned a privilege level. Higher levels require your explicit permission.</div>
        </div>
        ${levels.map(l => `
          <div class="settings-row" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="background:${l.color};color:#0a0a1a;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;min-width:24px;text-align:center;">${l.level}</span>
              <div>
                <div class="settings-row-label">${l.name}</div>
                <div class="settings-row-desc">${l.desc}</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="settings-group" style="margin-top:16px;">
        <div style="padding:8px 0 12px;">
          <div class="settings-row-label">Active Safeguards</div>
          <div class="settings-row-desc">Always-on protections that cannot be disabled.</div>
        </div>
        <div class="settings-row" style="padding:6px 0;">
          <div class="settings-row-label" style="flex:1;">AI budget cap</div>
          <span style="color:#50fa7b;font-size:12px;">Active</span>
        </div>
        <div class="settings-row" style="padding:6px 0;">
          <div class="settings-row-label" style="flex:1;">L2+ action preview gate</div>
          <span style="color:#50fa7b;font-size:12px;">Active</span>
        </div>
        <div class="settings-row" style="padding:6px 0;">
          <div class="settings-row-label" style="flex:1;">Provenance tracking (every AI artifact logged)</div>
          <span style="color:#50fa7b;font-size:12px;">Active</span>
        </div>
        <div class="settings-row" style="padding:6px 0;">
          <div class="settings-row-label" style="flex:1;">S1/S2 calibration + auto-escalation</div>
          <span style="color:#50fa7b;font-size:12px;">Active</span>
        </div>
        <div class="settings-row" style="padding:6px 0;">
          <div class="settings-row-label" style="flex:1;">VFS path restriction (sandbox roots only)</div>
          <span style="color:#50fa7b;font-size:12px;">Active</span>
        </div>
      </div>
    `;
  }

  function renderAbout() {
    const appCount = processManager.getAllApps().length;
    const uptime = formatUptime();
    const storageUsed = estimateStorageUsed();

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
        <div class="settings-about-version">Version 0.9.0 — M0-M8 Complete</div>
        <div class="settings-about-info">
          An AI-native operating system designed for the future.
          <br>
          Built with vanilla JS, no frameworks, 100% from scratch.
        </div>
        <div style="margin-top:20px; display:grid; grid-template-columns:1fr 1fr; gap:8px; max-width:360px;">
          <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:10px; text-align:center;">
            <div style="font-size:24px; font-weight:300; color:var(--accent);">${appCount}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px;">Apps</div>
          </div>
          <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:10px; text-align:center;">
            <div style="font-size:24px; font-weight:300; color:var(--accent);">${uptime}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px;">Uptime</div>
          </div>
          <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:10px; text-align:center;">
            <div style="font-size:24px; font-weight:300; color:var(--accent);">${storageUsed}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px;">Storage Used</div>
          </div>
          <div style="background:rgba(255,255,255,0.04); padding:12px; border-radius:10px; text-align:center;">
            <div style="font-size:24px; font-weight:300; color:var(--accent);">${windowManager.windows.size}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px;">Open Windows</div>
          </div>
        </div>
        <div style="margin-top:16px; font-size:11px; color:rgba(255,255,255,0.25); text-align:center;">
          \u00A9 ${new Date().getFullYear()} Astrion OS &middot; Made by Viraaj
        </div>
      </div>
    `;
  }

  function formatUptime() {
    const ms = performance.now();
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    return h + 'h ' + (m % 60) + 'm';
  }

  function estimateStorageUsed() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        total += (key.length + (localStorage.getItem(key) || '').length) * 2; // UTF-16
      }
      if (total < 1024) return total + ' B';
      if (total < 1024 * 1024) return (total / 1024).toFixed(1) + ' KB';
      return (total / (1024 * 1024)).toFixed(1) + ' MB';
    } catch { return '?'; }
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
