// NOVA OS — YouTube App (standalone video player + search)

import { processManager } from '../kernel/process-manager.js';

export function registerYouTube() {
  processManager.register('youtube', {
    name: 'YouTube',
    icon: '\u25B6',
    iconClass: 'dock-icon-youtube',
    singleInstance: true,
    width: 900,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    launch: (contentEl) => {
      initYouTube(contentEl);
    }
  });
}

/* ─── YouTube IFrame API loader (shared singleton) ─── */
let ytAPILoaded = false;
let ytAPICallbacks = [];

function loadYouTubeAPI() {
  return new Promise(resolve => {
    if (ytAPILoaded) return resolve();
    if (window.YT && window.YT.Player) { ytAPILoaded = true; return resolve(); }
    ytAPICallbacks.push(resolve);
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      ytAPILoaded = true;
      ytAPICallbacks.forEach(cb => cb());
      ytAPICallbacks = [];
    };
  });
}

function extractVideoId(input) {
  input = input.trim();
  let m = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = input.match(/embed\/([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  m = input.match(/music\.youtube\.com.*[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  return null;
}

const YT_API_KEY_STORAGE = 'astrion-yt-api-key';
function getYTApiKey() { return localStorage.getItem(YT_API_KEY_STORAGE) || ''; }
function setYTApiKey(key) { localStorage.setItem(YT_API_KEY_STORAGE, key); }

async function searchYouTube(query, apiKey) {
  if (!apiKey) return [];
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=15&q=${encodeURIComponent(query)}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      description: item.snippet.description || '',
    }));
  } catch { return []; }
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ─── Main app init ─── */
function initYouTube(container) {
  let player = null;
  let isPlaying = false;
  let pollTimer = null;

  container.innerHTML = `
    <style>
      .yt-app {
        display: flex; flex-direction: column; height: 100%;
        background: rgba(14, 14, 18, 0.97); color: var(--text-primary, #fff);
        font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
        border-radius: 0 0 var(--radius-lg, 14px) var(--radius-lg, 14px);
        overflow: hidden; user-select: none;
      }
      /* ── Search bar ── */
      .yt-search-bar {
        display: flex; gap: 8px; padding: 10px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        align-items: center;
      }
      .yt-search-icon { font-size: 16px; color: var(--text-tertiary, #666); }
      .yt-search-input {
        flex: 1; padding: 8px 12px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.06); color: #fff; font-size: 13px;
        outline: none; font-family: inherit;
      }
      .yt-search-input:focus { border-color: #ff0000; }
      .yt-search-input::placeholder { color: var(--text-tertiary, #666); }
      .yt-search-btn {
        padding: 8px 16px; border-radius: 10px; border: none;
        background: #ff0000; color: #fff; font-size: 12px;
        cursor: pointer; font-weight: 600;
      }
      .yt-search-btn:hover { filter: brightness(1.15); }
      .yt-key-btn {
        padding: 8px; border-radius: 8px; border: none;
        background: rgba(255,255,255,0.06); color: var(--text-secondary, #aaa);
        cursor: pointer; font-size: 14px;
      }
      .yt-key-btn:hover { background: rgba(255,255,255,0.1); }

      /* ── Body ── */
      .yt-body { display: flex; flex: 1; min-height: 0; }

      /* ── Video area ── */
      .yt-video-area {
        flex: 1; display: flex; flex-direction: column; min-width: 0;
      }
      .yt-player-wrap {
        width: 100%; aspect-ratio: 16/9; max-height: 380px;
        background: #000; position: relative; flex-shrink: 0;
      }
      .yt-player-wrap iframe { width: 100%; height: 100%; border: none; }
      .yt-player-placeholder {
        width: 100%; height: 100%; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        color: var(--text-tertiary, #666); gap: 8px;
      }
      .yt-player-placeholder-icon { font-size: 48px; }
      .yt-video-info {
        padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.04);
        flex-shrink: 0;
      }
      .yt-video-title {
        font-size: 14px; font-weight: 600;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .yt-video-channel {
        font-size: 11px; color: var(--text-secondary, #aaa); margin-top: 2px;
      }

      /* ── Controls ── */
      .yt-controls {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 14px; border-top: 1px solid rgba(255,255,255,0.06);
        background: rgba(0,0,0,0.15); flex-shrink: 0;
      }
      .yt-ctrl-btn {
        background: none; border: none; color: var(--text-secondary, #aaa);
        font-size: 18px; cursor: pointer; padding: 4px 6px; border-radius: 6px;
        transition: all 0.15s;
      }
      .yt-ctrl-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
      .yt-ctrl-btn.play-btn {
        font-size: 22px; color: #fff; background: #ff0000;
        width: 36px; height: 36px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
      }
      .yt-ctrl-btn.play-btn:hover { filter: brightness(1.15); }
      .yt-progress-wrap { flex: 1; display: flex; align-items: center; gap: 6px; }
      .yt-time { font-size: 10px; color: var(--text-tertiary, #666); font-variant-numeric: tabular-nums; min-width: 32px; }
      .yt-progress-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; cursor: pointer; }
      .yt-progress-fill { height: 100%; background: #ff0000; border-radius: 2px; width: 0; transition: width 0.4s linear; }
      .yt-vol-wrap { display: flex; align-items: center; gap: 5px; }
      .yt-vol-icon { font-size: 13px; color: var(--text-secondary, #aaa); }
      .yt-vol-slider {
        width: 70px; height: 4px; -webkit-appearance: none; appearance: none;
        background: rgba(255,255,255,0.1); border-radius: 2px; outline: none;
      }
      .yt-vol-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: #fff; border-radius: 50%; cursor: pointer; }

      /* ── Results sidebar ── */
      .yt-results {
        width: 280px; border-left: 1px solid rgba(255,255,255,0.06);
        overflow-y: auto; flex-shrink: 0;
      }
      .yt-results::-webkit-scrollbar { width: 5px; }
      .yt-results::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      .yt-result-label {
        padding: 8px 12px; font-size: 10px; color: var(--text-tertiary, #666);
        text-transform: uppercase; letter-spacing: 1px;
      }
      .yt-result-item {
        display: flex; gap: 8px; padding: 6px 12px; cursor: pointer;
        transition: background 0.15s; align-items: flex-start;
      }
      .yt-result-item:hover { background: rgba(255,255,255,0.04); }
      .yt-result-item.active { background: rgba(255,255,255,0.06); }
      .yt-result-thumb {
        width: 80px; height: 45px; border-radius: 4px; flex-shrink: 0;
        background-size: cover; background-position: center; background-color: #222;
      }
      .yt-result-info { flex: 1; min-width: 0; }
      .yt-result-title {
        font-size: 11px; font-weight: 500; line-height: 1.3;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .yt-result-channel { font-size: 10px; color: var(--text-tertiary, #666); margin-top: 2px; }
    </style>

    <div class="yt-app">
      <div class="yt-search-bar">
        <span class="yt-search-icon">\u25B6</span>
        <input class="yt-search-input" id="yt-input" placeholder="Search YouTube or paste URL..." />
        <button class="yt-search-btn" id="yt-search">\uD83D\uDD0D Search</button>
        <button class="yt-key-btn" id="yt-key" title="API Key Settings">\u2699</button>
      </div>

      <div class="yt-body">
        <div class="yt-video-area">
          <div class="yt-player-wrap" id="yt-player-wrap">
            <div class="yt-player-placeholder" id="yt-placeholder">
              <div class="yt-player-placeholder-icon">\u25B6</div>
              <div style="font-size:13px;">Search or paste a YouTube URL to start</div>
            </div>
          </div>
          <div class="yt-video-info">
            <div class="yt-video-title" id="yt-title">No video selected</div>
            <div class="yt-video-channel" id="yt-channel">\u2014</div>
          </div>
        </div>
        <div class="yt-results" id="yt-results">
          <div class="yt-result-label">Results</div>
        </div>
      </div>

      <div class="yt-controls">
        <button class="yt-ctrl-btn play-btn" id="yt-play">\u25B6</button>
        <div class="yt-progress-wrap">
          <span class="yt-time" id="yt-time-cur">0:00</span>
          <div class="yt-progress-bar" id="yt-pbar">
            <div class="yt-progress-fill" id="yt-pfill"></div>
          </div>
          <span class="yt-time" id="yt-time-dur">0:00</span>
        </div>
        <div class="yt-vol-wrap">
          <span class="yt-vol-icon">\uD83D\uDD0A</span>
          <input type="range" class="yt-vol-slider" id="yt-vol" min="0" max="100" value="80" />
        </div>
      </div>
    </div>
  `;

  // Refs
  const inputEl = container.querySelector('#yt-input');
  const searchBtn = container.querySelector('#yt-search');
  const keyBtn = container.querySelector('#yt-key');
  const playerWrap = container.querySelector('#yt-player-wrap');
  const placeholder = container.querySelector('#yt-placeholder');
  const titleEl = container.querySelector('#yt-title');
  const channelEl = container.querySelector('#yt-channel');
  const resultsEl = container.querySelector('#yt-results');
  const playBtn = container.querySelector('#yt-play');
  const timeCur = container.querySelector('#yt-time-cur');
  const timeDur = container.querySelector('#yt-time-dur');
  const pBar = container.querySelector('#yt-pbar');
  const pFill = container.querySelector('#yt-pfill');
  const volSlider = container.querySelector('#yt-vol');

  let results = [];
  let currentVideoId = null;

  // ── Init player ──
  async function initPlayer() {
    if (player) return;
    await loadYouTubeAPI();
    placeholder.remove();
    const div = document.createElement('div');
    div.id = 'yt-app-player-' + Date.now();
    div.style.cssText = 'width:100%;height:100%;';
    playerWrap.appendChild(div);

    return new Promise(resolve => {
      player = new window.YT.Player(div.id, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => { player.setVolume(parseInt(volSlider.value)); resolve(); },
          onStateChange: (e) => {
            if (e.data === 1) { // playing
              isPlaying = true; playBtn.textContent = '\u23F8'; startPoll();
            } else if (e.data === 2) { // paused
              isPlaying = false; playBtn.textContent = '\u25B6';
            } else if (e.data === 0) { // ended
              isPlaying = false; playBtn.textContent = '\u25B6'; stopPoll();
            }
          },
        },
      });
    });
  }

  async function playVideo(videoId, title, channel) {
    await initPlayer();
    currentVideoId = videoId;
    player.loadVideoById(videoId);
    isPlaying = true;
    playBtn.textContent = '\u23F8';
    titleEl.textContent = title || 'YouTube Video';
    channelEl.textContent = channel || '';
    startPoll();

    // Highlight active result
    resultsEl.querySelectorAll('.yt-result-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === videoId);
    });
  }

  // ── Search ──
  searchBtn.addEventListener('click', doSearch);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  async function doSearch() {
    const val = inputEl.value.trim();
    if (!val) return;
    // Check if URL
    const vid = extractVideoId(val);
    if (vid) {
      playVideo(vid, '', '');
      return;
    }
    // Search
    const key = getYTApiKey();
    if (!key) {
      promptKey();
      return;
    }
    searchBtn.textContent = '...';
    results = await searchYouTube(val, key);
    searchBtn.textContent = '\uD83D\uDD0D Search';
    renderResults();
  }

  keyBtn.addEventListener('click', promptKey);
  function promptKey() {
    const current = getYTApiKey();
    const key = prompt('Enter your YouTube Data API v3 key:\n(Get one free at console.cloud.google.com)', current);
    if (key !== null) setYTApiKey(key.trim());
  }

  function renderResults() {
    resultsEl.innerHTML = '';
    if (!results.length) {
      resultsEl.innerHTML = '<div class="yt-result-label">No results</div>';
      return;
    }
    const label = document.createElement('div');
    label.className = 'yt-result-label';
    label.textContent = `${results.length} Results`;
    resultsEl.appendChild(label);

    results.forEach(r => {
      const el = document.createElement('div');
      el.className = 'yt-result-item' + (r.id === currentVideoId ? ' active' : '');
      el.dataset.id = r.id;
      el.innerHTML = `
        <div class="yt-result-thumb" style="background-image:url(${r.thumb})"></div>
        <div class="yt-result-info">
          <div class="yt-result-title">${escHtml(r.title)}</div>
          <div class="yt-result-channel">${escHtml(r.channel)}</div>
        </div>
      `;
      el.addEventListener('click', () => playVideo(r.id, r.title, r.channel));
      resultsEl.appendChild(el);
    });
  }

  // ── Controls ──
  playBtn.addEventListener('click', () => {
    if (!player) return;
    if (isPlaying) { player.pauseVideo(); }
    else { player.playVideo(); }
  });

  volSlider.addEventListener('input', () => {
    if (player) player.setVolume(parseInt(volSlider.value));
  });

  pBar.addEventListener('click', e => {
    if (!player) return;
    const rect = pBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const dur = player.getDuration() || 0;
    player.seekTo(dur * pct, true);
  });

  // ── Progress polling ──
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      if (!player || !isPlaying) return;
      const cur = player.getCurrentTime() || 0;
      const dur = player.getDuration() || 0;
      timeCur.textContent = fmtTime(cur);
      timeDur.textContent = fmtTime(dur);
      pFill.style.width = dur > 0 ? (cur / dur * 100) + '%' : '0';
    }, 500);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── Cleanup ──
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      stopPoll();
      if (player) { try { player.destroy(); } catch (_) {} player = null; }
      observer.disconnect();
    }
  });
  observer.observe(container.parentElement || document.body, { childList: true, subtree: true });
}
