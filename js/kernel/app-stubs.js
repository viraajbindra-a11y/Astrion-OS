// Astrion OS — Real-App Lazy Loader (extends the toy-stubs pattern)
//
// 2026-05-12: continues Phase 1 Option B from ROADMAP-DEC-2026-v3.md —
// "Lazy-load all 76 apps." Toys went first in commit 972a09b (60 →
// 61 modules on cold boot once toys were deferred). This module
// does the same for the 60 "real" (non-toy) apps: register a thin
// stub with name/icon/dimensions at boot, dynamic-import the actual
// module on first launch, then re-register the real definition and
// dispatch the launch.
//
// Why this is safe across the larger surface:
//   - I audited every js/apps/*.js — only `registerX` is exported
//     externally except for settings.js (applyWallpaper +
//     applyAccentColor are called at boot) and trash.js (moveToTrash
//     exported but not imported anywhere). Settings stays EAGER in
//     boot.js. Trash is safe to lazy.
//   - All apps register exclusively inside their registerX function;
//     none does work at module top-level. So deferring the module
//     load deferred zero side effects.
//   - The smoke runner (/test/app-smoke.html) imports every app
//     directly + smoke-launches each one. 61/61 pass means every
//     real launch path actually mounts UI; the lazy stubs route
//     to those same launches on first click.
//
// What's excluded:
//   - settings: boot needs applyWallpaper + applyAccentColor exports.
//     Could be split into kernel/theme.js but that's a separate PR.
//   - The 16 toys: handled by js/kernel/toy-stubs.js.

import { processManager } from './process-manager.js';

const APP_MANIFEST = [
  { id: 'finder', name: 'Finder', icon: '📂', width: 750, height: 480, modulePath: '../apps/finder.js', fnName: 'registerFinder' },
  { id: 'notes', name: 'Notes', icon: '📝', width: 750, height: 500, singleInstance: true, modulePath: '../apps/notes.js', fnName: 'registerNotes' },
  { id: 'terminal', name: 'Terminal', icon: '>_', width: 700, height: 460, modulePath: '../apps/terminal.js', fnName: 'registerTerminal' },
  { id: 'calculator', name: 'Calculator', icon: '🖩', width: 280, height: 420, singleInstance: true, minWidth: 250, minHeight: 380, modulePath: '../apps/calculator.js', fnName: 'registerCalculator' },
  { id: 'text-editor', name: 'Text Editor', icon: '💻', width: 700, height: 480, modulePath: '../apps/text-editor.js', fnName: 'registerTextEditor' },
  { id: 'draw', name: 'Draw', icon: '🎨', width: 700, height: 520, modulePath: '../apps/draw.js', fnName: 'registerDraw' },
  { id: 'browser', name: 'Browser', icon: '🌐', width: 900, height: 600, modulePath: '../apps/browser.js', fnName: 'registerBrowser' },
  { id: 'music', name: 'Music', icon: '🎵', width: 820, height: 560, singleInstance: true, minWidth: 640, minHeight: 440, modulePath: '../apps/music.js', fnName: 'registerMusic' },
  { id: 'calendar', name: 'Calendar', icon: '📅', width: 800, height: 550, singleInstance: true, modulePath: '../apps/calendar.js', fnName: 'registerCalendar' },
  { id: 'appstore', name: 'App Store', icon: '🛍️', width: 800, height: 560, singleInstance: true, modulePath: '../apps/appstore.js', fnName: 'registerAppStore' },
  { id: 'photos', name: 'Photos', icon: '🖼️', width: 700, height: 500, singleInstance: true, modulePath: '../apps/photos.js', fnName: 'registerPhotos' },
  { id: 'weather', name: 'Weather', icon: '⛅', width: 380, height: 600, singleInstance: true, minWidth: 320, modulePath: '../apps/weather.js', fnName: 'registerWeather' },
  { id: 'clock', name: 'Clock', icon: '🕐', width: 400, height: 500, singleInstance: true, modulePath: '../apps/clock.js', fnName: 'registerClock' },
  { id: 'reminders', name: 'Reminders', icon: '✅', width: 600, height: 450, singleInstance: true, modulePath: '../apps/reminders.js', fnName: 'registerReminders' },
  { id: 'activity-monitor', name: 'Task Manager', icon: '📊', width: 860, height: 560, singleInstance: true, minWidth: 700, minHeight: 400, modulePath: '../apps/activity-monitor.js', fnName: 'registerActivityMonitor' },
  { id: 'vault', name: 'Vault', icon: '🔐', width: 820, height: 560, singleInstance: true, minWidth: 600, minHeight: 400, modulePath: '../apps/vault.js', fnName: 'registerVault' },
  { id: 'messages', name: 'Messages', icon: '💬', width: 820, height: 540, singleInstance: true, minWidth: 600, minHeight: 400, modulePath: '../apps/messages.js', fnName: 'registerMessages' },
  { id: 'screen-recorder', name: 'Screen Recorder', icon: '⏺️', width: 420, height: 360, singleInstance: true, modulePath: '../apps/screen-recorder.js', fnName: 'registerScreenRecorder' },
  { id: 'trash', name: 'Trash', icon: '🗑️', width: 640, height: 440, singleInstance: true, modulePath: '../apps/trash.js', fnName: 'registerTrash' },
  { id: 'installer', name: 'Install Astrion OS', icon: '💿', width: 560, height: 520, singleInstance: true, modulePath: '../apps/installer.js', fnName: 'registerInstaller' },
  { id: 'sticky-notes', name: 'Sticky Notes', icon: '🗂️', width: 700, height: 500, singleInstance: true, modulePath: '../apps/sticky-notes.js', fnName: 'registerStickyNotes' },
  { id: 'contacts', name: 'Contacts', icon: '👥', width: 750, height: 500, singleInstance: true, modulePath: '../apps/contacts.js', fnName: 'registerContacts' },
  { id: 'maps', name: 'Maps', icon: '🗺️', width: 850, height: 560, singleInstance: true, modulePath: '../apps/maps.js', fnName: 'registerMaps' },
  { id: 'voice-memos', name: 'Voice Memos', icon: '🎙️', width: 500, height: 520, singleInstance: true, modulePath: '../apps/voice-memos.js', fnName: 'registerVoiceMemos' },
  { id: 'pomodoro', name: 'Pomodoro', icon: '🍅', width: 380, height: 480, singleInstance: true, modulePath: '../apps/pomodoro.js', fnName: 'registerPomodoro' },
  { id: 'pdf-viewer', name: 'PDF Viewer', icon: '📄', width: 700, height: 560, modulePath: '../apps/pdf-viewer.js', fnName: 'registerPdfViewer' },
  { id: 'kanban', name: 'Kanban', icon: '📋', width: 900, height: 560, singleInstance: true, modulePath: '../apps/kanban.js', fnName: 'registerKanban' },
  { id: 'habit-tracker', name: 'Habits', icon: '✅', width: 560, height: 480, singleInstance: true, modulePath: '../apps/habit-tracker.js', fnName: 'registerHabitTracker' },
  { id: 'video-player', name: 'Video Player', icon: '▶️', width: 780, height: 520, modulePath: '../apps/video-player.js', fnName: 'registerVideoPlayer' },
  { id: 'system-info', name: 'System Info', icon: 'ℹ️', width: 600, height: 420, singleInstance: true, modulePath: '../apps/system-info.js', fnName: 'registerSystemInfo' },
  { id: 'translator', name: 'Translator', icon: '🌐', width: 650, height: 460, singleInstance: true, modulePath: '../apps/translator.js', fnName: 'registerTranslator' },
  { id: 'unit-converter', name: 'Converter', icon: '🔄', width: 420, height: 480, singleInstance: true, modulePath: '../apps/unit-converter.js', fnName: 'registerUnitConverter' },
  { id: 'color-picker', name: 'Color Picker', icon: '🎨', width: 380, height: 460, singleInstance: true, modulePath: '../apps/color-picker.js', fnName: 'registerColorPicker' },
  { id: 'stopwatch', name: 'Stopwatch', icon: '⏱️', width: 360, height: 420, singleInstance: true, modulePath: '../apps/stopwatch.js', fnName: 'registerStopwatch' },
  { id: 'timer', name: 'Timer', icon: '⏲️', width: 360, height: 400, singleInstance: true, modulePath: '../apps/timer.js', fnName: 'registerTimer' },
  { id: 'whiteboard', name: 'Whiteboard', icon: '📝', width: 800, height: 560, modulePath: '../apps/whiteboard.js', fnName: 'registerWhiteboard' },
  { id: 'password-gen', name: 'Password Gen', icon: '🔑', width: 420, height: 400, singleInstance: true, modulePath: '../apps/password-gen.js', fnName: 'registerPasswordGen' },
  { id: 'markdown', name: 'Markdown', icon: '📝', width: 800, height: 520, modulePath: '../apps/markdown.js', fnName: 'registerMarkdown' },
  { id: 'qr-code', name: 'QR Code', icon: '📲', width: 400, height: 460, singleInstance: true, modulePath: '../apps/qr-code.js', fnName: 'registerQrCode' },
  { id: 'dictionary', name: 'Dictionary', icon: '📖', width: 550, height: 480, singleInstance: true, modulePath: '../apps/dictionary.js', fnName: 'registerDictionary' },
  { id: 'journal', name: 'Journal', icon: '📓', width: 600, height: 500, singleInstance: true, modulePath: '../apps/journal.js', fnName: 'registerJournal' },
  { id: 'flashcards', name: 'Flashcards', icon: '🃏', width: 500, height: 440, singleInstance: true, modulePath: '../apps/flashcards.js', fnName: 'registerFlashcards' },
  { id: 'budget', name: 'Budget', icon: '💰', width: 560, height: 500, singleInstance: true, modulePath: '../apps/budget.js', fnName: 'registerBudget' },
  { id: 'typing-test', name: 'Typing Test', icon: '⌨️', width: 650, height: 440, singleInstance: true, modulePath: '../apps/typing-test.js', fnName: 'registerTypingTest' },
  { id: 'todo', name: 'Todo', icon: '☑️', width: 440, height: 500, singleInstance: true, modulePath: '../apps/todo.js', fnName: 'registerTodo' },
  { id: 'beat-studio', name: 'Beat Studio', icon: '🎹', width: 820, height: 520, singleInstance: true, modulePath: '../apps/beat-studio.js', fnName: 'registerBeatStudio' },
  { id: 'live-chat', name: 'Live Chat', icon: '📡', width: 500, height: 520, singleInstance: true, modulePath: '../apps/live-chat.js', fnName: 'registerLiveChat' },
  { id: 'youtube', name: 'YouTube', icon: '▶', width: 900, height: 600, singleInstance: true, minWidth: 600, minHeight: 400, modulePath: '../apps/youtube.js', fnName: 'registerYouTube' },
  { id: 'pixel-art', name: 'Pixel Art', icon: '🖼️', width: 580, height: 620, singleInstance: true, modulePath: '../apps/pixel-art.js', fnName: 'registerPixelArt' },
  { id: 'animate', name: 'Animate', icon: '🎬', width: 850, height: 580, singleInstance: true, modulePath: '../apps/animate.js', fnName: 'registerAnimate' },
  { id: 'video-editor', name: 'Video Editor', icon: '🎬', width: 960, height: 640, singleInstance: true, minWidth: 800, minHeight: 500, modulePath: '../apps/video-editor.js', fnName: 'registerVideoEditor' },
  { id: 'ai-art', name: 'AI Art', icon: '🎨', width: 700, height: 560, singleInstance: true, modulePath: '../apps/ai-art.js', fnName: 'registerAiArt' },
  { id: 'ai-writer', name: 'AI Writer', icon: '✍️', width: 750, height: 520, singleInstance: true, modulePath: '../apps/ai-writer.js', fnName: 'registerAiWriter' },
  { id: 'speed-test', name: 'Speed Test', icon: '⚡', width: 420, height: 500, singleInstance: true, modulePath: '../apps/speed-test.js', fnName: 'registerSpeedTest' },
  { id: 'recipe-book', name: 'Recipe Book', icon: '🍳', width: 520, height: 600, singleInstance: true, modulePath: '../apps/recipe-book.js', fnName: 'registerRecipeBook' },
  { id: 'meditation', name: 'Meditation', icon: '🧘', width: 380, height: 480, singleInstance: true, modulePath: '../apps/meditation.js', fnName: 'registerMeditation' },
  { id: 'countdown', name: 'Countdown', icon: '⏳', width: 420, height: 480, singleInstance: true, modulePath: '../apps/countdown.js', fnName: 'registerCountdown' },
  { id: 'color-palette', name: 'Color Palette', icon: '🎨', width: 440, height: 500, singleInstance: true, modulePath: '../apps/color-palette.js', fnName: 'registerColorPalette' },
  { id: 'bmi-calc', name: 'BMI Calculator', icon: '⚖️', width: 360, height: 440, singleInstance: true, modulePath: '../apps/bmi-calc.js', fnName: 'registerBmiCalc' },
  { id: 'adaptations', name: 'Adaptations', icon: '✨', width: 720, height: 560, singleInstance: true, minWidth: 540, minHeight: 420, modulePath: '../apps/adaptations.js', fnName: 'registerAdaptations' },
];

const _loadingPromises = new Map();

function paintLoadingState(contentEl, name) {
  contentEl.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px;color:rgba(255,255,255,0.55);font-size:13px;font-family:var(--font);background:#1a1a22;">
      <div style="font-size:28px;animation:app-stub-spin 1.2s linear infinite;">⏳</div>
      <div>Loading ${name}…</div>
      <style>@keyframes app-stub-spin { to { transform: rotate(360deg); } }</style>
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

function registerOne(entry) {
  const def = {
    name: entry.name,
    icon: entry.icon,
    width: entry.width,
    height: entry.height,
    launch: async (contentEl, instanceId, options) => {
      paintLoadingState(contentEl, entry.name);
      let loading = _loadingPromises.get(entry.id);
      if (!loading) {
        loading = (async () => {
          const mod = await import(/* @vite-ignore */ entry.modulePath);
          const fn = mod[entry.fnName];
          if (typeof fn !== 'function') {
            throw new Error(`${entry.modulePath} does not export ${entry.fnName}`);
          }
          fn();
        })();
        _loadingPromises.set(entry.id, loading);
      }
      try {
        await loading;
      } catch (err) {
        _loadingPromises.delete(entry.id);
        console.error(`[app-stubs] failed to load ${entry.id}:`, err);
        paintErrorState(contentEl, entry.name, err);
        return;
      }
      const real = processManager.getAppDefinition(entry.id);
      if (!real || typeof real.launch !== 'function') {
        paintErrorState(contentEl, entry.name, new Error('real launch missing after register'));
        return;
      }
      real.launch(contentEl, instanceId, options);
    },
  };
  if (entry.singleInstance) def.singleInstance = true;
  if (entry.minWidth) def.minWidth = entry.minWidth;
  if (entry.minHeight) def.minHeight = entry.minHeight;
  processManager.register(entry.id, def);
}

/**
 * Register every real app (60 entries) as a lazy-load stub. boot.js
 * calls this in place of the 60 individual registerX() calls.
 *
 * Settings stays eager in boot.js — boot.js imports applyWallpaper
 * and applyAccentColor from settings.js and calls them after the
 * shell mounts. Splitting those exports into a separate kernel/theme
 * module would let settings be lazy too, but is out of scope for
 * this commit.
 */
export function registerAllRealAppStubs() {
  for (const entry of APP_MANIFEST) {
    registerOne(entry);
  }
}

export { APP_MANIFEST };
