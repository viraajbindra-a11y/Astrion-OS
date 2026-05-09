// Astrion OS — Usage Tracker
//
// Single source of truth for "what does the user actually do, and when?"
// Powers a cluster of auto-evolution features:
//
//   #9   Time-of-day routine — bucket events by hour, propose routines
//        for hour-specific repeated sequences.
//   #16  Dock by usage — propose pin/unpin based on launch counts.
//   #17  Spotlight defaults — rank Suggested by what's hot at this hour.
//   #18  Settings hiding — rank settings panes by recent use.
//   #19  App categories shift — toys you actually play stay; toys you
//        ignore drop further.
//
// All persisted in localStorage so cross-session usage is meaningful.
// Subscribes to existing OS events (app:launched, intent:completed,
// settings:opened) — does NOT add new event types or capabilities.

import { eventBus } from './event-bus.js';

const STORAGE_KEY = 'astrion-usage-tracker-v1';
const MAX_EVENTS = 2000;
const KEEP_DAYS = 30;

let stats = null; // lazy-loaded

function load() {
  if (stats) return stats;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        stats = {
          appLaunches: parsed.appLaunches || {},
          settingsOpens: parsed.settingsOpens || {},
          spotlightQueries: parsed.spotlightQueries || {},
          events: Array.isArray(parsed.events) ? parsed.events : [],
        };
        prune();
        return stats;
      }
    }
  } catch {}
  stats = { appLaunches: {}, settingsOpens: {}, spotlightQueries: {}, events: [] };
  return stats;
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stats)); } catch {}
}

function prune() {
  if (!stats) return;
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  stats.events = stats.events.filter(e => e.ts > cutoff).slice(-MAX_EVENTS);
}

function hourOf(ts) {
  return new Date(ts).getHours();
}

function record(kind, key, extra = {}) {
  const s = load();
  const now = Date.now();
  s.events.push({ kind, key, hour: hourOf(now), ts: now, ...extra });
  if (kind === 'app-launch')      s.appLaunches[key]      = (s.appLaunches[key]      || 0) + 1;
  if (kind === 'settings-open')   s.settingsOpens[key]    = (s.settingsOpens[key]    || 0) + 1;
  if (kind === 'spotlight-query') s.spotlightQueries[key] = (s.spotlightQueries[key] || 0) + 1;
  prune();
  save();
}

// ─── Public read API ──────────────────────────────────────────────

export function getAppLaunchCount(appId) {
  return load().appLaunches[appId] || 0;
}

export function listMostUsedApps(limit = 10) {
  const s = load();
  return Object.entries(s.appLaunches)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}

export function listLeastUsedApps(opts = {}) {
  const { minLaunches = 0, sinceMs } = opts;
  const s = load();
  const ids = Object.keys(s.appLaunches);
  if (typeof sinceMs === 'number') {
    const cutoff = Date.now() - sinceMs;
    const recentIds = new Set(s.events.filter(e => e.kind === 'app-launch' && e.ts > cutoff).map(e => e.key));
    return ids.filter(id => !recentIds.has(id) && (s.appLaunches[id] || 0) >= minLaunches);
  }
  return ids.filter(id => (s.appLaunches[id] || 0) <= minLaunches);
}

export function getHourBucket(kind = 'app-launch', hour) {
  const s = load();
  return s.events.filter(e => e.kind === kind && e.hour === hour).map(e => e.key);
}

export function getSettingsOpens(section) {
  if (section) return load().settingsOpens[section] || 0;
  return { ...load().settingsOpens };
}

export function getSpotlightQueryCount(query) {
  return load().spotlightQueries[String(query || '').toLowerCase()] || 0;
}

export function getRecentEvents(limit = 50) {
  return load().events.slice(-limit);
}

// ─── Init / wiring ─────────────────────────────────────────────────

let initialized = false;

export function initUsageTracker() {
  if (initialized) return;
  initialized = true;
  eventBus.on('app:launched',     ({ appId })  => appId && record('app-launch', appId));
  eventBus.on('intent:started',   ({ cap })    => cap?.id && record('intent', cap.id));
  eventBus.on('settings:opened',  ({ section })=> section && record('settings-open', section));
  eventBus.on('spotlight:query',  ({ query })  => query && record('spotlight-query', String(query).toLowerCase()));
}

// ─── Test helpers ─────────────────────────────────────────────────

export function _resetForTests() {
  initialized = false;
  stats = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function _record(kind, key, extra = {}) { record(kind, key, extra); }
