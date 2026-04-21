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
    id: 'beat-studio', name: 'Beat Studio', icon: '\uD83C\uDFB9', category: 'Music',
    dev: 'Astrion', rating: 4.8, color: 'linear-gradient(135deg, #e91e63, #880e4f)',
    desc: '8-track drum machine with 16-step sequencer. Kick, snare, hi-hat, clap and more.',
    installed: true, price: 'Free'
  },
  {
    id: 'messages', name: 'Messages', icon: '\uD83D\uDCAC', category: 'Social',
    dev: 'Astrion', rating: 4.9, color: 'linear-gradient(135deg, #34c759, #0a8a2e)',
    desc: 'Chat with Astrion AI or create conversations. Persistent message history.',
    installed: true, price: 'Free'
  },
  {
    id: 'vault', name: 'Vault', icon: '\uD83D\uDD10', category: 'Security',
    dev: 'Astrion', rating: 4.9, color: 'linear-gradient(135deg, #2a7a3e, #0e4a22)',
    desc: 'AES-256 encrypted password manager with master password protection.',
    installed: true, price: 'Free'
  },
  {
    id: 'kanban', name: 'Kanban Board', icon: '\uD83D\uDCCB', category: 'Productivity',
    dev: 'Astrion', rating: 4.7, color: 'linear-gradient(135deg, #007aff, #0055cc)',
    desc: 'Drag-and-drop project management with columns and color-coded cards.',
    installed: true, price: 'Free'
  },
  {
    id: 'translator', name: 'Translator', icon: '\uD83C\uDF10', category: 'Reference',
    dev: 'Astrion', rating: 4.8, color: 'linear-gradient(135deg, #007aff, #0055cc)',
    desc: 'AI-powered translation between 12 languages. Powered by Ollama or Claude.',
    installed: true, price: 'Free'
  },
  {
    id: 'pomodoro', name: 'Pomodoro Timer', icon: '\uD83C\uDF45', category: 'Productivity',
    dev: 'Astrion', rating: 4.6, color: 'linear-gradient(135deg, #ff6b6b, #c41e16)',
    desc: '25/5 focus timer with animated progress ring and session counting.',
    installed: true, price: 'Free'
  },
  {
    id: 'chess', name: 'Chess', icon: '\u265A', category: 'Games',
    dev: 'Astrion', rating: 4.5, color: 'linear-gradient(135deg, #4a4a54, #2a2a34)',
    desc: '2-player local chess with Unicode pieces on a classic board.',
    installed: true, price: 'Free'
  },
  {
    id: 'snake', name: 'Snake', icon: '\uD83D\uDC0D', category: 'Games',
    dev: 'Astrion', rating: 4.4, color: 'linear-gradient(135deg, #34c759, #1a8a36)',
    desc: 'Classic snake game. Arrow keys to move, eat food, grow longer.',
    installed: true, price: 'Free'
  },
  {
    id: '2048', name: '2048', icon: '\uD83C\uDFB2', category: 'Games',
    dev: 'Astrion', rating: 4.7, color: 'linear-gradient(135deg, #edc22e, #c4a024)',
    desc: 'Slide tiles to merge numbers. Can you reach 2048?',
    installed: true, price: 'Free'
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
          <button class="appstore-tab" data-tab="linux">Linux Apps</button>
          <button class="appstore-tab" data-tab="android">Android</button>
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
      case 'linux': renderLinuxApps(); break;
      case 'android': renderAndroidApps(); break;
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

  // ─── Real Skills tab — wired to skill-registry + paste install ───
  // Mirrors Settings > Skills (lesson 155: bundled cannot be replaced
  // by user-installed). Both surfaces share the same registry so a
  // skill installed here shows up there immediately.
  async function renderSkills() {
    content.innerHTML = `<div style="padding:30px;color:rgba(255,255,255,0.55);font-size:13px;">Loading skills\u2026</div>`;
    let mod;
    try { mod = await import('../kernel/skill-registry.js'); }
    catch (err) {
      content.innerHTML = `<div style="padding:30px;color:#ff5f57;font-size:13px;">Skill registry failed: ${err.message}</div>`;
      return;
    }
    await mod.loadSkillRegistry();
    const skills = mod.listSkills();

    const bundled = skills.filter(s => !s.userInstalled);
    const installed = skills.filter(s => s.userInstalled);
    const enabledCount = skills.filter(s => s.enabled).length;

    const levelTone = {
      L0: { bg: '#0e6b3c', label: 'L0 read-only' },
      L1: { bg: '#1a4f8a', label: 'L1 sandbox' },
      L2: { bg: '#a36a00', label: 'L2 user data' },
      L3: { bg: '#8a1d1d', label: 'L3 self-mod' },
    };

    const skillCard = (s) => {
      const tone = levelTone[s.level] || levelTone.L1;
      const phraseStr = s.phrases.length
        ? s.phrases.map(p => '"' + p + '"').join(' \u00B7 ')
        : '(no phrases)';
      const isUser = s.userInstalled;
      const togglePill = `
        <label class="store-skill-toggle" style="position:relative;display:inline-block;width:38px;height:22px;cursor:pointer;flex-shrink:0;">
          <input type="checkbox" data-skill-toggle="${s.name}" ${s.enabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
          <span style="position:absolute;inset:0;background:${s.enabled ? 'var(--accent)' : 'rgba(255,255,255,0.18)'};border-radius:22px;transition:background 0.2s;"></span>
          <span style="position:absolute;top:2px;left:${s.enabled ? '18px' : '2px'};width:18px;height:18px;background:white;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>
        </label>`;
      return `
        <div class="appstore-card" style="cursor:default;background:rgba(255,255,255,0.04);${isUser ? 'border-left:3px solid #cba6f7;' : ''}">
          <div class="appstore-card-icon" style="background:${tone.bg};font-size:24px;">\u{2728}</div>
          <div class="appstore-card-name" title="${s.name}">${s.goal || s.name}</div>
          <div class="appstore-card-category" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:9px;color:rgba(255,255,255,0.65);text-transform:uppercase;letter-spacing:0.06em;">${tone.label}</span>
            ${isUser ? '<span style="font-size:9px;color:#cba6f7;text-transform:uppercase;letter-spacing:0.06em;">user</span>' : '<span style="font-size:9px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.06em;">bundled</span>'}
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);font-family:ui-monospace,monospace;margin-top:4px;line-height:1.4;height:28px;overflow:hidden;">${phraseStr}</div>
          <div class="appstore-card-footer" style="margin-top:8px;">
            ${isUser
              ? `<button class="appstore-get-btn" data-skill-uninstall="${s.name}" style="background:rgba(255,85,85,0.15);color:#ff8888;">Uninstall</button>`
              : `<span style="font-size:10px;color:rgba(255,255,255,0.45);">Built-in</span>`}
            ${togglePill}
          </div>
        </div>`;
    };

    content.innerHTML = `
      <div class="appstore-section">
        <div class="appstore-featured" style="grid-template-columns:1fr">
          <div class="appstore-featured-card" style="background:linear-gradient(135deg, #4a148c, #7b1fa2, #ce93d8)">
            <div class="appstore-featured-label">\u2728 AI Skills</div>
            <div class="appstore-featured-title">${enabledCount} of ${skills.length} skills enabled</div>
            <div class="appstore-featured-desc">Skills are tiny .skill files Astrion can dispatch from a Spotlight phrase. ${installed.length} user-installed \u00B7 ${bundled.length} bundled. Disabled skills fall through to the planner instead of dispatching.</div>
          </div>
        </div>

        ${installed.length ? `
          <div class="appstore-section-title" style="margin-top:24px;">Your installed skills (${installed.length})</div>
          <div class="appstore-grid" id="store-installed-skills">${installed.map(skillCard).join('')}</div>
        ` : ''}

        <div class="appstore-section-title" style="margin-top:24px;">Bundled skills (${bundled.length})</div>
        <div class="appstore-grid" id="store-bundled-skills">${bundled.map(skillCard).join('')}</div>

        <div style="margin-top:28px;padding:18px;background:rgba(255,255,255,0.04);border-radius:10px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">\u{1F9E9} Install a custom skill</div>
          <p style="font-size:12px;color:rgba(255,255,255,0.55);margin:0 0 12px;">
            Paste any <code>.skill</code> file. See <code>docs/skill-language.md</code> for the format.
            User-installed skills can't shadow a bundled skill of the same name (lesson 155).
          </p>
          <textarea id="store-install-skill-source" placeholder="goal: Show me the time\ntrigger:\n  - phrase: &quot;what time&quot;\ndo: |\n  Open the Clock app focused on the current time." rows="8" style="width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e0e0e0;padding:10px 12px;font-family:ui-monospace,monospace;font-size:12px;resize:vertical;box-sizing:border-box;"></textarea>
          <div style="display:flex;gap:10px;align-items:center;margin-top:10px;">
            <button id="store-install-skill-btn" class="appstore-get-btn" style="background:var(--accent);color:white;padding:8px 18px;font-weight:600;">Install</button>
            <span id="store-install-skill-status" style="font-size:11px;color:rgba(255,255,255,0.55);"></span>
          </div>
        </div>
      </div>
    `;

    content.querySelectorAll('[data-skill-toggle]').forEach(input => {
      input.addEventListener('change', () => {
        mod.setSkillEnabled(input.dataset.skillToggle, input.checked);
        renderSkills();
      });
    });
    content.querySelectorAll('[data-skill-uninstall]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = mod.uninstallUserSkill(btn.dataset.skillUninstall);
        if (r.ok) renderSkills();
      });
    });
    const installBtn = content.querySelector('#store-install-skill-btn');
    const installSrc = content.querySelector('#store-install-skill-source');
    const installStatus = content.querySelector('#store-install-skill-status');
    installBtn?.addEventListener('click', async () => {
      const txt = installSrc.value;
      if (!txt.trim()) {
        installStatus.textContent = '✗ Paste a .skill file first';
        installStatus.style.color = '#ff5555';
        return;
      }
      installStatus.textContent = 'Installing\u2026';
      installStatus.style.color = 'rgba(255,255,255,0.55)';
      const r = await mod.installUserSkill(txt);
      if (r.ok) {
        installStatus.textContent = '\u2713 Installed as ' + r.name;
        installStatus.style.color = '#a6e3a1';
        installSrc.value = '';
        setTimeout(() => renderSkills(), 800);
      } else {
        installStatus.textContent = '\u2717 ' + r.error;
        installStatus.style.color = '#ff5555';
      }
    });
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

  // ─── Android Apps tab (Waydroid integration) ───
  async function renderAndroidApps() {
    content.innerHTML = `<div style="padding:30px; text-align:center; color:rgba(255,255,255,0.4);">Checking Android runtime...</div>`;

    try {
      const res = await fetch('/api/android/status');
      const status = await res.json();

      if (!status.available) {
        content.innerHTML = `
          <div style="padding:40px; text-align:center;">
            <div style="font-size:64px; margin-bottom:16px;">\uD83E\uDD16</div>
            <div style="font-size:18px; font-weight:600; margin-bottom:8px;">Android Apps</div>
            <div style="font-size:13px; color:rgba(255,255,255,0.5); max-width:400px; margin:0 auto 20px; line-height:1.6;">
              Run Android apps on Zenith OS using Waydroid. This feature requires the Waydroid package which isn't installed yet.
            </div>
            <div style="font-size:11px; color:rgba(255,255,255,0.3);">Install Waydroid from the Terminal:<br><code style="background:rgba(255,255,255,0.08); padding:2px 8px; border-radius:4px;">sudo apt install waydroid</code></div>
          </div>
        `;
        return;
      }

      if (!status.initialized) {
        content.innerHTML = `
          <div style="padding:40px; text-align:center;">
            <div style="font-size:64px; margin-bottom:16px;">\uD83E\uDD16</div>
            <div style="font-size:18px; font-weight:600; margin-bottom:8px;">Set Up Android Apps</div>
            <div style="font-size:13px; color:rgba(255,255,255,0.5); max-width:440px; margin:0 auto 20px; line-height:1.6;">
              Waydroid is installed but needs to download the Android system image (~800 MB). This only happens once. You can choose to include Google Play Store.
            </div>
            <div style="display:flex; gap:10px; justify-content:center;">
              <button id="android-init" style="padding:11px 24px; border-radius:10px; border:none; background:var(--accent); color:white; font-size:13px; font-weight:600; cursor:pointer; font-family:var(--font);">Set Up (without Play Store)</button>
              <button id="android-init-gapps" style="padding:11px 24px; border-radius:10px; border:none; background:linear-gradient(135deg, #34a853, #1e8e3e); color:white; font-size:13px; font-weight:600; cursor:pointer; font-family:var(--font);">Set Up with Google Play</button>
            </div>
            <div style="margin-top:16px; font-size:10px; color:rgba(255,255,255,0.3);">Google Play requires ~1.2 GB download and GApps agreement</div>
          </div>
        `;

        content.querySelector('#android-init')?.addEventListener('click', async () => {
          content.innerHTML = `<div style="padding:60px; text-align:center;"><div style="font-size:48px; margin-bottom:12px;">\u23F3</div><div style="font-size:14px;">Downloading Android image...</div><div style="font-size:11px; color:rgba(255,255,255,0.4); margin-top:8px;">This takes 3-5 minutes. Don't close this window.</div></div>`;
          await fetch('/api/android/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          setTimeout(() => renderAndroidApps(), 5000);
        });

        content.querySelector('#android-init-gapps')?.addEventListener('click', async () => {
          content.innerHTML = `<div style="padding:60px; text-align:center;"><div style="font-size:48px; margin-bottom:12px;">\u23F3</div><div style="font-size:14px;">Downloading Android + Google Play...</div><div style="font-size:11px; color:rgba(255,255,255,0.4); margin-top:8px;">This takes 5-10 minutes. Don't close this window.</div></div>`;
          await fetch('/api/android/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gapps: true }) });
          setTimeout(() => renderAndroidApps(), 5000);
        });
        return;
      }

      // Waydroid is initialized — show Android apps
      content.innerHTML = `
        <div style="padding:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
            <div>
              <div style="font-size:16px; font-weight:600;">\uD83E\uDD16 Android Apps</div>
              <div style="font-size:11px; color:rgba(255,255,255,0.5);">Powered by Waydroid \u00B7 ${status.running ? '\uD83D\uDFE2 Running' : '\u26AA Stopped'}</div>
            </div>
            <div style="display:flex; gap:8px;">
              ${status.running
                ? `<button id="android-stop" style="padding:8px 16px; border-radius:8px; border:1px solid rgba(255,59,48,0.3); background:transparent; color:#ff6b6b; font-size:12px; cursor:pointer; font-family:var(--font);">Stop Android</button>`
                : `<button id="android-start" style="padding:8px 16px; border-radius:8px; border:none; background:var(--accent); color:white; font-size:12px; font-weight:500; cursor:pointer; font-family:var(--font);">Launch Android</button>`
              }
            </div>
          </div>

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; margin-bottom:20px;">
            <div style="padding:20px; border-radius:12px; background:rgba(52,168,83,0.12); border:1px solid rgba(52,168,83,0.2); text-align:center; cursor:pointer;" id="android-play">
              <div style="font-size:36px; margin-bottom:8px;">\u25B6\uFE0F</div>
              <div style="font-size:13px; font-weight:600;">Open Play Store</div>
              <div style="font-size:10px; color:rgba(255,255,255,0.5);">Browse & install apps</div>
            </div>
            <div style="padding:20px; border-radius:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); text-align:center; cursor:pointer;" id="android-full">
              <div style="font-size:36px; margin-bottom:8px;">\uD83D\uDCF1</div>
              <div style="font-size:13px; font-weight:600;">Android Home</div>
              <div style="font-size:10px; color:rgba(255,255,255,0.5);">Full Android launcher</div>
            </div>
          </div>

          <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Installed Android Apps</div>
          <div id="android-app-list"></div>
        </div>
      `;

      // Bind buttons
      content.querySelector('#android-start')?.addEventListener('click', async () => {
        await fetch('/api/android/start', { method: 'POST' });
        setTimeout(() => renderAndroidApps(), 2000);
      });
      content.querySelector('#android-stop')?.addEventListener('click', async () => {
        await fetch('/api/android/stop', { method: 'POST' });
        setTimeout(() => renderAndroidApps(), 1000);
      });
      content.querySelector('#android-play')?.addEventListener('click', async () => {
        if (!status.running) await fetch('/api/android/start', { method: 'POST' });
        await fetch('/api/android/launch-app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageName: 'com.android.vending' }) });
      });
      content.querySelector('#android-full')?.addEventListener('click', async () => {
        await fetch('/api/android/start', { method: 'POST' });
      });

      // Load installed Android apps
      const appList = content.querySelector('#android-app-list');
      try {
        const appsRes = await fetch('/api/android/apps');
        const { apps } = await appsRes.json();
        if (apps.length === 0) {
          appList.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:12px;">No Android apps installed. Open the Play Store to get started.</div>';
        } else {
          appList.innerHTML = apps.map(a => `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; margin-bottom:4px; cursor:pointer; transition:background 0.1s;"
              onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background=''">
              <div style="font-size:18px;">\uD83D\uDCE6</div>
              <div style="flex:1; font-size:12px;">${escHtml(a.name || a.packageName)}</div>
              <button class="android-launch" data-pkg="${escHtml(a.packageName)}" style="padding:4px 10px; border-radius:5px; border:none; background:rgba(255,255,255,0.08); color:white; font-size:10px; cursor:pointer; font-family:var(--font);">Open</button>
            </div>
          `).join('');
          appList.querySelectorAll('.android-launch').forEach(btn => {
            btn.addEventListener('click', () => {
              fetch('/api/android/launch-app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageName: btn.dataset.pkg }) });
            });
          });
        }
      } catch {
        appList.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:12px;">Could not load apps</div>';
      }
    } catch (err) {
      const _em = document.createElement('span'); _em.textContent = err.message;
      content.innerHTML = `<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">Android runtime unavailable<br><span style="font-size:11px;">${_em.innerHTML}</span></div>`;
    }
  }

  // ─── Linux Apps tab (Flatpak integration) ───
  async function renderLinuxApps() {
    content.innerHTML = `
      <div style="padding:20px;">
        <div style="display:flex; gap:10px; margin-bottom:20px;">
          <input type="text" id="flatpak-search" placeholder="Search Linux apps (Firefox, GIMP, VS Code, Spotify, Discord, Steam...)"
            style="flex:1; padding:10px 14px; border-radius:10px; border:1px solid rgba(255,255,255,0.1);
                   background:rgba(255,255,255,0.05); color:white; font-size:13px; font-family:var(--font); outline:none;">
          <button id="flatpak-search-btn" style="padding:10px 20px; border-radius:10px; border:none; background:var(--accent); color:white; font-size:13px; font-family:var(--font); cursor:pointer; font-weight:500;">Search</button>
        </div>

        <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px;">Popular Apps</div>
        <div id="flatpak-popular" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; margin-bottom:24px;">
          ${popularLinuxApps.map(a => flatpakCard(a)).join('')}
        </div>

        <div id="flatpak-results"></div>

        <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.5px; margin:20px 0 12px;">Installed Linux Apps</div>
        <div id="flatpak-installed" style="display:flex; flex-direction:column; gap:6px;">
          <div style="color:rgba(255,255,255,0.3); font-size:12px;">Loading...</div>
        </div>
      </div>
    `;

    const searchInput = content.querySelector('#flatpak-search');
    const searchBtn = content.querySelector('#flatpak-search-btn');

    const doSearch = async () => {
      const q = searchInput.value.trim();
      if (!q) return;
      const resultsEl = content.querySelector('#flatpak-results');
      resultsEl.innerHTML = '<div style="color:rgba(255,255,255,0.4); font-size:12px; padding:10px;">Searching Flathub...</div>';
      try {
        const res = await fetch(`/api/apps/search?q=${encodeURIComponent(q)}`);
        const { results } = await res.json();
        if (results.length === 0) {
          resultsEl.innerHTML = '<div style="color:rgba(255,255,255,0.4); font-size:12px; padding:10px;">No results found</div>';
          return;
        }
        resultsEl.innerHTML = `
          <div style="font-size:12px; font-weight:600; color:rgba(255,255,255,0.6); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:12px;">Search Results</div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
            ${results.map(r => flatpakCard({ id: r.id, name: r.name, desc: r.description || '', icon: '\uD83D\uDCE6' })).join('')}
          </div>
        `;
        bindFlatpakButtons(resultsEl);
      } catch (err) {
        const _em2 = document.createElement('span'); _em2.textContent = err.message;
        resultsEl.innerHTML = `<div style="color:#ff6b6b; font-size:12px; padding:10px;">Search failed: ${_em2.innerHTML}. Flatpak may not be available.</div>`;
      }
    };

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    bindFlatpakButtons(content.querySelector('#flatpak-popular'));
    loadInstalledFlatpaks();
  }

  async function loadInstalledFlatpaks() {
    const el = content.querySelector('#flatpak-installed');
    if (!el) return;
    try {
      const res = await fetch('/api/apps/installed');
      const { apps } = await res.json();
      if (apps.length === 0) {
        el.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:12px;">No Linux apps installed yet</div>';
        return;
      }
      el.innerHTML = apps.map(a => `
        <div style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:10px; background:rgba(255,255,255,0.03);">
          <div style="font-size:18px;">\uD83D\uDCE6</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:500;">${escHtml(a.name)}</div>
            <div style="font-size:10px; color:rgba(255,255,255,0.4);">${escHtml(a.id)} \u00B7 ${a.version || ''}</div>
          </div>
          <button class="flatpak-launch" data-id="${escHtml(a.id)}" style="padding:5px 12px; border-radius:6px; border:none; background:var(--accent); color:white; font-size:11px; cursor:pointer; font-family:var(--font);">Open</button>
          <button class="flatpak-remove" data-id="${escHtml(a.id)}" style="padding:5px 12px; border-radius:6px; border:1px solid rgba(255,59,48,0.3); background:transparent; color:#ff6b6b; font-size:11px; cursor:pointer; font-family:var(--font);">Remove</button>
        </div>
      `).join('');

      el.querySelectorAll('.flatpak-launch').forEach(btn => {
        btn.addEventListener('click', () => {
          fetch('/api/apps/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: btn.dataset.id }) });
        });
      });
      el.querySelectorAll('.flatpak-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Remove ${btn.dataset.id}?`)) return;
          btn.textContent = 'Removing...';
          await fetch('/api/apps/uninstall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: btn.dataset.id }) });
          loadInstalledFlatpaks();
        });
      });
    } catch {
      el.innerHTML = '<div style="color:rgba(255,255,255,0.3); font-size:12px;">Could not load installed apps</div>';
    }
  }

  function bindFlatpakButtons(container) {
    if (!container) return;
    container.querySelectorAll('.flatpak-install-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const appId = btn.dataset.id;
        btn.textContent = 'Installing...';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        try {
          await fetch('/api/apps/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appId }),
          });
          btn.textContent = 'Installing (background)...';
          setTimeout(() => { btn.textContent = 'Installed'; }, 3000);
        } catch {
          btn.textContent = 'Failed';
          btn.disabled = false;
        }
      });
    });
  }

  renderContent();
}

const popularLinuxApps = [
  { id: 'org.libreoffice.LibreOffice', name: 'LibreOffice', desc: 'Office suite — Writer, Calc, Impress (~600 MB)', icon: '\uD83D\uDCC4' },
  { id: 'org.chromium.Chromium', name: 'Chromium', desc: 'Open-source web browser (~250 MB)', icon: '\uD83C\uDF10' },
  { id: 'org.mozilla.firefox', name: 'Firefox', desc: 'Fast, private web browser', icon: '\uD83E\uDD8A' },
  { id: 'com.google.Chrome', name: 'Google Chrome', desc: 'Web browser by Google', icon: '\uD83C\uDF10' },
  { id: 'com.visualstudio.code', name: 'VS Code', desc: 'Code editor by Microsoft', icon: '\uD83D\uDCDD' },
  { id: 'com.spotify.Client', name: 'Spotify', desc: 'Music streaming', icon: '\uD83C\uDFB5' },
  { id: 'com.discordapp.Discord', name: 'Discord', desc: 'Voice, video & text chat', icon: '\uD83D\uDCAC' },
  { id: 'com.valvesoftware.Steam', name: 'Steam', desc: 'PC gaming platform', icon: '\uD83C\uDFAE' },
  { id: 'org.gimp.GIMP', name: 'GIMP', desc: 'Image editor', icon: '\uD83D\uDDBC\uFE0F' },
  { id: 'org.blender.Blender', name: 'Blender', desc: '3D creation suite', icon: '\uD83C\uDFAC' },
  { id: 'org.videolan.VLC', name: 'VLC', desc: 'Media player', icon: '\u25B6\uFE0F' },
  { id: 'org.telegram.desktop', name: 'Telegram', desc: 'Messaging app', icon: '\u2708\uFE0F' },
  { id: 'com.obsproject.Studio', name: 'OBS Studio', desc: 'Streaming & recording', icon: '\uD83D\uDCF9' },
  { id: 'org.kde.kdenlive', name: 'Kdenlive', desc: 'Video editor', icon: '\uD83C\uDFAC' },
];

function flatpakCard(app) {
  return `
    <div style="display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:12px; background:rgba(255,255,255,0.04); transition:background 0.15s;"
      onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='rgba(255,255,255,0.04)'">
      <div style="font-size:32px; width:42px; text-align:center;">${app.icon}</div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:600;">${escHtml(app.name)}</div>
        <div style="font-size:11px; color:rgba(255,255,255,0.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(app.desc)}</div>
      </div>
      <button class="flatpak-install-btn" data-id="${escHtml(app.id)}" style="
        padding:6px 14px; border-radius:16px; border:none;
        background:var(--accent); color:white; font-size:11px;
        font-weight:600; cursor:pointer; font-family:var(--font);
        white-space:nowrap;
      ">GET</button>
    </div>
  `;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
