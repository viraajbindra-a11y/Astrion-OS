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

// Boot sequence
(async function boot() {
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
  await animate(progressBar, 85, 200);

  // Init kernel
  windowManager.init();
  await animate(progressBar, 100, 300);

  // Phase 2: Transition to login screen
  await sleep(400);
  bootScreen.style.transition = 'opacity 0.5s ease';
  bootScreen.style.opacity = '0';
  await sleep(500);
  bootScreen.classList.add('hidden');

  // Show login screen
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

  // Phase 3: Transition to desktop
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

  // Desktop ready
  await sleep(300);

  // Show setup wizard on first boot
  await showSetupWizard();

  eventBus.emit('desktop:ready');

  // Welcome notification
  const userName = localStorage.getItem('nova-username') || 'User';
  notifications.show({
    title: `Welcome back, ${userName}!`,
    body: 'NOVA OS is ready. Press Cmd+Space for Spotlight, F4 for Launchpad.',
    icon: '\uD83D\uDC4B',
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
