// NOVA OS — Quick Settings

import { eventBus } from '../kernel/event-bus.js';

let isOpen = false;
let ccEl = null;

// State
let wifiOn = true;
let bluetoothOn = false;
let airdropOn = false;
let focusOn = false;
let brightness = 80;
let volume = 70;

export function initControlCenter() {
  // Click battery/wifi in menubar to open
  document.getElementById('menubar-wifi').addEventListener('click', toggle);
  document.getElementById('menubar-battery').addEventListener('click', toggle);

  // Close when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (isOpen && ccEl && !ccEl.contains(e.target) &&
        !e.target.closest('#menubar-wifi') && !e.target.closest('#menubar-battery')) {
      close();
    }
  });
}

function toggle() {
  if (isOpen) close();
  else open();
}

function open() {
  if (ccEl) ccEl.remove();

  ccEl = document.createElement('div');
  ccEl.id = 'control-center';
  ccEl.innerHTML = `
    <div class="cc-row">
      <div class="cc-tile ${wifiOn ? 'active' : ''}" data-toggle="wifi">
        <div class="cc-tile-icon">\uD83D\uDCF6</div>
        <div class="cc-tile-text">
          <div class="cc-tile-label">Wi-Fi</div>
          <div class="cc-tile-value">${wifiOn ? 'Connected' : 'Off'}</div>
        </div>
      </div>
      <div class="cc-tile ${bluetoothOn ? 'active' : ''}" data-toggle="bluetooth">
        <div class="cc-tile-icon">\uD83D\uDD37</div>
        <div class="cc-tile-text">
          <div class="cc-tile-label">Bluetooth</div>
          <div class="cc-tile-value">${bluetoothOn ? 'On' : 'Off'}</div>
        </div>
      </div>
    </div>
    <div class="cc-row">
      <div class="cc-tile ${airdropOn ? 'active' : ''}" data-toggle="airdrop">
        <div class="cc-tile-icon">\uD83D\uDCE1</div>
        <div class="cc-tile-text">
          <div class="cc-tile-label">AirDrop</div>
          <div class="cc-tile-value">${airdropOn ? 'Everyone' : 'Off'}</div>
        </div>
      </div>
      <div class="cc-tile ${focusOn ? 'active' : ''}" data-toggle="focus">
        <div class="cc-tile-icon">\uD83C\uDF19</div>
        <div class="cc-tile-text">
          <div class="cc-tile-label">Focus</div>
          <div class="cc-tile-value">${focusOn ? 'On' : 'Off'}</div>
        </div>
      </div>
    </div>

    <div class="cc-slider-group">
      <div class="cc-slider-row">
        <span class="cc-slider-icon">\u2600\uFE0F</span>
        <input type="range" class="cc-slider" min="10" max="100" value="${brightness}" data-slider="brightness">
      </div>
      <div class="cc-slider-row">
        <span class="cc-slider-icon">\uD83D\uDD0A</span>
        <input type="range" class="cc-slider" min="0" max="100" value="${volume}" data-slider="volume">
      </div>
    </div>

    <div class="cc-now-playing">
      <div class="cc-now-playing-art">\uD83C\uDFB5</div>
      <div class="cc-now-playing-info">
        <div class="cc-now-playing-title">Not Playing</div>
        <div class="cc-now-playing-artist">NOVA Music</div>
      </div>
      <button class="cc-now-playing-btn">\u25B6</button>
    </div>

    <div class="cc-quick-row">
      <div class="cc-quick-btn" data-toggle="dnd">
        \uD83C\uDF19
        <div class="cc-quick-label">DND</div>
      </div>
      <div class="cc-quick-btn" data-toggle="mirror">
        \uD83D\uDCFA
        <div class="cc-quick-label">Mirror</div>
      </div>
      <div class="cc-quick-btn active" data-toggle="dark">
        \uD83C\uDF11
        <div class="cc-quick-label">Dark</div>
      </div>
      <div class="cc-quick-btn" data-toggle="lock">
        \uD83D\uDD12
        <div class="cc-quick-label">Lock</div>
      </div>
    </div>
  `;

  document.getElementById('desktop').appendChild(ccEl);
  isOpen = true;

  // Toggle handlers
  ccEl.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', async () => {
      const key = el.dataset.toggle;
      // Clicking Wi-Fi tile: open the real Wi-Fi picker
      if (key === 'wifi') {
        close();
        try {
          const mod = await import('./wifi-picker.js');
          if (mod.openWifiPicker) mod.openWifiPicker();
          else console.error('openWifiPicker not found in module');
        } catch (e) {
          console.error('Failed to open Wi-Fi picker:', e);
        }
        return;
      }
      // Clicking Bluetooth tile: open the real Bluetooth picker
      if (key === 'bluetooth') {
        close();
        try {
          const mod = await import('./bluetooth-picker.js');
          if (mod.openBluetoothPicker) mod.openBluetoothPicker();
          else console.error('openBluetoothPicker not found');
        } catch (e) {
          console.error('Failed to open Bluetooth picker:', e);
        }
        return;
      }
      if (key === 'airdrop') { airdropOn = !airdropOn; }
      else if (key === 'focus') {
        close();
        const { setFocusMode, getFocusState } = await import('./focus-mode.js');
        const st = getFocusState();
        setFocusMode(st.enabled ? 'none' : 'dnd');
        return;
      }
      else if (key === 'dnd') {
        const { setFocusMode, getFocusState } = await import('./focus-mode.js');
        const st = getFocusState();
        setFocusMode(st.enabled ? 'none' : 'dnd');
        el.classList.toggle('active');
        return;
      }
      else if (key === 'lock') {
        close();
        import('./lock-screen.js').then(m => m.lockScreen());
        return;
      }

      el.classList.toggle('active');
      const valueEl = el.querySelector('.cc-tile-value');
      if (valueEl) {
        const isActive = el.classList.contains('active');
        if (key === 'wifi') valueEl.textContent = isActive ? 'Connected' : 'Off';
        else if (key === 'airdrop') valueEl.textContent = isActive ? 'Everyone' : 'Off';
        else valueEl.textContent = isActive ? 'On' : 'Off';
      }
    });
  });

  // Slider handlers — wire to real server endpoints
  ccEl.querySelectorAll('[data-slider]').forEach(slider => {
    let debounce = null;
    slider.addEventListener('input', async () => {
      const key = slider.dataset.slider;
      const level = parseInt(slider.value);
      if (key === 'brightness') {
        brightness = level;
        // Live preview — apply CSS filter as fallback
        const desktop = document.getElementById('desktop');
        if (desktop) desktop.style.filter = `brightness(${Math.max(0.3, level / 100)})`;
      } else if (key === 'volume') {
        volume = level;
      }

      // Debounce server call — don't spam pactl
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          await fetch(`/api/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level }),
          });
        } catch {}
      }, 120);
    });
  });

  // Load current values from server
  fetch('/api/volume').then(r => r.json()).then(d => {
    if (d.level != null) {
      const s = ccEl.querySelector('[data-slider="volume"]');
      if (s) { s.value = d.level; volume = d.level; }
    }
  }).catch(() => {});
  fetch('/api/brightness').then(r => r.json()).then(d => {
    if (d.level != null) {
      const s = ccEl.querySelector('[data-slider="brightness"]');
      if (s) { s.value = d.level; brightness = d.level; }
    }
  }).catch(() => {});
}

function close() {
  if (ccEl) {
    ccEl.style.animation = 'none';
    ccEl.style.opacity = '0';
    ccEl.style.transform = 'scale(0.95) translateY(-10px)';
    ccEl.style.transition = 'opacity 0.15s, transform 0.15s';
    setTimeout(() => { ccEl?.remove(); ccEl = null; }, 150);
  }
  isOpen = false;
}
