// Shared YouTube IFrame API loader + utilities
// Used by both music.js and youtube.js to avoid duplicate code
// and window.onYouTubeIframeAPIReady overwrite conflicts.

let ytAPILoaded = false;
let ytAPICallbacks = [];
let ytAPIFailed = false;

/**
 * Load the YouTube IFrame API script (singleton).
 * Returns a promise that resolves when YT.Player is available,
 * or rejects after 15 seconds if the script fails to load.
 */
export function loadYouTubeAPI() {
  return new Promise((resolve, reject) => {
    if (ytAPILoaded) return resolve();
    if (ytAPIFailed) return reject(new Error('YouTube API failed to load'));
    if (window.YT && window.YT.Player) { ytAPILoaded = true; return resolve(); }

    ytAPICallbacks.push({ resolve, reject });

    // Only inject script once
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => {
        ytAPIFailed = true;
        ytAPICallbacks.forEach(cb => cb.reject(new Error('YouTube API script failed to load')));
        ytAPICallbacks = [];
      };
      document.head.appendChild(tag);

      // Chain with any existing handler (defensive)
      const existing = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (existing) existing();
        ytAPILoaded = true;
        ytAPICallbacks.forEach(cb => cb.resolve());
        ytAPICallbacks = [];
      };

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!ytAPILoaded) {
          ytAPIFailed = true;
          ytAPICallbacks.forEach(cb => cb.reject(new Error('YouTube API load timed out')));
          ytAPICallbacks = [];
        }
      }, 15000);
    }
  });
}

/**
 * Extract a YouTube video ID from various URL formats.
 * Returns the 11-character ID or null.
 */
export function extractVideoId(input) {
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

/** localStorage key shared across apps for API key */
export const YT_API_KEY_STORAGE = 'astrion-yt-api-key';

export function getYTApiKey() {
  return localStorage.getItem(YT_API_KEY_STORAGE) || '';
}

export function setYTApiKey(key) {
  localStorage.setItem(YT_API_KEY_STORAGE, key);
}

/**
 * Search YouTube using the Data API v3.
 * Returns array of { id, title, channel, thumb, description }.
 */
export async function searchYouTube(query, apiKey, maxResults = 10) {
  if (!apiKey) return [];
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=${maxResults}&q=${encodeURIComponent(query)}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumb: item.snippet.thumbnails?.default?.url || '',
      description: item.snippet.description || '',
    }));
  } catch { return []; }
}

/** Escape HTML to prevent XSS from video titles etc. */
export function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/** Format seconds to m:ss */
export function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
