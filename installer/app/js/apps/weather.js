// NOVA OS — Weather App

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

function initWeather(container) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  const dayName = days[today.getDay()];

  // Simulated weather data
  const hourly = [];
  const baseTemp = 68;
  const icons = ['\u2600\uFE0F', '\u26C5', '\uD83C\uDF24\uFE0F', '\u2601\uFE0F', '\uD83C\uDF27\uFE0F'];
  for (let h = 0; h < 24; h++) {
    const hour = (today.getHours() + h) % 24;
    const temp = Math.round(baseTemp + Math.sin((hour - 6) * Math.PI / 12) * 12 + (Math.random() * 4 - 2));
    const label = h === 0 ? 'Now' : (hour === 0 ? '12AM' : hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour-12}PM`);
    hourly.push({ time: label, temp, icon: icons[Math.floor(Math.random() * 3)] });
  }

  const daily = [];
  const dayIcons = ['\u2600\uFE0F', '\uD83C\uDF24\uFE0F', '\u26C5', '\uD83C\uDF27\uFE0F', '\u26C8\uFE0F', '\u2600\uFE0F', '\uD83C\uDF24\uFE0F', '\u2600\uFE0F', '\u26C5', '\uD83C\uDF27\uFE0F'];
  for (let d = 0; d < 10; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const low = Math.round(55 + Math.random() * 10);
    const high = Math.round(low + 12 + Math.random() * 8);
    daily.push({
      name: d === 0 ? 'Today' : days[date.getDay()].slice(0, 3),
      icon: dayIcons[d],
      low, high
    });
  }

  const globalLow = Math.min(...daily.map(d => d.low));
  const globalHigh = Math.max(...daily.map(d => d.high));
  const range = globalHigh - globalLow;

  container.innerHTML = `
    <div class="weather-app">
      <div class="weather-current">
        <div class="weather-location">Cupertino</div>
        <div class="weather-temp-big">${hourly[0].temp}\u00B0</div>
        <div class="weather-condition">Mostly Sunny</div>
        <div class="weather-hl">H:${daily[0].high}\u00B0  L:${daily[0].low}\u00B0</div>
      </div>

      <div class="weather-hourly">
        ${hourly.slice(0, 12).map(h => `
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
              <div class="weather-day-bar-fill" style="left:${left}%;width:${width}%"></div>
            </div>
            <div class="weather-day-high">${d.high}\u00B0</div>
          </div>`;
        }).join('')}
      </div>

      <div class="weather-details">
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF21\uFE0F Feels Like</div>
          <div class="weather-detail-value">${hourly[0].temp + 2}\u00B0</div>
          <div class="weather-detail-sub">Humidity makes it feel warmer</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83D\uDCA7 Humidity</div>
          <div class="weather-detail-value">${Math.round(45 + Math.random() * 20)}%</div>
          <div class="weather-detail-sub">The dew point is ${Math.round(50 + Math.random() * 10)}\u00B0</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF2C\uFE0F Wind</div>
          <div class="weather-detail-value">${Math.round(5 + Math.random() * 10)} mph</div>
          <div class="weather-detail-sub">Gusts up to ${Math.round(15 + Math.random() * 10)} mph</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\u2600\uFE0F UV Index</div>
          <div class="weather-detail-value">${Math.round(3 + Math.random() * 5)}</div>
          <div class="weather-detail-sub">Moderate</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF05 Sunrise</div>
          <div class="weather-detail-value">6:42 AM</div>
        </div>
        <div class="weather-detail-card">
          <div class="weather-detail-label">\uD83C\uDF07 Sunset</div>
          <div class="weather-detail-value">7:31 PM</div>
        </div>
      </div>
    </div>
  `;
}
