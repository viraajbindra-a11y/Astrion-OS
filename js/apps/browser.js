// NOVA OS — Web Browser App (Multi-Tab)
// In Electron: uses a real Chromium BrowserView (loads ANY website)
// In web: falls back to iframe with server proxy

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
  const isElectron = !!window.novaElectron?.browser;
  const MAX_TABS = 8;

  // ── Bookmarks ──
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
    if (bookmarks.some(b => b.url === url)) return;
    const icon = getFaviconEmoji(url);
    bookmarks.push({ name: name || getDomain(url), url, icon });
    saveBookmarks();
  }
  function removeBookmark(url) {
    const idx = bookmarks.findIndex(b => b.url === url);
    if (idx >= 0) { bookmarks.splice(idx, 1); saveBookmarks(); }
  }
  function isBookmarked(url) { return bookmarks.some(b => b.url === url); }

  // ── Helpers ──
  function getDomain(url) {
    try { return url.replace(/^https?:\/\//, '').split('/')[0]; } catch { return url; }
  }
  function getFaviconEmoji(url) {
    const d = getDomain(url);
    if (d.includes('google')) return '\uD83D\uDD0D';
    if (d.includes('youtube')) return '\u25B6\uFE0F';
    if (d.includes('github')) return '\uD83D\uDC31';
    if (d.includes('reddit')) return '\uD83D\uDCAC';
    if (d.includes('wikipedia')) return '\uD83D\uDCDA';
    if (d.includes('twitter') || d.includes('x.com')) return '\uD83D\uDC26';
    if (d.includes('amazon')) return '\uD83D\uDED2';
    if (d.includes('stackoverflow')) return '\uD83D\uDCBB';
    if (d.includes('twitch')) return '\uD83D\uDFE3';
    if (d.includes('spotify')) return '\uD83C\uDFB5';
    if (d.includes('netflix')) return '\uD83C\uDFAC';
    if (url.includes('search.html')) return '\uD83D\uDD0D';
    return '\uD83C\uDF10';
  }

  // ── Tab state ──
  let tabs = [];
  let activeTabId = null;
  let tabIdCounter = 0;

  function createTabState(url) {
    return {
      id: `tab-${instanceId}-${tabIdCounter++}`,
      url: url || '',
      title: 'New Tab',
      favicon: '\uD83C\uDF10',
      iframe: null,
      history: [],
      historyIndex: -1,
    };
  }

  // ── Render shell ──
  container.innerHTML = `
    <div class="browser-app" style="display:flex;flex-direction:column;height:100%;">
      <div class="browser-tab-bar" id="brw-tabs-${instanceId}" style="
        display:flex; align-items:center; gap:0; padding:0 4px; height:36px; min-height:36px;
        background:rgba(0,0,0,0.2); border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0;
        overflow-x:auto; overflow-y:hidden;
      "></div>
      <div class="browser-toolbar" style="flex-shrink:0;">
        <button class="browser-nav-btn" id="brw-back-${instanceId}" title="Back">◀</button>
        <button class="browser-nav-btn" id="brw-fwd-${instanceId}" title="Forward">▶</button>
        <button class="browser-nav-btn" id="brw-reload-${instanceId}" title="Reload">↻</button>
        <div class="browser-url-bar">
          <span class="browser-url-lock">\uD83D\uDD12</span>
          <input type="text" class="browser-url-input" id="brw-url-${instanceId}" placeholder="Search or enter URL..." spellcheck="false">
        </div>
        <button class="browser-nav-btn" id="brw-bookmark-${instanceId}" title="Bookmark" style="font-size:14px;">☆</button>
        <button class="browser-nav-btn" id="brw-home-${instanceId}" title="Home">\uD83C\uDFE0</button>
        <button class="browser-nav-btn" id="brw-external-${instanceId}" title="Open in new tab" style="font-size:11px;opacity:0.6;">↗</button>
      </div>
      <div class="browser-viewport" id="brw-viewport-${instanceId}" style="flex:1;position:relative;overflow:hidden;"></div>
    </div>
  `;

  const tabBar = container.querySelector(`#brw-tabs-${instanceId}`);
  const urlInput = container.querySelector(`#brw-url-${instanceId}`);
  const viewport = container.querySelector(`#brw-viewport-${instanceId}`);
  const bookmarkBtn = container.querySelector(`#brw-bookmark-${instanceId}`);

  // ── Tab bar rendering ──
  function renderTabBar() {
    tabBar.innerHTML = '';
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'browser-tab' + (tab.id === activeTabId ? ' active' : '');
      el.style.cssText = `
        display:flex; align-items:center; gap:5px; padding:5px 8px; border-radius:8px 8px 0 0;
        background:${tab.id === activeTabId ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)'};
        font-size:11px; color:rgba(255,255,255,${tab.id === activeTabId ? '0.9' : '0.5'});
        max-width:180px; min-width:60px; cursor:pointer; position:relative; flex-shrink:0;
        transition:background 0.15s;
      `;
      el.innerHTML = `
        <span style="font-size:11px;flex-shrink:0;">${tab.favicon}</span>
        <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1;">${tab.title}</span>
        ${tabs.length > 1 ? `<span class="brw-tab-close" data-tab="${tab.id}" style="
          font-size:13px; opacity:0.4; cursor:pointer; margin-left:2px; flex-shrink:0;
          width:16px; height:16px; display:flex; align-items:center; justify-content:center;
          border-radius:50%; transition:opacity 0.15s, background 0.15s;
        ">&times;</span>` : ''}
      `;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.brw-tab-close')) return;
        switchTab(tab.id);
      });
      const closeBtn = el.querySelector('.brw-tab-close');
      if (closeBtn) {
        closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; closeBtn.style.background = 'rgba(255,255,255,0.1)'; });
        closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.4'; closeBtn.style.background = 'none'; });
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        });
      }
      tabBar.appendChild(el);
    });

    // Add "+" button
    if (tabs.length < MAX_TABS) {
      const addBtn = document.createElement('div');
      addBtn.style.cssText = `
        display:flex; align-items:center; justify-content:center; width:28px; height:28px;
        font-size:16px; color:rgba(255,255,255,0.4); cursor:pointer; border-radius:6px;
        flex-shrink:0; margin-left:2px; transition:background 0.15s, color 0.15s;
      `;
      addBtn.textContent = '+';
      addBtn.title = 'New tab (Ctrl+T)';
      addBtn.addEventListener('mouseenter', () => { addBtn.style.background = 'rgba(255,255,255,0.08)'; addBtn.style.color = 'rgba(255,255,255,0.8)'; });
      addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'none'; addBtn.style.color = 'rgba(255,255,255,0.4)'; });
      addBtn.addEventListener('click', () => openNewTab());
      tabBar.appendChild(addBtn);
    }
  }

  // ── Tab operations ──
  function openNewTab(url) {
    if (tabs.length >= MAX_TABS) return;
    const tab = createTabState(url);
    tabs.push(tab);
    switchTab(tab.id);
    if (!url) showHome(tab);
    else navigateTab(tab, url);
    return tab;
  }

  function closeTab(tabId) {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx < 0 || tabs.length <= 1) return;
    const tab = tabs[idx];
    // Remove iframe
    if (tab.iframe && tab.iframe.parentElement) tab.iframe.remove();
    // Remove home page if present
    const homeEl = viewport.querySelector(`.browser-home[data-tab="${tabId}"]`);
    if (homeEl) homeEl.remove();
    const errorEl = viewport.querySelector(`.browser-error[data-tab="${tabId}"]`);
    if (errorEl) errorEl.remove();

    tabs.splice(idx, 1);
    if (activeTabId === tabId) {
      // Switch to nearest tab
      const newIdx = Math.min(idx, tabs.length - 1);
      switchTab(tabs[newIdx].id);
    } else {
      renderTabBar();
    }
  }

  function switchTab(tabId) {
    activeTabId = tabId;
    const tab = getActiveTab();
    if (!tab) return;

    // Hide all tab content, show only active
    viewport.querySelectorAll('iframe, .browser-home, .browser-error').forEach(el => {
      el.style.display = 'none';
    });
    if (tab.iframe) tab.iframe.style.display = 'block';
    const homeEl = viewport.querySelector(`.browser-home[data-tab="${tabId}"]`);
    if (homeEl) homeEl.style.display = '';
    const errorEl = viewport.querySelector(`.browser-error[data-tab="${tabId}"]`);
    if (errorEl) errorEl.style.display = '';

    // Update toolbar to reflect active tab
    urlInput.value = tab.url;
    updateBookmarkBtn();
    windowManager.setTitle(instanceId, tab.title || 'Browser');
    renderTabBar();
  }

  function getActiveTab() { return tabs.find(t => t.id === activeTabId); }

  // ── Bookmark button ──
  function updateBookmarkBtn() {
    const tab = getActiveTab();
    if (tab && tab.url && isBookmarked(tab.url)) {
      bookmarkBtn.textContent = '★';
      bookmarkBtn.title = 'Remove bookmark';
      bookmarkBtn.style.color = '#ffd60a';
    } else {
      bookmarkBtn.textContent = '☆';
      bookmarkBtn.title = 'Bookmark this page';
      bookmarkBtn.style.color = '';
    }
  }

  // ── URL input ──
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      let url = urlInput.value.trim();
      if (!url) return;
      if (!url.match(/^https?:\/\//) && !url.includes('.')) {
        url = `search.html?q=${encodeURIComponent(url)}`;
      } else if (!url.match(/^https?:\/\//)) {
        url = 'https://' + url;
      }
      const tab = getActiveTab();
      if (tab) navigateTab(tab, url);
    }
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  // ── Nav buttons ──
  container.querySelector(`#brw-back-${instanceId}`).addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (isElectron) { window.novaElectron.browser.back(); return; }
    if (tab.historyIndex > 0) {
      tab.historyIndex--;
      navigateTab(tab, tab.history[tab.historyIndex], true);
    }
  });
  container.querySelector(`#brw-fwd-${instanceId}`).addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab) return;
    if (isElectron) { window.novaElectron.browser.forward(); return; }
    if (tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      navigateTab(tab, tab.history[tab.historyIndex], true);
    }
  });
  container.querySelector(`#brw-reload-${instanceId}`).addEventListener('click', () => {
    if (isElectron) { window.novaElectron.browser.reload(); return; }
    const tab = getActiveTab();
    if (tab && tab.iframe) tab.iframe.src = tab.iframe.src;
  });
  container.querySelector(`#brw-home-${instanceId}`).addEventListener('click', () => {
    if (isElectron) window.novaElectron.browser.close();
    const tab = getActiveTab();
    if (tab) showHome(tab);
  });

  bookmarkBtn.addEventListener('click', () => {
    const tab = getActiveTab();
    if (!tab || !tab.url) return;
    if (isBookmarked(tab.url)) removeBookmark(tab.url);
    else addBookmark(getDomain(tab.url), tab.url);
    updateBookmarkBtn();
  });

  container.querySelector(`#brw-external-${instanceId}`).addEventListener('click', () => {
    const tab = getActiveTab();
    if (tab && tab.url) window.open(tab.url, '_blank');
  });

  // Electron title/url updates
  if (isElectron) {
    window.novaElectron.browser.onTitle((title) => {
      const tab = getActiveTab();
      if (tab) { tab.title = title; updateTabMeta(tab); }
    });
    window.novaElectron.browser.onUrl((url) => {
      const tab = getActiveTab();
      if (tab) { tab.url = url; urlInput.value = url; }
    });
  }

  // ── Navigation ──
  function updateTabMeta(tab) {
    tab.favicon = getFaviconEmoji(tab.url);
    if (tab.id === activeTabId) {
      windowManager.setTitle(instanceId, tab.title || 'Browser');
    }
    renderTabBar();
  }

  function navigateTab(tab, url, skipHistory) {
    // Clean proxy URLs
    if (url.includes('/api/proxy?url=')) {
      try { url = decodeURIComponent(url.split('/api/proxy?url=')[1]); } catch {}
    }
    if (url.includes('api.allorigins.win/raw?url=')) {
      try { url = decodeURIComponent(url.split('api.allorigins.win/raw?url=')[1]); } catch {}
    }

    // History
    if (!isElectron && !skipHistory) {
      if (tab.historyIndex < tab.history.length - 1) tab.history.splice(tab.historyIndex + 1);
      tab.history.push(url);
      tab.historyIndex = tab.history.length - 1;
    }

    tab.url = url;
    tab.title = getDomain(url) || 'Loading...';
    tab.favicon = getFaviconEmoji(url);
    if (tab.id === activeTabId) {
      urlInput.value = url;
      updateBookmarkBtn();
    }
    updateTabMeta(tab);

    // Remove old content for this tab
    if (tab.iframe) { tab.iframe.remove(); tab.iframe = null; }
    const oldHome = viewport.querySelector(`.browser-home[data-tab="${tab.id}"]`);
    if (oldHome) oldHome.remove();
    const oldError = viewport.querySelector(`.browser-error[data-tab="${tab.id}"]`);
    if (oldError) oldError.remove();

    if (isElectron) {
      const rect = viewport.getBoundingClientRect();
      window.novaElectron.browser.navigate(url, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      setupBrowserViewTracking(viewport);
      return;
    }

    // YouTube embed
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
    if (ytMatch) {
      const iframe = createIframe(tab);
      iframe.src = `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
      iframe.allow = 'autoplay; encrypted-media';
      iframe.allowFullscreen = true;
      return;
    }

    // Google → local search (both homepage and search results)
    const googleMatch = url.match(/google\.com\/search\?.*q=([^&]+)/);
    if (googleMatch) {
      navigateTab(tab, `search.html?q=${encodeURIComponent(decodeURIComponent(googleMatch[1]))}`);
      return;
    }
    // Google homepage → redirect to Astrion search (Google blocks proxy)
    if (/^https?:\/\/(www\.)?google\.(com|co\.\w+|[a-z]{2,3})\/?(\?.*)?$/i.test(url)) {
      navigateTab(tab, 'search.html');
      return;
    }

    // Block sites known to crash the proxy
    const BLOCKED_DOMAINS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com'];
    const urlDomain = getDomain(url).toLowerCase();
    if (BLOCKED_DOMAINS.some(d => urlDomain.includes(d))) {
      tab.title = getDomain(url);
      updateTabMeta(tab);
      showBlockedPage(tab, url);
      return;
    }

    const isLocalPage = !url.startsWith('http://') && !url.startsWith('https://');
    const hasServer = window.location.port === '3000' || window.__NOVA_NATIVE__;

    const iframe = createIframe(tab);
    if (isLocalPage) iframe.src = url;
    else if (hasServer) iframe.src = `/api/proxy?url=${encodeURIComponent(url)}`;
    else iframe.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

    iframe.onload = () => {
      // Try to get title from page
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.title) {
          tab.title = doc.title;
          updateTabMeta(tab);
        }
        // Intercept link clicks
        if (doc) {
          doc.addEventListener('click', (e) => {
            const a = e.target.closest('a');
            if (a && a.href) {
              if (a.href.includes('/api/proxy?url=')) {
                e.preventDefault();
                navigateTab(tab, decodeURIComponent(a.href.split('/api/proxy?url=')[1]));
              } else if (a.href.startsWith('http') && !a.href.startsWith('javascript:')) {
                e.preventDefault();
                navigateTab(tab, a.href);
              }
            }
          }, true);
        }
      } catch { /* cross-origin */ }
    };

    // Timeout fallback
    setTimeout(() => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body || doc.body.innerHTML === '') showBlockedPage(tab, url);
      } catch { /* cross-origin = page loaded */ }
    }, 10000);
  }

  function createIframe(tab) {
    const iframe = document.createElement('iframe');
    iframe.className = 'browser-iframe';
    iframe.dataset.tab = tab.id;
    iframe.style.cssText = 'width:100%;height:100%;border:none;background:white;position:absolute;top:0;left:0;';
    if (tab.id !== activeTabId) iframe.style.display = 'none';
    tab.iframe = iframe;
    viewport.appendChild(iframe);
    return iframe;
  }

  function showBlockedPage(tab, blockedUrl) {
    if (tab.iframe) { tab.iframe.remove(); tab.iframe = null; }
    const err = document.createElement('div');
    err.className = 'browser-error';
    err.dataset.tab = tab.id;
    err.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px;text-align:center;color:rgba(255,255,255,0.6);position:absolute;top:0;left:0;width:100%;';
    if (tab.id !== activeTabId) err.style.display = 'none';
    err.innerHTML = `
      <div style="font-size:48px;margin-bottom:16px;">\uD83D\uDD12</div>
      <div style="font-size:16px;font-weight:600;color:white;margin-bottom:8px;">This site can't be displayed here</div>
      <div style="font-size:13px;max-width:400px;margin-bottom:20px;line-height:1.5;">Most websites block being loaded inside other apps. Click below to open it in a new browser tab.</div>
      <a href="${blockedUrl}" target="_blank" style="padding:10px 24px;background:var(--accent);color:white;text-decoration:none;border-radius:10px;font-size:13px;font-weight:500;">Open in Browser Tab</a>
    `;
    viewport.appendChild(err);
  }

  function showHome(tab) {
    tab.url = '';
    tab.title = 'New Tab';
    tab.favicon = '\uD83C\uDF10';
    if (tab.id === activeTabId) {
      urlInput.value = '';
      updateBookmarkBtn();
    }
    updateTabMeta(tab);

    // Remove old content
    if (tab.iframe) { tab.iframe.remove(); tab.iframe = null; }
    const oldHome = viewport.querySelector(`.browser-home[data-tab="${tab.id}"]`);
    if (oldHome) oldHome.remove();
    const oldError = viewport.querySelector(`.browser-error[data-tab="${tab.id}"]`);
    if (oldError) oldError.remove();

    const home = document.createElement('div');
    home.className = 'browser-home';
    home.dataset.tab = tab.id;
    home.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    if (tab.id !== activeTabId) home.style.display = 'none';
    home.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px;">
        <div style="font-size:56px;margin-bottom:20px;">\uD83C\uDF10</div>
        <input type="text" class="browser-home-search" placeholder="Search Google or enter URL..." autofocus
          style="width:100%;max-width:500px;padding:12px 20px;border-radius:24px;border:1px solid rgba(255,255,255,0.1);
          background:rgba(255,255,255,0.06);color:white;font-size:14px;outline:none;margin-bottom:30px;">
        <div class="browser-home-shortcuts" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;max-width:500px;">
          ${bookmarks.map(b => `
            <div class="browser-home-shortcut" data-url="${b.url}" style="
              display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;
              padding:12px 8px;border-radius:12px;width:72px;transition:background 0.15s;
            ">
              <div style="width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.06);
                display:flex;align-items:center;justify-content:center;font-size:20px;">${b.icon}</div>
              <span style="font-size:11px;color:rgba(255,255,255,0.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:72px;">${b.name}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    home.querySelector('.browser-home-search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) navigateTab(tab, q.includes('.') ? (q.startsWith('http') ? q : 'https://' + q) : `search.html?q=${encodeURIComponent(q)}`);
      }
    });

    home.querySelectorAll('.browser-home-shortcut').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.06)');
      el.addEventListener('mouseleave', () => el.style.background = 'none');
      el.addEventListener('click', () => navigateTab(tab, el.dataset.url));
    });

    viewport.appendChild(home);
  }

  // ── Keyboard shortcuts ──
  container.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); openNewTab(); }
      else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); if (tabs.length > 1) closeTab(activeTabId); }
      else if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); }
      else if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) switchTab(tabs[idx].id);
      }
    }
  });

  function cycleTab(dir) {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    const next = (idx + dir + tabs.length) % tabs.length;
    switchTab(tabs[next].id);
  }

  // ── Message handler for proxied nav ──
  const navHandler = (e) => {
    if (e.data?.type === 'nova-browser-nav' && e.data.url) {
      const tab = getActiveTab();
      if (tab) navigateTab(tab, e.data.url);
    }
  };
  window.addEventListener('message', navHandler);

  // ── Cleanup ──
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
    const update = () => {
      if (!document.contains(viewport)) {
        if (isElectron) window.novaElectron.browser.close();
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const tab = getActiveTab();
      if (isElectron && tab && tab.url) {
        window.novaElectron.browser.resize({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
      requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  // ── Init: open first tab ──
  const initUrl = options.url || options.initialUrl || '';
  openNewTab(initUrl || null);
}
