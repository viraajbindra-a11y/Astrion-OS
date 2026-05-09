// Astrion Browser — main (Electron main process)
//
// ╔════════════════════════════════════════════════════════════════════╗
// ║ IPC CHANNEL SURFACE LOCKED — 47 channels as of 2026-05-09          ║
// ║                                                                    ║
// ║ The set of ipcMain.handle channels is locked in                    ║
// ║ js/kernel/api-surface.lock.js (LOCKED_BROWSER_IPC). The v03 suite  ║
// ║ fetches this file's source and regex-parses the channel names,     ║
// ║ then asserts the set matches. Adding a new ipcMain.handle without  ║
// ║ updating the lock will fail v03.                                   ║
// ║                                                                    ║
// ║ Channel naming convention is `domain:verb` (sometimes              ║
// ║ `domain:noun`). Don't introduce a brand-new domain (i.e. left of   ║
// ║ the colon) without a real reason — bookmarks, history, settings,   ║
// ║ tabs, etc. already cover most things. Reuse > add.                 ║
// ╚════════════════════════════════════════════════════════════════════╝
//
// The chrome (tab strip, URL bar, sidebar) is a regular Electron
// BrowserWindow loading renderer/index.html. Each tab is a separate
// BrowserView attached to the same window, positioned below the chrome.
// Switching tabs swaps which BrowserView is on top + focused.
//
// We deliberately keep all "real OS" capability (cookies, history,
// localStorage) inside Electron's default partition. Astrion-specific
// features (graph-store bookmarks, AI on-page actions) come in via IPC
// and are layered on top of that vanilla Chromium behaviour.

const { app, BrowserWindow, BrowserView, ipcMain, shell, session, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Constants ─────────────────────────────────────────────────────
// Layout dimensions. BrowserViews are positioned beneath / beside the
// chrome HTML based on the active layout mode. Horizontal mode (default):
// chrome is 80px tall across the top. Vertical-tabs mode: tab strip is
// 220px wide on the left + a 44px toolbar across the rest of the top.
// Keep these in sync with renderer/style.css.
const CHROME_HEIGHT = 80;
const TOOLBAR_HEIGHT = 44;
const VERTICAL_TAB_WIDTH = 220;
// Width of the AI sidebar when open. Page BrowserView shrinks by
// this amount horizontally so the sidebar HTML in the chrome shows
// through on the right edge.
const SIDEBAR_WIDTH = 360;
const ASTRION_NEWTAB = `file://${path.join(__dirname, 'renderer', 'newtab.html')}`;
const ASTRION_HISTORY = `file://${path.join(__dirname, 'renderer', 'history.html')}`;
const ASTRION_SETTINGS = `file://${path.join(__dirname, 'renderer', 'settings.html')}`;
const ASTRION_READER = `file://${path.join(__dirname, 'renderer', 'reader.html')}`;
const ASTRION_READING_LIST = `file://${path.join(__dirname, 'renderer', 'reading-list.html')}`;
// Astrion's web server (web app, /api endpoints). The browser's AI
// sidebar talks to it; bookmarks may sync to it.
const ASTRION_SERVER = process.env.ASTRION_SERVER || 'http://localhost:3000';

// ─── State ─────────────────────────────────────────────────────────
let mainWindow = null;
const tabs = new Map(); // id → { id, view, url, title, favicon, isLoading }
let activeTabId = null;
let nextTabId = 1;
// AI sidebar visibility — when true, page BrowserView shrinks to leave
// room for the sidebar HTML on the right edge of the window.
let sidebarOpen = false;
// Persisted bookmarks. Loaded from disk on launch, saved on change.
let bookmarks = [];
const BOOKMARKS_PATH = path.join(app.getPath('userData'), 'bookmarks.json');

// ─── Window setup ──────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    title: 'Astrion Browser',
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Resizing the window must move/resize every BrowserView so the
  // active tab stays correctly positioned beneath the chrome.
  mainWindow.on('resize', () => layoutActiveView());
  mainWindow.on('maximize', () => layoutActiveView());
  mainWindow.on('unmaximize', () => layoutActiveView());

  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const tab of tabs.values()) {
      try { tab.view.webContents?.destroy?.(); } catch {}
    }
    tabs.clear();
  });

  // Spawn initial tabs once the chrome is ready.
  // Restore order: pinned tabs first (always), then last session if
  // the user has restoreLastSession enabled. Falls back to a single
  // newtab if there's nothing to restore.
  mainWindow.webContents.on('did-finish-load', () => {
    if (tabs.size > 0) return;
    const pinnedUrls = Array.isArray(settings.pinnedTabs) ? settings.pinnedTabs : [];
    const sessionUrls = (settings.restoreLastSession !== false && Array.isArray(settings.lastSessionTabs))
      ? settings.lastSessionTabs : [];

    let firstId = null;
    for (const url of pinnedUrls) {
      const id = createTab(url);
      const t = tabs.get(id);
      if (t) t.pinned = true;
      if (firstId === null) firstId = id;
    }
    for (const url of sessionUrls) {
      const id = createTab(url);
      if (firstId === null) firstId = id;
    }
    if (firstId === null) createTab(ASTRION_NEWTAB);
    pushTabList();
  });
}

// ─── Tab management ────────────────────────────────────────────────
function createTab(url) {
  if (!mainWindow) return null;
  const id = nextTabId++;

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Per-tab preload that activates only on our internal file://
      // pages (history, settings, newtab). External pages see no
      // privileged API.
      preload: path.join(__dirname, 'page-preload.js'),
    },
  });

  const tab = {
    id,
    view,
    url: url || ASTRION_NEWTAB,
    title: 'New Tab',
    favicon: null,
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
  };
  tabs.set(id, tab);

  // Wire WebContents events back to the chrome via IPC.
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: openUrl }) => {
    // External links (target=_blank, window.open) → open in a new tab
    // inside our browser, never spawn an external chromium.
    createTab(openUrl);
    return { action: 'deny' };
  });

  // Intercept astrion:// navigation. Chromium doesn't know the scheme,
  // so a click on <a href="astrion://history"> would 404. We catch it
  // and redirect to the corresponding file:// URL.
  wc.on('will-navigate', (e, navUrl) => {
    if (/^astrion:/.test(navUrl)) {
      e.preventDefault();
      wc.loadURL(normalizeInput(navUrl));
    }
  });

  wc.on('did-start-loading', () => {
    tab.isLoading = true;
    pushTabState(id);
  });
  wc.on('did-stop-loading', () => {
    tab.isLoading = false;
    tab.canGoBack = wc.canGoBack();
    tab.canGoForward = wc.canGoForward();
    pushTabState(id);
  });
  wc.on('did-navigate', (_, navUrl) => {
    tab.url = navUrl;
    tab.canGoBack = wc.canGoBack();
    tab.canGoForward = wc.canGoForward();
    applyPerSiteZoom(tab);
    pushTabState(id);
  });
  wc.on('did-navigate-in-page', (_, navUrl) => {
    tab.url = navUrl;
    pushTabState(id);
  });
  wc.on('page-title-updated', (_, title) => {
    tab.title = title || 'Untitled';
    pushTabState(id);
  });
  wc.on('page-favicon-updated', (_, favicons) => {
    tab.favicon = favicons[0] || null;
    pushTabState(id);
  });
  wc.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    // Mainframe load failures (e.g., DNS not resolved) — surface in
    // the URL bar but don't blow up.
    if (errorCode !== -3 /* aborted */) {
      console.warn(`[astrion-browser] failed to load ${validatedURL}: ${errorDescription}`);
    }
  });

  // Context menu — universal browser bits + Astrion's "Ask Astrion"
  // hooks. Built per-tab so the menu can access the live selection /
  // link / image at click time.
  wc.on('context-menu', (_, params) => {
    showPageContextMenu(tab, params);
  });

  // History recording on each main-frame navigation.
  wc.on('did-navigate', (_, navUrl) => {
    if (navUrl && !navUrl.startsWith('file://') && !navUrl.includes('newtab.html')) {
      pushHistoryEntry(navUrl, tab.title);
    }
  });

  wc.loadURL(tab.url);

  setActiveTab(id);
  pushTabList();
  return id;
}

function setActiveTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  // Detach the previous active view so only one BrowserView is shown.
  if (activeTabId !== null && activeTabId !== id) {
    const prev = tabs.get(activeTabId);
    if (prev && mainWindow) {
      try { mainWindow.removeBrowserView(prev.view); } catch {}
    }
  }
  if (mainWindow) {
    try { mainWindow.setBrowserView(tab.view); } catch {}
    activeTabId = id;
    layoutActiveView();
    tab.view.webContents.focus();
  }
  // Mark active for sleeping-tab tracking; reload if it was sleeping.
  markTabActive(id);
  pushActive();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  try {
    if (mainWindow) mainWindow.removeBrowserView(tab.view);
    tab.view.webContents.destroy();
  } catch {}
  tabs.delete(id);
  if (activeTabId === id) {
    const remaining = [...tabs.keys()];
    if (remaining.length === 0) {
      // Last tab closed → spawn a new newtab so the window never feels
      // "empty" while still alive.
      createTab(ASTRION_NEWTAB);
    } else {
      setActiveTab(remaining[remaining.length - 1]);
    }
  }
  pushTabList();
}

function navigateTab(id, raw) {
  const tab = tabs.get(id);
  if (!tab || !raw) return;
  const url = normalizeInput(raw);
  tab.view.webContents.loadURL(url);
}

function navigateBack(id) {
  const tab = tabs.get(id);
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
}

function navigateForward(id) {
  const tab = tabs.get(id);
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
}

function reloadTab(id) {
  const tab = tabs.get(id);
  if (tab) tab.view.webContents.reload();
}

function stopTab(id) {
  const tab = tabs.get(id);
  if (tab) tab.view.webContents.stop();
}

// ─── Helpers ───────────────────────────────────────────────────────
function normalizeInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return ASTRION_NEWTAB;
  // astrion:// internal pages — resolve to local renderer files.
  if (/^astrion:\/?\/?/.test(trimmed)) {
    const id = trimmed.replace(/^astrion:\/?\/?/, '').toLowerCase();
    if (id === 'newtab' || id === '') return ASTRION_NEWTAB;
    if (id === 'history') return ASTRION_HISTORY;
    if (id === 'settings') return ASTRION_SETTINGS;
    if (id === 'reader') return ASTRION_READER;
    if (id === 'reading-list' || id === 'readinglist') return ASTRION_READING_LIST;
    return ASTRION_NEWTAB;
  }
  // view-source: passthrough
  if (trimmed.startsWith('view-source:')) return trimmed;
  // Already a URL with scheme.
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith('about:') || trimmed.startsWith('chrome://')) return trimmed;
  // Looks like a domain (has a dot, no spaces) → assume HTTPS.
  if (!/\s/.test(trimmed) && /[.]/.test(trimmed)) return `https://${trimmed}`;
  // Search keyword expansion: "yt cats" → YouTube, "wiki ramen" → Wikipedia.
  // Splits on first space; first token is the keyword, rest is the query.
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx > 0) {
    const keyword = trimmed.slice(0, spaceIdx).toLowerCase();
    const rest = trimmed.slice(spaceIdx + 1).trim();
    const map = settings.searchKeywords || {};
    if (rest && map[keyword]) {
      return map[keyword].replace(/%s/g, encodeURIComponent(rest));
    }
  }
  // Otherwise → search using the configured search engine.
  return searchUrlFor(trimmed);
}

function searchUrlFor(query) {
  const q = encodeURIComponent(query);
  const engine = (settings && settings.searchEngine) || 'google';
  switch (engine) {
    case 'duckduckgo': return `https://duckduckgo.com/?q=${q}`;
    case 'brave':      return `https://search.brave.com/search?q=${q}`;
    case 'bing':       return `https://www.bing.com/search?q=${q}`;
    default:           return `https://www.google.com/search?q=${q}`;
  }
}

function layoutActiveView() {
  if (!mainWindow || activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const [w, h] = mainWindow.getContentSize();

  // Vertical tabs mode: tab strip is on the left, only the toolbar
  // sits above the page. Horizontal mode: full 80px chrome on top.
  const vertical = !!(settings && settings.verticalTabs);
  const xOffset = vertical ? VERTICAL_TAB_WIDTH : 0;
  const yOffset = vertical ? TOOLBAR_HEIGHT : CHROME_HEIGHT;
  // Bookmarks bar adds another row when visible — we don't wire that
  // back through main yet, so always reserve the full chrome height.
  // (Bookmarks bar is rendered in the chrome HTML; if it's hidden the
  // layout has empty space which is fine.)

  const baseWidth = w - xOffset;
  const pageWidth = sidebarOpen ? Math.max(0, baseWidth - SIDEBAR_WIDTH) : baseWidth;
  try {
    tab.view.setBounds({
      x: xOffset,
      y: yOffset,
      width: pageWidth,
      height: Math.max(0, h - yOffset),
    });
  } catch {}
}

function tabSummary(tab) {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon,
    isLoading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    pinned: !!tab.pinned,
  };
}

function pushTabState(id) {
  const tab = tabs.get(id);
  if (!tab || !mainWindow) return;
  try { mainWindow.webContents.send('tab:update', tabSummary(tab)); } catch {}
}

function pushTabList() {
  if (!mainWindow) return;
  const list = [...tabs.values()].map(tabSummary);
  try { mainWindow.webContents.send('tabs:list', list); } catch {}
}

function pushActive() {
  if (!mainWindow) return;
  try { mainWindow.webContents.send('tabs:active', activeTabId); } catch {}
}

// ─── IPC ────────────────────────────────────────────────────────────
ipcMain.handle('tabs:new', (_, url) => createTab(url));
ipcMain.handle('tabs:close', (_, id) => closeTab(id));
ipcMain.handle('tabs:switch', (_, id) => setActiveTab(id));
ipcMain.handle('tabs:list', () => [...tabs.values()].map(tabSummary));
ipcMain.handle('tabs:active', () => activeTabId);
ipcMain.handle('tab:navigate', (_, id, url) => navigateTab(id, url));
ipcMain.handle('tab:back', (_, id) => navigateBack(id));
ipcMain.handle('tab:forward', (_, id) => navigateForward(id));
ipcMain.handle('tab:reload', (_, id) => reloadTab(id));
ipcMain.handle('tab:stop', (_, id) => stopTab(id));

ipcMain.handle('astrion:server', () => ASTRION_SERVER);
ipcMain.handle('astrion:newtab-url', () => ASTRION_NEWTAB);

// External links from the chrome itself (e.g., "open in browser")
// shouldn't escape our browser.
ipcMain.handle('astrion:open-external', (_, url) => {
  // Whitelist mailto:/tel: but everything else → new tab.
  if (/^(mailto|tel|sms):/i.test(url)) {
    shell.openExternal(url);
  } else {
    createTab(url);
  }
});

// ─── AI sidebar ────────────────────────────────────────────────────
ipcMain.handle('sidebar:toggle', () => {
  sidebarOpen = !sidebarOpen;
  layoutActiveView();
  return sidebarOpen;
});
ipcMain.handle('sidebar:state', () => sidebarOpen);

// Pull a usable text snapshot from the active tab so the AI has page
// context to reason about. Capped at ~6000 chars (≈1500 tokens) so we
// don't blow the chat budget on a long article.
ipcMain.handle('sidebar:page-context', async () => {
  if (activeTabId === null) return { url: '', title: '', text: '' };
  const tab = tabs.get(activeTabId);
  if (!tab) return { url: '', title: '', text: '' };
  try {
    const text = await tab.view.webContents.executeJavaScript(`
      (() => {
        const main = document.querySelector('main, article, [role="main"]') || document.body;
        return (main.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000);
      })()
    `, true).catch(() => '');
    return {
      url: tab.url,
      title: tab.title,
      text: text || '',
    };
  } catch {
    return { url: tab.url, title: tab.title, text: '' };
  }
});

// Forward the AI ask to Astrion's web server. We do this from main so
// the file:// chrome doesn't hit CORS, and so we can attach the page
// context without exposing fetch() to the renderer. Calls Astrion's
// existing /api/ai/ollama endpoint (local model, no key needed) —
// matches what the JS chat panel uses. Future: pull the user-chosen
// model from a shared config endpoint instead of hardcoding.
ipcMain.handle('sidebar:ask', async (_, prompt) => {
  try {
    const ctx = await ipcMainInvoke('sidebar:page-context');
    const baseSystem =
      'You are Astrion, the built-in AI inside Astrion Browser. ' +
      'You help the user understand, summarize, and reason about the page they are reading. ' +
      'Be concise. Use markdown sparingly.';
    const pageSystem = ctx.url && !ctx.url.includes('newtab.html')
      ? `\n\nThe user is currently viewing:\nTitle: ${ctx.title}\nURL: ${ctx.url}\n\nPage excerpt (truncated):\n${ctx.text}`
      : '';
    const body = {
      url: process.env.ASTRION_OLLAMA_URL || 'http://localhost:11434',
      model: process.env.ASTRION_OLLAMA_MODEL || 'qwen2.5:7b',
      system: baseSystem + pageSystem,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
    };
    const res = await fetch(`${ASTRION_SERVER}/api/ai/ollama`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `Astrion AI returned ${res.status}${errText ? ': ' + errText.slice(0, 200) : ''}` };
    }
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, reply: data.reply || '(empty response)' };
  } catch (err) {
    return { ok: false, error: err?.message || 'AI request failed' };
  }
});

// ipcMain.handle returns a function we can't directly invoke; this
// helper invokes one of our own handlers from inside another so we
// can compose page-context + ask without duplicating logic.
async function ipcMainInvoke(channel, ...args) {
  if (channel === 'sidebar:page-context') {
    if (activeTabId === null) return { url: '', title: '', text: '' };
    const tab = tabs.get(activeTabId);
    if (!tab) return { url: '', title: '', text: '' };
    try {
      const text = await tab.view.webContents.executeJavaScript(`
        (() => {
          const main = document.querySelector('main, article, [role="main"]') || document.body;
          return (main.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000);
        })()
      `, true).catch(() => '');
      return { url: tab.url, title: tab.title, text: text || '' };
    } catch {
      return { url: tab.url, title: tab.title, text: '' };
    }
  }
  return null;
}

// ─── Bookmarks ─────────────────────────────────────────────────────
function loadBookmarks() {
  try {
    if (fs.existsSync(BOOKMARKS_PATH)) {
      const raw = fs.readFileSync(BOOKMARKS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) bookmarks = parsed;
    }
  } catch (err) {
    console.warn('[astrion-browser] failed to load bookmarks:', err?.message);
  }
}
function saveBookmarks() {
  try {
    fs.writeFileSync(BOOKMARKS_PATH, JSON.stringify(bookmarks, null, 2));
  } catch (err) {
    console.warn('[astrion-browser] failed to save bookmarks:', err?.message);
  }
}
function pushBookmarks() {
  if (mainWindow) {
    try { mainWindow.webContents.send('bookmarks:list', bookmarks); } catch {}
  }
}
ipcMain.handle('bookmarks:list', () => bookmarks);
ipcMain.handle('bookmarks:add', (_, b) => {
  if (!b || !b.url) return false;
  // Dedup by URL — re-bookmarking just updates the title.
  const existing = bookmarks.findIndex(x => x.url === b.url);
  const entry = { url: b.url, title: b.title || b.url, favicon: b.favicon || null, addedAt: Date.now() };
  if (existing >= 0) bookmarks[existing] = { ...bookmarks[existing], ...entry };
  else bookmarks.unshift(entry);
  saveBookmarks();
  pushBookmarks();
  return true;
});
ipcMain.handle('bookmarks:remove', (_, url) => {
  const before = bookmarks.length;
  bookmarks = bookmarks.filter(b => b.url !== url);
  if (bookmarks.length !== before) {
    saveBookmarks();
    pushBookmarks();
  }
  return true;
});

// ─── Find in page ──────────────────────────────────────────────────
ipcMain.handle('find:start', (_, text, opts) => {
  if (activeTabId === null || !text) return;
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.findInPage(text, opts || {});
});
ipcMain.handle('find:stop', (_, action) => {
  if (activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  // action: 'clearSelection' | 'keepSelection' | 'activateSelection'
  if (tab) tab.view.webContents.stopFindInPage(action || 'clearSelection');
});

// ─── Page zoom ─────────────────────────────────────────────────────
function persistZoom(tab, factor) {
  try {
    const host = new URL(tab.url).hostname;
    if (!host) return;
    if (!settings.perSiteZoom) settings.perSiteZoom = {};
    if (Math.abs(factor - 1.0) < 0.001) {
      delete settings.perSiteZoom[host];
    } else {
      settings.perSiteZoom[host] = +factor.toFixed(2);
    }
    saveSettings();
  } catch {}
}
ipcMain.handle('zoom:in', () => {
  if (activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const wc = tab.view.webContents;
  const next = Math.min(3, wc.getZoomFactor() + 0.1);
  wc.setZoomFactor(next);
  persistZoom(tab, next);
});
ipcMain.handle('zoom:out', () => {
  if (activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const wc = tab.view.webContents;
  const next = Math.max(0.25, wc.getZoomFactor() - 0.1);
  wc.setZoomFactor(next);
  persistZoom(tab, next);
});
ipcMain.handle('zoom:reset', () => {
  if (activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  tab.view.webContents.setZoomFactor(1);
  persistZoom(tab, 1);
});

// Apply persisted zoom when a tab navigates to a domain we have a
// preference for. Hooked from the createTab event flow below.
function applyPerSiteZoom(tab) {
  try {
    const host = new URL(tab.url).hostname;
    if (!host || !settings.perSiteZoom) return;
    const z = settings.perSiteZoom[host];
    if (z && z > 0) tab.view.webContents.setZoomFactor(z);
  } catch {}
}

// ─── Page context menu ─────────────────────────────────────────────
function showPageContextMenu(tab, params) {
  const wc = tab.view.webContents;
  const hasSelection = !!params.selectionText;
  const hasLink = !!params.linkURL;
  const hasImage = !!params.srcURL;
  const isEditable = !!params.isEditable;

  const items = [];

  // Astrion AI items first — that's the differentiator.
  if (hasSelection) {
    const sel = params.selectionText.trim().slice(0, 1000);
    items.push({
      label: '✨ Ask Astrion about this',
      click: () => askAstrionWithPrompt(`Explain or expand on: "${sel}"`),
    });
    items.push({
      label: '✨ Translate to English',
      click: () => askAstrionWithPrompt(`Translate this to English (or paraphrase if already English):\n"${sel}"`),
    });
    items.push({ type: 'separator' });
  } else {
    items.push({
      label: '✨ Summarize this page',
      click: () => askAstrionWithPrompt('Summarize this page in 5 bullet points.'),
    });
    items.push({
      label: '✨ Ask Astrion...',
      click: () => openAiSidebar(),
    });
    items.push({ type: 'separator' });
  }

  // Selection / clipboard
  if (hasSelection) {
    items.push({
      label: 'Copy',
      role: 'copy',
    });
    items.push({
      label: 'Search Google for "' + params.selectionText.trim().slice(0, 30) + '"',
      click: () => createTab(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`),
    });
    items.push({ type: 'separator' });
  } else if (isEditable) {
    items.push({ label: 'Cut', role: 'cut' });
    items.push({ label: 'Copy', role: 'copy' });
    items.push({ label: 'Paste', role: 'paste' });
    items.push({ type: 'separator' });
  }

  // Links
  if (hasLink) {
    items.push({
      label: 'Open link in new tab',
      click: () => createTab(params.linkURL),
    });
    items.push({
      label: 'Copy link address',
      click: () => clipboard.writeText(params.linkURL),
    });
    items.push({ type: 'separator' });
  }

  // Images
  if (hasImage) {
    items.push({
      label: 'Open image in new tab',
      click: () => createTab(params.srcURL),
    });
    items.push({
      label: 'Copy image address',
      click: () => clipboard.writeText(params.srcURL),
    });
    items.push({
      label: 'Save image as...',
      click: () => wc.downloadURL(params.srcURL),
    });
    items.push({ type: 'separator' });
  }

  // Video → Picture-in-picture
  if (params.mediaType === 'video') {
    items.push({
      label: 'Picture in picture',
      click: () => {
        // Find the video element under the click point (or any video)
        // and toggle PiP on it.
        wc.executeJavaScript(`
          (() => {
            const candidates = document.querySelectorAll('video');
            let target = null;
            for (const v of candidates) {
              if (!v.paused && !v.ended) { target = v; break; }
            }
            if (!target && candidates.length) target = candidates[0];
            if (!target) return false;
            if (document.pictureInPictureElement === target) {
              document.exitPictureInPicture().catch(() => {});
            } else {
              target.requestPictureInPicture().catch(() => {});
            }
            return true;
          })()
        `, true).catch(() => {});
      },
    });
    if (params.srcURL) {
      items.push({
        label: 'Save video as...',
        click: () => wc.downloadURL(params.srcURL),
      });
    }
    items.push({ type: 'separator' });
  }

  // Navigation
  items.push({
    label: 'Back',
    enabled: wc.canGoBack(),
    accelerator: 'Alt+Left',
    click: () => wc.goBack(),
  });
  items.push({
    label: 'Forward',
    enabled: wc.canGoForward(),
    accelerator: 'Alt+Right',
    click: () => wc.goForward(),
  });
  items.push({
    label: 'Reload',
    accelerator: 'Ctrl+R',
    click: () => wc.reload(),
  });
  items.push({ type: 'separator' });

  // View source / inspect
  items.push({
    label: 'View page source',
    click: () => createTab(`view-source:${tab.url}`),
  });
  items.push({
    label: 'Inspect element',
    accelerator: 'Ctrl+Shift+I',
    click: () => wc.inspectElement(params.x, params.y),
  });

  Menu.buildFromTemplate(items).popup({ window: mainWindow });
}

function openAiSidebar() {
  if (!sidebarOpen) {
    sidebarOpen = true;
    layoutActiveView();
  }
  if (mainWindow) {
    try { mainWindow.webContents.send('sidebar:opened'); } catch {}
  }
}

function askAstrionWithPrompt(prompt) {
  openAiSidebar();
  if (mainWindow) {
    try { mainWindow.webContents.send('sidebar:ask-with-prompt', prompt); } catch {}
  }
}

// ─── History ───────────────────────────────────────────────────────
const HISTORY_PATH = path.join(app.getPath('userData'), 'history.json');
const HISTORY_CAP = 1000;
let history = [];

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed.slice(0, HISTORY_CAP);
    }
  } catch {}
}
function saveHistory() {
  try { fs.writeFileSync(HISTORY_PATH, JSON.stringify(history)); } catch {}
}
function pushHistoryEntry(url, title) {
  // Dedup: if the most recent entry is the same URL, just bump time.
  if (history.length > 0 && history[0].url === url) {
    history[0].at = Date.now();
    if (title) history[0].title = title;
  } else {
    history.unshift({ url, title: title || url, at: Date.now() });
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
  }
  saveHistory();
}

ipcMain.handle('history:list', () => history);
ipcMain.handle('history:clear', () => {
  history = [];
  saveHistory();
});

// ─── Settings ──────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  searchEngine: 'google',           // google | duckduckgo | brave | bing | astrion
  homepage: 'astrion://newtab',
  aiModel: 'qwen2.5:7b',
  aiUrl: 'http://localhost:11434',
  sleepingTabsMinutes: 30,
  blockTrackers: true,
  restoreLastSession: true,
  pinnedTabs: [],
  lastSessionTabs: [],
  theme: 'dark',                    // dark | light | sepia
  accent: '#5ac8fa',
  verticalTabs: false,
  perSiteZoom: {},                  // { hostname: zoomFactor }
  // Search keyword expansion. Type "yt cats" → YouTube. The %s
  // placeholder gets the URL-encoded query. Users can add/remove
  // keywords from the Settings page.
  searchKeywords: {
    yt:    'https://www.youtube.com/results?search_query=%s',
    wiki:  'https://en.wikipedia.org/wiki/Special:Search?search=%s',
    gh:    'https://github.com/search?q=%s',
    amzn:  'https://www.amazon.com/s?k=%s',
    map:   'https://www.google.com/maps/search/%s',
    mdn:   'https://developer.mozilla.org/en-US/search?q=%s',
    so:    'https://stackoverflow.com/search?q=%s',
    rd:    'https://www.reddit.com/search/?q=%s',
    ddg:   'https://duckduckgo.com/?q=%s',
    img:   'https://www.google.com/search?tbm=isch&q=%s',
  },
  readingList: [],                  // [{ url, title, addedAt }]
};
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2)); } catch {}
}
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_, partial) => {
  settings = { ...settings, ...partial };
  saveSettings();
  if (mainWindow) {
    try { mainWindow.webContents.send('settings:changed', settings); } catch {}
  }
  // Some changes need an immediate effect — relayout for vertical
  // tabs toggle, fresh layout for accent/theme via CSS.
  layoutActiveView();
  return settings;
});

// ─── Ad / tracker blocker ──────────────────────────────────────────
// Built-in blocklist — see blocklist.js. Active when settings.blockTrackers
// is true (default). Matches by hostname suffix so foo.doubleclick.net
// blocks but unrelated.doubleclick-net.com does NOT.
const blocklist = require('./blocklist');
const blockSet = new Set(blocklist);
let blockedCount = 0;

function isBlockedHost(host) {
  if (!host) return false;
  if (blockSet.has(host)) return true;
  // Suffix match — pop the leftmost label and try again.
  const idx = host.indexOf('.');
  if (idx < 0) return false;
  return isBlockedHost(host.slice(idx + 1));
}

function installAdBlocker() {
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (!settings.blockTrackers) return callback({ cancel: false });
      try {
        const host = new URL(details.url).hostname;
        if (isBlockedHost(host)) {
          blockedCount++;
          return callback({ cancel: true });
        }
      } catch {}
      callback({ cancel: false });
    });
  } catch (err) {
    console.warn('[astrion-browser] failed to install ad blocker:', err?.message);
  }
}

ipcMain.handle('blocker:stats', () => ({ blockedCount, listSize: blocklist.length }));

// ─── Reading list ──────────────────────────────────────────────────
// Separate from bookmarks by intent: "I want to read this later" vs
// "I want this saved permanently for quick access." Stored in
// settings.readingList — entries can be removed when read.
ipcMain.handle('reading-list:list', () => settings.readingList || []);
ipcMain.handle('reading-list:add', (_, entry) => {
  if (!entry || !entry.url) return false;
  if (!settings.readingList) settings.readingList = [];
  // Dedup by URL — re-adding bumps to the top.
  settings.readingList = settings.readingList.filter(e => e.url !== entry.url);
  settings.readingList.unshift({
    url: entry.url,
    title: entry.title || entry.url,
    addedAt: Date.now(),
  });
  if (settings.readingList.length > 500) settings.readingList.length = 500;
  saveSettings();
  if (mainWindow) {
    try { mainWindow.webContents.send('reading-list:list', settings.readingList); } catch {}
  }
  return true;
});
ipcMain.handle('reading-list:remove', (_, url) => {
  if (!settings.readingList) return false;
  const before = settings.readingList.length;
  settings.readingList = settings.readingList.filter(e => e.url !== url);
  if (settings.readingList.length !== before) {
    saveSettings();
    if (mainWindow) {
      try { mainWindow.webContents.send('reading-list:list', settings.readingList); } catch {}
    }
  }
  return true;
});
ipcMain.handle('reading-list:add-current', () => {
  if (activeTabId === null) return false;
  const tab = tabs.get(activeTabId);
  if (!tab) return false;
  return ipcMainInvokeReading(tab);
});
function ipcMainInvokeReading(tab) {
  if (!settings.readingList) settings.readingList = [];
  settings.readingList = settings.readingList.filter(e => e.url !== tab.url);
  settings.readingList.unshift({
    url: tab.url,
    title: tab.title || tab.url,
    addedAt: Date.now(),
  });
  saveSettings();
  if (mainWindow) {
    try { mainWindow.webContents.send('reading-list:list', settings.readingList); } catch {}
  }
  return true;
}

// ─── Reading mode ──────────────────────────────────────────────────
// In-memory store. The reader extracts the active tab's content via
// JS injection, stashes it here, then opens reader.html which pulls
// it back via IPC. Cap at one entry — only the most recent extraction
// is kept (re-extracting overwrites).
let lastReaderContent = null;

ipcMain.handle('reader:extract-and-open', async () => {
  if (activeTabId === null) return null;
  const tab = tabs.get(activeTabId);
  if (!tab) return null;
  const wc = tab.view.webContents;

  try {
    const extracted = await wc.executeJavaScript(`
      (() => {
        // Simple Readability-style extraction. Find the densest text
        // container, clone it, strip non-content noise, return HTML.
        const candidates = [
          document.querySelector('article'),
          document.querySelector('[role="article"]'),
          document.querySelector('main'),
          document.querySelector('[role="main"]'),
          document.querySelector('.post, .article, .entry, .content'),
          document.body,
        ].filter(Boolean);

        let best = candidates[0];
        let bestLen = 0;
        for (const el of candidates) {
          const len = (el.innerText || '').length;
          if (len > bestLen) { best = el; bestLen = len; }
        }
        if (!best) return null;

        const clone = best.cloneNode(true);
        const stripSelectors = [
          'script', 'style', 'nav', 'header', 'footer', 'aside',
          'iframe', 'noscript', 'form', 'button', 'svg',
          '.ad', '.ads', '.advertisement', '[class*="sponsored"]',
          '[class*="newsletter"]', '[class*="popup"]',
          '[role="navigation"]', '[role="complementary"]', '[role="banner"]',
          '[aria-hidden="true"]',
        ];
        clone.querySelectorAll(stripSelectors.join(',')).forEach(el => el.remove());

        // Title
        const h1 = best.querySelector('h1') || document.querySelector('h1');
        const title = (h1 ? h1.innerText : document.title || '').trim();

        // Byline / author
        const bylineEl = document.querySelector(
          '[rel="author"], .author, .byline, [itemprop="author"], meta[name="author"]'
        );
        let byline = '';
        if (bylineEl) {
          byline = bylineEl.tagName === 'META' ? bylineEl.content : bylineEl.innerText;
          byline = (byline || '').trim().slice(0, 200);
        }

        // Date
        const dateEl = document.querySelector(
          'time, [itemprop="datePublished"], meta[property="article:published_time"]'
        );
        let date = '';
        if (dateEl) {
          date = dateEl.tagName === 'META' ? dateEl.content :
                 (dateEl.getAttribute('datetime') || dateEl.innerText || '').trim();
        }

        return {
          title,
          byline,
          date,
          content: clone.innerHTML,
          url: location.href,
          extractedAt: Date.now(),
        };
      })()
    `, true);

    if (!extracted) return null;
    lastReaderContent = extracted;
    createTab(ASTRION_READER);
    return true;
  } catch (err) {
    console.warn('[astrion-browser] reader extract failed:', err?.message);
    return null;
  }
});

ipcMain.handle('reader:get-content', () => lastReaderContent);

// ─── Downloads ─────────────────────────────────────────────────────
const downloads = []; // { id, filename, savePath, totalBytes, receivedBytes, state }
let nextDownloadId = 1;

function pushDownloads() {
  if (!mainWindow) return;
  try { mainWindow.webContents.send('downloads:list', downloads); } catch {}
}

// will-download must be registered AFTER app.whenReady — session.defaultSession
// is undefined before then. Hoist into a setup function and call from the
// whenReady block. Was silently a no-op until 2026-05-09 audit caught this.
function installDownloadsListener() {
  session.defaultSession.on('will-download', (event, item, webContents) => {
  // We don't pre-set savePath — let Electron prompt the user.
  const id = nextDownloadId++;
  const entry = {
    id,
    filename: item.getFilename(),
    savePath: '',
    totalBytes: item.getTotalBytes(),
    receivedBytes: 0,
    state: 'progressing',
    startedAt: Date.now(),
  };
  downloads.unshift(entry);
  if (downloads.length > 100) downloads.length = 100;
  pushDownloads();

  item.on('updated', (_, state) => {
    entry.state = state;
    entry.receivedBytes = item.getReceivedBytes();
    entry.totalBytes = item.getTotalBytes();
    entry.savePath = item.getSavePath();
    pushDownloads();
  });
  item.once('done', (_, state) => {
    entry.state = state;
    entry.receivedBytes = item.getReceivedBytes();
    entry.totalBytes = item.getTotalBytes();
    entry.savePath = item.getSavePath();
    pushDownloads();
  });
  });
}

ipcMain.handle('downloads:list', () => downloads);
ipcMain.handle('downloads:open', (_, id) => {
  const dl = downloads.find(d => d.id === id);
  if (dl && dl.savePath && dl.state === 'completed') {
    shell.openPath(dl.savePath);
  }
});
ipcMain.handle('downloads:show', (_, id) => {
  const dl = downloads.find(d => d.id === id);
  if (dl && dl.savePath) {
    shell.showItemInFolder(dl.savePath);
  }
});
ipcMain.handle('downloads:clear', () => {
  // Drop completed/cancelled entries; keep in-progress ones.
  for (let i = downloads.length - 1; i >= 0; i--) {
    if (downloads[i].state !== 'progressing') downloads.splice(i, 1);
  }
  pushDownloads();
});

// ─── Fullscreen ────────────────────────────────────────────────────
ipcMain.handle('fullscreen:toggle', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});
ipcMain.handle('fullscreen:state', () => mainWindow ? mainWindow.isFullScreen() : false);

// ─── Tab pinning ───────────────────────────────────────────────────
// Pinned tabs sit at the leftmost positions, render narrower in the
// strip, and the close button is hidden in their context menu. The
// pin state persists across browser restarts via the `pins` array
// in settings.
ipcMain.handle('tabs:pin', (_, id, pinned) => {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.pinned = !!pinned;
  // Persist the URL so we can restore on next launch.
  const pinnedUrls = [...tabs.values()].filter(t => t.pinned).map(t => t.url);
  settings.pinnedTabs = pinnedUrls;
  saveSettings();
  pushTabList();
});

// ─── Sleeping tabs ─────────────────────────────────────────────────
// Tabs that haven't been the active tab for N minutes get unloaded
// (replaced with about:blank) to claw back memory. The tab title and
// URL stay in our state so re-clicking the tab reloads it.
const sleepingTabs = new Set();
let sleepingTabIdleSince = new Map(); // id → timestamp of last activate
const SLEEP_CHECK_INTERVAL_MS = 60_000;

function markTabActive(id) {
  sleepingTabIdleSince.set(id, Date.now());
  if (sleepingTabs.has(id)) {
    const tab = tabs.get(id);
    if (tab) {
      sleepingTabs.delete(id);
      tab.view.webContents.loadURL(tab.url);
    }
  }
}

function sweepSleepingTabs() {
  const minutes = settings.sleepingTabsMinutes;
  if (!minutes || minutes <= 0) return;
  const cutoff = Date.now() - minutes * 60_000;
  for (const [id, lastActive] of sleepingTabIdleSince.entries()) {
    if (id === activeTabId) continue;
    if (sleepingTabs.has(id)) continue;
    if (lastActive > cutoff) continue;
    const tab = tabs.get(id);
    if (!tab) continue;
    sleepingTabs.add(id);
    // Don't blow up the URL bar / history — just unload the renderer.
    try { tab.view.webContents.loadURL('about:blank'); } catch {}
  }
}

setInterval(sweepSleepingTabs, SLEEP_CHECK_INTERVAL_MS);

// ─── Tab management extras ─────────────────────────────────────────
ipcMain.handle('tabs:duplicate', (_, id) => {
  const tab = tabs.get(id);
  if (tab) createTab(tab.url);
});
ipcMain.handle('tabs:close-others', (_, keepId) => {
  const ids = [...tabs.keys()].filter(id => id !== keepId);
  for (const id of ids) closeTab(id);
});
ipcMain.handle('tabs:close-right', (_, fromId) => {
  const ids = [...tabs.keys()];
  const idx = ids.indexOf(fromId);
  if (idx < 0) return;
  for (const id of ids.slice(idx + 1)) closeTab(id);
});
ipcMain.handle('tabs:mute', (_, id, muted) => {
  const tab = tabs.get(id);
  if (tab) tab.view.webContents.setAudioMuted(!!muted);
});

// ─── Lifecycle ─────────────────────────────────────────────────────
// Astrion-specific Chromium hardening: disable the default search engine
// pings and the metrics reporting Electron inherits from upstream.
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,MediaRouter,PrivacySandboxAdsAPIs');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');
// Friendly user agent — sites that sniff for Chrome get Chrome.
// We don't want to trigger "browser not supported" pages.

app.whenReady().then(() => {
  // Privacy defaults: block third-party cookies for trackers; suppress
  // "do you want to remember this password" if we ever get there.
  try {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      // Sensible defaults — geolocation/notifications/clipboard prompt;
      // background-sync/midi/etc auto-deny.
      const allowed = ['notifications', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'media'];
      callback(allowed.includes(permission));
    });
  } catch {}

  loadSettings();
  loadHistory();
  loadBookmarks();
  installAdBlocker();
  installDownloadsListener();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Save the last-session tab URLs (excluding pinned ones, which save
// separately). Triggers on close so restartLastSession can replay them.
function snapshotSession() {
  const sessionUrls = [...tabs.values()]
    .filter(t => !t.pinned && t.url && !t.url.includes('newtab.html'))
    .map(t => t.url);
  settings.lastSessionTabs = sessionUrls;
  saveSettings();
}

app.on('before-quit', () => snapshotSession());
app.on('window-all-closed', () => {
  snapshotSession();
  if (process.platform !== 'darwin') app.quit();
});
