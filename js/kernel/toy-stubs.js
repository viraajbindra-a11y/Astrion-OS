// Astrion OS — Toy App Lazy Loader
//
// 2026-05-11 (Phase 1, Option B — boot-perf):
//
// The 16 toy apps (minigames + goofy bits) total ~100 KB of JS. They
// were imported eagerly in boot.js — the browser fetched and parsed
// every module on first boot even though most users never open them
// in their first session. This module replaces those eager imports
// with stubs that lazy-import the real module on first launch.
//
// How it works:
//   - registerToyStub('snake') registers a "thin" definition with
//     processManager: same name/icon/width/height/singleInstance as
//     the real app, but a launch callback that:
//       1. paints a "Loading…" placeholder into contentEl
//       2. dynamically imports js/apps/snake.js
//       3. calls the module's registerSnake() — which overwrites the
//          stub in processManager.apps with the real definition
//       4. invokes the real launch on the same contentEl + instanceId
//   - Subsequent launches of 'snake' go straight to the real def
//     because processManager.apps now holds it.
//
// Why dimensions in the manifest must match the real app's:
//   processManager.launch reads width/height from the stub (since
//   that's what's registered when the launch happens) and creates the
//   window before the lazy import completes. If the stub width is
//   wrong, the window opens at the wrong size and (after the real
//   launch fires) the content fits awkwardly. Keep the manifest in
//   sync if any toy's dims change.
//
// Why this is safe to bypass for game.* capabilities:
//   capability-providers.js's getGameModule() ALREADY uses dynamic
//   import for snake/chess/2048 — the AI-driven game capabilities
//   don't depend on the register call having run. The stubs only
//   defer the UI side; the state-getter exports are reachable on
//   demand without a launch.

import { processManager } from './process-manager.js';

// 16 toys (matches TOYS set in app-categories.js). Each entry mirrors
// the real app's processManager.register() call so the stub's window
// dims match what the real launch expects. Keep this in sync if any
// toy's register options change.
const TOY_MANIFEST = {
  '2048':                { name: '2048',                icon: '🎲', width: 420, height: 500, modulePath: '../apps/2048.js',                fnName: 'register2048' },
  'chess':               { name: 'Chess',               icon: '♚',       width: 520, height: 560, modulePath: '../apps/chess.js',               fnName: 'registerChess' },
  'snake':               { name: 'Snake',               icon: '🐍', width: 440, height: 500, modulePath: '../apps/snake.js',               fnName: 'registerSnake' },
  'tetris':              { name: 'Tetris',              icon: '🧱', width: 380, height: 540, modulePath: '../apps/tetris.js',              fnName: 'registerTetris' },
  'minesweeper':         { name: 'Minesweeper',         icon: '💣', width: 420, height: 520, modulePath: '../apps/minesweeper.js',         fnName: 'registerMinesweeper' },
  'sudoku':              { name: 'Sudoku',              icon: '🔢', width: 440, height: 580, modulePath: '../apps/sudoku.js',              fnName: 'registerSudoku' },
  'wordle':              { name: 'Wordle',              icon: '🟩', width: 380, height: 520, modulePath: '../apps/wordle.js',              fnName: 'registerWordle' },
  'tic-tac-toe':         { name: 'Tic Tac Toe',         icon: '❌',       width: 340, height: 440, modulePath: '../apps/tic-tac-toe.js',         fnName: 'registerTicTacToe' },
  'rock-paper-scissors': { name: 'Rock Paper Scissors', icon: '✊',       width: 360, height: 420, modulePath: '../apps/rock-paper-scissors.js', fnName: 'registerRockPaperScissors' },
  'matrix-rain':         { name: 'Matrix Rain',         icon: '💚', width: 700, height: 500, modulePath: '../apps/matrix-rain.js',         fnName: 'registerMatrixRain' },
  'neon-void':           { name: 'Neon Void',           icon: '🚀', width: 900, height: 620, modulePath: '../apps/neon-void.js',           fnName: 'registerNeonVoid' },
  'emoji-kitchen':       { name: 'Emoji Kitchen',       icon: '🧪', width: 400, height: 520, modulePath: '../apps/emoji-kitchen.js',       fnName: 'registerEmojiKitchen' },
  'soundboard':          { name: 'Soundboard',          icon: '🔊', width: 420, height: 400, modulePath: '../apps/soundboard.js',          fnName: 'registerSoundboard' },
  'reaction-test':       { name: 'Reaction Test',       icon: '⚡',       width: 380, height: 420, modulePath: '../apps/reaction-test.js',       fnName: 'registerReactionTest' },
  'random-facts':        { name: 'Random Facts',        icon: '🧠', width: 380, height: 400, modulePath: '../apps/random-facts.js',        fnName: 'registerRandomFacts' },
  'quotes':              { name: 'Quotes',              icon: '💬', width: 480, height: 380, modulePath: '../apps/quotes.js',              fnName: 'registerQuotes' },
};

// Tracks in-flight loads so two near-simultaneous launches don't
// import the module twice. The browser's module cache also dedupes
// at the network layer, but resolving the same Promise twice is
// cheaper than parsing a duplicate module instance.
const _loadingPromises = new Map();

function paintLoadingState(contentEl, name) {
  contentEl.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px;color:rgba(255,255,255,0.55);font-size:13px;font-family:var(--font);background:#1a1a22;">
      <div style="font-size:32px;animation:toy-stub-spin 1.2s linear infinite;">⏳</div>
      <div>Loading ${name}…</div>
      <style>@keyframes toy-stub-spin { to { transform: rotate(360deg); } }</style>
    </div>
  `;
}

function paintErrorState(contentEl, name, err) {
  contentEl.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:#ff5f57;font-size:13px;font-family:var(--font);background:#1a1a22;padding:20px;text-align:center;">
      <div style="font-size:32px;">⚠️</div>
      <div><strong>${name}</strong> failed to load</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);">${String(err?.message || err).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</div>
    </div>
  `;
}

/**
 * Register a single toy as a lazy-loading stub. The first launch
 * dynamically imports the real module + calls its registerX() which
 * replaces the stub. Subsequent launches use the real definition.
 *
 * @param {string} appId — must be a key in TOY_MANIFEST
 */
export function registerToyStub(appId) {
  const entry = TOY_MANIFEST[appId];
  if (!entry) {
    console.warn(`[toy-stubs] unknown toy: ${appId}`);
    return;
  }
  processManager.register(appId, {
    name: entry.name,
    icon: entry.icon,
    singleInstance: true,
    width: entry.width,
    height: entry.height,
    launch: async (contentEl, instanceId, options) => {
      paintLoadingState(contentEl, entry.name);
      let loading = _loadingPromises.get(appId);
      if (!loading) {
        loading = (async () => {
          const mod = await import(/* @vite-ignore */ entry.modulePath);
          const fn = mod[entry.fnName];
          if (typeof fn !== 'function') {
            throw new Error(`${entry.modulePath} does not export ${entry.fnName}`);
          }
          fn(); // calls processManager.register(appId, realDef) — overwrites this stub
        })();
        _loadingPromises.set(appId, loading);
      }
      try {
        await loading;
      } catch (err) {
        _loadingPromises.delete(appId); // allow retry on next launch
        console.error(`[toy-stubs] failed to load ${appId}:`, err);
        paintErrorState(contentEl, entry.name, err);
        return;
      }
      const real = processManager.getAppDefinition(appId);
      if (!real || typeof real.launch !== 'function') {
        paintErrorState(contentEl, entry.name, new Error('real launch missing after register'));
        return;
      }
      // Real launch reuses the same window. processManager already
      // created the window via this stub's dims; the real def's dims
      // match (manifest in sync), so no resize jolt.
      real.launch(contentEl, instanceId, options);
    },
  });
}

/**
 * Register every toy in the manifest as a lazy-load stub. boot.js
 * calls this in place of the 16 individual registerX() calls.
 *
 * Order is preserved by the dock layout call site (boot.js stays in
 * charge of WHERE in the registration sequence the toys land).
 */
export function registerAllToyStubs() {
  for (const appId of Object.keys(TOY_MANIFEST)) {
    registerToyStub(appId);
  }
}

/**
 * The manifest is exported so boot.js (or other call sites) can
 * register stubs in a specific order, mirroring the dock's existing
 * inline placement of toy registers.
 */
export { TOY_MANIFEST };
