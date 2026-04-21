// Astrion OS — App Categories
//
// This file is the mental shift from "51 hand-coded apps" → "3 primitives + 48 templates."
//
// PRIMITIVES are first-class OS tools. They stay as shipped apps forever.
// TEMPLATES are examples the Intent Kernel (M1) will instantiate from user intents
// once it lands. Today they still launch like normal apps — the label is the move.
//
// Don't add new entries here unless they're primitives. Anything else should ship
// as an intent/template, not a new dock icon. This is the moratorium (see CONTRIBUTING.md).
//
// Addresses audit hole #1: "51 hand-coded apps is a trap."

export const PRIMITIVE = 'primitive';
export const TEMPLATE = 'template';

// Only these three survive as shipped apps.
// Everything else is a template the AI will instantiate on demand in M1+.
const PRIMITIVES = new Set([
  'terminal',      // real bash, first-class dev tool
  'text-editor',   // raw editing primitive
  'browser',       // web is a primitive, not an app
]);

// All known Astrion apps. When a new app ships, add it here as 'template' (default).
// Adding a new 'primitive' requires explicit justification and a plan review.
const ALL_APPS = [
  '2048', 'activity-monitor', 'ai-art', 'ai-writer', 'animate', 'appstore', 'beat-studio',
  'bmi-calc', 'browser', 'budget', 'calculator', 'calendar', 'chess', 'clock',
  'color-palette', 'color-picker', 'contacts', 'countdown', 'dictionary', 'draw',
  'emoji-kitchen', 'finder', 'flashcards', 'habit-tracker', 'installer', 'journal',
  'kanban', 'live-chat', 'maps', 'markdown', 'matrix-rain', 'meditation',
  'messages', 'minesweeper', 'music', 'neon-void', 'notes', 'password-gen',
  'pdf-viewer', 'photos', 'pixel-art', 'pomodoro', 'qr-code', 'quotes',
  'random-facts', 'reaction-test', 'recipe-book', 'reminders', 'rock-paper-scissors',
  'screen-recorder', 'settings', 'snake', 'soundboard', 'speed-test', 'sticky-notes',
  'stopwatch', 'sudoku', 'system-info', 'terminal', 'tetris', 'text-editor',
  'tic-tac-toe', 'timer-app', 'todo', 'translator', 'trash', 'typing-test',
  'unit-converter', 'vault', 'video-editor', 'video-player', 'voice-memos',
  'weather', 'whiteboard', 'wordle', 'youtube',
];

/**
 * Get the category of an app.
 * @param {string} appId
 * @returns {'primitive' | 'template'}
 */
export function getCategory(appId) {
  return PRIMITIVES.has(appId) ? PRIMITIVE : TEMPLATE;
}

/**
 * Is this app a primitive (shipped forever) or a template (AI-instantiable)?
 * @param {string} appId
 */
export function isPrimitive(appId) {
  return PRIMITIVES.has(appId);
}

export function isTemplate(appId) {
  return !PRIMITIVES.has(appId) && ALL_APPS.includes(appId);
}

/**
 * All known app IDs. Used by the moratorium check to verify nothing new slipped in.
 */
export function listAllApps() {
  return [...ALL_APPS];
}

/**
 * Counts — handy for the "about Astrion" page and for tests.
 */
export function counts() {
  const primitiveCount = [...PRIMITIVES].filter(id => ALL_APPS.includes(id)).length;
  return {
    primitives: primitiveCount,
    templates: ALL_APPS.length - primitiveCount,
    total: ALL_APPS.length,
  };
}
