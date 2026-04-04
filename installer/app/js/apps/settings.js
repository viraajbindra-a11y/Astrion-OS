// NOVA OS — Settings App

import { processManager } from '../kernel/process-manager.js';
import { eventBus } from '../kernel/event-bus.js';

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
  { id: 'gradient-purple', name: 'Aurora', colors: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460, #533483)' },
  { id: 'gradient-blue', name: 'Ocean', colors: 'linear-gradient(135deg, #0c1445, #1a237e, #283593, #1565c0)' },
  { id: 'gradient-dark', name: 'Midnight', colors: 'linear-gradient(135deg, #0a0a0a, #1a1a1a, #2d2d2d, #1a1a1a)' },
  { id: 'gradient-sunset', name: 'Sunset', colors: 'linear-gradient(135deg, #1a0a2e, #4a1942, #7b2d5f, #b0413e)' },
  { id: 'gradient-forest', name: 'Forest', colors: 'linear-gradient(135deg, #0a1a0a, #1b3a1b, #2d5a2d, #1a3a2a)' },
  { id: 'gradient-space', name: 'Deep Space', colors: 'radial-gradient(ellipse at 30% 50%, #1a0533 0%, #0a0a1a 50%, #000000 100%)' },
];

function initSettings(container) {
  const currentWallpaper = localStorage.getItem('nova-wallpaper') || 'gradient-purple';
  let activeSection = 'appearance';

  const sections = {
    appearance: { icon: '\uD83C\uDFA8', name: 'Appearance' },
    desktop: { icon: '\uD83D\uDDA5\uFE0F', name: 'Desktop & Dock' },
    ai: { icon: '\u2728', name: 'AI Assistant' },
    about: { icon: '\u2139\uFE0F', name: 'About NOVA OS' },
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
      case 'desktop': renderDesktop(); break;
      case 'ai': renderAI(); break;
      case 'about': renderAbout(); break;
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
    main.innerHTML = `
      <div class="settings-section-title">AI Assistant</div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">AI Model</div>
            <div class="settings-row-desc">Choose the AI model for responses</div>
          </div>
          <select class="settings-select">
            <option value="mock">Local (Demo Mode)</option>
            <option value="haiku" disabled>Claude Haiku (Requires API)</option>
            <option value="sonnet" disabled>Claude Sonnet (Requires API)</option>
          </select>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">AI in Apps</div>
            <div class="settings-row-desc">Enable AI features in Notes, Terminal, etc.</div>
          </div>
          <button class="settings-toggle on"></button>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-label">Spotlight AI</div>
            <div class="settings-row-desc">Press Cmd+Space to ask NOVA anything</div>
          </div>
          <button class="settings-toggle on"></button>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-row">
          <div>
            <div class="settings-row-label">API Endpoint</div>
            <div class="settings-row-desc">For connecting to a real AI backend</div>
          </div>
          <input type="text" class="settings-select" value="/api/ai" style="width:200px;font-family:var(--mono);font-size:12px;">
        </div>
      </div>
    `;
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
        <div class="settings-about-name">NOVA OS</div>
        <div class="settings-about-version">Version 0.1.0 (Early Prototype)</div>
        <div class="settings-about-info">
          An AI-native operating system built for the future.
          <br><br>
          AI deeply integrated into every app and workflow.
          <br>
          Cross-platform via web technology.
          <br><br>
          Built with love by the NOVA team.
          <br><br>
          \u00A9 ${new Date().getFullYear()} NOVA OS Project
        </div>
      </div>
    `;
  }

  renderSection();
}

// Apply saved wallpaper on boot
export function applyWallpaper() {
  const id = localStorage.getItem('nova-wallpaper');
  if (!id) return;
  const wp = wallpapers.find(w => w.id === id);
  if (wp) {
    const desktop = document.getElementById('desktop');
    desktop.style.backgroundImage = wp.colors;
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
