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
});
