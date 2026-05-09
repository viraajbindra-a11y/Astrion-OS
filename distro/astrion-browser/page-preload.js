// Astrion Browser — per-tab page preload.
//
// Attached to every BrowserView. Exposes a small `window.astrionPage`
// API ONLY when the current frame is one of our internal renderer/
// pages — history.html, settings.html. External web pages get no
// privileged API: the preload runs but the URL check fails so
// nothing gets exposed.
//
// Why this works safely: the preload runs per-frame, before any page
// JS. The URL is read from the document at preload time. If the URL
// isn't ours, the contextBridge call never fires, and the page stays
// in a vanilla Chromium environment.

const { contextBridge, ipcRenderer } = require('electron');

function isInternalPage() {
  const href = (typeof location !== 'undefined' && location.href) || '';
  // file:// URL containing our renderer/ path with one of our known files.
  if (!href.startsWith('file://')) return false;
  // Allow only specific page names to be safe.
  return /\/renderer\/(history|settings|newtab)\.html(\?|#|$)/.test(href);
}

if (isInternalPage()) {
  contextBridge.exposeInMainWorld('astrionPage', {
    listHistory: () => ipcRenderer.invoke('history:list'),
    clearHistory: () => ipcRenderer.invoke('history:clear'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
    listBookmarks: () => ipcRenderer.invoke('bookmarks:list'),
    removeBookmark: (url) => ipcRenderer.invoke('bookmarks:remove', url),
    // Navigation helpers — internal pages can ask the chrome to navigate
    // the current tab, or open a new tab.
    navigate: (url) => {
      // Just set location — we're inside the BrowserView; this triggers
      // the normal main.js navigation event handler.
      location.href = url;
    },
  });
}
