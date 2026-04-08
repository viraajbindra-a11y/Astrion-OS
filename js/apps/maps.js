// Astrion OS — Maps App
// Uses OpenStreetMap via Leaflet.js for map display + search.

import { processManager } from '../kernel/process-manager.js';

export function registerMaps() {
  processManager.register('maps', {
    name: 'Maps',
    icon: '\uD83D\uDDFA\uFE0F',
    singleInstance: true,
    width: 850,
    height: 560,
    launch: (contentEl) => initMaps(contentEl),
  });
}

function initMaps(container) {
  // Load Leaflet CSS + JS via CDN
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100%; background:#1a1a22;">
      <div style="padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; gap:8px; align-items:center;">
        <input type="text" id="map-search" placeholder="Search location..." style="
          flex:1; padding:8px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.1);
          background:rgba(255,255,255,0.06); color:white; font-size:13px; font-family:var(--font); outline:none;
        ">
        <button id="map-search-btn" style="padding:8px 16px; border-radius:8px; border:none; background:var(--accent); color:white; font-size:12px; cursor:pointer; font-family:var(--font);">Search</button>
        <button id="map-locate" title="My Location" style="padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.06); color:white; font-size:14px; cursor:pointer;">\uD83D\uDCCD</button>
      </div>
      <div id="map-container" style="flex:1; background:#2a2a34;">
        <iframe id="map-frame" style="width:100%; height:100%; border:none;"
          src="https://www.openstreetmap.org/export/embed.html?bbox=-74.006,40.7128,-73.97,40.73&layer=mapnik"
          loading="lazy"></iframe>
      </div>
      <div id="map-status" style="padding:4px 12px; font-size:10px; color:rgba(255,255,255,0.4); border-top:1px solid rgba(255,255,255,0.06);">
        Powered by OpenStreetMap
      </div>
    </div>
  `;

  const searchInput = container.querySelector('#map-search');
  const searchBtn = container.querySelector('#map-search-btn');
  const locateBtn = container.querySelector('#map-locate');
  const frame = container.querySelector('#map-frame');
  const status = container.querySelector('#map-status');

  async function searchLocation(query) {
    if (!query.trim()) return;
    status.textContent = 'Searching...';
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
        headers: { 'User-Agent': 'AstrionOS/1.0' }
      });
      const results = await res.json();
      if (results.length > 0) {
        const r = results[0];
        const bbox = r.boundingbox; // [south, north, west, east]
        frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox[2]},${bbox[0]},${bbox[3]},${bbox[1]}&layer=mapnik&marker=${r.lat},${r.lon}`;
        status.textContent = r.display_name;
      } else {
        status.textContent = 'Location not found';
      }
    } catch (err) {
      status.textContent = 'Search failed: ' + err.message;
    }
  }

  searchBtn.addEventListener('click', () => searchLocation(searchInput.value));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchLocation(searchInput.value); });

  locateBtn.addEventListener('click', () => {
    if (navigator.geolocation) {
      status.textContent = 'Getting location...';
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        const d = 0.01;
        frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - d},${latitude - d},${longitude + d},${latitude + d}&layer=mapnik&marker=${latitude},${longitude}`;
        status.textContent = `Location: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      }, () => {
        status.textContent = 'Location access denied';
      });
    }
  });
}
