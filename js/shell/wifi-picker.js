// NOVA OS — Wi-Fi Network Picker
// Calls the real server endpoints (/api/wifi/*) which use nmcli on the ISO.
// On dev machines without nmcli, falls back to a "not available" state.

let pickerEl = null;

export function initWifiPicker() {
  // Right-click menubar Wi-Fi icon opens picker
  const wifiIcon = document.getElementById('menubar-wifi');
  if (wifiIcon) {
    wifiIcon.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openWifiPicker();
    });
  }
}

export function openWifiPicker() {
  if (pickerEl) { close(); return; }

  pickerEl = document.createElement('div');
  pickerEl.id = 'wifi-picker';
  pickerEl.style.cssText = `
    position: fixed;
    top: 32px;
    right: 100px;
    width: 320px;
    max-height: 480px;
    background: rgba(30, 30, 36, 0.95);
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    padding: 14px;
    z-index: 95000;
    font-family: var(--font);
    color: white;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: scaleIn 0.15s ease-out;
  `;

  pickerEl.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <div style="font-size:13px; font-weight:600;">Wi-Fi</div>
      <button id="wifi-refresh" style="background:rgba(255,255,255,0.08); border:none; color:white; padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; font-family:var(--font);">Rescan</button>
    </div>
    <div id="wifi-status-line" style="font-size:11px; color:rgba(255,255,255,0.5); padding:2px 0;">Loading…</div>
    <div id="wifi-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:3px; max-height:360px;"></div>
  `;

  const desktop = document.getElementById('desktop') || document.body;
  desktop.appendChild(pickerEl);

  pickerEl.querySelector('#wifi-refresh').addEventListener('click', loadNetworks);

  loadNetworks();

  setTimeout(() => {
    document.addEventListener('click', function clickOut(e) {
      if (!pickerEl?.contains(e.target) && !e.target.closest('#menubar-wifi')) {
        close();
        document.removeEventListener('click', clickOut);
      }
    });
  }, 10);
}

async function loadNetworks() {
  const status = pickerEl?.querySelector('#wifi-status-line');
  const list = pickerEl?.querySelector('#wifi-list');
  if (!status || !list) return;

  status.textContent = 'Scanning…';
  list.innerHTML = '';

  try {
    const [nwRes, stRes] = await Promise.all([
      fetch('/api/wifi/networks').then(r => r.json()).catch(() => ({ networks: [], error: 'offline' })),
      fetch('/api/wifi/status').then(r => r.json()).catch(() => ({ connected: false })),
    ]);

    const nets = nwRes.networks || [];
    const current = stRes.connected ? stRes.connection : null;

    if (nets.length === 0) {
      status.textContent = nwRes.error
        ? 'Wi-Fi unavailable on this system'
        : 'No networks in range';
      return;
    }

    status.textContent = current ? `Connected to ${current}` : `${nets.length} networks`;

    // Dedupe SSIDs, keep strongest signal
    const map = new Map();
    for (const n of nets) {
      if (!map.has(n.ssid) || map.get(n.ssid).signal < n.signal) {
        map.set(n.ssid, n);
      }
    }
    const sorted = [...map.values()].sort((a, b) => b.signal - a.signal);

    sorted.forEach(net => {
      const isCurrent = net.ssid === current;
      const el = document.createElement('div');
      el.style.cssText = `
        padding: 8px 10px;
        border-radius: 8px;
        cursor: ${isCurrent ? 'default' : 'pointer'};
        display: flex;
        align-items: center;
        gap: 10px;
        background: ${isCurrent ? 'rgba(0,122,255,0.15)' : 'transparent'};
        transition: background 0.1s;
      `;
      if (!isCurrent) {
        el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.06)');
        el.addEventListener('mouseleave', () => el.style.background = 'transparent');
      }
      const bars = net.signal > 75 ? '\uD83D\uDCF6' : net.signal > 50 ? '\uD83D\uDCF6' : '\uD83D\uDCF6';
      el.innerHTML = `
        <div style="font-size:14px; width:20px; text-align:center; opacity:${Math.max(0.4, net.signal / 100)};">${bars}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(net.ssid)}</div>
          <div style="font-size:10px; color:rgba(255,255,255,0.4);">${net.security || 'Open'}\u00A0\u00B7\u00A0${net.signal}%</div>
        </div>
        ${net.security && net.security !== 'Open' ? '<div style="font-size:12px;">\uD83D\uDD12</div>' : ''}
        ${isCurrent ? '<div style="font-size:13px; color:var(--accent);">\u2713</div>' : ''}
      `;
      if (!isCurrent) {
        el.addEventListener('click', () => connect(net));
      }
      list.appendChild(el);
    });
  } catch (err) {
    status.textContent = 'Scan failed: ' + err.message;
  }
}

async function connect(net) {
  let password = '';
  if (net.security && net.security !== 'Open') {
    password = prompt(`Password for "${net.ssid}":`);
    if (password === null) return;
  }

  const status = pickerEl?.querySelector('#wifi-status-line');
  if (status) status.textContent = `Connecting to ${net.ssid}…`;

  try {
    const res = await fetch('/api/wifi/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssid: net.ssid, password }),
    });
    const data = await res.json();
    const { notifications } = await import('../kernel/notifications.js');

    if (data.ok) {
      notifications.show({ title: 'Wi-Fi Connected', body: net.ssid, icon: '\uD83D\uDCF6' });
      loadNetworks();
    } else {
      notifications.show({
        title: 'Could not connect',
        body: data.output?.slice(0, 100) || 'Check your password',
        icon: '\u26A0\uFE0F',
      });
      if (status) status.textContent = 'Connection failed';
    }
  } catch (err) {
    if (status) status.textContent = 'Connection error';
  }
}

function close() {
  if (pickerEl) { pickerEl.remove(); pickerEl = null; }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
