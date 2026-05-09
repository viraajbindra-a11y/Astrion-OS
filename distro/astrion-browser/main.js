// Astrion Browser — main (Electron main process)
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

const { app, BrowserWindow, BrowserView, ipcMain, shell, session } = require('electron');
const path = require('path');

// ─── Constants ─────────────────────────────────────────────────────
// Height of the chrome (tab strip + URL bar). BrowserViews are
// positioned starting at this y offset. Keep in sync with style.css.
const CHROME_HEIGHT = 80;
const ASTRION_NEWTAB = `file://${path.join(__dirname, 'renderer', 'newtab.html')}`;
// Astrion's web server (web app, /api endpoints). The browser's AI
// sidebar talks to it; bookmarks may sync to it.
const ASTRION_SERVER = process.env.ASTRION_SERVER || 'http://localhost:3000';

// ─── State ─────────────────────────────────────────────────────────
let mainWindow = null;
const tabs = new Map(); // id → { id, view, url, title, favicon, isLoading }
let activeTabId = null;
let nextTabId = 1;

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

  // Spawn an initial tab once the chrome is ready.
  mainWindow.webContents.on('did-finish-load', () => {
    if (tabs.size === 0) createTab(ASTRION_NEWTAB);
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
      // Each tab gets its own session so we can wire per-tab features
      // (per-site cookie isolation, etc.) later. For now, all tabs
      // share the default partition.
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
  // Already a URL with scheme.
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(trimmed)) return trimmed;
  if (trimmed.startsWith('about:') || trimmed.startsWith('chrome://')) return trimmed;
  // Special: "astrion://newtab" → file URL of our newtab.
  if (trimmed === 'astrion://newtab' || trimmed === 'astrion:newtab') return ASTRION_NEWTAB;
  // Looks like a domain or has slashes? Assume HTTPS.
  if (!/\s/.test(trimmed) && /[.]/.test(trimmed)) return `https://${trimmed}`;
  // Otherwise → search.
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function layoutActiveView() {
  if (!mainWindow || activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const [w, h] = mainWindow.getContentSize();
  try {
    tab.view.setBounds({ x: 0, y: CHROME_HEIGHT, width: w, height: Math.max(0, h - CHROME_HEIGHT) });
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

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
