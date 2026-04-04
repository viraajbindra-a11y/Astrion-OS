// NOVA OS — App Store

import { processManager } from '../kernel/process-manager.js';
import { appInstaller } from '../kernel/app-installer.js';

export function registerAppStore() {
  processManager.register('appstore', {
    name: 'App Store',
    icon: '\uD83D\uDECD\uFE0F',
    iconClass: 'dock-icon-appstore',
    singleInstance: true,
    width: 800,
    height: 560,
    launch: (contentEl) => {
      initAppStore(contentEl);
    }
  });
}

// Build store listing from real installable apps + demo apps
function buildStoreApps() {
  const registry = appInstaller.getRegistry();
  const realApps = Object.entries(registry).map(([id, app]) => ({
    id, name: app.name, icon: app.icon, category: app.category,
    dev: app.dev, rating: app.rating, color: app.color,
    desc: app.desc, installed: appInstaller.isInstalled(id), price: app.price || 'Free',
  }));
  return [...realApps, ...demoApps];
}

const demoApps = [
  {
    id: 'weather-widget', name: 'Weather Pro', icon: '\u26C5', category: 'Utilities',
    dev: 'CloudTech', rating: 4.8, color: 'linear-gradient(135deg, #1e88e5, #0d47a1)',
    desc: 'Beautiful weather forecasts with hourly and weekly views. AI-powered weather insights.',
    installed: false, price: 'Free'
  },
  {
    id: 'code-editor-pro', name: 'CodePad Pro', icon: '\uD83D\uDCBB', category: 'Developer Tools',
    dev: 'DevForge', rating: 4.9, color: 'linear-gradient(135deg, #7c4dff, #304ffe)',
    desc: 'Advanced code editor with syntax highlighting, git integration, and AI code completion.',
    installed: false, price: '$4.99'
  },
  {
    id: 'photo-editor', name: 'PixelStudio', icon: '\uD83D\uDDBC\uFE0F', category: 'Photography',
    dev: 'Creative Labs', rating: 4.7, color: 'linear-gradient(135deg, #ff6d00, #ff3d00)',
    desc: 'Professional photo editing with AI-powered filters, layers, and adjustment tools.',
    installed: false, price: '$2.99'
  },
  {
    id: 'task-manager', name: 'TaskFlow', icon: '\u2705', category: 'Productivity',
    dev: 'ProductiveApps', rating: 4.6, color: 'linear-gradient(135deg, #00c853, #1b5e20)',
    desc: 'Smart task management with AI prioritization and deadline tracking.',
    installed: false, price: 'Free'
  },
  {
    id: 'music-pro', name: 'BeatMaker', icon: '\uD83C\uDFB9', category: 'Music',
    dev: 'SoundForge', rating: 4.5, color: 'linear-gradient(135deg, #e91e63, #880e4f)',
    desc: 'Create music with virtual instruments, loops, and AI-assisted composition.',
    installed: false, price: '$6.99'
  },
  {
    id: 'chat-app', name: 'NovaChat', icon: '\uD83D\uDCAC', category: 'Social',
    dev: 'NOVA Team', rating: 4.8, color: 'linear-gradient(135deg, #00bcd4, #006064)',
    desc: 'End-to-end encrypted messaging with AI-powered smart replies.',
    installed: false, price: 'Free'
  },
  {
    id: 'vpn-app', name: 'ShieldVPN', icon: '\uD83D\uDD12', category: 'Security',
    dev: 'SecureTech', rating: 4.4, color: 'linear-gradient(135deg, #455a64, #263238)',
    desc: 'Protect your privacy with military-grade encryption and global servers.',
    installed: false, price: '$3.99/mo'
  },
  {
    id: 'fitness', name: 'FitTrack', icon: '\uD83C\uDFCB\uFE0F', category: 'Health & Fitness',
    dev: 'HealthApps', rating: 4.6, color: 'linear-gradient(135deg, #f44336, #b71c1c)',
    desc: 'Track workouts, calories, and progress with AI coaching.',
    installed: false, price: 'Free'
  },
  {
    id: 'translator', name: 'LinguaAI', icon: '\uD83C\uDF0D', category: 'Reference',
    dev: 'LangTech', rating: 4.9, color: 'linear-gradient(135deg, #3f51b5, #1a237e)',
    desc: 'Instant translation in 100+ languages powered by AI.',
    installed: false, price: 'Free'
  },
];

function initAppStore(container) {
  let activeTab = 'discover';
  let detailApp = null;
  const storeApps = buildStoreApps();

  container.innerHTML = `
    <div class="appstore-app">
      <div class="appstore-header">
        <div class="appstore-tabs" id="store-tabs">
          <button class="appstore-tab active" data-tab="discover">Discover</button>
          <button class="appstore-tab" data-tab="top">Top Charts</button>
          <button class="appstore-tab" data-tab="categories">Categories</button>
          <button class="appstore-tab" data-tab="skills">AI Skills</button>
        </div>
        <input type="text" class="appstore-search" placeholder="Search apps...">
      </div>
      <div class="appstore-content" id="store-content"></div>
    </div>
  `;

  const content = container.querySelector('#store-content');
  const tabs = container.querySelector('#store-tabs');
  const searchInput = container.querySelector('.appstore-search');

  tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.appstore-tab');
    if (!tab) return;
    activeTab = tab.dataset.tab;
    tabs.querySelectorAll('.appstore-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    detailApp = null;
    renderContent();
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    if (!q) { renderContent(); return; }
    const filtered = storeApps.filter(a => a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q));
    renderGrid(filtered, 'Search Results');
  });

  function renderContent() {
    if (detailApp) { renderDetail(detailApp); return; }
    switch (activeTab) {
      case 'discover': renderDiscover(); break;
      case 'top': renderTopCharts(); break;
      case 'categories': renderCategories(); break;
      case 'skills': renderSkills(); break;
    }
  }

  function renderDiscover() {
    content.innerHTML = `
      <div class="appstore-featured">
        <div class="appstore-featured-card" style="background:linear-gradient(135deg, #1a237e, #4a148c)">
          <div class="appstore-featured-label">Featured</div>
          <div class="appstore-featured-title">AI Skills Marketplace</div>
          <div class="appstore-featured-desc">Discover AI-powered skills that supercharge your NOVA OS experience</div>
        </div>
        <div class="appstore-featured-card" style="background:linear-gradient(135deg, #004d40, #00695c)">
          <div class="appstore-featured-label">New & Notable</div>
          <div class="appstore-featured-title">Developer Tools</div>
          <div class="appstore-featured-desc">Code faster with AI-assisted development tools</div>
        </div>
      </div>
      <div class="appstore-section" id="store-essential"></div>
      <div class="appstore-section" id="store-new"></div>
    `;

    renderGridInto('#store-essential', storeApps.slice(0, 4), 'Essential Apps');
    renderGridInto('#store-new', storeApps.slice(4), 'New & Updated');
  }

  function renderTopCharts() {
    const sorted = [...storeApps].sort((a, b) => b.rating - a.rating);
    content.innerHTML = '<div class="appstore-section"><div class="appstore-section-header"><div class="appstore-section-title">Top Charts</div></div><div class="appstore-list" id="store-list"></div></div>';
    const list = content.querySelector('#store-list');
    sorted.forEach((app, i) => {
      const el = document.createElement('div');
      el.className = 'appstore-list-item';
      el.innerHTML = `
        <div class="appstore-list-num">${i + 1}</div>
        <div class="appstore-list-icon" style="background:${app.color}">${app.icon}</div>
        <div class="appstore-list-info">
          <div class="appstore-list-name">${app.name}</div>
          <div class="appstore-list-category">${app.category}</div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary)">\u2B50 ${app.rating}</div>
        <button class="appstore-get-btn${app.installed ? ' installed' : ''}">${app.installed ? 'Installed' : app.price === 'Free' ? 'GET' : app.price}</button>
      `;
      el.querySelector('.appstore-get-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        installApp(app, e.target);
      });
      el.addEventListener('click', () => { detailApp = app; renderContent(); });
      list.appendChild(el);
    });
  }

  function renderCategories() {
    const cats = [...new Set(storeApps.map(a => a.category))];
    const catIcons = { 'Utilities': '\uD83D\uDD27', 'Developer Tools': '\uD83D\uDCBB', 'Photography': '\uD83D\uDCF7', 'Productivity': '\uD83D\uDCCA', 'Music': '\uD83C\uDFB5', 'Social': '\uD83D\uDCAC', 'Security': '\uD83D\uDD12', 'Health & Fitness': '\uD83C\uDFCB\uFE0F', 'Reference': '\uD83D\uDCDA' };
    content.innerHTML = `<div class="appstore-section"><div class="appstore-section-title">Categories</div><div class="appstore-grid">${cats.map(cat => `
      <div class="appstore-card" data-cat="${cat}">
        <div class="appstore-card-icon" style="background:rgba(255,255,255,0.06)">${catIcons[cat] || '\uD83D\uDCC1'}</div>
        <div class="appstore-card-name">${cat}</div>
        <div class="appstore-card-category">${storeApps.filter(a => a.category === cat).length} apps</div>
      </div>
    `).join('')}</div></div>`;
  }

  function renderSkills() {
    content.innerHTML = `
      <div class="appstore-section">
        <div class="appstore-featured" style="grid-template-columns:1fr">
          <div class="appstore-featured-card" style="background:linear-gradient(135deg, #4a148c, #7b1fa2, #ce93d8)">
            <div class="appstore-featured-label">\u2728 AI Skills</div>
            <div class="appstore-featured-title">Extend NOVA with AI Superpowers</div>
            <div class="appstore-featured-desc">Skills are AI capabilities that plug directly into NOVA OS. They can summarize documents, generate code, translate languages, and more — all from Spotlight or any app.</div>
          </div>
        </div>
        <div class="appstore-section-title" style="margin-top:20px">Available Skills</div>
        <div class="appstore-grid">
          <div class="appstore-card">
            <div class="appstore-card-icon" style="background:linear-gradient(135deg,#ff6d00,#ff3d00)">\uD83D\uDCDD</div>
            <div class="appstore-card-name">Smart Summarizer</div>
            <div class="appstore-card-category">AI Skill \u2022 Free</div>
            <div class="appstore-card-footer"><span class="appstore-card-rating">\u2B50 4.9</span><button class="appstore-get-btn">GET</button></div>
          </div>
          <div class="appstore-card">
            <div class="appstore-card-icon" style="background:linear-gradient(135deg,#1e88e5,#0d47a1)">\uD83D\uDCBB</div>
            <div class="appstore-card-name">Code Generator</div>
            <div class="appstore-card-category">AI Skill \u2022 $1.99</div>
            <div class="appstore-card-footer"><span class="appstore-card-rating">\u2B50 4.8</span><button class="appstore-get-btn">$1.99</button></div>
          </div>
          <div class="appstore-card">
            <div class="appstore-card-icon" style="background:linear-gradient(135deg,#43a047,#1b5e20)">\uD83C\uDF0D</div>
            <div class="appstore-card-name">Auto Translator</div>
            <div class="appstore-card-category">AI Skill \u2022 Free</div>
            <div class="appstore-card-footer"><span class="appstore-card-rating">\u2B50 4.7</span><button class="appstore-get-btn">GET</button></div>
          </div>
          <div class="appstore-card">
            <div class="appstore-card-icon" style="background:linear-gradient(135deg,#ab47bc,#6a1b9a)">\uD83C\uDFA8</div>
            <div class="appstore-card-name">Image Describer</div>
            <div class="appstore-card-category">AI Skill \u2022 Free</div>
            <div class="appstore-card-footer"><span class="appstore-card-rating">\u2B50 4.6</span><button class="appstore-get-btn">GET</button></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderDetail(app) {
    content.innerHTML = `
      <div class="appstore-detail">
        <div style="margin-bottom:16px"><span style="cursor:pointer;color:var(--accent)" id="store-back">\u25C0 Back</span></div>
        <div class="appstore-detail-header">
          <div class="appstore-detail-icon" style="background:${app.color}">${app.icon}</div>
          <div class="appstore-detail-info">
            <div class="appstore-detail-name">${app.name}</div>
            <div class="appstore-detail-dev">${app.dev}</div>
            <div style="display:flex;gap:12px;align-items:center">
              <button class="appstore-get-btn${app.installed ? ' installed' : ''}" id="store-detail-get" style="padding:6px 24px;font-size:14px">${app.installed ? 'Installed' : app.price === 'Free' ? 'GET' : app.price}</button>
              <span style="font-size:13px;color:var(--text-tertiary)">\u2B50 ${app.rating}</span>
            </div>
          </div>
        </div>
        <div class="appstore-detail-desc">${app.desc}</div>
        <div class="appstore-section-title" style="font-size:16px;margin-bottom:12px">Screenshots</div>
        <div class="appstore-detail-screenshots">
          <div class="appstore-detail-screenshot">Screenshot 1</div>
          <div class="appstore-detail-screenshot">Screenshot 2</div>
          <div class="appstore-detail-screenshot">Screenshot 3</div>
        </div>
      </div>
    `;

    content.querySelector('#store-back').addEventListener('click', () => {
      detailApp = null;
      renderContent();
    });

    content.querySelector('#store-detail-get').addEventListener('click', (e) => {
      installApp(app, e.target);
    });
  }

  function renderGrid(apps, title) {
    content.innerHTML = '';
    const section = document.createElement('div');
    section.className = 'appstore-section';
    section.innerHTML = `<div class="appstore-section-header"><div class="appstore-section-title">${title}</div></div>`;
    const grid = document.createElement('div');
    grid.className = 'appstore-grid';
    apps.forEach(app => {
      grid.appendChild(createCard(app));
    });
    section.appendChild(grid);
    content.appendChild(section);
  }

  function renderGridInto(selector, apps, title) {
    const section = content.querySelector(selector);
    section.innerHTML = `<div class="appstore-section-header"><div class="appstore-section-title">${title}</div><span class="appstore-see-all">See All</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'appstore-grid';
    apps.forEach(app => grid.appendChild(createCard(app)));
    section.appendChild(grid);
  }

  function createCard(app) {
    const card = document.createElement('div');
    card.className = 'appstore-card';
    card.innerHTML = `
      <div class="appstore-card-icon" style="background:${app.color}">${app.icon}</div>
      <div class="appstore-card-name">${app.name}</div>
      <div class="appstore-card-category">${app.category}</div>
      <div class="appstore-card-footer">
        <span class="appstore-card-rating">\u2B50 ${app.rating}</span>
        <button class="appstore-get-btn${app.installed ? ' installed' : ''}">${app.installed ? 'Installed' : app.price === 'Free' ? 'GET' : app.price}</button>
      </div>
    `;
    card.querySelector('.appstore-get-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      installApp(app, e.target);
    });
    card.addEventListener('click', () => { detailApp = app; renderContent(); });
    return card;
  }

  async function installApp(app, btn) {
    if (app.installed) return;
    btn.textContent = 'Installing...';
    btn.style.pointerEvents = 'none';

    // Check if this is a real installable app from the registry
    const registry = appInstaller.getRegistry();
    const realApp = registry[app.id];

    await new Promise(r => setTimeout(r, 1200)); // install animation

    if (realApp) {
      await appInstaller.install(app.id);
    }

    app.installed = true;
    btn.textContent = 'OPEN';
    btn.classList.add('installed');
    btn.style.pointerEvents = '';

    // Click to open installed app
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (realApp) processManager.launch(app.id);
    });
  }

  renderContent();
}
