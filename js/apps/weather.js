// Astrion OS — Weather App
// Uses Open-Meteo API (free, no key, no signup, no limits).
// Falls back to cached data when offline, simulated data on first run.

import { processManager } from '../kernel/process-manager.js';

export function registerWeather() {
  processManager.register('weather', {
    name: 'Weather',
    icon: '\u26C5',
    iconClass: 'dock-icon-weather',
    singleInstance: true,
    width: 380,
    height: 600,
    minWidth: 320,
    launch: (contentEl) => {
      initWeather(contentEl);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// WMO WEATHER CODE → ICON + DESCRIPTION
// ═══════════════════════════════════════════════════════════════

const WMO = {
  0:  { icon: '\u2600\uFE0F', desc: 'Clear sky' },
  1:  { icon: '\uD83C\uDF24\uFE0F', desc: 'Mainly clear' },
  2:  { icon: '\u26C5', desc: 'Partly cloudy' },
  3:  { icon: '\u2601\uFE0F', desc: 'Overcast' },
  45: { icon: '\uD83C\uDF2B\uFE0F', desc: 'Fog' },
  48: { icon: '\uD83C\uDF2B\uFE0F', desc: 'Depositing rime fog' },
  51: { icon: '\uD83C\uDF26\uFE0F', desc: 'Light drizzle' },
  53: { icon: '\uD83C\uDF26\uFE0F', desc: 'Moderate drizzle' },
  55: { icon: '\uD83C\uDF26\uFE0F', desc: 'Dense drizzle' },
  61: { icon: '\uD83C\uDF27\uFE0F', desc: 'Slight rain' },
  63: { icon: '\uD83C\uDF27\uFE0F', desc: 'Moderate rain' },
  65: { icon: '\uD83C\uDF27\uFE0F', desc: 'Heavy rain' },
  66: { icon: '\u2744\uFE0F', desc: 'Freezing rain' },
  67: { icon: '\u2744\uFE0F', desc: 'Heavy freezing rain' },
  71: { icon: '\u2744\uFE0F', desc: 'Slight snow' },
  73: { icon: '\uD83C\uDF28\uFE0F', desc: 'Moderate snow' },
  75: { icon: '\uD83C\uDF28\uFE0F', desc: 'Heavy snow' },
  77: { icon: '\u2744\uFE0F', desc: 'Snow grains' },
  80: { icon: '\uD83C\uDF27\uFE0F', desc: 'Slight showers' },
  81: { icon: '\uD83C\uDF27\uFE0F', desc: 'Moderate showers' },
  82: { icon: '\u26C8\uFE0F', desc: 'Violent showers' },
  85: { icon: '\uD83C\uDF28\uFE0F', desc: 'Slight snow showers' },
  86: { icon: '\uD83C\uDF28\uFE0F', desc: 'Heavy snow showers' },
  95: { icon: '\u26A1', desc: 'Thunderstorm' },
  96: { icon: '\u26A1', desc: 'Thunderstorm with hail' },
  99: { icon: '\u26A1', desc: 'Thunderstorm with heavy hail' },
};

function wmo(code) {
  return WMO[code] || WMO[0];
}

// ═══════════════════════════════════════════════════════════════
// OPEN-METEO FETCH
// ═══════════════════════════════════════════════════════════════

async function fetchWeather(lat, lon) {
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    'current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,uv_index',
    'hourly=temperature_2m,weather_code',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset',
    'temperature_unit=fahrenheit',
    'wind_speed_unit=mph',
    'forecast_days=10',
    'timezone=auto',
  ].join('&');

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return await res.json();
}

// ═══════════════════════════════════════════════════════════════
// LOCATION
// ═══════════════════════════════════════════════════════════════

function getStoredLocation() {
  const lat = localStorage.getItem('nova-location-lat');
  const lon = localStorage.getItem('nova-location-lon');
  const city = localStorage.getItem('nova-location-city');
  if (lat && lon) return { lat: parseFloat(lat), lon: parseFloat(lon), city: city || 'Your Location' };
  return null;
}

function storeLocation(lat, lon, city) {
  localStorage.setItem('nova-location-lat', String(lat));
  localStorage.setItem('nova-location-lon', String(lon));
  localStorage.setItem('nova-location-city', city);
}

async function detectLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        let city = 'Your Location';
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
            { headers: { 'User-Agent': 'AstrionOS/1.0' }, signal: AbortSignal.timeout(5000) }
          );
          const data = await res.json();
          city = data.address?.city || data.address?.town || data.address?.village || data.address?.county || 'Your Location';
        } catch {}
        storeLocation(latitude, longitude, city);
        resolve({ lat: latitude, lon: longitude, city });
      },
      (err) => reject(err),
      { timeout: 8000 }
    );
  });
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

function renderWeather(container, data, city) {
  const now = data.current;
  const currentWmo = wmo(now.weather_code);
  const temp = Math.round(now.temperature_2m);
  const feelsLike = Math.round(now.apparent_temperature);
  const humidity = now.relative_humidity_2m;
  const wind = Math.round(now.wind_speed_10m);
  const gusts = Math.round(now.wind_gusts_10m);
  const uvIndex = Math.round(now.uv_index);

  // Hourly: next 12 hours starting from current hour
  const currentHourIndex = new Date().getHours();
  // Open-Meteo hourly starts at midnight of current day
  const hourlyTemps = data.hourly.temperature_2m;
  const hourlyCodes = data.hourly.weather_code;
  const hourly = [];
  for (let i = 0; i < 12; i++) {
    const idx = currentHourIndex + i;
    if (idx >= hourlyTemps.length) break;
    const hour = idx % 24;
    const label = i === 0 ? 'Now' : (hour === 0 ? '12AM' : hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`);
    hourly.push({
      time: label,
      temp: Math.round(hourlyTemps[idx]),
      icon: wmo(hourlyCodes[idx]).icon,
    });
  }

  // Daily: 10-day forecast
  const dailyMax = data.daily.temperature_2m_max;
  const dailyMin = data.daily.temperature_2m_min;
  const dailyCodes = data.daily.weather_code;
  const sunrise = data.daily.sunrise;
  const sunset = data.daily.sunset;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daily = [];
  for (let d = 0; d < dailyMax.length; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    daily.push({
      name: d === 0 ? 'Today' : days[date.getDay()],
      icon: wmo(dailyCodes[d]).icon,
      low: Math.round(dailyMin[d]),
      high: Math.round(dailyMax[d]),
    });
  }

  const globalLow = Math.min(...daily.map(d => d.low));
  const globalHigh = Math.max(...daily.map(d => d.high));
  const range = globalHigh - globalLow || 1;

  // Sunrise/sunset formatted
  const sunriseTime = sunrise?.[0] ? new Date(sunrise[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '--';
  const sunsetTime = sunset?.[0] ? new Date(sunset[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '--';

  // UV label
  const uvLabel = uvIndex <= 2 ? 'Low' : uvIndex <= 5 ? 'Moderate' : uvIndex <= 7 ? 'High' : uvIndex <= 10 ? 'Very High' : 'Extreme';

  container.innerHTML = `
    <div class="weather-app">
      <div class="weather-current">
        <div class="weather-location">${esc(city)}</div>
        <div class="weather-temp-big">${temp}\u00B0</div>
        <div class="weather-condition">${currentWmo.icon} ${currentWmo.desc}</div>
        <div class="weather-hl">H:${daily[0]?.high ?? '--'}\u00B0  L:${daily[0]?.low ?? '--'}\u00B0</div>
      </div>

      <div class="weather-hourly">
        ${hourly.map(h => `
          <div class="weather-hour">
            <div class="weather-hour-time">${h.time}</div>
            <div class="weather-hour-icon">${h.icon}</div>
            <div class="weather-hour-temp">${h.temp}\u00B0</div>
          </div>
        `).join('')}
      </div>

      <div class="weather-daily">
        ${daily.map(d => {
          const left = ((d.low - globalLow) / range) * 100;
          const width = ((d.high - d.low) / range) * 100;
          return `
          <div class="weather-day">
            <div class="weather-day-name">${d.name}</div>
            <div class="weather-day-icon">${d.icon}</div>
            <div class="weather-day-low">${d.low}\u00B0</div>
            <div class="weather-day-bar">
              <div class="weather-day-bar-fill" style="left:${left}%;width:${Math.max(width, 5)}%"></div>
            </div>
            <div class="weather-day-high">${d.high}\u00B0</div>
          </div>`;
        }).join('')}
      </div>

      <div class="weather-details">
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF21\uFE0F Feels Like</div>
          <div class="weather-detail-value">${feelsLike}\u00B0</div>
          <div class="weather-detail-sub">${feelsLike > temp ? 'Humidity makes it feel warmer' : feelsLike < temp ? 'Wind makes it feel cooler' : 'Similar to actual temp'}</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83D\uDCA7 Humidity</div>
          <div class="weather-detail-value">${humidity}%</div>
          <div class="weather-detail-sub">${humidity > 70 ? 'Muggy' : humidity > 40 ? 'Comfortable' : 'Dry'}</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF2C\uFE0F Wind</div>
          <div class="weather-detail-value">${wind} mph</div>
          <div class="weather-detail-sub">Gusts up to ${gusts} mph</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\u2600\uFE0F UV Index</div>
          <div class="weather-detail-value">${uvIndex}</div>
          <div class="weather-detail-sub">${uvLabel}</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF05 Sunrise</div>
          <div class="weather-detail-value">${sunriseTime}</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF07 Sunset</div>
          <div class="weather-detail-value">${sunsetTime}</div>
        </div>
      </div>
    </div>
  `;

  // Cache weather data for offline use
  try {
    localStorage.setItem('nova-weather-cache', JSON.stringify({ data, city, ts: Date.now() }));
  } catch {}
}

function renderLoading(container) {
  container.innerHTML = `
    <div class="weather-app" style="display:flex; align-items:center; justify-content:center; min-height:400px;">
      <div style="text-align:center; color:rgba(255,255,255,0.5); font-size:14px;">
        <div style="font-size:32px; margin-bottom:12px;">\u26C5</div>
        Loading weather...
      </div>
    </div>
  `;
}

function renderError(container, msg, retryFn) {
  container.innerHTML = `
    <div class="weather-app" style="display:flex; align-items:center; justify-content:center; min-height:400px;">
      <div style="text-align:center; color:rgba(255,255,255,0.5); font-size:14px;">
        <div style="font-size:32px; margin-bottom:12px;">\u26A0\uFE0F</div>
        ${esc(msg)}
        <br><br>
        <button id="weather-retry" style="
          padding:8px 16px; border-radius:8px; border:1px solid rgba(255,255,255,0.15);
          background:rgba(255,255,255,0.08); color:white; cursor:pointer; font-size:13px;
        ">Retry</button>
      </div>
    </div>
  `;
  container.querySelector('#weather-retry')?.addEventListener('click', retryFn);
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

async function initWeather(container) {
  renderLoading(container);

  const load = async () => {
    renderLoading(container);

    // Try to get location
    let loc = getStoredLocation();
    if (!loc) {
      try {
        loc = await detectLocation();
      } catch {
        // Default to New York if geolocation is denied/unavailable
        loc = { lat: 40.7128, lon: -74.006, city: 'New York' };
      }
    }

    // Try to fetch real weather
    try {
      const data = await fetchWeather(loc.lat, loc.lon);
      renderWeather(container, data, loc.city);
    } catch (err) {
      // Try cached data
      try {
        const cached = JSON.parse(localStorage.getItem('nova-weather-cache'));
        if (cached && cached.data && (Date.now() - cached.ts) < 3600000) {
          renderWeather(container, cached.data, cached.city + ' (cached)');
          return;
        }
      } catch {}
      renderError(container, 'Could not load weather data', load);
    }
  };

  await load();
}
