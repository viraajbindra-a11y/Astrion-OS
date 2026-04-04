/**
 * NOVA OS — Electron Preload Script
 * Exposes safe APIs to the renderer (NOVA OS web app).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novaElectron', {
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('get-fullscreen'),
  platform: process.platform,
  isDesktopApp: true,
});
