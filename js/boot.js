// NOVA OS — Boot Sequence

import { eventBus } from './kernel/event-bus.js';
import { fileSystem } from './kernel/file-system.js';
import { windowManager } from './kernel/window-manager.js';
import { processManager } from './kernel/process-manager.js';
import { initMenubar } from './shell/menubar.js';
import { initDock } from './shell/dock.js';
import { initDesktop } from './shell/desktop.js';
import { initSpotlight } from './shell/spotlight.js';
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

// Boot sequence
(async function boot() {
  // ─── Native App Mode ───
  // When running inside nova-shell (our C renderer), each app opens in its own
  // native GTK window. The server sends a page with __NOVA_LAUNCH_APP__ set.
  // We skip the full desktop boot and just launch that one app.
  if (window.__NOVA_NATIVE__ && window.__NOVA_LAUNCH_APP__) {
    console.log(`[NOVA Native] Launching app: ${window.__NOVA_LAUNCH_APP__}`);
    await fileSystem.init();

    // Register all apps
    registerFinder(); registerNotes(); registerTerminal();
    registerCalculator(); registerSettings(); registerTextEditor();
    registerDraw(); registerBrowser(); registerMusic();
    registerCalendar(); registerAppStore(); registerPhotos();
    registerWeather(); registerClock(); registerReminders();
    registerActivityMonitor();

    windowManager.init();

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

  // Init file system
  await fileSystem.init();
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
  setInterval(updateLoginClock, 1000);

  // Show saved username
  const savedName = localStorage.getItem('nova-username');
  if (savedName) {
    document.querySelector('.login-name').textContent = savedName;
  }

  // Wait for login
  const passwordInput = document.getElementById('login-password');
  passwordInput.focus();

  await new Promise(resolve => {
    const login = () => {
      resolve();
    };
    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') login();
    });
    loginScreen.addEventListener('click', (e) => {
      if (!e.target.closest('.login-input-wrap')) login();
    });
  });

  // Phase 4: Transition to desktop
  loginScreen.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  loginScreen.style.opacity = '0';
  loginScreen.style.transform = 'scale(1.05)';
  await sleep(500);
  loginScreen.classList.add('hidden');

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
  initControlCenter();
  initLaunchpad();
  notifications.init();
  initShortcuts();
  initLockScreen();
  initScreenshot();
  appInstaller.loadInstalled();

  // Desktop ready
  await sleep(300);
  eventBus.emit('desktop:ready');

  // Welcome notification
  const userName = localStorage.getItem('nova-username') || 'User';
  const welcomeMsg = isFirstBoot
    ? 'Welcome to NOVA OS! Press Cmd+Space for Spotlight, F4 for Launchpad.'
    : 'NOVA OS is ready. Press Cmd+Space for Spotlight, F4 for Launchpad.';
  notifications.show({
    title: isFirstBoot ? `Welcome, ${userName}!` : `Welcome back, ${userName}!`,
    body: welcomeMsg,
    icon: isFirstBoot ? '\uD83D\uDE80' : '\uD83D\uDC4B',
    duration: 5000,
  });

  console.log('NOVA OS booted successfully.');
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
