// Astrion OS — Context Bundle (Agent Core Sprint, Phase 2)
//
// A single, pure snapshot of "what the user is currently looking at" that
// the intent planner can feed to Claude. Context matters because the planner
// has to pick between a zillion capabilities and the user rarely says
// everything out loud — "clean this up" means "clean up whatever is selected
// in the app I'm currently focused in."
//
// What the bundle captures:
//   - `openApps`          — list of running apps (processManager)
//   - `activeApp`         — which app is currently focused (from window:focused)
//   - `activeWindowTitle` — title of the focused window
//   - `clipboardText`     — last copied item (localStorage shim)
//   - `selectedText`      — whatever the user had highlighted BEFORE Spotlight
//                           stole focus (snapshot captured on spotlight:toggle)
//   - `recentTerminalLines` — tail of the terminal output DOM, if any
//   - `currentDate`       — ISO timestamp so the planner can handle "today"
//
// What this file does NOT do:
//   - Live subscriptions (the planner pulls a snapshot, never observes)
//   - Any side effects on user data
//   - Any network calls
//
// Lesson #66: cap clipboard + selection payload sizes. Planner prompts are
// not a great place to leak pages of copied text into Claude's context.
//
// Lesson #48: read the exact localStorage shape the target subsystem writes.
// clipboard-manager.js uses `nova-clipboard-history` (array of strings,
// most-recent first).

import { eventBus } from './event-bus.js';
import { processManager } from './process-manager.js';

// ---------- module state ----------

let _activeAppId = null;
let _activeWindowTitle = null;
let _capturedSelection = null; // snapshotted when Spotlight opens
let _initialized = false;

const MAX_CLIPBOARD_CHARS = 200;
const MAX_SELECTION_CHARS = 500;
const MAX_TERMINAL_LINES = 20;

// ---------- init ----------

/**
 * Wire up the context-bundle to the event bus. Called once from boot.js.
 * Safe to call multiple times — it just no-ops on the second call.
 */
export function initContextBundle() {
  if (_initialized) return;
  _initialized = true;

  // Track active window / app via the same events window-manager already fires.
  eventBus.on('window:focused', ({ id, title, app }) => {
    _activeWindowTitle = title || null;
    _activeAppId = app || null;
  });
  eventBus.on('window:closed', ({ id, app }) => {
    // If the focused window closed, clear the cache. Next `window:focused`
    // event will repopulate it.
    if (app === _activeAppId) {
      _activeAppId = null;
      _activeWindowTitle = null;
    }
  });

  // When Spotlight is about to open, snapshot any selected text BEFORE the
  // spotlight input steals focus (which would wipe `document.getSelection`).
  eventBus.on('spotlight:will-open', () => {
    try {
      const sel = window.getSelection?.()?.toString() || '';
      _capturedSelection = sel.trim().slice(0, MAX_SELECTION_CHARS) || null;
    } catch {
      _capturedSelection = null;
    }
  });
  eventBus.on('spotlight:closed', () => {
    _capturedSelection = null;
  });

  console.log('[context-bundle] initialized');
}

// ---------- readers (all defensive) ----------

function readClipboardLatest() {
  try {
    const raw = localStorage.getItem('nova-clipboard-history');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const first = parsed[0];
    // Format varies slightly across versions; tolerate both shapes.
    const text = typeof first === 'string' ? first
      : typeof first?.text === 'string' ? first.text
      : typeof first?.content === 'string' ? first.content
      : null;
    if (!text) return null;
    return text.slice(0, MAX_CLIPBOARD_CHARS);
  } catch {
    return null;
  }
}

function readTerminalTail(maxLines = MAX_TERMINAL_LINES) {
  try {
    const nodes = document.querySelectorAll('[id^="term-output-"]');
    if (!nodes || nodes.length === 0) return null;
    // Use the most recently updated (last in DOM order — Astrion reuses ids
    // but mounts the newest terminal last).
    const last = nodes[nodes.length - 1];
    const text = (last?.textContent || '').trim();
    if (!text) return null;
    const lines = text.split('\n').filter(Boolean);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return null;
  }
}

function readOpenApps() {
  try {
    const running = processManager.getRunningApps();
    if (!Array.isArray(running)) return [];
    return running.map(p => ({
      appId: p.appId,
      instanceId: p.instanceId,
      name: p.app?.name || p.appId,
      icon: p.app?.icon || null,
    }));
  } catch {
    return [];
  }
}

// ---------- public API ----------

/**
 * Return a pure snapshot of current context. Safe to call from anywhere;
 * no throws, no side effects. Missing data is returned as null / [].
 *
 * @returns {{
 *   timestamp: number,
 *   openApps: Array<{appId:string,instanceId?:string,name:string,icon?:string}>,
 *   activeApp: string|null,
 *   activeWindowTitle: string|null,
 *   clipboardText: string|null,
 *   selectedText: string|null,
 *   recentTerminalLines: string|null,
 *   currentDate: string,
 * }}
 */
export function getContextBundle() {
  return {
    timestamp: Date.now(),
    openApps: readOpenApps(),
    activeApp: _activeAppId,
    activeWindowTitle: _activeWindowTitle,
    clipboardText: readClipboardLatest(),
    selectedText: _capturedSelection,
    recentTerminalLines: readTerminalTail(),
    currentDate: new Date().toISOString(),
  };
}

/**
 * Compact one-line summary of the bundle for the planner prompt. Avoids
 * dumping a JSON blob into Claude's context window.
 */
export function summarizeContext(bundle) {
  if (!bundle) return '';
  const lines = [];
  lines.push(`date: ${new Date(bundle.timestamp).toISOString().replace(/T/, ' ').replace(/\..+/, '')}`);
  if (bundle.openApps?.length) {
    lines.push(`open apps: ${bundle.openApps.map(a => a.name).slice(0, 10).join(', ')}`);
  } else {
    lines.push('open apps: (none)');
  }
  if (bundle.activeApp) {
    lines.push(`active: ${bundle.activeApp}${bundle.activeWindowTitle ? ` — "${bundle.activeWindowTitle}"` : ''}`);
  }
  if (bundle.selectedText) {
    lines.push(`selection: "${bundle.selectedText.slice(0, 120)}${bundle.selectedText.length > 120 ? '…' : ''}"`);
  }
  if (bundle.clipboardText) {
    lines.push(`clipboard: "${bundle.clipboardText.slice(0, 80)}${bundle.clipboardText.length > 80 ? '…' : ''}"`);
  }
  if (bundle.recentTerminalLines) {
    const tail = bundle.recentTerminalLines.split('\n').slice(-5).join(' | ');
    lines.push(`terminal (last 5): ${tail.slice(0, 160)}${tail.length > 160 ? '…' : ''}`);
  }
  return lines.join('\n');
}

// ---------- inline sanity tests (localhost only) ----------

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  // These run at import time BEFORE initContextBundle() is called.
  // They verify the reader functions don't throw on empty state.
  let fail = 0;
  try {
    const b = getContextBundle();
    if (!b || typeof b !== 'object') { console.warn('[context-bundle] bundle not an object'); fail++; }
    if (!Array.isArray(b.openApps)) { console.warn('[context-bundle] openApps not array'); fail++; }
    if (typeof b.currentDate !== 'string') { console.warn('[context-bundle] currentDate not a string'); fail++; }
    const s = summarizeContext(b);
    if (typeof s !== 'string') { console.warn('[context-bundle] summary not a string'); fail++; }
  } catch (err) {
    console.warn('[context-bundle] sanity threw:', err?.message);
    fail++;
  }
  if (fail === 0) console.log('[context-bundle] 4/4 sanity tests pass');
}
