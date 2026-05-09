// Astrion OS — Spotlight Defaults Adapter
//
// #17 Spotlight defaults — when the empty Spotlight is opened, the
// "Suggested" fallback list reflects what you actually use at this
// hour-of-day, not a hardcoded set.
//
// #18 Settings hiding — Settings panes you've never opened sink to
// the bottom of the list. Heavily-used ones float up.
//
// #19 App categories shift — toys you actually play stay near the
// top of the Toys folder; ignored toys sink. (Cosmetic ordering, no
// removal.)
//
// All three are pure read-only consumers of usage-tracker.js. They
// don't record adaptations — the tracker is already persistent and
// any user complaint can be fixed by tuning per-category boldness or
// resetting the tracker.

import { listMostUsedApps, getHourBucket, getSettingsOpens } from './usage-tracker.js';

const DEFAULT_SUGGESTED = ['Notes', 'Terminal', 'Messages', 'Browser', 'Music', 'Weather', 'Calculator', 'Beat Studio'];

/**
 * Given the full app list, return suggestions ranked by what's hot at
 * THIS hour-of-day. Falls back to the static DEFAULT_SUGGESTED list
 * for users with no history yet.
 */
export function rankSuggestedApps(allApps, opts = {}) {
  const hour = typeof opts.hour === 'number' ? opts.hour : new Date().getHours();
  const limit = opts.limit || 8;
  const idsAtHour = getHourBucket('app-launch', hour);
  if (idsAtHour.length === 0) {
    return DEFAULT_SUGGESTED
      .map(name => allApps.find(a => a.name === name))
      .filter(Boolean)
      .slice(0, limit);
  }
  // Count + dedupe.
  const counts = new Map();
  for (const id of idsAtHour) counts.set(id, (counts.get(id) || 0) + 1);
  const sorted = [...counts.entries()].sort(([, a], [, b]) => b - a);
  // Map to app objects, fall back-fill from most-used overall if short.
  const out = [];
  const seen = new Set();
  for (const [id] of sorted) {
    const app = allApps.find(a => a.id === id);
    if (!app || seen.has(id)) continue;
    out.push(app); seen.add(id);
    if (out.length >= limit) return out;
  }
  for (const { id } of listMostUsedApps(limit)) {
    if (seen.has(id)) continue;
    const app = allApps.find(a => a.id === id);
    if (!app) continue;
    out.push(app); seen.add(id);
    if (out.length >= limit) return out;
  }
  return out;
}

/**
 * Rank Settings pane sections by recent open counts. Sections never
 * opened sort last (alphabetical fallback).
 */
export function rankSettingsSections(sections) {
  const opens = getSettingsOpens();
  return [...sections].sort((a, b) => {
    const ca = opens[a.id] || 0;
    const cb = opens[b.id] || 0;
    if (ca !== cb) return cb - ca;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

/**
 * Rank toys by launch count. Used inside the Toys folder for ordering.
 */
export function rankToys(toyApps) {
  return [...toyApps].sort((a, b) => {
    const ca = listMostUsedApps(999).find(x => x.id === a.id)?.count || 0;
    const cb = listMostUsedApps(999).find(x => x.id === b.id)?.count || 0;
    return cb - ca;
  });
}
