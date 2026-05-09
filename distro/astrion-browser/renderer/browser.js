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
const readerBtn = document.getElementById('reader-btn');

// Local mirror of main-process tab list, kept in sync via push events.
let tabState = []; // [{ id, url, title, favicon, isLoading, canGoBack, canGoForward }]
let activeId = null;
let urlBarFocused = false;

// ─── Tab strip rendering ────────────────────────────────
function renderTabs() {
  tabsEl.innerHTML = '';
  // Sort: pinned first (in their original order), then unpinned.
  const sorted = [
    ...tabState.filter(t => t.pinned),
    ...tabState.filter(t => !t.pinned),
  ];
  for (const t of sorted) {
    const tab = document.createElement('div');
    tab.className = 'tab'
      + (t.id === activeId ? ' active' : '')
      + (t.isLoading ? ' loading' : '')
      + (t.pinned ? ' pinned' : '');
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

aiBtn.addEventListener('click', () => toggleSidebar());
readerBtn.addEventListener('click', () => window.astrion.openReader());

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
  else if (ctrl && e.key === 'd') { e.preventDefault(); toggleBookmarkActive(); }
  else if (ctrl && e.key === 'f') { e.preventDefault(); openFindBar(); }
  else if (ctrl && e.key === 'h') { e.preventDefault(); window.astrion.newTab('astrion://history'); }
  else if (ctrl && e.key === ',') { e.preventDefault(); window.astrion.newTab('astrion://settings'); }
  else if (ctrl && e.key === 'j') { e.preventDefault(); toggleDownloadsBar(); }
  else if (ctrl && e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); toggleSidebar(); }
  else if (ctrl && e.shiftKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); window.astrion.openReader(); }
  else if (e.key === 'F11') { e.preventDefault(); window.astrion.toggleFullscreen(); }
  else if (ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); window.astrion.zoomIn(); }
  else if (ctrl && e.key === '-') { e.preventDefault(); window.astrion.zoomOut(); }
  else if (ctrl && e.key === '0') { e.preventDefault(); window.astrion.zoomReset(); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); if (activeId !== null) window.astrion.back(activeId); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); if (activeId !== null) window.astrion.forward(activeId); }
  else if (e.key === 'Escape' && !findBar.hidden) { e.preventDefault(); closeFindBar(); }
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

// ═══════════════════════════════════════════════════════
// AI SIDEBAR
// ═══════════════════════════════════════════════════════
const sidebar = document.getElementById('sidebar');
const sidebarClose = document.getElementById('sidebar-close');
const sidebarMessages = document.getElementById('sidebar-messages');
const sidebarContext = document.getElementById('sidebar-context');
const sidebarForm = document.getElementById('sidebar-form');
const sidebarInput = document.getElementById('sidebar-input');
const sidebarSend = document.getElementById('sidebar-send');
const sidebarSuggestions = document.querySelectorAll('.sidebar-suggestion');

let sidebarOpen = false;

async function toggleSidebar() {
  const newState = await window.astrion.toggleSidebar();
  setSidebarVisible(newState);
}

function setSidebarVisible(open) {
  sidebarOpen = open;
  sidebar.hidden = !sidebarOpen;
  aiBtn.classList.toggle('active', sidebarOpen);
  if (sidebarOpen) {
    refreshSidebarContext();
    setTimeout(() => sidebarInput.focus(), 50);
  }
}

// Main process opens the sidebar in response to a context-menu click.
window.astrion.onSidebarOpened?.(() => {
  setSidebarVisible(true);
});

// Main process asks us to send a specific prompt (e.g. "Summarize this
// page" from the right-click menu). Open + ask + scroll.
window.astrion.onSidebarAskWithPrompt?.((prompt) => {
  setSidebarVisible(true);
  // Defer slightly so the layout/focus settle before sendAiMessage
  // mutates the DOM.
  setTimeout(() => sendAiMessage(prompt), 100);
});

async function refreshSidebarContext() {
  try {
    const ctx = await window.astrion.pageContext();
    if (ctx.url && !ctx.url.includes('newtab.html')) {
      sidebarContext.textContent = `Reading: ${ctx.title || ctx.url}`;
    } else {
      sidebarContext.textContent = '';
    }
  } catch {
    sidebarContext.textContent = '';
  }
}

sidebarClose.addEventListener('click', () => toggleSidebar());

sidebarForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendAiMessage(sidebarInput.value);
});

// Enter to send (Shift+Enter for newline)
sidebarInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAiMessage(sidebarInput.value);
  }
});

sidebarSuggestions.forEach(btn => {
  btn.addEventListener('click', () => {
    sendAiMessage(btn.dataset.q);
  });
});

async function sendAiMessage(prompt) {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return;

  appendSidebarMessage('user', trimmed);
  sidebarInput.value = '';
  sidebarSend.disabled = true;

  const loading = appendSidebarMessage('assistant', '');
  loading.classList.add('loading');

  try {
    const resp = await window.astrion.askAi(trimmed);
    loading.classList.remove('loading');
    if (resp && resp.ok) {
      loading.textContent = resp.reply;
    } else {
      loading.classList.add('error');
      loading.textContent = (resp && resp.error) || 'AI request failed.';
    }
  } catch (err) {
    loading.classList.remove('loading');
    loading.classList.add('error');
    loading.textContent = err?.message || 'AI request failed.';
  } finally {
    sidebarSend.disabled = false;
    sidebarInput.focus();
    sidebarMessages.scrollTop = sidebarMessages.scrollHeight;
  }
}

function appendSidebarMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  sidebarMessages.appendChild(div);
  sidebarMessages.scrollTop = sidebarMessages.scrollHeight;
  return div;
}

// ═══════════════════════════════════════════════════════
// BOOKMARKS
// ═══════════════════════════════════════════════════════
const bookmarksBar = document.getElementById('bookmarks-bar');
const bookmarkBtn = document.getElementById('bookmark-btn');
let bookmarks = [];

function isBookmarked(url) {
  return bookmarks.some(b => b.url === url);
}

async function toggleBookmarkActive() {
  if (activeId === null) return;
  const t = tabState.find(x => x.id === activeId);
  if (!t) return;
  if (isBookmarked(t.url)) {
    await window.astrion.removeBookmark(t.url);
  } else {
    await window.astrion.addBookmark({ url: t.url, title: t.title, favicon: t.favicon });
  }
}

function renderBookmarksBar() {
  bookmarksBar.innerHTML = '';
  if (bookmarks.length === 0) {
    bookmarksBar.hidden = true;
    return;
  }
  bookmarksBar.hidden = false;
  for (const b of bookmarks.slice(0, 30)) {
    const btn = document.createElement('button');
    btn.className = 'bookmark';
    btn.title = b.url;

    const fav = document.createElement('span');
    fav.className = 'bookmark-favicon';
    if (b.favicon) {
      fav.style.background = `url("${cssEscape(b.favicon)}") center/contain no-repeat`;
    } else {
      fav.style.background = 'rgba(255,255,255,0.12)';
    }
    btn.appendChild(fav);

    const label = document.createElement('span');
    label.textContent = b.title || displayUrl(b.url);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      if (activeId !== null) window.astrion.navigate(activeId, b.url);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.astrion.removeBookmark(b.url);
    });

    bookmarksBar.appendChild(btn);
  }
}

function refreshBookmarkButton() {
  const t = tabState.find(x => x.id === activeId);
  bookmarkBtn.classList.toggle('bookmarked', !!(t && isBookmarked(t.url)));
  bookmarkBtn.textContent = (t && isBookmarked(t.url)) ? '★' : '☆';
}

bookmarkBtn.addEventListener('click', () => toggleBookmarkActive());

window.astrion.onBookmarks((list) => {
  bookmarks = list;
  renderBookmarksBar();
  refreshBookmarkButton();
});

window.astrion.listBookmarks().then((list) => {
  bookmarks = list;
  renderBookmarksBar();
  refreshBookmarkButton();
});

// Hook into tab updates so the star reflects the active tab's URL.
const _origRefresh = refreshChromeForActive;
refreshChromeForActive = function() {
  _origRefresh();
  refreshBookmarkButton();
};

// ═══════════════════════════════════════════════════════
// FIND IN PAGE
// ═══════════════════════════════════════════════════════
const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const findPrev = document.getElementById('find-prev');
const findNext = document.getElementById('find-next');
const findCloseBtn = document.getElementById('find-close');
const findOpenBtn = document.getElementById('find-btn');

function openFindBar() {
  findBar.hidden = false;
  findInput.focus();
  findInput.select();
}

function closeFindBar() {
  findBar.hidden = true;
  findInput.value = '';
  findCount.textContent = '0/0';
  window.astrion.findStop('clearSelection');
}

findOpenBtn.addEventListener('click', () => openFindBar());
findCloseBtn.addEventListener('click', () => closeFindBar());

findInput.addEventListener('input', () => {
  if (findInput.value) {
    window.astrion.findStart(findInput.value, { findNext: true });
  } else {
    findCount.textContent = '0/0';
    window.astrion.findStop('clearSelection');
  }
});

findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    window.astrion.findStart(findInput.value, { forward: !e.shiftKey, findNext: false });
  }
});

findPrev.addEventListener('click', () => {
  if (findInput.value) window.astrion.findStart(findInput.value, { forward: false, findNext: false });
});
findNext.addEventListener('click', () => {
  if (findInput.value) window.astrion.findStart(findInput.value, { forward: true, findNext: false });
});

// found-in-page result count comes back via tab-update. main.js
// doesn't currently pipe that through; we'd add a "find:result" IPC
// channel to track activeMatchOrdinal/matches. For now the count
// shows "?" until we wire it.

// ═══════════════════════════════════════════════════════
// TAB CONTEXT MENU
// ═══════════════════════════════════════════════════════
const tabMenu = document.getElementById('tab-menu');
let tabMenuTargetId = null;

document.addEventListener('contextmenu', (e) => {
  const tabEl = e.target.closest?.('.tab');
  if (!tabEl) return;
  e.preventDefault();
  tabMenuTargetId = parseInt(tabEl.dataset.id, 10);
  showTabMenu(e.pageX, e.pageY);
});

function showTabMenu(x, y) {
  // Show pin or unpin depending on the target tab's state.
  const target = tabState.find(t => t.id === tabMenuTargetId);
  const pinned = !!(target && target.pinned);
  tabMenu.querySelector('button[data-action="pin"]').hidden = pinned;
  tabMenu.querySelector('button[data-action="unpin"]').hidden = !pinned;

  tabMenu.hidden = false;
  // Clamp to viewport
  const rect = tabMenu.getBoundingClientRect();
  const mx = Math.min(x, window.innerWidth - rect.width - 8);
  const my = Math.min(y, window.innerHeight - rect.height - 8);
  tabMenu.style.left = mx + 'px';
  tabMenu.style.top = my + 'px';
}

function hideTabMenu() {
  tabMenu.hidden = true;
  tabMenuTargetId = null;
}

document.addEventListener('click', (e) => {
  if (!tabMenu.hidden && !tabMenu.contains(e.target)) hideTabMenu();
});

tabMenu.querySelectorAll('button[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = tabMenuTargetId;
    if (id === null) { hideTabMenu(); return; }
    const action = btn.dataset.action;
    switch (action) {
      case 'reload': window.astrion.reload(id); break;
      case 'duplicate': window.astrion.duplicateTab(id); break;
      case 'pin': window.astrion.pinTab(id, true); break;
      case 'unpin': window.astrion.pinTab(id, false); break;
      case 'mute': window.astrion.muteTab(id, true); break;
      case 'unmute': window.astrion.muteTab(id, false); break;
      case 'close': window.astrion.closeTab(id); break;
      case 'close-others': window.astrion.closeOtherTabs(id); break;
      case 'close-right': window.astrion.closeTabsRight(id); break;
    }
    hideTabMenu();
  });
});

// ═══════════════════════════════════════════════════════
// DOWNLOADS BAR
// ═══════════════════════════════════════════════════════
const downloadsBar = document.getElementById('downloads-bar');
const downloadsItems = document.getElementById('downloads-items');
const downloadsClear = document.getElementById('downloads-clear');
const downloadsClose = document.getElementById('downloads-close');

let lastDownloads = [];
let downloadsBarManuallyHidden = false;

function fmtBytes(bytes) {
  if (!bytes) return '0';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function renderDownloads(list) {
  lastDownloads = list || [];
  downloadsItems.innerHTML = '';
  // Show only the most recent 5 in the bar.
  for (const d of lastDownloads.slice(0, 5)) {
    const row = document.createElement('div');
    row.className = `dl-item ${d.state}`;

    const name = document.createElement('span');
    name.className = 'dl-item-name';
    name.textContent = d.filename;
    name.title = d.savePath || d.filename;
    row.appendChild(name);

    if (d.state === 'progressing') {
      const bar = document.createElement('div');
      bar.className = 'dl-item-bar';
      const fill = document.createElement('div');
      fill.className = 'dl-item-bar-fill';
      const pct = d.totalBytes > 0 ? (d.receivedBytes / d.totalBytes) * 100 : 0;
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      const prog = document.createElement('span');
      prog.className = 'dl-item-progress';
      prog.textContent = d.totalBytes
        ? `${fmtBytes(d.receivedBytes)}/${fmtBytes(d.totalBytes)}`
        : fmtBytes(d.receivedBytes);
      row.appendChild(prog);
    } else if (d.state === 'completed') {
      const open = document.createElement('button');
      open.className = 'dl-item-action';
      open.textContent = 'Open';
      open.addEventListener('click', () => window.astrion.openDownload(d.id));
      row.appendChild(open);

      const show = document.createElement('button');
      show.className = 'dl-item-action';
      show.textContent = 'Show';
      show.addEventListener('click', () => window.astrion.showDownload(d.id));
      row.appendChild(show);
    } else {
      const status = document.createElement('span');
      status.className = 'dl-item-progress';
      status.textContent = d.state;
      row.appendChild(status);
    }

    downloadsItems.appendChild(row);
  }
}

function toggleDownloadsBar() {
  if (downloadsBar.hidden) {
    downloadsBarManuallyHidden = false;
    downloadsBar.hidden = false;
    window.astrion.listDownloads().then(renderDownloads);
  } else {
    downloadsBarManuallyHidden = true;
    downloadsBar.hidden = true;
  }
}

downloadsClear.addEventListener('click', () => {
  window.astrion.clearDownloads();
});
downloadsClose.addEventListener('click', () => {
  downloadsBarManuallyHidden = true;
  downloadsBar.hidden = true;
});

window.astrion.onDownloads?.((list) => {
  const wasHidden = downloadsBar.hidden;
  renderDownloads(list);
  // Auto-show when something starts. Don't pop back up if user
  // explicitly closed it.
  if (list && list.length > 0 && !downloadsBarManuallyHidden) {
    downloadsBar.hidden = false;
  }
});

// Initial pull.
window.astrion.listDownloads?.().then(list => {
  if (list && list.length > 0 && !downloadsBarManuallyHidden) {
    downloadsBar.hidden = false;
  }
  renderDownloads(list || []);
});
