// NOVA OS — Web Browser App
// In Electron: uses a real Chromium BrowserView (loads ANY website)
// In web: falls back to iframe (limited)

import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';

export function registerBrowser() {
  processManager.register('browser', {
    name: 'Browser',
    icon: '\uD83C\uDF10',
    iconClass: 'dock-icon-browser',
    singleInstance: false,
    width: 900,
    height: 600,
    launch: (contentEl, instanceId, options) => {
      initBrowser(contentEl, instanceId, options);
    }
  });
}

function initBrowser(container, instanceId, options = {}) {
  let currentUrl = options.url || '';
  const isElectron = !!window.novaElectron?.browser;

  const bookmarks = [
    { name: 'Google', url: 'https://www.google.com', icon: '\uD83D\uDD0D' },
    { name: 'YouTube', url: 'https://www.youtube.com', icon: '\u25B6\uFE0F' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '\uD83D\uDCDA' },
    { name: 'GitHub', url: 'https://github.com', icon: '\uD83D\uDC31' },
    { name: 'Reddit', url: 'https://www.reddit.com', icon: '\uD83E\uDD16' },
    { name: 'Twitter', url: 'https://x.com', icon: '\uD83D\uDC26' },
  ];

  container.innerHTML = `
    <div class="browser-app">
      <div class="browser-toolbar">
        <button class="browser-nav-btn" id="brw-back-${instanceId}" title="Back">\u25C0</button>
        <button class="browser-nav-btn" id="brw-fwd-${instanceId}" title="Forward">\u25B6</button>
        <button class="browser-nav-btn" id="brw-reload-${instanceId}" title="Reload">\u21BB</button>
        <div class="browser-url-bar">
          <span class="browser-url-lock">\uD83D\uDD12</span>
          <input type="text" class="browser-url-input" id="brw-url-${instanceId}" placeholder="Search or enter URL..." value="${currentUrl}" spellcheck="false">
        </div>
        <button class="browser-nav-btn" id="brw-home-${instanceId}" title="Home">\uD83C\uDFE0</button>
        <button class="browser-nav-btn" id="brw-external-${instanceId}" title="Open in Firefox" style="font-size:11px; opacity:0.6;">\uD83E\uDD8A</button>
      </div>
      <div class="browser-viewport" id="brw-viewport-${instanceId}">
        <div class="browser-loading" id="brw-loading-${instanceId}">
          <div class="browser-loading-bar" id="brw-loading-bar-${instanceId}"></div>
        </div>
      </div>
    </div>
  `;

  const urlInput = container.querySelector(`#brw-url-${instanceId}`);
  const viewport = container.querySelector(`#brw-viewport-${instanceId}`);
  const loadingBar = container.querySelector(`#brw-loading-bar-${instanceId}`);

  // URL input
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      let url = urlInput.value.trim();
      if (!url) return;
      if (!url.match(/^https?:\/\//) && !url.includes('.')) {
        url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      } else if (!url.match(/^https?:\/\//)) {
        url = 'https://' + url;
      }
      navigate(url);
    }
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  // Nav buttons
  container.querySelector(`#brw-back-${instanceId}`).addEventListener('click', () => {
    if (isElectron) window.novaElectron.browser.back();
  });
  container.querySelector(`#brw-fwd-${instanceId}`).addEventListener('click', () => {
    if (isElectron) window.novaElectron.browser.forward();
  });
  container.querySelector(`#brw-reload-${instanceId}`).addEventListener('click', () => {
    if (isElectron) window.novaElectron.browser.reload();
    else {
      const iframe = viewport.querySelector('iframe');
      if (iframe) iframe.src = iframe.src;
    }
  });
  container.querySelector(`#brw-home-${instanceId}`).addEventListener('click', () => {
    if (isElectron) window.novaElectron.browser.close();
    showHome();
  });
  container.querySelector(`#brw-external-${instanceId}`).addEventListener('click', () => {
    if (currentUrl) {
      fetch('/api/browser/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: currentUrl }),
      });
    }
  });

  // Listen for title/url updates from Electron
  if (isElectron) {
    window.novaElectron.browser.onTitle((title) => {
      windowManager.setTitle(instanceId, title);
    });
    window.novaElectron.browser.onUrl((url) => {
      urlInput.value = url;
      currentUrl = url;
    });
  }

  function navigate(url) {
    currentUrl = url;
    urlInput.value = url;
    loadingBar.style.width = '50%';

    if (isElectron) {
      // Use REAL Chromium browser engine
      const rect = viewport.getBoundingClientRect();
      window.novaElectron.browser.navigate(url, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });

      // Clear the viewport (BrowserView renders on top)
      const old = viewport.querySelector('.browser-home, .browser-error');
      if (old) old.remove();

      setTimeout(() => { loadingBar.style.width = '100%'; }, 500);
      setTimeout(() => { loadingBar.style.width = '0%'; }, 800);

      windowManager.setTitle(instanceId, url.replace(/^https?:\/\//, '').split('/')[0]);

      // Update BrowserView bounds when window moves/resizes
      setupBrowserViewTracking(viewport);
    } else {
      const old = viewport.querySelector('.browser-home, .browser-error, iframe');
      if (old) old.remove();

      // Detect: running on ISO (has server) or web (GitHub Pages)?
      const hasServer = window.location.port === '3000' || window.__NOVA_NATIVE__;

      if (hasServer) {
        // ISO: try native browser, fall back to proxy
        fetch('/api/browser/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        }).then(r => r.json()).then(data => {
          if (data.ok) {
            loadingBar.style.width = '100%';
            setTimeout(() => { loadingBar.style.width = '0%'; }, 300);
          }
        }).catch(() => {});
      } else {
        // Web (GitHub Pages): direct iframe (some sites block this)
        const iframe = document.createElement('iframe');
        iframe.className = 'browser-iframe';
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
        iframe.src = url;
        iframe.onload = () => {
          loadingBar.style.width = '100%';
          setTimeout(() => { loadingBar.style.width = '0%'; }, 300);
        };
        iframe.onerror = () => {
          viewport.innerHTML = `<div class="browser-error" style="padding:40px;text-align:center;color:rgba(255,255,255,0.5);"><div style="font-size:48px;margin-bottom:12px;">\u26A0\uFE0F</div><div>This site can't be loaded in an iframe.</div><div style="margin-top:8px;"><a href="${url}" target="_blank" style="color:var(--accent);">Open in new tab</a></div></div>`;
        };
        viewport.appendChild(iframe);
      }

      windowManager.setTitle(instanceId, url.replace(/^https?:\/\//, '').split('/')[0]);
    }
  }

  // Listen for link clicks from within proxied pages (they postMessage us)
  const navHandler = (e) => {
    if (e.data?.type === 'nova-browser-nav' && e.data.url) {
      navigate(e.data.url);
    }
  };
  window.addEventListener('message', navHandler);

  // Cleanup when window closes
  const cleanup = () => window.removeEventListener('message', navHandler);
  container.addEventListener('DOMNodeRemoved', cleanup, { once: true });

  function setupBrowserViewTracking(viewport) {
    // Continuously update BrowserView position to match the window
    const update = () => {
      if (!document.contains(viewport)) {
        // Window was closed — cleanup BrowserView
        if (isElectron) window.novaElectron.browser.close();
        return;
      }
      const rect = viewport.getBoundingClientRect();
      if (isElectron && currentUrl) {
        window.novaElectron.browser.resize({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  function showHome() {
    currentUrl = '';
    urlInput.value = '';

    const old = viewport.querySelector('.browser-home, .browser-error, iframe');
    if (old) old.remove();

    const home = document.createElement('div');
    home.className = 'browser-home';
    home.innerHTML = `
      <div class="browser-home-logo">\uD83C\uDF10</div>
      <input type="text" class="browser-home-search" placeholder="Search Google or enter URL..." autofocus>
      <div class="browser-home-shortcuts">
        ${bookmarks.map(b => `
          <div class="browser-home-shortcut" data-url="${b.url}">
            <div class="browser-home-shortcut-icon">${b.icon}</div>
            ${b.name}
          </div>
        `).join('')}
      </div>
    `;

    home.querySelector('.browser-home-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) navigate(q.includes('.') ? (q.startsWith('http') ? q : 'https://' + q) : `https://www.google.com/search?q=${encodeURIComponent(q)}`);
      }
    });

    home.querySelectorAll('.browser-home-shortcut').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.url));
    });

    viewport.appendChild(home);
    windowManager.setTitle(instanceId, 'Browser');
  }

  // Show home page initially
  if (currentUrl) navigate(currentUrl);
  else showHome();
}
