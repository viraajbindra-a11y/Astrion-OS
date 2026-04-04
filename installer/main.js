/**
 * NOVA OS — Electron Desktop App
 *
 * This wraps NOVA OS into a downloadable desktop application.
 * Users download the .dmg (Mac), .exe (Windows), or .AppImage (Linux),
 * double-click, and they're running NOVA OS as a native app.
 *
 * The app runs a local Express server and opens NOVA OS in a
 * frameless window that looks like a real operating system.
 */

const { app, BrowserWindow, screen, globalShortcut, Menu, ipcMain, autoUpdater } = require('electron');
const path = require('path');
const express = require('express');

// --- Auto-Updater ---
// Checks GitHub Releases for new versions on startup
function setupAutoUpdater() {
  try {
    const { updateElectronApp } = require('update-electron-app');
    updateElectronApp({
      repo: 'viraajbindra-a11y/Nova-OS',
      updateInterval: '1 hour',
      notifyUser: true,
    });
  } catch (e) {
    // update-electron-app not installed or not in production, skip
    console.log('Auto-updater not available:', e.message);
  }
}

let mainWindow;
let server;
const PORT = 19840; // Random high port to avoid conflicts

// Start the local web server
function startServer() {
  return new Promise((resolve) => {
    const expressApp = express();

    // Serve NOVA OS files
    expressApp.use(express.static(path.join(__dirname, 'app')));
    expressApp.use(express.json());

    // AI proxy endpoint (forwards to Anthropic if key is set)
    expressApp.post('/api/ai', async (req, res) => {
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) {
        return res.status(200).json({
          content: [{ text: '' }]
        });
      }

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(req.body),
        });
        const data = await response.json();
        res.json(data);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    server = expressApp.listen(PORT, () => {
      console.log(`NOVA OS server running on port ${PORT}`);
      resolve();
    });
  });
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(900, height),
    minWidth: 800,
    minHeight: 600,
    frame: false,           // No native title bar — NOVA OS has its own
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 }, // Hide native traffic lights
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
    icon: path.join(__dirname, 'icons', 'icon.png'),
    show: false, // Show after loading
  });

  // Load NOVA OS from local server
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Hide menu bar
  Menu.setApplicationMenu(null);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Handle full-screen toggle from renderer
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.handle('get-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up server on quit
app.on('before-quit', () => {
  if (server) server.close();
});
