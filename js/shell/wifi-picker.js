// NOVA OS — WiFi Network Picker

let isOpen = false;
let pickerEl = null;

// Simulated networks
const networks = [
  { name: 'Home Network', signal: 95, secure: true, connected: true },
  { name: 'NOVA-5G', signal: 82, secure: true, connected: false },
  { name: 'Neighbors WiFi', signal: 65, secure: true, connected: false },
  { name: 'CoffeeShop', signal: 55, secure: false, connected: false },
  { name: 'Guest Network', signal: 40, secure: false, connected: false },
  { name: 'Office_Secure', signal: 30, secure: true, connected: false },
];

export function initWifiPicker() {
  // Already handled by Control Center, but add standalone click on wifi icon
  document.getElementById('menubar-wifi').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    toggle();
  });
}

function toggle() {
  if (isOpen) close();
  else open();
}

function open() {
  if (pickerEl) pickerEl.remove();

  pickerEl = document.createElement('div');
  pickerEl.id = 'wifi-picker';
  pickerEl.style.cssText = `position:fixed;top:28px;right:100px;width:280px;background:rgba(38,38,42,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:8px;box-shadow:0 15px 50px rgba(0,0,0,0.5);z-index:95000;animation:scaleIn 0.15s ease-out;`;

  pickerEl.innerHTML = `
    <div style="padding:8px 10px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;">
      Wi-Fi
      <div style="width:32px;height:18px;border-radius:9px;background:var(--green);position:relative;cursor:pointer;">
        <div style="width:14px;height:14px;background:white;border-radius:50%;position:absolute;top:2px;right:2px;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>
      </div>
    </div>
    <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0;"></div>
    <div style="padding:4px 10px 2px;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;">Known Networks</div>
    ${networks.filter(n => n.connected).map(n => networkItem(n)).join('')}
    <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0;"></div>
    <div style="padding:4px 10px 2px;font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;">Available Networks</div>
    ${networks.filter(n => !n.connected).map(n => networkItem(n)).join('')}
    <div style="height:1px;background:rgba(255,255,255,0.08);margin:4px 0;"></div>
    <div style="padding:6px 10px;font-size:13px;color:var(--accent);cursor:pointer;">Network Preferences...</div>
  `;

  // Click handlers for networks
  pickerEl.querySelectorAll('[data-network]').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.network;
      const net = networks.find(n => n.name === name);
      if (net && !net.connected) {
        if (net.secure) {
          // Show password prompt
          const pw = prompt(`Enter password for "${name}":`);
          if (!pw) return;
        }
        // "Connect"
        networks.forEach(n => n.connected = false);
        net.connected = true;
        open(); // re-render
      }
    });
  });

  document.getElementById('desktop').appendChild(pickerEl);
  isOpen = true;

  const closeHandler = (e) => {
    if (pickerEl && !pickerEl.contains(e.target)) {
      close();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

function close() {
  if (pickerEl) { pickerEl.remove(); pickerEl = null; }
  isOpen = false;
}

function networkItem(n) {
  const bars = n.signal > 80 ? 3 : n.signal > 50 ? 2 : 1;
  const signalIcon = '\u2022'.repeat(bars);
  return `<div data-network="${n.name}" style="display:flex;align-items:center;padding:6px 10px;border-radius:6px;cursor:default;font-size:13px;gap:8px;${n.connected ? 'color:white;' : 'color:rgba(255,255,255,0.7);'}" onmouseenter="this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.background='none'">
    <span style="flex:1;">${n.connected ? '\u2713 ' : ''}${n.name}</span>
    ${n.secure ? '<span style="font-size:10px;color:rgba(255,255,255,0.3);">\uD83D\uDD12</span>' : ''}
    <span style="font-size:10px;color:rgba(255,255,255,0.3);">${signalIcon}</span>
  </div>`;
}
