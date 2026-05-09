// Astrion OS — App Categories
//
// This file is the mental shift from "51 hand-coded apps" → "3 primitives + N templates + N toys."
//
// PRIMITIVES are first-class OS tools. They stay as shipped apps forever.
// TEMPLATES are examples the Intent Kernel (M1) will instantiate from user intents
// once it lands. Today they still launch like normal apps — the label is the move.
// TOYS are minigames and goofy bits. They ship for fun but should not dilute the
// real-app surface — Launchpad puts them in their own folder, Spotlight ranks
// them last, and the wizard counts them separately so "76 Apps" isn't a lie.
//
// Don't add new entries here unless they're primitives. Anything else should ship
// as an intent/template, not a new dock icon. This is the moratorium (see CONTRIBUTING.md).
//
// Addresses audit hole #1: "51 hand-coded apps is a trap."
// Addresses 2026-05-09 strategic review: "76 apps is too many; minigames dilute brand."

export const PRIMITIVE = 'primitive';
export const TEMPLATE = 'template';
export const TOY = 'toy';

// Only these three survive as shipped apps.
// Everything else is a template the AI will instantiate on demand in M1+.
const PRIMITIVES = new Set([
  'terminal',      // real bash, first-class dev tool
  'text-editor',   // raw editing primitive
  'browser',       // web is a primitive, not an app
]);

// Toys: minigames + goofy bits. Demoted from the main app surface so real apps
// surface. They still launch normally — they're just labeled and ranked as toys.
const TOYS = new Set([
  '2048',
  'chess',
  'snake',
  'tetris',
  'minesweeper',
  'sudoku',
  'wordle',
  'tic-tac-toe',
  'rock-paper-scissors',
  'matrix-rain',
  'neon-void',
  'emoji-kitchen',
  'soundboard',
  'reaction-test',
  'random-facts',
  'quotes',
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
 * @returns {'primitive' | 'template' | 'toy'}
 */
export function getCategory(appId) {
  if (PRIMITIVES.has(appId)) return PRIMITIVE;
  if (TOYS.has(appId)) return TOY;
  return TEMPLATE;
}

/**
 * Is this app a primitive (shipped forever) or a template (AI-instantiable)?
 * @param {string} appId
 */
export function isPrimitive(appId) {
  return PRIMITIVES.has(appId);
}

export function isTemplate(appId) {
  return !PRIMITIVES.has(appId) && !TOYS.has(appId) && ALL_APPS.includes(appId);
}

/**
 * Is this app a toy (minigame / goofy bit)?
 * Used by Launchpad to fold them into a Toys folder, by Spotlight to rank
 * them last in default match scoring, and by the wizard to count them
 * separately from "real" apps.
 * @param {string} appId
 */
export function isToy(appId) {
  return TOYS.has(appId);
}

/**
 * All known app IDs. Used by the moratorium check to verify nothing new slipped in.
 */
export function listAllApps() {
  return [...ALL_APPS];
}

/**
 * Just the toy IDs.
 */
export function listToys() {
  return [...TOYS];
}

/**
 * App IDs minus the toys — the "real" app surface.
 */
export function listNonToyApps() {
  return ALL_APPS.filter(id => !TOYS.has(id));
}

/**
 * Counts — handy for the "about Astrion" page and for tests.
 * Now splits out toys so "X Apps + Y Toys" shows up honestly in the wizard
 * instead of conflating them.
 */
export function counts() {
  const primitiveCount = [...PRIMITIVES].filter(id => ALL_APPS.includes(id)).length;
  const toyCount = [...TOYS].filter(id => ALL_APPS.includes(id)).length;
  return {
    primitives: primitiveCount,
    templates: ALL_APPS.length - primitiveCount - toyCount,
    toys: toyCount,
    apps: ALL_APPS.length - toyCount, // primitives + templates — the real-app surface
    total: ALL_APPS.length,
  };
}
