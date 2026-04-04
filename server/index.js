// NOVA OS — Backend API Proxy Server
// Proxies AI requests to the Anthropic API so the key stays server-side.

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static files from project root
app.use(express.static(join(__dirname, '..')));
app.use(express.json());

// API key — set via environment variable: ANTHROPIC_API_KEY
// Run with: ANTHROPIC_API_KEY=sk-ant-... npm start
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// AI proxy endpoint
app.post('/api/ai', async (req, res) => {
  try {
    const { system, messages, model, max_tokens } = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 1024,
        system: system || 'You are NOVA, a helpful AI assistant built into NOVA OS.',
        messages: messages || [],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', response.status, err);
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Native Shell App Routes ───
// When nova-shell (the native C renderer) opens an app,
// it loads /app/terminal, /app/notes, etc.
// We serve the same index.html but with a query param so JS can auto-launch the app.
app.get('/app/:appId', (req, res) => {
  const appId = req.params.appId;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NOVA OS — ${appId}</title>
  <link rel="stylesheet" href="/css/system.css">
  <link rel="stylesheet" href="/css/desktop.css">
  <link rel="stylesheet" href="/css/window.css">
  <link rel="stylesheet" href="/css/apps/terminal.css">
  <link rel="stylesheet" href="/css/apps/notes.css">
  <link rel="stylesheet" href="/css/apps/finder.css">
  <link rel="stylesheet" href="/css/apps/calculator.css">
  <link rel="stylesheet" href="/css/apps/text-editor.css">
  <link rel="stylesheet" href="/css/apps/music.css">
  <link rel="stylesheet" href="/css/apps/photos.css">
  <link rel="stylesheet" href="/css/apps/calendar.css">
  <link rel="stylesheet" href="/css/apps/settings.css">
  <link rel="stylesheet" href="/css/apps/weather.css">
  <link rel="stylesheet" href="/css/apps/clock.css">
  <link rel="stylesheet" href="/css/apps/draw.css">
  <link rel="stylesheet" href="/css/apps/reminders.css">
  <link rel="stylesheet" href="/css/apps/activity-monitor.css">
  <link rel="stylesheet" href="/css/apps/appstore.css">
  <link rel="stylesheet" href="/css/apps/browser.css">
  <style>
    /* Native mode: no shell chrome, just the app */
    body.nova-native-app { background: #1e1e2e; margin: 0; padding: 0; overflow: hidden; }
    body.nova-native-app #desktop, body.nova-native-app #menubar,
    body.nova-native-app #dock, body.nova-native-app #spotlight,
    body.nova-native-app #control-center, body.nova-native-app #notification-center,
    body.nova-native-app #lock-screen, body.nova-native-app #setup-wizard,
    body.nova-native-app #launchpad { display: none !important; }
    body.nova-native-app #windows { position: fixed; inset: 0; }
    body.nova-native-app .window {
      position: fixed !important; inset: 0 !important;
      width: 100% !important; height: 100% !important;
      border-radius: 0 !important; border: none !important;
      box-shadow: none !important;
    }
    body.nova-native-app .window .window-titlebar { display: none !important; }
    body.nova-native-app .window .window-content {
      height: 100% !important; border-radius: 0 !important;
    }
  </style>
</head>
<body class="nova-native-app">
  <div id="windows"></div>
  <script>
    // Tell the boot system which app to auto-launch in native mode
    window.__NOVA_NATIVE__ = true;
    window.__NOVA_LAUNCH_APP__ = '${appId}';
  </script>
  <script type="module" src="/js/boot.js"></script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`NOVA OS server running at http://localhost:${PORT}`);
});
