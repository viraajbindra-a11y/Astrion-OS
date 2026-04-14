// Astrion OS — Recent Apps Tracker
// Tracks the last 10 apps launched. Shows in Spotlight when the search is empty.

import { eventBus } from '../kernel/event-bus.js';
import { processManager } from '../kernel/process-manager.js';

const STORAGE_KEY = 'nova-recent-apps';
const MAX_RECENT = 10;

let recentApps = []; // [{ appId, name, lastUsed }]

export function initRecentApps() {
  try { recentApps = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { recentApps = []; }

  // Track app launches
  eventBus.on('window:created', ({ app }) => {
    if (!app) return;
    recordApp(app);
  });
}

function recordApp(appId) {
  const def = processManager.getAppDefinition(appId);
  const name = def?.name || appId;

  // Remove existing entry for this app
  recentApps = recentApps.filter(a => a.appId !== appId);
  // Prepend
  recentApps.unshift({ appId, name, lastUsed: Date.now() });
  // Trim
  if (recentApps.length > MAX_RECENT) recentApps = recentApps.slice(0, MAX_RECENT);

  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recentApps)); }
  catch { /* localStorage full — non-critical */ }
}

/**
 * Get recent apps for display. Returns [{ appId, name, lastUsed, iconPath }].
 */
export function getRecentApps() {
  return recentApps.map(a => ({
    ...a,
    iconPath: `/assets/icons/${a.appId}.svg`,
  }));
}
