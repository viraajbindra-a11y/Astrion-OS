// Astrion Browser — preload (context bridge between renderer + main)
//
// Exposes a small `window.astrion` API to the chrome (renderer/index.html)
// so it can talk to the main process without enabling nodeIntegration.
// Page content (each tab's BrowserView) does NOT use this preload —
// it gets a clean default Chromium environment so sites work normally.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('astrion', {
  // Tab lifecycle
  newTab: (url) => ipcRenderer.invoke('tabs:new', url),
  closeTab: (id) => ipcRenderer.invoke('tabs:close', id),
  switchTab: (id) => ipcRenderer.invoke('tabs:switch', id),
  listTabs: () => ipcRenderer.invoke('tabs:list'),
  activeTab: () => ipcRenderer.invoke('tabs:active'),
  duplicateTab: (id) => ipcRenderer.invoke('tabs:duplicate', id),
  closeOtherTabs: (id) => ipcRenderer.invoke('tabs:close-others', id),
  closeTabsRight: (id) => ipcRenderer.invoke('tabs:close-right', id),
  muteTab: (id, muted) => ipcRenderer.invoke('tabs:mute', id, muted),

  // Per-tab navigation
  navigate: (id, url) => ipcRenderer.invoke('tab:navigate', id, url),
  back: (id) => ipcRenderer.invoke('tab:back', id),
  forward: (id) => ipcRenderer.invoke('tab:forward', id),
  reload: (id) => ipcRenderer.invoke('tab:reload', id),
  stop: (id) => ipcRenderer.invoke('tab:stop', id),

  // Convenience
  serverUrl: () => ipcRenderer.invoke('astrion:server'),
  newtabUrl: () => ipcRenderer.invoke('astrion:newtab-url'),
  openExternal: (url) => ipcRenderer.invoke('astrion:open-external', url),

  // AI sidebar
  toggleSidebar: () => ipcRenderer.invoke('sidebar:toggle'),
  sidebarState: () => ipcRenderer.invoke('sidebar:state'),
  askAi: (prompt) => ipcRenderer.invoke('sidebar:ask', prompt),
  pageContext: () => ipcRenderer.invoke('sidebar:page-context'),

  // History + settings
  listHistory: () => ipcRenderer.invoke('history:list'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),

  // Reading mode
  openReader: () => ipcRenderer.invoke('reader:extract-and-open'),

  // Downloads
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  openDownload: (id) => ipcRenderer.invoke('downloads:open', id),
  showDownload: (id) => ipcRenderer.invoke('downloads:show', id),
  clearDownloads: () => ipcRenderer.invoke('downloads:clear'),

  // Fullscreen + pinning
  toggleFullscreen: () => ipcRenderer.invoke('fullscreen:toggle'),
  fullscreenState: () => ipcRenderer.invoke('fullscreen:state'),
  pinTab: (id, pinned) => ipcRenderer.invoke('tabs:pin', id, pinned),

  // Bookmarks
  listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  addBookmark: (b) => ipcRenderer.invoke('bookmarks:add', b),
  removeBookmark: (url) => ipcRenderer.invoke('bookmarks:remove', url),

  // Reading list
  listReadingList: () => ipcRenderer.invoke('reading-list:list'),
  addToReadingList: (e) => ipcRenderer.invoke('reading-list:add', e),
  removeFromReadingList: (url) => ipcRenderer.invoke('reading-list:remove', url),
  addCurrentToReadingList: () => ipcRenderer.invoke('reading-list:add-current'),

  // Find in page
  findStart: (text, opts) => ipcRenderer.invoke('find:start', text, opts),
  findStop: (action) => ipcRenderer.invoke('find:stop', action),

  // Zoom
  zoomIn: () => ipcRenderer.invoke('zoom:in'),
  zoomOut: () => ipcRenderer.invoke('zoom:out'),
  zoomReset: () => ipcRenderer.invoke('zoom:reset'),

  // Push channels (main → renderer)
  onTabUpdate: (cb) => {
    const listener = (_e, tab) => cb(tab);
    ipcRenderer.on('tab:update', listener);
    return () => ipcRenderer.off('tab:update', listener);
  },
  onTabsList: (cb) => {
    const listener = (_e, list) => cb(list);
    ipcRenderer.on('tabs:list', listener);
    return () => ipcRenderer.off('tabs:list', listener);
  },
  onActiveTab: (cb) => {
    const listener = (_e, id) => cb(id);
    ipcRenderer.on('tabs:active', listener);
    return () => ipcRenderer.off('tabs:active', listener);
  },
  onBookmarks: (cb) => {
    const listener = (_e, list) => cb(list);
    ipcRenderer.on('bookmarks:list', listener);
    return () => ipcRenderer.off('bookmarks:list', listener);
  },
  onSidebarOpened: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('sidebar:opened', listener);
    return () => ipcRenderer.off('sidebar:opened', listener);
  },
  onSettingsChanged: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.off('settings:changed', listener);
  },
  onSidebarAskWithPrompt: (cb) => {
    const listener = (_e, prompt) => cb(prompt);
    ipcRenderer.on('sidebar:ask-with-prompt', listener);
    return () => ipcRenderer.off('sidebar:ask-with-prompt', listener);
  },
  onDownloads: (cb) => {
    const listener = (_e, list) => cb(list);
    ipcRenderer.on('downloads:list', listener);
    return () => ipcRenderer.off('downloads:list', listener);
  },
});
