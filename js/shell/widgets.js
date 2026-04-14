// NOVA OS — Desktop Widgets
// Floating widgets on the desktop: clock, weather, calendar, system stats.
// Users can drag them around. Positions are saved to localStorage.

const WIDGET_POS_KEY = 'nova-widget-positions';
const WIDGET_ENABLED_KEY = 'nova-widgets-enabled';

let widgets = new Map();

export function initWidgets() {
  // Only init if enabled (default: enabled)
  const enabled = localStorage.getItem(WIDGET_ENABLED_KEY);
  if (enabled === 'false') return;

  // Create container that sits on the desktop but below windows
  let layer = document.getElementById('widget-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'widget-layer';
    layer.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 2;
    `;
    const desktop = document.getElementById('desktop');
    if (desktop) desktop.appendChild(layer);
    else return;
  }

  // Default widgets
  createWidget('clock', {
    x: window.innerWidth - 260,
    y: 60,
    width: 220,
    height: 180,
    render: renderClockWidget,
    updateInterval: 1000,
  });

  createWidget('weather', {
    x: window.innerWidth - 260,
    y: 260,
    width: 220,
    height: 140,
    render: renderWeatherWidget,
    updateInterval: 600000, // 10 min
  });

  createWidget('stats', {
    x: 30,
    y: 60,
    width: 200,
    height: 110,
    render: renderStatsWidget,
    updateInterval: 2000,
  });
}

function createWidget(id, opts) {
  const saved = getSavedPos(id);
  const x = saved?.x ?? opts.x;
  const y = saved?.y ?? opts.y;

  const el = document.createElement('div');
  el.className = 'nova-widget';
  el.dataset.widgetId = id;
  el.style.cssText = `
    position: absolute;
    left: ${x}px;
    top: ${y}px;
    width: ${opts.width}px;
    min-height: ${opts.height}px;
    background: rgba(20, 20, 28, 0.6);
    backdrop-filter: blur(25px);
    -webkit-backdrop-filter: blur(25px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 14px 16px;
    color: white;
    font-family: var(--font);
    pointer-events: auto;
    cursor: grab;
    transition: box-shadow 0.15s ease, transform 0.15s ease;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    user-select: none;
  `;

  el.addEventListener('mouseenter', () => {
    el.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.35)';
  });
  el.addEventListener('mouseleave', () => {
    el.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.2)';
  });

  // Drag to move
  let dragging = false;
  let offsetX = 0, offsetY = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input')) return;
    dragging = true;
    offsetX = e.clientX - el.offsetLeft;
    offsetY = e.clientY - el.offsetTop;
    el.style.cursor = 'grabbing';
    el.style.transition = 'none';
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    el.style.left = (e.clientX - offsetX) + 'px';
    el.style.top = Math.max(32, e.clientY - offsetY) + 'px';
  });
  el.addEventListener('pointerup', () => {
    if (dragging) {
      dragging = false;
      el.style.cursor = 'grab';
      el.style.transition = '';
      savePos(id, parseInt(el.style.left), parseInt(el.style.top));
    }
  });

  document.getElementById('widget-layer').appendChild(el);

  // Initial render + updates
  opts.render(el);
  let updateTimer = null;
  if (opts.updateInterval) {
    updateTimer = setInterval(() => opts.render(el), opts.updateInterval);
  }

  widgets.set(id, { el, opts, updateTimer });
}

function getSavedPos(id) {
  try {
    const all = JSON.parse(localStorage.getItem(WIDGET_POS_KEY) || '{}');
    return all[id];
  } catch { return null; }
}

function savePos(id, x, y) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(WIDGET_POS_KEY) || '{}'); } catch {}
  all[id] = { x, y };
  localStorage.setItem(WIDGET_POS_KEY, JSON.stringify(all));
}

// ───── Widget Renderers ─────

function renderClockWidget(el) {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();

  el.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
      <div style="font-size: 42px; font-weight: 300; letter-spacing: -1px; font-variant-numeric: tabular-nums;">
        ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}
      </div>
      <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 4px;">
        ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <svg width="100" height="40" viewBox="0 0 100 40" style="margin-top: 10px; opacity: 0.4;">
        <path d="M0 30 Q25 10, 50 25 T100 15" stroke="white" stroke-width="1.5" fill="none"/>
        <circle cx="${(s / 60) * 100}" cy="20" r="2" fill="white"/>
      </svg>
    </div>
  `;
}

async function renderWeatherWidget(el) {
  // Use Open-Meteo (no API key) — fall back to fake data if offline
  try {
    // Default to NYC if no saved location
    const lat = localStorage.getItem('nova-location-lat') || '40.71';
    const lon = localStorage.getItem('nova-location-lon') || '-74.01';
    const city = localStorage.getItem('nova-location-city') || 'New York';

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`
    );
    const data = await res.json();
    const temp = Math.round(data.current?.temperature_2m ?? 72);
    const code = data.current?.weather_code ?? 0;
    const { icon, desc } = weatherCodeInfo(code);

    el.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.5px;">${city}</div>
        <div style="display: flex; align-items: center; justify-content: space-between; flex: 1;">
          <div>
            <div style="font-size: 38px; font-weight: 300; letter-spacing: -1px;">${temp}\u00B0</div>
            <div style="font-size: 12px; color: rgba(255,255,255,0.6);">${desc}</div>
          </div>
          <div style="font-size: 48px;">${icon}</div>
        </div>
      </div>
    `;
  } catch {
    el.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase;">Weather</div>
        <div style="display: flex; align-items: center; justify-content: space-between; flex: 1;">
          <div>
            <div style="font-size: 38px; font-weight: 300;">72\u00B0</div>
            <div style="font-size: 12px; color: rgba(255,255,255,0.6);">Offline</div>
          </div>
          <div style="font-size: 48px;">\u2601\uFE0F</div>
        </div>
      </div>
    `;
  }
}

function weatherCodeInfo(code) {
  if (code === 0) return { icon: '\u2600\uFE0F', desc: 'Clear' };
  if (code <= 3) return { icon: '\u26C5', desc: 'Partly cloudy' };
  if (code <= 48) return { icon: '\uD83C\uDF2B\uFE0F', desc: 'Foggy' };
  if (code <= 67) return { icon: '\uD83C\uDF27\uFE0F', desc: 'Rainy' };
  if (code <= 77) return { icon: '\u2744\uFE0F', desc: 'Snowy' };
  if (code <= 82) return { icon: '\uD83C\uDF26\uFE0F', desc: 'Showers' };
  if (code <= 99) return { icon: '\u26C8\uFE0F', desc: 'Stormy' };
  return { icon: '\u2601\uFE0F', desc: 'Cloudy' };
}

function renderStatsWidget(el) {
  // Fake but plausible system stats — we don't have real OS hooks in the web app
  const cpu = Math.round(15 + Math.random() * 25);
  const mem = Math.round(40 + Math.random() * 20);
  const battery = parseInt(localStorage.getItem('nova-battery') || '100');

  el.innerHTML = `
    <div style="font-size: 11px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">System</div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${statBar('CPU', cpu, '#007aff')}
      ${statBar('Memory', mem, '#34c759')}
      ${statBar('Battery', battery, battery > 20 ? '#ff9500' : '#ff3b30')}
    </div>
  `;
}

function statBar(label, pct, color) {
  return `
    <div>
      <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px;">
        <span style="color: rgba(255,255,255,0.7);">${label}</span>
        <span style="color: rgba(255,255,255,0.5);">${pct}%</span>
      </div>
      <div style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
        <div style="height: 100%; width: ${pct}%; background: ${color}; transition: width 0.3s ease;"></div>
      </div>
    </div>
  `;
}
