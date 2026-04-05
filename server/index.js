// NOVA OS — Backend API Proxy Server
// Proxies AI requests to the Anthropic API so the key stays server-side.

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// ─── Security: rate limiter ───
// Simple in-memory token bucket per IP. Hard cap on /api/* endpoints
// so a rogue app can't spam the AI proxy or update endpoint.
const rateLimitBuckets = new Map();
const RATE_LIMITS = {
  '/api/ai':           { tokens: 30,  refillPerSec: 0.5 }, // 30 requests, refill 1 every 2s
  '/api/update/check': { tokens: 5,   refillPerSec: 0.05 }, // 5/hour-ish
  default:             { tokens: 60,  refillPerSec: 1 },
};

function rateLimit(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();

  const ip = req.ip || req.socket.remoteAddress || 'local';
  const limitKey = RATE_LIMITS[req.path] ? req.path : 'default';
  const limit = RATE_LIMITS[limitKey];
  const bucketKey = `${ip}:${limitKey}`;

  let bucket = rateLimitBuckets.get(bucketKey);
  const now = Date.now() / 1000;

  if (!bucket) {
    bucket = { tokens: limit.tokens, last: now };
    rateLimitBuckets.set(bucketKey, bucket);
  } else {
    const elapsed = now - bucket.last;
    bucket.tokens = Math.min(limit.tokens, bucket.tokens + elapsed * limit.refillPerSec);
    bucket.last = now;
  }

  if (bucket.tokens < 1) {
    res.setHeader('Retry-After', '5');
    return res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((1 - bucket.tokens) / limit.refillPerSec),
    });
  }

  bucket.tokens -= 1;
  next();
}

// Cleanup old buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() / 1000 - 600;
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.last < cutoff) rateLimitBuckets.delete(key);
  }
}, 300000);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'interest-cohort=()');
  next();
});

app.use(rateLimit);

// Serve static files from project root
app.use(express.static(join(__dirname, '..')));
app.use(express.json({ limit: '1mb' }));

// API key — set via environment variable: ANTHROPIC_API_KEY
// Run with: ANTHROPIC_API_KEY=sk-ant-... npm start
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ─── Update Check / Trigger ───
// Used by the "Check for Updates..." menu item. On the ISO this runs
// /usr/bin/nova-update (root via passwordless sudo). On dev machines
// it just checks the remote SHA against the bundled web app.
app.post('/api/update/check', async (req, res) => {
  try {
    const { exec } = await import('child_process');
    const fs = await import('fs');

    // 1. Fetch latest SHA from GitHub
    const ghRes = await fetch('https://api.github.com/repos/viraajbindra-a11y/Nova-OS/commits/main');
    if (!ghRes.ok) {
      return res.status(502).json({ status: 'error', error: 'GitHub unreachable' });
    }
    const latest = (await ghRes.json()).sha;

    // 2. Read current SHA (if running on ISO, /var/lib/nova-updater/last-sha)
    let current = '';
    try {
      current = fs.readFileSync('/var/lib/nova-updater/last-sha', 'utf-8').trim();
    } catch (e) { /* not on ISO */ }

    if (current && current === latest) {
      return res.json({ status: 'up-to-date', current, latest });
    }

    // 3. On ISO: kick off the updater
    if (fs.existsSync('/usr/bin/nova-update')) {
      res.json({ status: 'update-available', current, latest });
      exec('sudo -n /usr/bin/nova-update', (err, stdout, stderr) => {
        if (err) console.error('nova-update failed:', stderr);
        else console.log('nova-update finished:', stdout);
      });
      return;
    }

    // 4. Dev machine: just report the SHA
    res.json({ status: 'update-available', current: 'dev', latest });
  } catch (error) {
    console.error('Update check error:', error.message);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

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
  <link rel="stylesheet" href="/css/apps/vault.css">
  <style>
    /* Native mode: no shell chrome, just the app content filling the window */
    body.nova-native-app { background: #1e1e2e; margin: 0; padding: 0; overflow: hidden; }
    body.nova-native-app #windows-container { position: fixed; inset: 0; }
    body.nova-native-app #desktop { display: none !important; }
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
  <!-- These IDs are required by window-manager.js and process-manager.js -->
  <div id="desktop" style="display:none"></div>
  <div id="windows-container"></div>
  <script>
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
