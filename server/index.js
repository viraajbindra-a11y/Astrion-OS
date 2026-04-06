// NOVA OS — Backend API Proxy Server
// Proxies AI requests to the Anthropic API so the key stays server-side.

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dns from 'dns';

// Force IPv4 DNS resolution first — many networks (including some home
// Wi-Fi) have broken IPv6. Node's default undici fetch prefers IPv6 and
// hangs indefinitely on failed connections. This makes fetch actually work.
dns.setDefaultResultOrder('ipv4first');

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
        system: system || 'You are Astrion, a helpful AI assistant built into Astrion OS.',
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
  <title>Astrion OS — ${appId}</title>
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
    // HiDPI auto-scale (same as main index.html)
    (function () {
      const w = window.innerWidth;
      const dpr = window.devicePixelRatio || 1;
      let zoom = 1;
      if (w >= 3600)       zoom = 1.6;
      else if (w >= 2700)  zoom = 2.0;
      else if (w >= 2400)  zoom = 1.75;
      else if (w >= 2000)  zoom = 1.5;
      else if (w >= 1800 && dpr >= 1.5) zoom = 1.4;
      if (zoom > 1) {
        document.documentElement.style.zoom = zoom;
        window.__NOVA_UI_ZOOM__ = zoom;
      }
    })();
    window.__NOVA_NATIVE__ = true;
    window.__NOVA_LAUNCH_APP__ = '${appId}';
  </script>
  <script type="module" src="/js/boot.js"></script>
</body>
</html>`);
});

// ─── Launch real browser (Firefox/Chromium) for fast browsing ───
app.post('/api/browser/open', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  // Try browsers in order: our own first, then system browsers
  const browsers = ['astrion-browser', 'firefox-esr', 'firefox', 'chromium', 'chromium-browser'];
  for (const browser of browsers) {
    const check = await runShell('which', [browser]);
    if (check.code === 0) {
      runShell(browser, ['--new-window', url]); // Don't await — it stays open
      return res.json({ ok: true, browser });
    }
  }
  // Fallback: xdg-open
  runShell('xdg-open', [url]);
  res.json({ ok: true, browser: 'xdg-open' });
});

// ═══════════════════════════════════════════════════════════
// Browser Proxy — fetches external pages and rewrites them so
// they can be rendered inside the NOVA browser iframe without
// X-Frame-Options / CSP blocking.
// ═══════════════════════════════════════════════════════════
app.get('/api/browser/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url');

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Astrion/1.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type') || 'text/html';

    // Strip headers that block iframes
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', contentType);

    // HTML: rewrite links so they go back through the proxy
    if (contentType.includes('text/html')) {
      let html = await upstream.text();
      const baseUrl = new URL(targetUrl);
      const proxyBase = `/api/browser/proxy?url=`;

      // Inject <base> so relative URLs resolve
      const baseTag = `<base href="${baseUrl.origin}${baseUrl.pathname}">`;
      html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);

      // Rewrite absolute links through the proxy
      html = html.replace(
        /(href|src|action)=["'](https?:\/\/[^"']+)["']/gi,
        (m, attr, url) => `${attr}="${proxyBase}${encodeURIComponent(url)}"`
      );

      // Intercept clicks + forms with JS
      const shim = `<script>
        document.addEventListener('click', function(e) {
          const a = e.target.closest('a');
          if (a && a.href && !a.href.startsWith('javascript:') && !a.href.includes('/api/browser/proxy')) {
            e.preventDefault();
            window.parent.postMessage({ type: 'nova-browser-nav', url: a.href }, '*');
          }
        }, true);
      </script>`;
      html = html.replace(/<\/body>/i, shim + '</body>');

      res.send(html);
    } else {
      // Non-HTML: stream through
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (err) {
    console.error('Browser proxy error:', err.message);
    res.status(502).send(`<html><body style="font-family:sans-serif;padding:40px;background:#1e1e2e;color:white;"><h2>Proxy error</h2><p>Could not fetch: ${targetUrl}</p><p style="color:#888">${err.message}</p></body></html>`);
  }
});

// ═══════════════════════════════════════════════════════════
// System Control — Bluetooth / Wi-Fi / Volume / Brightness
// These shell out to bluetoothctl / nmcli / amixer on the ISO.
// On dev machines they return simulated data.
// ═══════════════════════════════════════════════════════════
function runShell(cmd, args = []) {
  return new Promise(async (resolve) => {
    const { spawn } = await import('child_process');
    const proc = spawn(cmd, args, { timeout: 5000 });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.on('error', err => resolve({ code: -1, stdout: '', stderr: err.message }));
  });
}

// ─── Bluetooth ───
app.get('/api/bluetooth/status', async (req, res) => {
  const r = await runShell('bluetoothctl', ['show']);
  const powered = /Powered: yes/i.test(r.stdout);
  res.json({ available: r.code === 0, powered });
});

app.post('/api/bluetooth/power', async (req, res) => {
  const { on } = req.body;
  await runShell('bluetoothctl', ['power', on ? 'on' : 'off']);
  res.json({ ok: true });
});

app.get('/api/bluetooth/devices', async (req, res) => {
  // Start scan, wait 3s, then list
  await runShell('bluetoothctl', ['--timeout', '3', 'scan', 'on']).catch(() => {});
  const r = await runShell('bluetoothctl', ['devices']);
  const devices = r.stdout.split('\n')
    .map(line => line.match(/^Device ([0-9A-F:]{17}) (.+)$/i))
    .filter(Boolean)
    .map(m => ({ mac: m[1], name: m[2] }));
  res.json({ devices });
});

app.post('/api/bluetooth/pair', async (req, res) => {
  const { mac } = req.body;
  if (!mac) return res.status(400).json({ error: 'mac required' });
  const r = await runShell('bluetoothctl', ['pair', mac]);
  res.json({ ok: r.code === 0, output: r.stdout });
});

app.post('/api/bluetooth/connect', async (req, res) => {
  const { mac } = req.body;
  const r = await runShell('bluetoothctl', ['connect', mac]);
  res.json({ ok: r.code === 0 });
});

// ─── Wi-Fi ───
app.get('/api/wifi/networks', async (req, res) => {
  // nmcli returns SSID, signal, security
  const r = await runShell('nmcli', ['-t', '-f', 'SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list']);
  if (r.code !== 0) {
    return res.json({ networks: [], error: r.stderr || 'nmcli not available' });
  }
  const networks = r.stdout.split('\n')
    .filter(Boolean)
    .map(line => {
      const [ssid, signal, security] = line.split(':');
      return { ssid, signal: parseInt(signal) || 0, security: security || 'Open' };
    })
    .filter(n => n.ssid);
  res.json({ networks });
});

app.post('/api/wifi/connect', async (req, res) => {
  const { ssid, password } = req.body;
  if (!ssid) return res.status(400).json({ error: 'ssid required' });
  const args = password
    ? ['device', 'wifi', 'connect', ssid, 'password', password]
    : ['device', 'wifi', 'connect', ssid];
  const r = await runShell('nmcli', args);
  res.json({ ok: r.code === 0, output: r.stdout || r.stderr });
});

app.get('/api/wifi/status', async (req, res) => {
  const r = await runShell('nmcli', ['-t', '-f', 'DEVICE,STATE,CONNECTION', 'device']);
  const wifi = r.stdout.split('\n')
    .map(line => line.split(':'))
    .find(parts => parts[0] && parts[0].startsWith('wl'));
  res.json({
    connected: wifi && wifi[1] === 'connected',
    connection: wifi?.[2] || null,
  });
});

// ─── Volume ───
app.get('/api/volume', async (req, res) => {
  const r = await runShell('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
  const m = r.stdout.match(/(\d+)%/);
  res.json({ level: m ? parseInt(m[1]) : 50 });
});

app.post('/api/volume', async (req, res) => {
  const { level } = req.body;
  if (typeof level !== 'number') return res.status(400).json({ error: 'level required' });
  await runShell('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${Math.max(0, Math.min(150, level))}%`]);
  res.json({ ok: true });
});

app.post('/api/volume/mute', async (req, res) => {
  await runShell('pactl', ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']);
  res.json({ ok: true });
});

// ─── Brightness ───
app.get('/api/brightness', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const backlights = await fs.readdir('/sys/class/backlight').catch(() => []);
    if (backlights.length === 0) return res.json({ level: 100 });
    const dir = `/sys/class/backlight/${backlights[0]}`;
    const [cur, max] = await Promise.all([
      fs.readFile(`${dir}/brightness`, 'utf-8'),
      fs.readFile(`${dir}/max_brightness`, 'utf-8'),
    ]);
    res.json({ level: Math.round((parseInt(cur) / parseInt(max)) * 100) });
  } catch {
    res.json({ level: 100 });
  }
});

app.post('/api/brightness', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const { level } = req.body;
    const backlights = await fs.readdir('/sys/class/backlight').catch(() => []);
    if (backlights.length === 0) return res.json({ ok: false });
    const dir = `/sys/class/backlight/${backlights[0]}`;
    const max = parseInt(await fs.readFile(`${dir}/max_brightness`, 'utf-8'));
    const target = Math.round((Math.max(0, Math.min(100, level)) / 100) * max);
    // Requires brightness file to be writable — usually needs sudo or udev rule
    await runShell('sudo', ['-n', 'tee', `${dir}/brightness`]).catch(() => {});
    await fs.writeFile(`${dir}/brightness`, String(target)).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── Battery ───
app.get('/api/battery', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    // Find battery in /sys/class/power_supply/
    const supplies = await fs.readdir('/sys/class/power_supply').catch(() => []);
    const bat = supplies.find(s => s.startsWith('BAT'));
    if (!bat) return res.json({ level: 100, charging: true, available: false });

    const dir = `/sys/class/power_supply/${bat}`;
    const [capacityRaw, statusRaw] = await Promise.all([
      fs.readFile(`${dir}/capacity`, 'utf-8').catch(() => '100'),
      fs.readFile(`${dir}/status`, 'utf-8').catch(() => 'Unknown'),
    ]);
    res.json({
      level: parseInt(capacityRaw.trim()),
      charging: statusRaw.trim() === 'Charging' || statusRaw.trim() === 'Full',
      status: statusRaw.trim(),
      available: true,
    });
  } catch {
    res.json({ level: 100, charging: true, available: false });
  }
});

// ─── System Info (Task Manager / Activity Monitor) ───
app.get('/api/system/processes', async (req, res) => {
  const r = await runShell('ps', ['aux', '--sort=-pcpu']);
  if (r.code !== 0) return res.json({ processes: [] });
  const lines = r.stdout.split('\n').filter(Boolean);
  const header = lines[0];
  const processes = lines.slice(1).map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      user: parts[0],
      pid: parseInt(parts[1]),
      cpu: parseFloat(parts[2]),
      mem: parseFloat(parts[3]),
      vsz: parseInt(parts[4]),
      rss: parseInt(parts[5]),
      tty: parts[6],
      stat: parts[7],
      start: parts[8],
      time: parts[9],
      command: parts.slice(10).join(' '),
    };
  });
  res.json({ processes });
});

app.get('/api/system/cpu', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const stat1 = await fs.readFile('/proc/stat', 'utf-8');
    await new Promise(r => setTimeout(r, 200));
    const stat2 = await fs.readFile('/proc/stat', 'utf-8');

    const parse = (s) => {
      const line = s.split('\n')[0]; // cpu line
      const parts = line.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const a = parse(stat1), b = parse(stat2);
    const idle = b.idle - a.idle;
    const total = b.total - a.total;
    const usage = total > 0 ? Math.round(((total - idle) / total) * 100) : 0;

    // Count cores
    const cpuInfo = await fs.readFile('/proc/cpuinfo', 'utf-8');
    const cores = (cpuInfo.match(/^processor/gm) || []).length;
    const model = (cpuInfo.match(/model name\s*:\s*(.+)/i) || [])[1] || 'Unknown';

    // Uptime
    const uptimeRaw = await fs.readFile('/proc/uptime', 'utf-8');
    const uptimeSec = Math.floor(parseFloat(uptimeRaw.split(' ')[0]));

    res.json({ usage, cores, model: model.trim(), uptime: uptimeSec });
  } catch (e) {
    res.json({ usage: 0, cores: 1, model: 'Unknown', uptime: 0 });
  }
});

app.get('/api/system/memory', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
    const get = (key) => {
      const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? parseInt(m[1]) : 0;
    };
    const total = get('MemTotal');
    const free = get('MemFree');
    const buffers = get('Buffers');
    const cached = get('Cached');
    const available = get('MemAvailable');
    const swapTotal = get('SwapTotal');
    const swapFree = get('SwapFree');

    res.json({
      total: Math.round(total / 1024), // MB
      used: Math.round((total - available) / 1024),
      available: Math.round(available / 1024),
      cached: Math.round((buffers + cached) / 1024),
      swapTotal: Math.round(swapTotal / 1024),
      swapUsed: Math.round((swapTotal - swapFree) / 1024),
    });
  } catch {
    res.json({ total: 8192, used: 4096, available: 4096, cached: 0, swapTotal: 0, swapUsed: 0 });
  }
});

app.get('/api/system/disk', async (req, res) => {
  const r = await runShell('df', ['-h', '--output=source,fstype,size,used,avail,pcent,target']);
  const lines = r.stdout.split('\n').filter(Boolean).slice(1);
  const disks = lines
    .filter(l => !l.includes('tmpfs') && !l.includes('devtmpfs') && !l.includes('squashfs'))
    .map(l => {
      const parts = l.trim().split(/\s+/);
      return { device: parts[0], fstype: parts[1], size: parts[2], used: parts[3], avail: parts[4], percent: parts[5], mount: parts[6] };
    });
  res.json({ disks });
});

app.get('/api/system/network-stats', async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const net = await fs.readFile('/proc/net/dev', 'utf-8');
    const lines = net.split('\n').filter(l => l.includes(':'));
    const interfaces = lines.map(l => {
      const [name, rest] = l.split(':');
      const nums = rest.trim().split(/\s+/).map(Number);
      return { name: name.trim(), rxBytes: nums[0], txBytes: nums[8], rxPackets: nums[1], txPackets: nums[9] };
    }).filter(i => i.name !== 'lo');
    res.json({ interfaces });
  } catch {
    res.json({ interfaces: [] });
  }
});

app.post('/api/system/kill', async (req, res) => {
  const { pid, signal } = req.body;
  if (!pid) return res.status(400).json({ error: 'pid required' });
  const r = await runShell('kill', [signal || '-15', String(pid)]);
  res.json({ ok: r.code === 0 });
});

app.get('/api/system/services', async (req, res) => {
  const r = await runShell('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--plain', '--no-legend']);
  const services = r.stdout.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/);
    return { name: parts[0], load: parts[1], active: parts[2], sub: parts[3], description: parts.slice(4).join(' ') };
  });
  res.json({ services });
});

// ═══════════════════════════════════════════════════════════
// Flatpak App Store — browse, search, install, uninstall real
// Linux apps from Flathub via the flatpak CLI.
// ═══════════════════════════════════════════════════════════
app.get('/api/apps/installed', async (req, res) => {
  const r = await runShell('flatpak', ['list', '--app', '--columns=application,name,version,size']);
  const apps = r.stdout.split('\n').filter(Boolean).map(line => {
    const parts = line.split('\t');
    return { id: parts[0], name: parts[1], version: parts[2], size: parts[3] };
  });
  res.json({ apps });
});

app.get('/api/apps/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: [] });
  const r = await runShell('flatpak', ['search', '--columns=application,name,description,version', q]);
  const results = r.stdout.split('\n').filter(Boolean).slice(0, 20).map(line => {
    const parts = line.split('\t');
    return { id: parts[0], name: parts[1], description: parts[2], version: parts[3] };
  });
  res.json({ results });
});

app.post('/api/apps/install', async (req, res) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: 'appId required' });
  res.json({ status: 'installing', appId });
  // Run install in background (it takes a while)
  runShell('flatpak', ['install', '-y', 'flathub', appId]).then(r => {
    console.log(`Flatpak install ${appId}: ${r.code === 0 ? 'OK' : 'FAILED'}`);
  });
});

app.post('/api/apps/uninstall', async (req, res) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: 'appId required' });
  const r = await runShell('flatpak', ['uninstall', '-y', appId]);
  res.json({ ok: r.code === 0 });
});

app.post('/api/apps/launch', async (req, res) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: 'appId required' });
  runShell('flatpak', ['run', appId]); // Don't await — it stays open
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
// Waydroid — Android Runtime
// ═══════════════════════════════════════════════════════════
app.get('/api/android/status', async (req, res) => {
  const installed = await runShell('which', ['waydroid']);
  if (installed.code !== 0) return res.json({ available: false, reason: 'Waydroid not installed' });

  const status = await runShell('waydroid', ['status']);
  const running = /Session:\s+RUNNING/i.test(status.stdout);
  const initialized = !/not initialized/i.test(status.stdout);
  res.json({ available: true, initialized, running });
});

app.post('/api/android/init', async (req, res) => {
  // Downloads ~800MB Android system image on first run
  res.json({ status: 'initializing', message: 'Downloading Android image (~800MB). This takes a few minutes...' });
  // Run in background — it's slow
  const { gapps } = req.body || {};
  const args = ['init', '-s', 'GAPPS'];
  if (!gapps) args.splice(2); // just 'init' without GApps
  runShell('sudo', ['waydroid', ...args]).then(r => {
    console.log('Waydroid init:', r.code === 0 ? 'OK' : 'FAILED', r.stderr?.slice(0, 200));
  });
});

app.post('/api/android/start', async (req, res) => {
  // Start Waydroid session (needs Wayland — use cage as nested compositor)
  res.json({ status: 'starting' });
  // Launch in cage (minimal Wayland compositor) so it works under X11
  runShell('cage', ['waydroid', 'show-full-ui']).catch(() => {
    // Fallback: try direct launch
    runShell('waydroid', ['show-full-ui']);
  });
});

app.post('/api/android/stop', async (req, res) => {
  await runShell('waydroid', ['session', 'stop']);
  res.json({ ok: true });
});

app.post('/api/android/install-apk', async (req, res) => {
  const { path } = req.body;
  if (!path) return res.status(400).json({ error: 'path required' });
  const r = await runShell('waydroid', ['app', 'install', path]);
  res.json({ ok: r.code === 0, output: r.stdout || r.stderr });
});

app.get('/api/android/apps', async (req, res) => {
  const r = await runShell('waydroid', ['app', 'list']);
  const apps = r.stdout.split('\n').filter(Boolean).map(line => {
    const parts = line.trim().split(/\s+/);
    return { packageName: parts[0], name: parts.slice(1).join(' ') || parts[0] };
  });
  res.json({ apps });
});

app.post('/api/android/launch-app', async (req, res) => {
  const { packageName } = req.body;
  if (!packageName) return res.status(400).json({ error: 'packageName required' });
  runShell('waydroid', ['app', 'launch', packageName]);
  res.json({ ok: true });
});

// ─── Display / Resolution ───
app.get('/api/display/info', async (req, res) => {
  const r = await runShell('xrandr', ['--current']);
  const lines = r.stdout.split('\n');

  // Find connected output + current resolution
  let output = '', current = '', resolutions = [];
  for (const line of lines) {
    const connMatch = line.match(/^(\S+)\s+connected/);
    if (connMatch) output = connMatch[1];
    const resMatch = line.match(/^\s+(\d+x\d+)\s+([\d.]+)(\*?)(\+?)/);
    if (resMatch && output) {
      resolutions.push({
        resolution: resMatch[1],
        rate: resMatch[2],
        active: resMatch[3] === '*',
      });
      if (resMatch[3] === '*') current = resMatch[1];
    }
  }

  res.json({ output, current, resolutions });
});

app.post('/api/display/set-zoom', async (req, res) => {
  const { zoom } = req.body;
  if (!zoom || zoom < 0.5 || zoom > 4) return res.status(400).json({ error: 'zoom must be 0.5-4.0' });
  try {
    const fs = await import('fs/promises');
    const homedir = process.env.HOME || '/home/nova';
    const configDir = `${homedir}/.config/nova-renderer`;
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(`${configDir}/zoom`, String(zoom));
    res.json({ ok: true, zoom, message: 'Zoom saved. Restarting renderer...' });
    // Restart renderer so it picks up new zoom
    setTimeout(() => runShell('killall', ['nova-renderer']).catch(() => {}), 500);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/display/set-resolution', async (req, res) => {
  const { resolution } = req.body;
  if (!resolution) return res.status(400).json({ error: 'resolution required' });

  // Get connected output name
  const info = await runShell('xrandr', ['--current']);
  const outputMatch = info.stdout.match(/^(\S+)\s+connected/m);
  const output = outputMatch ? outputMatch[1] : 'eDP-1';

  const r = await runShell('xrandr', ['--output', output, '--mode', resolution]);
  res.json({ ok: r.code === 0, output: r.stdout || r.stderr });
});

// ─── System Actions ───
app.post('/api/system/set-time', async (req, res) => {
  const { timestamp } = req.body;
  if (!timestamp) return res.status(400).json({ error: 'timestamp required' });
  const d = new Date(timestamp);
  const dateStr = d.toISOString().replace('T', ' ').split('.')[0];
  const r = await runShell('sudo', ['-n', 'date', '-s', dateStr]);
  res.json({ ok: r.code === 0 });
});

app.post('/api/system/shutdown', async (req, res) => {
  res.json({ ok: true });
  setTimeout(() => runShell('sudo', ['-n', 'shutdown', '-h', 'now']), 500);
});

app.post('/api/system/restart', async (req, res) => {
  res.json({ ok: true });
  setTimeout(() => runShell('sudo', ['-n', 'shutdown', '-r', 'now']), 500);
});

app.post('/api/system/sleep', async (req, res) => {
  res.json({ ok: true });
  setTimeout(() => runShell('sudo', ['-n', 'systemctl', 'suspend']), 500);
});

app.listen(PORT, () => {
  console.log(`Astrion OS server running at http://localhost:${PORT}`);
});
