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
  let currentUrl = options.url || options.initialUrl || '';
  const isElectron = !!window.novaElectron?.browser;

  // History stack for web mode (Electron handles its own)
  const historyStack = [];
  let historyIndex = -1;

  const DEFAULT_BOOKMARKS = [
    { name: 'Google', url: 'https://www.google.com', icon: '\uD83D\uDD0D' },
    { name: 'YouTube', url: 'https://www.youtube.com', icon: '\u25B6\uFE0F' },
    { name: 'Wikipedia', url: 'https://en.wikipedia.org', icon: '\uD83D\uDCDA' },
    { name: 'GitHub', url: 'https://github.com', icon: '\uD83D\uDC31' },
    { name: 'Reddit', url: 'https://www.reddit.com', icon: '\uD83E\uDD16' },
    { name: 'Twitter', url: 'https://x.com', icon: '\uD83D\uDC26' },
  ];
  let bookmarks;
  try { bookmarks = JSON.parse(localStorage.getItem('nova-browser-bookmarks')) || [...DEFAULT_BOOKMARKS]; }
  catch { bookmarks = [...DEFAULT_BOOKMARKS]; }

  function saveBookmarks() {
    try { localStorage.setItem('nova-browser-bookmarks', JSON.stringify(bookmarks)); } catch {}
  }

  function addBookmark(name, url) {
    if (bookmarks.some(b => b.url === url)) return; // already bookmarked
    const icon = url.includes('youtube') ? '\u25B6\uFE0F' : url.includes('github') ? '\uD83D\uDC31' : url.includes('reddit') ? '\uD83D\uDCAC' : url.includes('wikipedia') ? '\uD83D\uDCDA' : '\uD83C\uDF10';
    bookmarks.push({ name: name || new URL(url).hostname, url, icon });
    saveBookmarks();
  }

  function removeBookmark(url) {
    const idx = bookmarks.findIndex(b => b.url === url);
    if (idx >= 0) { bookmarks.splice(idx, 1); saveBookmarks(); }
  }

  function isBookmarked(url) {
    return bookmarks.some(b => b.url === url);
  }

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
        <button class="browser-nav-btn" id="brw-bookmark-${instanceId}" title="Bookmark this page" style="font-size:14px;">☆</button>
        <button class="browser-nav-btn" id="brw-home-${instanceId}" title="Home">\uD83C\uDFE0</button>
        <button class="browser-nav-btn" id="brw-external-${instanceId}" title="Open in new tab" style="font-size:11px; opacity:0.6;">↗</button>
      </div>
      <div class="browser-tab-bar" id="brw-tabs-${instanceId}" style="
        display:flex; align-items:center; gap:2px; padding:0 8px; height:32px;
        background:rgba(0,0,0,0.15); border-bottom:1px solid rgba(255,255,255,0.04); flex-shrink:0;
      ">
        <div class="browser-tab active" id="brw-tab-${instanceId}" style="
          display:flex; align-items:center; gap:6px; padding:5px 14px; border-radius:8px 8px 0 0;
          background:rgba(255,255,255,0.06); font-size:11px; color:rgba(255,255,255,0.8);
          max-width:220px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;
        ">
          <span id="brw-tab-favicon-${instanceId}" style="font-size:12px;">\uD83C\uDF10</span>
          <span id="brw-tab-title-${instanceId}">New Tab</span>
        </div>
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
        url = `search.html?q=${encodeURIComponent(url)}`;
      } else if (!url.match(/^https?:\/\//)) {
        url = 'https://' + url;
      }
      navigate(url);
    }
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  // Nav buttons
  container.querySelector(`#brw-back-${instanceId}`).addEventListener('click', () => {
    if (isElectron) { window.novaElectron.browser.back(); return; }
    if (historyIndex > 0) {
      historyIndex--;
      navigateNoHistory(historyStack[historyIndex]);
    }
  });
  container.querySelector(`#brw-fwd-${instanceId}`).addEventListener('click', () => {
    if (isElectron) { window.novaElectron.browser.forward(); return; }
    if (historyIndex < historyStack.length - 1) {
      historyIndex++;
      navigateNoHistory(historyStack[historyIndex]);
    }
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

  // Bookmark button — toggle bookmark for current page
  const bookmarkBtn = container.querySelector(`#brw-bookmark-${instanceId}`);
  function updateBookmarkBtn() {
    if (currentUrl && isBookmarked(currentUrl)) {
      bookmarkBtn.textContent = '★';
      bookmarkBtn.title = 'Remove bookmark';
      bookmarkBtn.style.color = '#ffd60a';
    } else {
      bookmarkBtn.textContent = '☆';
      bookmarkBtn.title = 'Bookmark this page';
      bookmarkBtn.style.color = '';
    }
  }
  bookmarkBtn.addEventListener('click', () => {
    if (!currentUrl) return;
    if (isBookmarked(currentUrl)) {
      removeBookmark(currentUrl);
    } else {
      const domain = currentUrl.replace(/^https?:\/\//, '').split('/')[0];
      addBookmark(domain, currentUrl);
    }
    updateBookmarkBtn();
  });

  container.querySelector(`#brw-external-${instanceId}`).addEventListener('click', () => {
    if (currentUrl) {
      // Open in actual browser tab
      window.open(currentUrl, '_blank');
    }
  });

  // Listen for title/url updates from Electron
  if (isElectron) {
    window.novaElectron.browser.onTitle((title) => {
      updateTab(title, currentUrl);
    });
    window.novaElectron.browser.onUrl((url) => {
      urlInput.value = url;
      currentUrl = url;
    });
  }

  const tabTitle = container.querySelector(`#brw-tab-title-${instanceId}`);
  const tabFavicon = container.querySelector(`#brw-tab-favicon-${instanceId}`);

  function updateTab(title, url) {
    const domain = url.replace(/^https?:\/\//, '').split('/')[0];
    const displayTitle = title || domain || 'New Tab';
    if (tabTitle) tabTitle.textContent = displayTitle;
    windowManager.setTitle(instanceId, displayTitle);
    // Try to set a fitting emoji for the favicon
    if (domain.includes('google')) { if (tabFavicon) tabFavicon.textContent = '\uD83D\uDD0D'; }
    else if (domain.includes('youtube')) { if (tabFavicon) tabFavicon.textContent = '\u25B6\uFE0F'; }
    else if (domain.includes('github')) { if (tabFavicon) tabFavicon.textContent = '\uD83D\uDC31'; }
    else if (domain.includes('reddit')) { if (tabFavicon) tabFavicon.textContent = '\uD83D\uDCAC'; }
    else if (domain.includes('wikipedia')) { if (tabFavicon) tabFavicon.textContent = '\uD83D\uDCDA'; }
    else if (domain.includes('twitter') || domain.includes('x.com')) { if (tabFavicon) tabFavicon.textContent = '\uD83D\uDC26'; }
    else if (url.includes('search.html')) { if (tabFavicon) tabFavicon.textContent = '\uD83D\uDD0D'; }
    else { if (tabFavicon) tabFavicon.textContent = '\uD83C\uDF10'; }
  }

  let _skipHistory = false;

  /** Navigate without adding to history (used by back/forward) */
  function navigateNoHistory(url) {
    _skipHistory = true;
    navigate(url);
    _skipHistory = false;
  }

  function navigate(url) {
    // Clean up proxy URLs — extract the real URL if someone passed a proxy link
    if (url.includes('/api/proxy?url=')) {
      try { url = decodeURIComponent(url.split('/api/proxy?url=')[1]); } catch {}
    }
    if (url.includes('api.allorigins.win/raw?url=')) {
      try { url = decodeURIComponent(url.split('api.allorigins.win/raw?url=')[1]); } catch {}
    }

    // Push to history stack (trim forward history on new navigation)
    if (!isElectron && !_skipHistory) {
      if (historyIndex < historyStack.length - 1) {
        historyStack.splice(historyIndex + 1);
      }
      historyStack.push(url);
      historyIndex = historyStack.length - 1;
    }

    currentUrl = url;
    urlInput.value = url;
    loadingBar.style.width = '50%';
    updateTab(null, url);
    updateBookmarkBtn();

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

      // Update BrowserView bounds when window moves/resizes
      setupBrowserViewTracking(viewport);
    } else {
      const old = viewport.querySelector('.browser-home, .browser-error, iframe');
      if (old) old.remove();

      // Heavy JS-dependent sites break through proxy — use embedded YouTube
      // player for YouTube, open other heavy sites with a notice
      const EMBED_YOUTUBE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;
      const ytMatch = url.match(EMBED_YOUTUBE);
      if (ytMatch) {
        // Embed YouTube via their official embed player (works in iframes)
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:none;';
        iframe.src = `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
        iframe.allow = 'autoplay; encrypted-media';
        iframe.allowFullscreen = true;
        viewport.appendChild(iframe);
        loadingBar.style.width = '100%';
        setTimeout(() => { loadingBar.style.width = '0%'; }, 500);
        return;
      }

      // Detect: running with Express server (localhost:3000 / ISO)?
      const hasServer = window.location.port === '3000' || window.__NOVA_NATIVE__;

      // For local pages (search.html, etc.), load directly without proxy
      const isLocalPage = !url.startsWith('http://') && !url.startsWith('https://');

      const iframe = document.createElement('iframe');
      iframe.className = 'browser-iframe';
      iframe.style.cssText = 'width:100%;height:100%;border:none;background:white;';

      if (isLocalPage) {
        // Local Astrion page — load directly
        iframe.src = url;
      } else if (hasServer) {
        // Route through our server proxy — strips X-Frame-Options/CSP
        iframe.src = `/api/proxy?url=${encodeURIComponent(url)}`;
      } else {
        // GitHub Pages fallback — use allorigins.win as public CORS proxy
        iframe.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      }

      iframe.onload = () => {
        loadingBar.style.width = '100%';
        setTimeout(() => { loadingBar.style.width = '0%'; }, 300);

        // Try to intercept link clicks inside proxied pages
        try {
          const doc = iframe.contentDocument;
          if (doc) {
            doc.addEventListener('click', (e) => {
              const a = e.target.closest('a');
              if (a && a.href) {
                const href = a.href;
                // If the link goes through our proxy, extract the real URL
                if (href.includes('/api/proxy?url=')) {
                  e.preventDefault();
                  const realUrl = decodeURIComponent(href.split('/api/proxy?url=')[1]);
                  navigate(realUrl);
                } else if (href.startsWith('http') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  navigate(href);
                }
              }
            }, true);
          }
        } catch {
          // Cross-origin — proxy links already rewritten server-side
        }
      };

      iframe.onerror = () => showBlockedPage(url);
      viewport.appendChild(iframe);

      // Timeout fallback — if nothing loaded after 10s, show error
      setTimeout(() => {
        try {
          const doc = iframe.contentDocument;
          if (!doc || !doc.body || doc.body.innerHTML === '') {
            showBlockedPage(url);
          }
        } catch {
          // Cross-origin frame from proxy — this is fine, page loaded
        }
      }, 10000);
    }
  }

  function showBlockedPage(blockedUrl) {
    const old = viewport.querySelector('iframe');
    if (old) old.remove();
    viewport.innerHTML = `
      <div class="browser-error" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px;text-align:center;color:rgba(255,255,255,0.6);">
        <div style="font-size:48px;margin-bottom:16px;">\uD83D\uDD12</div>
        <div style="font-size:16px;font-weight:600;color:white;margin-bottom:8px;">This site can't be displayed here</div>
        <div style="font-size:13px;max-width:400px;margin-bottom:20px;line-height:1.5;">Most websites block being loaded inside other apps. Click below to open it in a new browser tab.</div>
        <a href="${blockedUrl}" target="_blank" style="padding:10px 24px;background:var(--accent);color:white;text-decoration:none;border-radius:10px;font-size:13px;font-weight:500;">Open in Browser Tab</a>
        <div style="font-size:11px;color:rgba(255,255,255,0.3);margin-top:16px;">On the Astrion OS ISO, the native Astrion Browser handles this automatically.</div>
      </div>`;
  }

  // Listen for link clicks from within proxied pages (they postMessage us)
  const navHandler = (e) => {
    if (e.data?.type === 'nova-browser-nav' && e.data.url) {
      navigate(e.data.url);
    }
  };
  window.addEventListener('message', navHandler);

  // Cleanup when window closes — use MutationObserver (DOMNodeRemoved is deprecated)
  const _browserObserver = new MutationObserver(() => {
    if (!container.isConnected) {
      window.removeEventListener('message', navHandler);
      _browserObserver.disconnect();
    }
  });
  if (container.parentElement) {
    _browserObserver.observe(container.parentElement, { childList: true, subtree: true });
  }

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
        if (q) navigate(q.includes('.') ? (q.startsWith('http') ? q : 'https://' + q) : `search.html?q=${encodeURIComponent(q)}`);
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
