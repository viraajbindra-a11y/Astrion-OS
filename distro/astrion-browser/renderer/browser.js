// Astrion Browser — chrome (renderer)
//
// All renderer logic lives here. The window has no nodeIntegration —
// everything talks to main via the `astrion` API the preload exposes.

const tabsEl = document.getElementById('tabs');
const newTabBtn = document.getElementById('new-tab-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const urlBar = document.getElementById('url-bar');
const urlIcon = document.getElementById('url-icon');
const aiBtn = document.getElementById('ai-btn');

// Local mirror of main-process tab list, kept in sync via push events.
let tabState = []; // [{ id, url, title, favicon, isLoading, canGoBack, canGoForward }]
let activeId = null;
let urlBarFocused = false;

// ─── Tab strip rendering ────────────────────────────────
function renderTabs() {
  tabsEl.innerHTML = '';
  for (const t of tabState) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.id === activeId ? ' active' : '') + (t.isLoading ? ' loading' : '');
    tab.dataset.id = t.id;

    const fav = document.createElement('span');
    fav.className = 'tab-favicon';
    if (t.favicon && !t.isLoading) {
      fav.style.backgroundImage = `url("${cssEscape(t.favicon)}")`;
      fav.style.background = `url("${cssEscape(t.favicon)}") center/contain no-repeat, rgba(255,255,255,0.06)`;
    }
    tab.appendChild(fav);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = t.title || displayUrl(t.url) || 'New Tab';
    tab.appendChild(title);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      window.astrion.closeTab(t.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => {
      if (t.id !== activeId) window.astrion.switchTab(t.id);
    });
    // Middle-click closes a tab — universal browser convention.
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.astrion.closeTab(t.id);
      }
    });

    tabsEl.appendChild(tab);
  }
}

function refreshChromeForActive() {
  const t = tabState.find(x => x.id === activeId);
  if (!t) {
    backBtn.disabled = true;
    forwardBtn.disabled = true;
    if (!urlBarFocused) urlBar.value = '';
    return;
  }
  backBtn.disabled = !t.canGoBack;
  forwardBtn.disabled = !t.canGoForward;
  if (!urlBarFocused) {
    urlBar.value = displayUrl(t.url);
  }
  // Lock icon hint: https → 🔒, file:// → 📄, http:// → ⚠
  if (t.url.startsWith('https://')) urlIcon.textContent = '🔒';
  else if (t.url.startsWith('file://')) urlIcon.textContent = '📄';
  else if (t.url.startsWith('http://')) urlIcon.textContent = '⚠';
  else if (t.url.startsWith('astrion:') || t.url.includes('newtab.html')) urlIcon.textContent = '✨';
  else urlIcon.textContent = '·';
}

function displayUrl(url) {
  if (!url) return '';
  // Strip our newtab file path so the URL bar reads "astrion://newtab".
  if (url.includes('newtab.html')) return 'astrion://newtab';
  return url;
}

function cssEscape(s) {
  return String(s).replace(/[\\"]/g, (c) => `\\${c}`);
}

// ─── Wiring ─────────────────────────────────────────────
newTabBtn.addEventListener('click', () => window.astrion.newTab());
backBtn.addEventListener('click', () => activeId !== null && window.astrion.back(activeId));
forwardBtn.addEventListener('click', () => activeId !== null && window.astrion.forward(activeId));
reloadBtn.addEventListener('click', () => activeId !== null && window.astrion.reload(activeId));

aiBtn.addEventListener('click', () => {
  // Phase 2 lands the AI sidebar. For now this opens a new tab to
  // Astrion's chat interface — gives users a discoverable surface.
  window.astrion.newTab('astrion://newtab');
});

urlBar.addEventListener('focus', () => {
  urlBarFocused = true;
  // Select all on focus — universal address-bar UX.
  setTimeout(() => urlBar.select(), 0);
});
urlBar.addEventListener('blur', () => {
  urlBarFocused = false;
  refreshChromeForActive();
});
urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (activeId !== null) window.astrion.navigate(activeId, urlBar.value);
    urlBar.blur();
  } else if (e.key === 'Escape') {
    refreshChromeForActive();
    urlBar.blur();
  }
});

// ─── Keyboard shortcuts ─────────────────────────────────
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 't') { e.preventDefault(); window.astrion.newTab(); }
  else if (ctrl && e.key === 'w') { e.preventDefault(); if (activeId !== null) window.astrion.closeTab(activeId); }
  else if (ctrl && e.key === 'l') { e.preventDefault(); urlBar.focus(); }
  else if (ctrl && e.key === 'r') { e.preventDefault(); if (activeId !== null) window.astrion.reload(activeId); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); if (activeId !== null) window.astrion.back(activeId); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); if (activeId !== null) window.astrion.forward(activeId); }
  else if (ctrl && /^[1-9]$/.test(e.key)) {
    // Ctrl+1..9 jump to nth tab (1-indexed)
    const idx = parseInt(e.key, 10) - 1;
    const target = tabState[idx];
    if (target) { e.preventDefault(); window.astrion.switchTab(target.id); }
  }
});

// ─── Subscribe to main process push events ─────────────
window.astrion.onTabsList((list) => {
  tabState = list;
  renderTabs();
  refreshChromeForActive();
});
window.astrion.onActiveTab((id) => {
  activeId = id;
  renderTabs();
  refreshChromeForActive();
});
window.astrion.onTabUpdate((tab) => {
  const idx = tabState.findIndex(t => t.id === tab.id);
  if (idx >= 0) tabState[idx] = tab;
  else tabState.push(tab);
  renderTabs();
  if (tab.id === activeId) refreshChromeForActive();
});

// Initial pull — main might push the tab list before we subscribe.
window.astrion.listTabs().then((list) => {
  tabState = list;
  renderTabs();
});
window.astrion.activeTab().then((id) => {
  activeId = id;
  refreshChromeForActive();
});
