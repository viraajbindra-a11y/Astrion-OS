// NOVA OS — Clipboard Manager
// Keeps a history of the last 30 things copied. Press Cmd+Shift+V to open.

const HISTORY_KEY = 'nova-clipboard-history';
const MAX_ITEMS = 30;

let history = [];
let panel = null;
let lastCapture = '';

export function initClipboardManager() {
  // Load history
  try { history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { history = []; }

  // Poll clipboard when the page has focus (permission-dependent)
  setInterval(pollClipboard, 1500);

  // Also capture copy/cut events directly
  document.addEventListener('copy', onCopyEvent, true);
  document.addEventListener('cut', onCopyEvent, true);

  // Shortcut — Cmd+Shift+V
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      toggle();
    }
  });
}

async function pollClipboard() {
  if (!document.hasFocus()) return;
  try {
    const text = await navigator.clipboard.readText();
    if (text && text !== lastCapture) {
      lastCapture = text;
      addToHistory(text);
    }
  } catch {
    // Permission denied — rely on copy events instead
  }
}

function onCopyEvent(e) {
  // Give the browser a moment to update the clipboard
  setTimeout(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) addToHistory(text);
    } catch {
      // Fall back to selection
      const sel = window.getSelection()?.toString();
      if (sel) addToHistory(sel);
    }
  }, 50);
}

function addToHistory(text) {
  if (!text || text.trim().length === 0) return;
  if (text.length > 10000) return; // skip huge blobs

  // Remove existing copy of this text
  history = history.filter(item => item.text !== text);
  history.unshift({ text, time: Date.now() });
  if (history.length > MAX_ITEMS) history = history.slice(0, MAX_ITEMS);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));

  if (panel) renderList();
}

function toggle() {
  if (panel) close();
  else open();
}

function open() {
  panel = document.createElement('div');
  panel.id = 'clipboard-manager';
  panel.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 480px;
    max-height: 70vh;
    background: rgba(30, 30, 36, 0.95);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    z-index: 97000;
    font-family: var(--font);
    color: white;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    animation: clipboardPop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  if (!document.getElementById('clipboard-styles')) {
    const s = document.createElement('style');
    s.id = 'clipboard-styles';
    s.textContent = `
      @keyframes clipboardPop {
        from { opacity: 0; transform: translate(-50%, -48%) scale(0.95); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
    `;
    document.head.appendChild(s);
  }

  panel.innerHTML = `
    <div style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; align-items:center;">
      <span style="font-size: 13px; font-weight: 600;">\uD83D\uDCCB Clipboard History</span>
      <button id="cm-clear" style="background:rgba(255,255,255,0.08); border:none; color:#ff6b6b; padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; font-family:var(--font);">Clear</button>
    </div>
    <div id="cm-list" style="flex:1; overflow-y:auto; padding: 8px;"></div>
    <div style="padding: 8px 16px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 10px; color: rgba(255,255,255,0.4); text-align:center;">
      Click to copy \u00B7 Press Esc to close
    </div>
  `;

  document.body.appendChild(panel);

  panel.querySelector('#cm-clear').addEventListener('click', () => {
    history = [];
    localStorage.setItem(HISTORY_KEY, '[]');
    renderList();
  });

  renderList();

  function escHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      document.removeEventListener('keydown', escHandler);
    }
  }
  document.addEventListener('keydown', escHandler);

  setTimeout(() => {
    document.addEventListener('click', function clickOut(e) {
      if (!panel?.contains(e.target)) {
        close();
        document.removeEventListener('click', clickOut);
      }
    });
  }, 10);
}

function renderList() {
  if (!panel) return;
  const list = panel.querySelector('#cm-list');
  if (!list) return;

  if (history.length === 0) {
    list.innerHTML = `<div style="padding: 32px; text-align: center; color: rgba(255,255,255,0.3); font-size: 13px;">No clipboard history yet.<br><span style="font-size:11px; opacity:0.6;">Copy anything and it will appear here.</span></div>`;
    return;
  }

  list.innerHTML = '';
  history.forEach((item, i) => {
    const preview = item.text.length > 80 ? item.text.slice(0, 80) + '…' : item.text;
    const isUrl = /^https?:\/\//.test(item.text);
    const icon = isUrl ? '\uD83D\uDD17' : (item.text.length > 100 ? '\uD83D\uDCC4' : '\uD83D\uDCDD');
    const time = timeAgo(item.time);

    const el = document.createElement('div');
    el.style.cssText = `
      padding: 10px 12px; border-radius: 8px; cursor: pointer;
      display: flex; gap: 10px; align-items: flex-start;
      transition: background 0.1s;
      margin-bottom: 2px;
    `;
    el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.08)');
    el.addEventListener('mouseleave', () => el.style.background = 'transparent');
    el.innerHTML = `
      <div style="font-size: 16px; flex-shrink: 0;">${icon}</div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; color: rgba(255,255,255,0.9); white-space: pre-wrap; word-break: break-word;">${escapeHtml(preview)}</div>
        <div style="font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px;">${time}</div>
      </div>
    `;
    el.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.text);
        lastCapture = item.text;
        el.style.background = 'rgba(0,122,255,0.3)';
        setTimeout(close, 200);
      } catch {}
    });
    list.appendChild(el);
  });
}

function close() {
  if (panel) {
    panel.style.animation = 'clipboardPop 0.12s reverse forwards';
    setTimeout(() => { panel?.remove(); panel = null; }, 120);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
