// NOVA OS — Boot Sequence

// Patch localStorage first — prevents crashes on full storage / private browsing
import './lib/safe-storage.js';

import { eventBus } from './kernel/event-bus.js';
import { fileSystem } from './kernel/file-system.js';
import { graphStore } from './kernel/graph-store.js';
// M2.P2: side-effect import triggers graph-query's inline sanity tests
// on every localhost page load. Day 4 consumers import { query } directly.
import './kernel/graph-query.js';
import { migrateLocalStorageToGraph } from './kernel/graph-migration.js';
import { windowManager } from './kernel/window-manager.js';
import { processManager } from './kernel/process-manager.js';

// Intent Kernel (M1) — parser, capability providers, and step executor.
// Importing capability-providers.js registers all 13 core capabilities
// as a side effect. initIntentExecutor() wires the executor to the
// `intent:execute` event bus channel.
import './kernel/capability-providers.js';
import { initIntentExecutor } from './kernel/intent-executor.js';
// Agent Core Sprint — context surfaces + conversation memory for the planner.
import { initContextBundle } from './kernel/context-bundle.js';
import { initConversationMemory } from './kernel/conversation-memory.js';
import { initCalibrationTracker } from './kernel/calibration-tracker.js';
import { initMenubar } from './shell/menubar.js';
import { initDock } from './shell/dock.js';
import { initDesktop } from './shell/desktop.js';
import { initSpotlight } from './shell/spotlight.js';
import { initShortcutsOverlay } from './shell/shortcuts-overlay.js';
import { registerFinder } from './apps/finder.js';
import { registerNotes } from './apps/notes.js';
import { registerTerminal } from './apps/terminal.js';
import { registerCalculator } from './apps/calculator.js';
import { registerSettings, applyWallpaper, applyAccentColor } from './apps/settings.js';
import { registerTextEditor } from './apps/text-editor.js';
import { registerDraw } from './apps/draw.js';
import { registerBrowser } from './apps/browser.js';
import { registerMusic } from './apps/music.js';
import { registerCalendar } from './apps/calendar.js';
import { registerAppStore } from './apps/appstore.js';
import { showSetupWizard } from './shell/setup-wizard.js';
import { notifications } from './kernel/notifications.js';
import { initControlCenter } from './shell/control-center.js';
import { initLaunchpad } from './shell/launchpad.js';
import { registerPhotos } from './apps/photos.js';
import { initShortcuts } from './shell/shortcuts.js';
import { registerWeather } from './apps/weather.js';
import { registerClock } from './apps/clock.js';
import { registerReminders } from './apps/reminders.js';
import { registerActivityMonitor } from './apps/activity-monitor.js';
import { initLockScreen } from './shell/lock-screen.js';
import { initScreenshot } from './shell/screenshot.js';
import { appInstaller } from './kernel/app-installer.js';
import { initMissionControl } from './shell/mission-control.js';
import { initAppSwitcher } from './shell/app-switcher.js';
import { initEmojiPicker } from './shell/emoji-picker.js';
import { initWidgets } from './shell/widgets.js';
import { initHotCorners } from './shell/hot-corners.js';
import { initQuickLook } from './shell/quick-look.js';
import { initClipboardManager } from './shell/clipboard-manager.js';
import { initSpaces } from './shell/spaces.js';
import { initNightShift } from './shell/night-shift.js';
import { initFocusMode } from './shell/focus-mode.js';
import { initIdleLock } from './shell/idle-lock.js';
import { initRecentApps } from './shell/recent-apps.js';
import { initSelectionInfo } from './shell/selection-info.js';
import { registerVault } from './apps/vault.js';
import { registerMessages } from './apps/messages.js';
import { initScreensaver } from './shell/screensaver.js';
import { registerScreenRecorder } from './apps/screen-recorder.js';
import { registerTrash } from './apps/trash.js';
import { registerInstaller } from './apps/installer.js';
import { registerStickyNotes } from './apps/sticky-notes.js';
import { registerContacts } from './apps/contacts.js';
import { registerMaps } from './apps/maps.js';
import { registerVoiceMemos } from './apps/voice-memos.js';
import { registerPomodoro } from './apps/pomodoro.js';
import { registerPdfViewer } from './apps/pdf-viewer.js';
import { registerKanban } from './apps/kanban.js';
import { registerHabitTracker } from './apps/habit-tracker.js';
import { registerVideoPlayer } from './apps/video-player.js';
import { registerSystemInfo } from './apps/system-info.js';
import { registerTranslator } from './apps/translator.js';
import { registerUnitConverter } from './apps/unit-converter.js';
import { registerColorPicker } from './apps/color-picker.js';
import { registerStopwatch } from './apps/stopwatch.js';
import { registerTimer } from './apps/timer.js';
import { registerWhiteboard } from './apps/whiteboard.js';
import { registerPasswordGen } from './apps/password-gen.js';
import { registerMarkdown } from './apps/markdown.js';
import { registerQrCode } from './apps/qr-code.js';
import { registerDictionary } from './apps/dictionary.js';
import { registerJournal } from './apps/journal.js';
import { registerFlashcards } from './apps/flashcards.js';
import { registerChess } from './apps/chess.js';
import { registerSnake } from './apps/snake.js';
import { register2048 } from './apps/2048.js';
import { registerBudget } from './apps/budget.js';
import { registerQuotes } from './apps/quotes.js';
import { registerTypingTest } from './apps/typing-test.js';
import { registerTodo } from './apps/todo.js';
import { registerBeatStudio } from './apps/beat-studio.js';
import { registerLiveChat } from './apps/live-chat.js';
import { registerYouTube } from './apps/youtube.js';
import { registerPixelArt } from './apps/pixel-art.js';
import { registerAnimate } from './apps/animate.js';
import { registerVideoEditor } from './apps/video-editor.js';
import { registerAiArt } from './apps/ai-art.js';
import { registerTetris } from './apps/tetris.js';
import { registerMinesweeper } from './apps/minesweeper.js';
import { registerMatrixRain } from './apps/matrix-rain.js';
import { registerNeonVoid } from './apps/neon-void.js';
import { verifyPassword } from './kernel/crypto.js';
import { sounds } from './kernel/sound.js';
import { initVolumeHud } from './shell/volume-hud.js';

// Boot sequence
(async function boot() {
  // ─── Native App Mode ───
  // When running inside nova-shell (our C renderer), each app opens in its own
  // native GTK window. The server sends a page with __NOVA_LAUNCH_APP__ set.
  // We skip the full desktop boot and just launch that one app.
  if (window.__NOVA_NATIVE__ && window.__NOVA_LAUNCH_APP__) {
    console.log(`[NOVA Native] Launching app: ${window.__NOVA_LAUNCH_APP__}`);
    await fileSystem.init();
    await graphStore.init();
    await migrateLocalStorageToGraph();

    // Register ALL 52 apps so any of them can launch in native mode.
    // M0.P3: was previously only registering the first 16 — which meant
    // launching Chess, Kanban, Beat Studio, etc. from nova-shell failed
    // silently because processManager didn't know about them.
    registerFinder(); registerNotes(); registerTerminal();
    registerCalculator(); registerSettings(); registerTextEditor();
    registerDraw(); registerBrowser(); registerMusic();
    registerCalendar(); registerAppStore(); registerPhotos();
    registerWeather(); registerClock(); registerReminders();
    registerActivityMonitor();
    registerVault(); registerMessages(); registerScreenRecorder();
    registerTrash(); registerInstaller(); registerStickyNotes();
    registerContacts(); registerMaps(); registerVoiceMemos();
    registerPomodoro(); registerPdfViewer(); registerKanban();
    registerHabitTracker(); registerVideoPlayer(); registerSystemInfo();
    registerTranslator(); registerUnitConverter(); registerColorPicker();
    registerStopwatch(); registerTimer(); registerWhiteboard();
    registerPasswordGen(); registerMarkdown(); registerQrCode();
    registerDictionary(); registerJournal(); registerFlashcards();
    registerChess(); registerSnake(); register2048();
    registerBudget(); registerQuotes(); registerTypingTest();
    registerTodo(); registerBeatStudio(); registerLiveChat();
    registerYouTube(); registerPixelArt(); registerTetris();
    registerMinesweeper(); registerMatrixRain(); registerNeonVoid();
    registerAnimate();
    registerVideoEditor();
    registerAiArt();

    windowManager.init();

    // Wire the Intent Kernel in native mode too — apps launched from
    // nova-shell can still emit `intent:execute` and the executor will
    // respond. This is how native Search passes intents into Astrion.
    initIntentExecutor();
    initContextBundle();
    initConversationMemory();
    initCalibrationTracker();

    // Phase 0: kill mock provider trap in native path too (lesson #72)
    if (localStorage.getItem('nova-ai-provider') === 'mock') {
      localStorage.removeItem('nova-ai-provider');
    }

    // Launch the requested app directly (no boot screen, no login)
    processManager.launch(window.__NOVA_LAUNCH_APP__);
    console.log(`[NOVA Native] App ${window.__NOVA_LAUNCH_APP__} launched.`);
    return;
  }

  const bootScreen = document.getElementById('boot-screen');
  const loginScreen = document.getElementById('login-screen');
  const desktop = document.getElementById('desktop');
  const progressBar = bootScreen.querySelector('.boot-progress-bar');

  // Phase 1: Boot animation
  await animate(progressBar, 30, 400);

  // Init file system + hypergraph store (M2.P1) + run one-shot migration (M2.P3)
  await fileSystem.init();
  await graphStore.init();
  await migrateLocalStorageToGraph();
  await animate(progressBar, 60, 300);

  // Register all apps
  registerFinder();
  registerNotes();
  registerTerminal();
  registerCalculator();
  registerSettings();
  registerTextEditor();
  registerDraw();
  registerBrowser();
  registerMusic();
  registerCalendar();
  registerAppStore();
  registerPhotos();
  registerWeather();
  registerClock();
  registerReminders();
  registerActivityMonitor();
  registerVault();
  registerMessages();
  registerScreenRecorder();
  registerTrash();
  registerInstaller();
  registerStickyNotes();
  registerContacts();
  registerMaps();
  registerVoiceMemos();
  registerPomodoro();
  registerPdfViewer();
  registerKanban();
  registerHabitTracker();
  registerVideoPlayer();
  registerSystemInfo();
  registerTranslator();
  registerUnitConverter();
  registerColorPicker();
  registerStopwatch();
  registerTimer();
  registerWhiteboard();
  registerPasswordGen();
  registerMarkdown();
  registerQrCode();
  registerDictionary();
  registerJournal();
  registerFlashcards();
  registerChess();
  registerSnake();
  register2048();
  registerBudget();
  registerQuotes();
  registerTypingTest();
  registerTodo();
  registerBeatStudio();
  registerLiveChat();
  registerYouTube();
  registerPixelArt();
  registerTetris();
  registerMinesweeper();
  registerMatrixRain();
  registerNeonVoid();
  registerAnimate();
  registerVideoEditor();
  registerAiArt();
  await animate(progressBar, 85, 200);

  // Init kernel
  windowManager.init();
  await animate(progressBar, 100, 300);

  // Phase 2: Fade out boot screen
  await sleep(400);
  bootScreen.style.transition = 'opacity 0.5s ease';
  bootScreen.style.opacity = '0';
  await sleep(500);
  bootScreen.classList.add('hidden');

  // Phase 2.5: If first boot, show setup wizard BEFORE login
  const isFirstBoot = !localStorage.getItem('nova-setup-done');
  if (isFirstBoot) {
    // Show desktop behind wizard (so wallpaper applies live)
    desktop.classList.remove('hidden');
    desktop.style.opacity = '1';
    applyWallpaper();
    applyAccentColor();

    await showSetupWizard();

    // After wizard, apply chosen preferences
    applyWallpaper();
    applyAccentColor();
    desktop.classList.add('hidden');
  }

  // Phase 3: Login screen
  loginScreen.classList.remove('hidden');
  loginScreen.style.opacity = '0';
  loginScreen.style.transition = 'opacity 0.6s ease';
  requestAnimationFrame(() => { loginScreen.style.opacity = '1'; });
  updateLoginClock();
  const loginClockTimer = setInterval(updateLoginClock, 1000);

  // Show saved username
  const savedName = localStorage.getItem('nova-username');
  if (savedName) {
    document.querySelector('.login-name').textContent = savedName;
  }

  // Wait for login — verify password against stored PBKDF2 hash
  const passwordInput = document.getElementById('login-password');
  passwordInput.focus();

  const storedHash = localStorage.getItem('nova-password-hash');

  await new Promise(resolve => {
    let failedAttempts = 0;

    const login = async () => {
      // No password set — any click/enter lets you in
      if (!storedHash) { resolve(); return; }

      const pw = passwordInput.value;
      if (!pw) {
        passwordInput.focus();
        passwordInput.animate(
          [{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }],
          { duration: 200, iterations: 1 }
        );
        return;
      }

      const ok = await verifyPassword(pw, storedHash);
      if (ok) {
        resolve();
      } else {
        failedAttempts++;
        passwordInput.value = '';
        passwordInput.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
          { duration: 400, iterations: 1 }
        );

        // Lock out after 5 failed attempts — 10s delay
        if (failedAttempts >= 5) {
          passwordInput.disabled = true;
          let secs = 10;
          const timer = setInterval(() => {
            passwordInput.placeholder = `Locked — try again in ${secs}s`;
            secs--;
            if (secs < 0) {
              clearInterval(timer);
              passwordInput.disabled = false;
              passwordInput.placeholder = 'Password';
              failedAttempts = 0;
              passwordInput.focus();
            }
          }, 1000);
        }
      }
    };

    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') login();
    });
    loginScreen.addEventListener('click', (e) => {
      if (e.target.closest('.login-input-wrap')) return;
      // Click outside the input only logs in if no password is set
      if (!storedHash) resolve();
    });
  });

  // Phase 4: Transition to desktop
  loginScreen.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  loginScreen.style.opacity = '0';
  loginScreen.style.transform = 'scale(1.05)';
  await sleep(500);
  loginScreen.classList.add('hidden');
  clearInterval(loginClockTimer);

  // Show desktop
  desktop.classList.remove('hidden');
  desktop.style.opacity = '0';
  desktop.style.transition = 'opacity 0.5s ease';
  requestAnimationFrame(() => { desktop.style.opacity = '1'; });

  // Apply saved preferences
  applyWallpaper();
  applyAccentColor();


  // Init shell
  initMenubar();
  initDock();
  initDesktop();
  initSpotlight();
  initShortcutsOverlay();
  initIntentExecutor();
  initContextBundle();
  // Agent Core Sprint follow-up: the original sprint commit only wired
  // initConversationMemory() into the native branch. The init itself is a
  // no-op today, but the retrospective claimed "both branches" and that
  // was false. Kept symmetric so the web preview + native shell behave
  // identically.
  initConversationMemory();
  initCalibrationTracker();

  // Phase 0: kill mock provider trap permanently (lesson #72).
  // If a prior Settings test left provider='mock', every AI path silently
  // falls to _mockResponse and nothing works.
  if (localStorage.getItem('nova-ai-provider') === 'mock') {
    localStorage.removeItem('nova-ai-provider');
  }

  initControlCenter();
  initLaunchpad();
  notifications.init();
  initShortcuts();
  initLockScreen();
  initScreenshot();
  appInstaller.loadInstalled();

  // ─── Phase 1+ features (Overview, App Switcher, etc.) ───
  initMissionControl();
  initAppSwitcher();
  initEmojiPicker();
  initHotCorners();
  initQuickLook();
  initWidgets();
  initScreensaver();
  initClipboardManager();
  initSpaces();
  initNightShift();
  initFocusMode();
  initIdleLock();
  initRecentApps();
  initSelectionInfo();
  initVolumeHud();

  // Boot chime (disabled — users found it annoying)
  // setTimeout(() => sounds.boot(), 100);

  // Desktop ready
  await sleep(300);
  eventBus.emit('desktop:ready');

  // Welcome notification
  const userName = localStorage.getItem('nova-username') || 'User';
  const appCount = processManager.getAllApps().length;
  const welcomeMsg = isFirstBoot
    ? `Welcome to Astrion OS! ${appCount} apps ready. Press Cmd+Space for Search.`
    : `Astrion OS is ready. ${appCount} apps loaded.`;
  notifications.show({
    title: isFirstBoot ? `Welcome, ${userName}!` : `Welcome back, ${userName}!`,
    body: welcomeMsg,
    icon: isFirstBoot ? '\uD83D\uDE80' : '\uD83D\uDC4B',
    duration: 5000,
  });

  console.log('Astrion OS booted successfully.');
})();

function animate(bar, targetWidth, duration) {
  return new Promise(resolve => {
    bar.style.transition = `width ${duration}ms ease`;
    bar.style.width = targetWidth + '%';
    setTimeout(resolve, duration);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateLoginClock() {
  const now = new Date();
  const timeEl = document.getElementById('login-time');
  const dateEl = document.getElementById('login-date');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }
}
