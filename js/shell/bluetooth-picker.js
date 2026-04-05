// NOVA OS — Bluetooth Picker
// Slide-down panel for Bluetooth devices. Calls /api/bluetooth/* endpoints
// which shell out to bluetoothctl on the ISO.

let panel = null;

export function openBluetoothPicker() {
  if (panel) { close(); return; }

  panel = document.createElement('div');
  panel.id = 'bt-picker';
  panel.style.cssText = `
    position: fixed;
    top: 32px;
    right: 8px;
    width: 320px;
    max-height: 460px;
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
  `;

  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between;">
      <div style="font-size:13px; font-weight:600;">Bluetooth</div>
      <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
        <span style="font-size:11px; color:rgba(255,255,255,0.6);">On</span>
        <input type="checkbox" id="bt-power" style="accent-color:var(--accent);">
      </label>
    </div>
    <div id="bt-status" style="font-size:11px; color:rgba(255,255,255,0.5); padding:2px 0;">Loading…</div>
    <div id="bt-list" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:4px;"></div>
    <button id="bt-refresh" style="background:rgba(255,255,255,0.08); border:none; color:white; padding:7px; border-radius:8px; font-size:11px; cursor:pointer; font-family:var(--font);">Scan for devices</button>
  `;

  document.body.appendChild(panel);

  panel.querySelector('#bt-refresh').addEventListener('click', loadDevices);
  panel.querySelector('#bt-power').addEventListener('change', async (e) => {
    await fetch('/api/bluetooth/power', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: e.target.checked }),
    });
    loadStatus();
  });

  loadStatus();
  loadDevices();

  setTimeout(() => {
    document.addEventListener('click', function clickOut(e) {
      if (!panel?.contains(e.target) && !e.target.closest('#menubar-wifi')) {
        close();
        document.removeEventListener('click', clickOut);
      }
    });
  }, 10);
}

async function loadStatus() {
  try {
    const res = await fetch('/api/bluetooth/status');
    const data = await res.json();
    const statusEl = panel?.querySelector('#bt-status');
    const powerEl = panel?.querySelector('#bt-power');
    if (powerEl) powerEl.checked = data.powered;
    if (statusEl) {
      statusEl.textContent = data.available
        ? (data.powered ? 'Bluetooth is on' : 'Bluetooth is off')
        : 'Bluetooth unavailable';
    }
  } catch {}
}

async function loadDevices() {
  const list = panel?.querySelector('#bt-list');
  const status = panel?.querySelector('#bt-status');
  if (!list) return;

  if (status) status.textContent = 'Scanning… (3s)';
  list.innerHTML = '<div style="padding:20px; text-align:center; color:rgba(255,255,255,0.3); font-size:11px;">Searching for devices…</div>';

  try {
    const res = await fetch('/api/bluetooth/devices');
    const data = await res.json();
    const devices = data.devices || [];

    list.innerHTML = '';
    if (devices.length === 0) {
      list.innerHTML = '<div style="padding:20px; text-align:center; color:rgba(255,255,255,0.3); font-size:11px;">No devices found</div>';
      if (status) status.textContent = 'No devices';
      return;
    }

    if (status) status.textContent = `${devices.length} devices`;

    devices.forEach(dev => {
      const el = document.createElement('div');
      el.style.cssText = `
        padding: 9px 11px; border-radius: 8px; cursor: pointer;
        display: flex; align-items: center; gap: 10px;
      `;
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.06)');
      el.addEventListener('mouseleave', () => el.style.background = 'transparent');
      el.innerHTML = `
        <div style="font-size:16px;">${guessIcon(dev.name)}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(dev.name)}</div>
          <div style="font-size:10px; color:rgba(255,255,255,0.35); font-family:monospace;">${dev.mac}</div>
        </div>
        <button data-mac="${dev.mac}" class="bt-connect" style="background:var(--accent); border:none; color:white; padding:4px 10px; border-radius:5px; font-size:11px; cursor:pointer; font-family:var(--font);">Connect</button>
      `;
      list.appendChild(el);
    });

    list.querySelectorAll('.bt-connect').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mac = btn.dataset.mac;
        btn.textContent = 'Pairing…';
        btn.disabled = true;
        await fetch('/api/bluetooth/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac }),
        });
        await fetch('/api/bluetooth/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac }),
        });
        const { notifications } = await import('../kernel/notifications.js');
        notifications.show({ title: 'Bluetooth', body: `Connected to ${btn.closest('div').previousElementSibling?.querySelector('div')?.textContent || mac}`, icon: '\uD83D\uDD37' });
        btn.textContent = 'Connected';
      });
    });
  } catch {
    list.innerHTML = '<div style="padding:20px; text-align:center; color:rgba(255,255,255,0.3); font-size:11px;">Bluetooth unavailable</div>';
  }
}

function guessIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('airpod') || n.includes('headphone') || n.includes('earbud')) return '\uD83C\uDFA7';
  if (n.includes('keyboard')) return '\u2328\uFE0F';
  if (n.includes('mouse')) return '\uD83D\uDDB1\uFE0F';
  if (n.includes('speaker')) return '\uD83D\uDD0A';
  if (n.includes('iphone') || n.includes('android') || n.includes('phone')) return '\uD83D\uDCF1';
  if (n.includes('tv')) return '\uD83D\uDCFA';
  if (n.includes('watch')) return '\u231A';
  return '\uD83D\uDD37';
}

function close() {
  if (panel) panel.remove();
  panel = null;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
