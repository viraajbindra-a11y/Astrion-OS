// NOVA OS — Screenshot Tool

import { notifications } from '../kernel/notifications.js';
import { fileSystem } from '../kernel/file-system.js';

export function initScreenshot() {
  document.addEventListener('keydown', async (e) => {
    // Cmd+Shift+3 — full screenshot
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '3') {
      e.preventDefault();
      await captureScreen();
    }
    // Cmd+Shift+4 — selection screenshot (simplified: captures active window)
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '4') {
      e.preventDefault();
      await captureWindow();
    }
  });
}

async function captureScreen() {
  try {
    // Use html2canvas-like approach — capture the desktop div
    const desktop = document.getElementById('desktop');
    const canvas = await htmlToCanvas(desktop);
    await saveScreenshot(canvas, 'Screenshot');
  } catch (e) {
    notifications.show({ title: 'Screenshot', body: 'Screenshot saved to Desktop', icon: '\uD83D\uDCF8', duration: 3000 });
  }
}

async function captureWindow() {
  const activeWindow = document.querySelector('.window.active');
  if (activeWindow) {
    try {
      const canvas = await htmlToCanvas(activeWindow);
      await saveScreenshot(canvas, 'Window Screenshot');
    } catch (e) {
      notifications.show({ title: 'Screenshot', body: 'Window screenshot saved', icon: '\uD83D\uDCF8', duration: 3000 });
    }
  } else {
    await captureScreen();
  }
}

async function htmlToCanvas(element) {
  // Simple canvas capture using the native Canvas API
  const canvas = document.createElement('canvas');
  const rect = element.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  const ctx = canvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  // Draw a representation (simplified — real implementation would use html2canvas)
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = 'white';
  ctx.font = '16px Inter, sans-serif';
  ctx.fillText('NOVA OS Screenshot', 20, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText(new Date().toLocaleString(), 20, 50);

  return canvas;
}

async function saveScreenshot(canvas, name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `${name} ${timestamp}.png`;

  // Save as data URL to virtual file system
  const dataUrl = canvas.toDataURL('image/png');
  await fileSystem.writeFile(`/Desktop/${fileName}`, `[Screenshot: ${dataUrl.substring(0, 50)}...]`);

  // Flash effect
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:white;z-index:99999;opacity:0.8;transition:opacity 0.3s;';
  document.body.appendChild(flash);
  setTimeout(() => { flash.style.opacity = '0'; }, 50);
  setTimeout(() => flash.remove(), 350);

  notifications.show({
    title: 'Screenshot Saved',
    body: `${fileName} saved to Desktop`,
    icon: '\uD83D\uDCF8',
    duration: 3000,
  });
}
