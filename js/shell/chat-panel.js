// Astrion OS — AI Chat Side Panel (3 modes: Normal / Plan / Bypass)
//
// Right-edge slide-in panel. Persistent chat surface for the Astrion
// agent, separate from Spotlight's one-shot command palette.
//
// Three modes (segmented control at top):
//
//   Normal — standard L2+ safety path. Emits `intent:plan` and lets
//   the existing Spotlight subscriber own the L2+ preview gate +
//   red-team review. The chat panel just mirrors plan progress.
//
//   Plan — preview-first. Calls planIntent() directly, renders the
//   plan as an inline card with Approve / Discard buttons, and only
//   calls executePlan() on explicit Approve. "Show me before you do."
//
//   Bypass — red banner. Auto-confirms every plan:preview and
//   interception:preview. The USER owns the safety decision when they
//   flip this; the banner + per-message red dot make that obvious.
//
// Events in:  plan:started, plan:preview, plan:step:start, plan:step:done,
//             plan:step:fail, plan:completed, plan:failed, plan:clarify,
//             interception:preview, ai:response
// Events out: intent:plan, plan:confirmed, plan:aborted,
//             interception:confirm, interception:abort

import { eventBus } from '../kernel/event-bus.js';
import { renderMarkdown, MARKDOWN_STYLES } from '../lib/render-md.js';
import { processManager } from '../kernel/process-manager.js';
import { listSkills } from '../kernel/skill-registry.js';

const MODE = {
  NORMAL: 'normal',
  PLAN: 'plan',
  BYPASS: 'bypass',
  CHAT: 'chat',   // Direct Q&A with streaming tokens — no planner, no gates
};

// Module-level state
let panelEl = null;
let toggleBtnEl = null;
let isOpen = false;
let currentMode = MODE.NORMAL;
let messages = []; // { id, role, text, kind, planId?, meta? }
let planGroups = new Map(); // planId -> { messageIds:[], plan, status, mode }
let bypassAutoConfirmOn = false; // guards interception:preview auto-confirm
let pendingAttachment = null;     // { name, content, bytes } from drag-drop
let inputEl = null;
let listEl = null;
let modeChipEl = null;
let banner = null;

// Persist mode across reloads
const MODE_KEY = 'astrion-chat-panel-mode';
// Persist visible chat history across reloads. Different from the
// ai-service conversationHistory key (that's the AI's context memory;
// this is the user's visible scrollback). Only text/system messages
// serialize — plan-preview/plan-progress cards have function refs in
// meta that don't survive JSON.
const MESSAGES_KEY = 'astrion-chat-panel-messages-v1';
const MESSAGES_CAP = 60;

function loadMode() {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === MODE.PLAN || saved === MODE.BYPASS || saved === MODE.NORMAL || saved === MODE.CHAT) {
    currentMode = saved;
  }
}

function saveMode() {
  try { localStorage.setItem(MODE_KEY, currentMode); } catch {}
}

function saveMessages() {
  // Keep only serializable kinds; drop ephemeral plan cards + clarify
  // (their meta carries function refs we can't persist) + system
  // toasts that wouldn't make sense replayed out of context.
  const persistable = messages
    .filter(m => m.kind === 'text' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-MESSAGES_CAP)
    .map(m => ({
      id: m.id, role: m.role, text: m.text, kind: m.kind, mode: m.mode,
      meta: m.meta ? {
        brain: m.meta.brain, model: m.meta.model, provider: m.meta.provider,
      } : null,
    }));
  try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(persistable)); } catch {}
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    messages = parsed.filter(m =>
      m && typeof m.id === 'string' && typeof m.role === 'string' && typeof m.text === 'string'
    );
  } catch { messages = []; }
}

function clearMessages() {
  messages = [];
  try { localStorage.removeItem(MESSAGES_KEY); } catch {}
}

function newMsgId() {
  return 'msg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export function initChatPanel() {
  // Idempotent — boot.js calls this in both spotlight-popup and normal
  // paths, and tests sometimes call it again. Without the guard, every
  // call appended a fresh panel + toggle to <body>, leaving the module
  // state pointing at the latest copy and old DOM nodes orphaned.
  if (panelEl && document.body.contains(panelEl)) return;
  loadMode();
  loadMessages();
  injectStyles();
  buildToggleButton();
  buildPanel();
  // Replay persisted messages into the freshly-built list. Done after
  // buildPanel so listEl exists. If there's nothing to replay the
  // empty-state UI in renderMessage still triggers correctly.
  if (messages.length > 0 && listEl) {
    const empty = listEl.querySelector('.cp-empty');
    if (empty) empty.remove();
    for (const m of messages) {
      try { listEl.appendChild(messageNode(m)); } catch {}
    }
    scrollToBottom();
  }
  subscribeEvents();
  subscribeKeyboard();
  console.log('[chat-panel] ready — mode:', currentMode, '· restored messages:', messages.length);
}

export function openChatPanel() {
  if (!panelEl) return;
  if (isOpen) return;
  isOpen = true;
  panelEl.classList.add('open');
  toggleBtnEl?.classList.add('hidden');
  // Re-render the empty state on open. initChatPanel runs before
  // skill-registry.loadSkillRegistry() finishes, so the first paint
  // misses the "Get it done" section. Cheap to re-render — only
  // touches DOM when messages.length === 0.
  renderEmpty();
  setTimeout(() => inputEl?.focus(), 50);
  eventBus.emit('chat-panel:opened', { mode: currentMode });
}

export function closeChatPanel() {
  if (!panelEl) return;
  if (!isOpen) return;
  isOpen = false;
  panelEl.classList.remove('open');
  toggleBtnEl?.classList.remove('hidden');
  eventBus.emit('chat-panel:closed');
}

export function toggleChatPanel() {
  if (isOpen) closeChatPanel(); else openChatPanel();
}

// ═══════════════════════════════════════════════════════════════
// DOM CONSTRUCTION
// ═══════════════════════════════════════════════════════════════

function buildToggleButton() {
  toggleBtnEl = document.createElement('button');
  toggleBtnEl.id = 'chat-panel-toggle';
  toggleBtnEl.type = 'button';
  toggleBtnEl.title = 'AI Chat (Ctrl+Shift+K)';
  toggleBtnEl.innerHTML = '\u{1F4AC}'; // speech-balloon
  toggleBtnEl.addEventListener('click', toggleChatPanel);
  document.body.appendChild(toggleBtnEl);
}

function buildPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'chat-panel';
  panelEl.className = 'chat-panel';
  panelEl.innerHTML = `
    <div class="cp-header">
      <div class="cp-title">
        <span class="cp-title-dot" id="cp-title-dot"></span>
        <span>Astrion Chat</span>
      </div>
      <div class="cp-header-actions">
        <button class="cp-iconbtn" id="cp-autospeak-btn" title="Auto-speak Chat replies">\u{1F509}</button>
        <button class="cp-iconbtn" id="cp-clear-btn" title="Clear conversation">\u{1F5D1}</button>
        <button class="cp-iconbtn" id="cp-close-btn" title="Close (Ctrl+Shift+K)">\u2715</button>
      </div>
    </div>

    <div class="cp-mode-row" role="tablist" aria-label="Chat mode">
      <button class="cp-mode-btn" data-mode="normal" role="tab">
        <span class="cp-mode-icon">\u2713</span>
        <span class="cp-mode-label">Normal</span>
      </button>
      <button class="cp-mode-btn" data-mode="plan" role="tab">
        <span class="cp-mode-icon">\u{1F50D}</span>
        <span class="cp-mode-label">Plan</span>
      </button>
      <button class="cp-mode-btn" data-mode="bypass" role="tab">
        <span class="cp-mode-icon">\u26A1</span>
        <span class="cp-mode-label">Bypass</span>
      </button>
      <button class="cp-mode-btn" data-mode="chat" role="tab">
        <span class="cp-mode-icon">\u{1F4AC}</span>
        <span class="cp-mode-label">Chat</span>
      </button>
    </div>

    <div class="cp-banner" id="cp-banner"></div>
    <div class="cp-phase" id="cp-phase" role="status" aria-live="polite"></div>

    <div class="cp-messages" id="cp-messages" role="log" aria-live="polite"></div>

    <div class="cp-input-row">
      <button class="cp-mic" id="cp-mic" title="Speak (Web Speech API)" aria-label="Voice input">\u{1F3A4}</button>
      <textarea id="cp-input"
        rows="1"
        placeholder="Ask Astrion anything..."
        aria-label="Message"></textarea>
      <button class="cp-send" id="cp-send" title="Send (Enter)">\u27A4</button>
    </div>

    <div class="cp-hint" id="cp-hint">
      Enter to send \u00B7 Shift+Enter for newline \u00B7 Ctrl+Shift+K to toggle
    </div>
    <div class="cp-footer-stats" id="cp-footer-stats" aria-live="polite"></div>
  `;
  document.body.appendChild(panelEl);

  listEl = panelEl.querySelector('#cp-messages');
  inputEl = panelEl.querySelector('#cp-input');
  banner = panelEl.querySelector('#cp-banner');
  modeChipEl = panelEl.querySelector('#cp-title-dot');

  // Mode buttons
  panelEl.querySelectorAll('.cp-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  panelEl.querySelector('#cp-close-btn').addEventListener('click', closeChatPanel);
  panelEl.querySelector('#cp-clear-btn').addEventListener('click', clearConversation);
  panelEl.querySelector('#cp-mic')?.addEventListener('click', startVoiceInput);

  /* Drag-and-drop file upload — drop a file onto the panel and the
   * file content gets attached to the next user message as context.
   * The AI sees `[attached: filename.txt]\n<content>\n\n<your query>`.
   * Plain text only (utf-8); binary files rejected with a notice. */
  ['dragover', 'dragenter'].forEach(ev =>
    panelEl.addEventListener(ev, (e) => {
      e.preventDefault();
      panelEl.classList.add('cp-drag-over');
    }));
  ['dragleave', 'dragend'].forEach(ev =>
    panelEl.addEventListener(ev, (e) => {
      if (e.target === panelEl) panelEl.classList.remove('cp-drag-over');
    }));
  panelEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    panelEl.classList.remove('cp-drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      pushSystemMessage(`✗ ${file.name} too big (${Math.round(file.size/1024)} KB > 200 KB cap). Drop a smaller file.`);
      return;
    }
    try {
      const text = await file.text();
      /* Cheap UTF-8 sanity: if first 2KB has > 5% non-printable bytes,
       * call it binary + reject. Avoids stuffing a JPEG into the prompt. */
      const sample = text.slice(0, 2000);
      let nonPrint = 0;
      for (let i = 0; i < sample.length; i++) {
        const c = sample.charCodeAt(i);
        if (c < 9 || (c > 13 && c < 32) || c === 127) nonPrint++;
      }
      if (sample.length > 0 && nonPrint / sample.length > 0.05) {
        pushSystemMessage(`✗ ${file.name} looks binary; chat only accepts text files.`);
        return;
      }
      pendingAttachment = { name: file.name, content: text, bytes: file.size };
      pushSystemMessage(`\u{1F4CE} Attached ${file.name} (${file.size} bytes) — your next message will include it as context.`);
      reflectAttachment();
    } catch (err) {
      pushSystemMessage(`✗ Couldn't read ${file.name}: ${err?.message || String(err)}`);
    }
  });
  /* Auto-speak toggle — persists to localStorage. Active state shown
   * by an .active class (accent border + tinted bg). */
  const autoSpeakBtn = panelEl.querySelector('#cp-autospeak-btn');
  function reflectAutoSpeak() {
    const on = localStorage.getItem('astrion-chat-autospeak') === '1';
    autoSpeakBtn?.classList.toggle('active', on);
    if (autoSpeakBtn) autoSpeakBtn.title = on
      ? 'Auto-speak ON — Chat replies read aloud'
      : 'Auto-speak Chat replies';
  }
  reflectAutoSpeak();
  autoSpeakBtn?.addEventListener('click', () => {
    const on = localStorage.getItem('astrion-chat-autospeak') === '1';
    if (on) {
      localStorage.removeItem('astrion-chat-autospeak');
      try { window.speechSynthesis?.cancel?.(); } catch {}
    } else {
      localStorage.setItem('astrion-chat-autospeak', '1');
    }
    reflectAutoSpeak();
  });
  panelEl.querySelector('#cp-send').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.mode === 'stop') {
      // Mid-stream — user wants to interrupt the current reply
      if (chatAbortController) {
        try { chatAbortController.abort(); } catch {}
      }
    } else {
      handleSend();
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape') {
      closeChatPanel();
    }
  });

  // Auto-grow textarea + live cost-preview badge.
  // The hint line shows "Enter to send · ~N tokens" when typing.
  // Estimate is char-count / 4 (the standard rough English tokenization
  // ratio). Resets when input is empty.
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
    const hintEl = panelEl.querySelector('#cp-hint');
    const len = inputEl.value.length;
    if (hintEl && !hintEl.dataset.streaming) {
      if (len > 0) {
        const tokens = Math.max(1, Math.ceil(len / 4));
        hintEl.textContent = `~${tokens} input tokens · Enter to send`;
      } else {
        hintEl.textContent = 'Enter to send · Shift+Enter for newline · Ctrl+Shift+K to toggle';
      }
    }
  });

  applyModeUI();
  renderEmpty();
  updateFooterStats();
  // Refresh stats after each plan + on a slow timer (resets at midnight
  // via getTodayKey). 30s is fast enough to show recent cost + cheap.
  eventBus.on('plan:completed', updateFooterStats);
  eventBus.on('plan:failed', updateFooterStats);
  setInterval(updateFooterStats, 30000);
}

async function updateFooterStats() {
  if (!panelEl) return;
  const el = panelEl.querySelector('#cp-footer-stats');
  if (!el) return;
  try {
    const { getBudgetStats } = await import('../kernel/intent-executor.js');
    const b = getBudgetStats();
    const fraction = b.limit > 0 ? b.used / b.limit : 0;
    const hue = fraction < 0.6 ? 150 : fraction < 0.85 ? 40 : 0;
    el.innerHTML = `
      <span class="cp-budget-dot" style="background:hsl(${hue},70%,55%);"></span>
      <span class="cp-budget-text">Budget \u00B7 ${b.used}/${b.limit} irreversibility tokens used today</span>
    `;
  } catch { /* silent */ }
}

function applyModeUI() {
  if (!panelEl) return;
  panelEl.dataset.mode = currentMode;
  panelEl.querySelectorAll('.cp-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
    btn.setAttribute('aria-selected', btn.dataset.mode === currentMode ? 'true' : 'false');
  });

  if (currentMode === MODE.BYPASS) {
    banner.textContent = '\u26A0 BYPASS MODE — gates off. Every action executes immediately. You own the safety call.';
    banner.classList.add('visible', 'danger');
  } else if (currentMode === MODE.PLAN) {
    banner.textContent = '\u{1F50D} Plan mode — plans are previewed; nothing runs until you approve.';
    banner.classList.add('visible');
    banner.classList.remove('danger');
  } else if (currentMode === MODE.CHAT) {
    banner.textContent = '\u{1F4AC} Chat mode — direct Q&A with streaming tokens. No planner, no capabilities, no gates.';
    banner.classList.add('visible');
    banner.classList.remove('danger');
  } else {
    banner.classList.remove('visible', 'danger');
    banner.textContent = '';
  }

  if (modeChipEl) {
    modeChipEl.className = 'cp-title-dot';
    modeChipEl.classList.add('mode-' + currentMode);
  }
}

function setMode(mode) {
  if (mode !== MODE.NORMAL && mode !== MODE.PLAN && mode !== MODE.BYPASS && mode !== MODE.CHAT) return;
  if (mode === currentMode) return;
  currentMode = mode;
  saveMode();
  applyModeUI();
  pushSystemMessage(`Mode \u2192 ${labelFor(mode)}`);
}

function labelFor(mode) {
  return mode === MODE.PLAN ? 'Plan'
       : mode === MODE.BYPASS ? 'Bypass'
       : mode === MODE.CHAT ? 'Chat'
       : 'Normal';
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE RENDERING
// ═══════════════════════════════════════════════════════════════

// Onboarding-style empty state (2026-05-04, "Cowork-style" pivot).
// Pulls live skill + app names from the registries so the suggestions
// match the actual installed surface — and so they keep working when
// the user installs more skills / apps later. Three categories:
//
//   Get it done  — top skills from skill-registry (phrase shortcuts)
//   Open an app  — picks from the user's docked / common apps
//   Ask Astrion  — grounding queries that exercise the new system
//                  prompt (the AI now knows what it can do)
//
// The full "what can you do" answer streams from the AI itself —
// cheaper than hardcoding a help doc here AND it keeps drifting in
// sync with reality as new caps land.
function renderEmpty() {
  if (messages.length !== 0) return;

  const COMMON_APPS = ['Calculator', 'Notes', 'Calendar', 'Music', 'Maps', 'Weather'];
  const SKILL_PICKS = ['organize-downloads', 'whats-on-my-calendar', 'quick-timer', 'new-reminder', 'toggle-dark-mode'];

  let appButtons = [];
  try {
    const apps = processManager.getAllApps();
    appButtons = COMMON_APPS
      .filter(name => apps.some(a => a.name === name))
      .slice(0, 3)
      .map(name => ({ q: `open ${name}`, label: `Open ${name}` }));
  } catch {}

  let skillButtons = [];
  try {
    const skills = listSkills().filter(s => s.enabled);
    skillButtons = SKILL_PICKS
      .map(n => skills.find(s => s.name === n))
      .filter(Boolean)
      .slice(0, 3)
      .map(s => ({ q: s.phrases?.[0] || s.name, label: s.phrases?.[0] || s.name }));
  } catch {}

  const askButtons = [
    { q: 'What can you do?', label: 'What can you do?' },
    { q: 'List my installed apps', label: 'List my installed apps' },
    { q: 'Explain the Astrion safety triple', label: 'How does Astrion stay safe?' },
  ];

  const section = (label, btns) => btns.length === 0 ? '' : `
    <div class="cp-empty-section">
      <div class="cp-empty-section-label">${label}</div>
      <div class="cp-empty-examples">
        ${btns.map(b => `<button class="cp-example" data-q="${escapeAttr(b.q)}">${escapeAttr(b.label)}</button>`).join('')}
      </div>
    </div>
  `;

  listEl.innerHTML = `
    <div class="cp-empty">
      <div class="cp-empty-icon">\u{1F4AC}</div>
      <div class="cp-empty-text"><strong>Hey, I'm Astrion.</strong></div>
      <div class="cp-empty-subtext">I know every app and skill on this OS — try one, or ask me anything.</div>
      ${section('Get it done', skillButtons)}
      ${section('Open an app', appButtons)}
      ${section('Ask Astrion', askButtons)}
      <div class="cp-empty-tip">Tip: press <kbd>Cmd</kbd>+<kbd>Space</kbd> for Spotlight, or type <kbd>?</kbd> there for the full command list.</div>
    </div>
  `;
  listEl.querySelectorAll('.cp-example').forEach(el => {
    el.addEventListener('click', () => {
      inputEl.value = el.dataset.q;
      inputEl.focus();
      handleSend();
    });
  });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pushUserMessage(text) {
  const msg = { id: newMsgId(), role: 'user', text, kind: 'text', mode: currentMode };
  messages.push(msg);
  renderMessage(msg);
  scrollToBottom();
  saveMessages();
  return msg;
}

function pushSystemMessage(text, cls = '') {
  const msg = { id: newMsgId(), role: 'system', text, kind: 'system', cls };
  messages.push(msg);
  renderMessage(msg);
  scrollToBottom();
  return msg;
}

function pushAssistantMessage(text, opts = {}) {
  const msg = {
    id: newMsgId(),
    role: 'assistant',
    text,
    kind: opts.kind || 'text',
    planId: opts.planId || null,
    meta: opts.meta || null,
  };
  messages.push(msg);
  renderMessage(msg);
  scrollToBottom();
  saveMessages();
  return msg;
}

function updateMessage(id, mutator) {
  const msg = messages.find(m => m.id === id);
  if (!msg) return;
  mutator(msg);
  const node = listEl.querySelector(`[data-msg-id="${id}"]`);
  if (node) node.replaceWith(messageNode(msg));
  scrollToBottom();
  // Persist the post-mutation state — important for streamed
  // assistant messages that grow token-by-token. Save throttled
  // by the JSON serialization cost (negligible at our sizes).
  saveMessages();
}

function removeMessage(id) {
  const idx = messages.findIndex(m => m.id === id);
  if (idx === -1) return;
  messages.splice(idx, 1);
  const node = listEl?.querySelector(`[data-msg-id="${id}"]`);
  if (node) node.remove();
}

function renderMessage(msg) {
  // If list currently shows the empty state, clear it first
  const empty = listEl.querySelector('.cp-empty');
  if (empty) empty.remove();
  listEl.appendChild(messageNode(msg));
}

function messageNode(msg) {
  const row = document.createElement('div');
  row.className = `cp-msg cp-msg-${msg.role}`;
  if (msg.cls) row.classList.add(msg.cls);
  row.dataset.msgId = msg.id;

  if (msg.role === 'user') {
    const dotCls = msg.mode === MODE.BYPASS ? 'danger' : '';
    row.innerHTML = `
      <div class="cp-bubble user">
        ${dotCls ? `<span class="cp-mode-dot ${dotCls}" title="Sent in Bypass mode"></span>` : ''}
        <div class="cp-bubble-text">${escapeHtml(msg.text)}</div>
        <div class="cp-bubble-actions">
          <button class="cp-bubble-action cp-user-copy" data-msg-id="${msg.id}" title="Copy message">⎘</button>
        </div>
      </div>
    `;
    // Wire user-bubble copy after insertion (deferred so the DOM has
    // the new node mounted before we attach the listener).
    setTimeout(() => {
      const btn = panelEl?.querySelector(`.cp-user-copy[data-msg-id="${msg.id}"]`);
      btn?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(msg.text || '');
          btn.innerHTML = '✓';
          setTimeout(() => { btn.innerHTML = '⎘'; }, 1200);
        } catch {}
      });
    }, 0);
  } else if (msg.role === 'system') {
    row.innerHTML = `<div class="cp-sys">${escapeHtml(msg.text)}</div>`;
  } else {
    // assistant
    if (msg.kind === 'plan-preview') {
      row.appendChild(renderPlanPreviewCard(msg));
    } else if (msg.kind === 'plan-progress') {
      row.appendChild(renderPlanProgressCard(msg));
    } else if (msg.kind === 'clarify') {
      row.appendChild(renderClarifyCard(msg));
    } else {
      const m = msg.meta || {};
      const metaParts = [];
      if (m.brain)    metaParts.push(escapeHtml(m.brain));
      if (m.model)    metaParts.push(escapeHtml(m.model));
      if (m.provider && m.provider !== 'ollama') metaParts.push(escapeHtml(m.provider));
      const meta = metaParts.length
        ? `<span class="cp-bubble-meta">${metaParts.join(' \u00B7 ')}</span>`
        : '';
      const isStreaming = !!msg.meta?.streaming;
      const hasText = msg.text && msg.text.length > 2;  /* skip "…" placeholder */
      const copyId = `cpcopy-${msg.id}`;
      const regenId = `cpregen-${msg.id}`;
      // While streaming, show plain (escaped) text so partial markdown
      // tokens don't render half-broken (e.g. "**hel" mid-bold). Once
      // complete, re-render through the markdown pipeline so headers /
      // bold / lists / code actually look like what they are.
      const bodyHtml = isStreaming
        ? escapeHtml(msg.text)
        : renderMarkdown(msg.text);
      row.innerHTML = `
        <div class="cp-bubble assistant">
          <div class="cp-bubble-text">${bodyHtml}</div>
          ${meta}
          ${hasText && !isStreaming ? `
            <div class="cp-bubble-actions">
              <button class="cp-bubble-action" id="${copyId}" title="Copy reply">\u2398</button>
              <button class="cp-bubble-action" id="${regenId}" title="Regenerate">\u21BB</button>
              <button class="cp-bubble-action cp-speak-btn" data-msg-id="${msg.id}" title="Read aloud">\u{1F509}</button>
            </div>
          ` : ''}
        </div>
      `;
      /* Wire Copy + Regenerate after DOM insertion */
      setTimeout(() => {
        const copyBtn = document.getElementById(copyId);
        const regenBtn = document.getElementById(regenId);
        copyBtn?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(msg.text || '');
            copyBtn.innerHTML = '\u2713';
            setTimeout(() => { copyBtn.innerHTML = '\u2398'; }, 1200);
          } catch {}
        });
        regenBtn?.addEventListener('click', () => {
          /* Walk back to find the most recent user message above this one */
          const idx = messages.indexOf(msg);
          for (let i = idx - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
              inputEl.value = messages[i].text;
              handleSend();
              return;
            }
          }
        });
        const speakBtn = panelEl?.querySelector(`.cp-speak-btn[data-msg-id="${msg.id}"]`);
        speakBtn?.addEventListener('click', () => speakText(msg.text));
      }, 0);
    }
  }
  return row;
}

function renderPlanPreviewCard(msg) {
  const card = document.createElement('div');
  card.className = 'cp-plan-card';
  const plan = msg.meta?.plan;
  const steps = plan?.steps || [];
  card.innerHTML = `
    <div class="cp-plan-head">
      <span class="cp-plan-icon">\u{1F50D}</span>
      <span class="cp-plan-title">Planned ${steps.length} step${steps.length === 1 ? '' : 's'}</span>
    </div>
    ${plan?.reasoning ? `<div class="cp-plan-reasoning">${escapeHtml(plan.reasoning)}</div>` : ''}
    <ol class="cp-plan-steps">
      ${steps.map((s, i) => `
        <li>
          <code>${escapeHtml(s.cap || '?')}</code>
          ${s.args ? `<span class="cp-plan-args">${escapeHtml(shortArgs(s.args))}</span>` : ''}
        </li>`).join('')}
    </ol>
    <div class="cp-plan-actions">
      <button class="cp-btn cp-btn-primary" data-act="approve">\u2713 Approve</button>
      <button class="cp-btn cp-btn-ghost" data-act="discard">\u2715 Discard</button>
    </div>
  `;
  card.querySelector('[data-act="approve"]').addEventListener('click', () => {
    if (msg.meta?.onApprove) msg.meta.onApprove();
    card.querySelector('.cp-plan-actions').innerHTML = '<span class="cp-plan-approved">\u2713 Approved, running\u2026</span>';
  });
  card.querySelector('[data-act="discard"]').addEventListener('click', () => {
    if (msg.meta?.onDiscard) msg.meta.onDiscard();
    card.querySelector('.cp-plan-actions').innerHTML = '<span class="cp-plan-discarded">\u2715 Discarded</span>';
  });
  return card;
}

function renderPlanProgressCard(msg) {
  const card = document.createElement('div');
  card.className = 'cp-plan-card progress';
  const group = msg.meta?.group;
  const steps = group?.plan?.steps || [];
  const status = group?.status || 'running';
  card.innerHTML = `
    <div class="cp-plan-head">
      <span class="cp-plan-icon">${status === 'done' ? '\u2713' : status === 'failed' ? '\u2717' : '\u25D4'}</span>
      <span class="cp-plan-title">${status === 'done' ? 'Completed' : status === 'failed' ? 'Failed' : 'Running'} ${steps.length} step${steps.length === 1 ? '' : 's'}</span>
    </div>
    <ul class="cp-plan-progress">
      ${steps.map((s, i) => {
        const state = group?.stepStates?.[i] || 'pending';
        const icon = state === 'done' ? '\u2713' : state === 'running' ? '\u25D4' : state === 'failed' ? '\u2717' : '\u00B7';
        return `<li class="state-${state}"><span class="cp-step-icon">${icon}</span> <code>${escapeHtml(s.cap || '?')}</code></li>`;
      }).join('')}
    </ul>
    ${group?.error ? `<div class="cp-plan-error">${escapeHtml(group.error)}</div>` : ''}
  `;
  return card;
}

function renderClarifyCard(msg) {
  const card = document.createElement('div');
  card.className = 'cp-plan-card clarify';
  const choices = msg.meta?.choices || [];
  card.innerHTML = `
    <div class="cp-plan-head">
      <span class="cp-plan-icon">?</span>
      <span class="cp-plan-title">Need clarification</span>
    </div>
    <div class="cp-clarify-q">${escapeHtml(msg.meta?.question || msg.text || '')}</div>
    <div class="cp-clarify-choices">
      ${choices.map(c => `<button class="cp-btn cp-btn-ghost" data-choice="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
    </div>
  `;
  card.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      inputEl.value = btn.dataset.choice;
      handleSend();
    });
  });
  return card;
}

function shortArgs(args) {
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 77) + '\u2026' : s;
  } catch { return ''; }
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    listEl.scrollTop = listEl.scrollHeight;
  });
}

// Web Speech Synthesis — read text aloud. Cancel any prior utterance
// so back-to-back clicks don't queue up. No-op if synth unavailable.
function speakText(text) {
  if (!text || typeof window.speechSynthesis === 'undefined') return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 2000));
    /* Honor Settings > AI > Voice picks (voice / rate / pitch). All
     * persisted to localStorage by the settings panel. Falls back to
     * en-US 1.0/1.0 if absent. */
    const wantedVoice = localStorage.getItem('astrion-tts-voice');
    if (wantedVoice) {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(vv => vv.voiceURI === wantedVoice);
      if (v) { u.voice = v; u.lang = v.lang; }
    }
    if (!u.lang) u.lang = 'en-US';
    u.rate = parseFloat(localStorage.getItem('astrion-tts-rate') || '1.0') || 1.0;
    u.pitch = parseFloat(localStorage.getItem('astrion-tts-pitch') || '1.0') || 1.0;
    window.speechSynthesis.speak(u);
  } catch {}
}

// Web Speech API mic — pushes the recognized text into the input field.
// User still has to hit Enter to send. Stub gracefully if the browser
// has no SpeechRecognition (Firefox without flag, some WebKitGTK builds).
let voiceRecognizer = null;
function startVoiceInput() {
  const Sr = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = panelEl?.querySelector('#cp-mic');
  if (!Sr) {
    if (micBtn) {
      micBtn.title = 'Voice input not supported in this browser';
      micBtn.style.opacity = '0.3';
    }
    return;
  }
  if (voiceRecognizer) {
    /* Already listening — stop. */
    try { voiceRecognizer.stop(); } catch {}
    voiceRecognizer = null;
    if (micBtn) micBtn.classList.remove('listening');
    return;
  }
  voiceRecognizer = new Sr();
  voiceRecognizer.lang = 'en-US';
  voiceRecognizer.interimResults = true;
  voiceRecognizer.continuous = false;
  if (micBtn) micBtn.classList.add('listening');

  let assembled = '';
  voiceRecognizer.onresult = (e) => {
    let text = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
    }
    assembled = text;
    if (inputEl) {
      inputEl.value = assembled;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
    }
  };
  voiceRecognizer.onend = () => {
    voiceRecognizer = null;
    if (micBtn) micBtn.classList.remove('listening');
  };
  voiceRecognizer.onerror = () => {
    voiceRecognizer = null;
    if (micBtn) micBtn.classList.remove('listening');
  };
  try { voiceRecognizer.start(); } catch {}
}

function clearConversation() {
  clearMessages(); // wipes both in-memory + persisted scrollback
  planGroups.clear();
  listEl.innerHTML = '';
  renderEmpty();
  // Also start a fresh conversation session so the planner / chat
  // history doesn't carry over the old context. Best-effort import —
  // ok if the module isn't ready yet.
  import('../kernel/conversation-memory.js')
    .then(m => m.startFreshSession?.())
    .catch(() => {});
  // Same for ai-service's running conversationHistory (used as
  // implicit context for askStream/askWithMeta when skipHistory=false).
  // 2026-05-03: clearHistory() also wipes the persisted blob so the
  // next page load doesn't restore the abandoned session.
  import('../kernel/ai-service.js')
    .then(m => { m.aiService?.clearHistory?.(); })
    .catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// SEND FLOW — four mode handlers
// ═══════════════════════════════════════════════════════════════

async function handleSend() {
  let query = (inputEl.value || '').trim();
  if (!query && !pendingAttachment) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  /* If a file was dropped onto the panel, prepend its content as
   * context for the AI. Drop the attachment after one send so it
   * doesn't accumulate across questions. */
  let visibleQuery = query;
  let modelQuery = query;
  if (pendingAttachment) {
    const attached = pendingAttachment;
    pendingAttachment = null;
    reflectAttachment();
    visibleQuery = `\u{1F4CE} ${attached.name}\n${query || '(attached above)'}`;
    modelQuery = `[attached file: ${attached.name}, ${attached.bytes} bytes]\n` +
      attached.content.slice(0, 50000) +
      (attached.content.length > 50000 ? '\n[...truncated to 50KB]' : '') +
      `\n\nUser question: ${query || '(no question — explain or summarize this file)'}`;
  }

  pushUserMessage(visibleQuery);

  if (currentMode === MODE.NORMAL) {
    sendNormal(modelQuery);
  } else if (currentMode === MODE.PLAN) {
    sendPlan(modelQuery);
  } else if (currentMode === MODE.BYPASS) {
    sendBypass(modelQuery);
  } else if (currentMode === MODE.CHAT) {
    sendChat(modelQuery);
  }
}

function reflectAttachment() {
  if (!panelEl) return;
  const hintEl = panelEl.querySelector('#cp-hint');
  if (!hintEl) return;
  if (pendingAttachment) {
    hintEl.textContent = `\u{1F4CE} ${pendingAttachment.name} attached · will send with your next message`;
    hintEl.dataset.attached = '1';
  } else {
    delete hintEl.dataset.attached;
    hintEl.textContent = 'Enter to send · Shift+Enter for newline · Ctrl+Shift+K to toggle';
  }
}

// CHAT mode: direct Q&A with the AI — no planner, no capability dispatch,
// no L2 gates, no self-mod machinery. Tokens stream in live so the reply
// bubble paints as the model generates. The Stop button (below the input
// while streaming) aborts the fetch mid-stream via AbortController.
let chatAbortController = null;

async function sendChat(query) {
  // Abort any in-flight stream when a new message starts
  if (chatAbortController) {
    try { chatAbortController.abort(); } catch {}
    chatAbortController = null;
  }
  chatAbortController = new AbortController();
  toggleChatStopButton(true);

  const replyMsg = pushAssistantMessage('\u2026', { kind: 'text', meta: { streaming: true } });
  let assembled = '';
  let firstChunk = true;

  try {
    const aiMod = await import('../kernel/ai-service.js');
    const result = await aiMod.aiService.askStream(query, {
      skipHistory: false,
      capCategory: 'chat',
      // 4096 not 800 — structured answers (audit reports, plans,
      // multi-section comparisons) routinely run 1500-3000 tokens
      // and 800 truncated them mid-paragraph. 4096 gives headroom
      // without exhausting most local-model context budgets.
      maxTokens: 4096,
      signal: chatAbortController.signal,
    }, (delta) => {
      if (firstChunk) { assembled = ''; firstChunk = false; }
      assembled += delta;
      updateMessage(replyMsg.id, m => {
        m.text = assembled;
        m.kind = 'text';
      });
    });
    updateMessage(replyMsg.id, m => {
      if (!m.text) m.text = '(no reply)';
      m.meta = {
        ...(m.meta || {}),
        streaming: false,
        brain: result?.meta?.brain,
        model: result?.meta?.model,
        provider: result?.meta?.provider,
      };
    });
    /* Auto-speak the reply if the user toggled it on (persisted to
     * localStorage). Demo-relevant for hands-free Q&A. */
    if (localStorage.getItem('astrion-chat-autospeak') === '1' && assembled) {
      speakText(assembled);
    }
  } catch (err) {
    // AbortError = user clicked Stop; keep whatever tokens we got + mark
    const aborted = err?.name === 'AbortError';
    updateMessage(replyMsg.id, m => {
      m.kind = 'text';
      if (aborted && assembled) m.text = assembled + '  \u2014 (stopped)';
      else if (aborted) m.text = '\u2014 (stopped)';
      else m.text = '\u2717 Chat failed: ' + (err?.message || String(err));
      m.meta = { ...(m.meta || {}), streaming: false };
    });
  } finally {
    chatAbortController = null;
    toggleChatStopButton(false);
  }
}

function toggleChatStopButton(streaming) {
  if (!panelEl) return;
  const send = panelEl.querySelector('#cp-send');
  const hintEl = panelEl.querySelector('#cp-hint');
  if (streaming) {
    if (send) {
      send.innerHTML = '\u25A0'; /* stop square */
      send.title = 'Stop';
      send.dataset.mode = 'stop';
    }
    if (hintEl) hintEl.textContent = 'Streaming\u2026 click the stop button to interrupt';
  } else {
    if (send) {
      send.innerHTML = '\u27A4'; /* arrow send */
      send.title = 'Send (Enter)';
      send.dataset.mode = 'send';
    }
    if (hintEl) hintEl.textContent = 'Enter to send \u00B7 Shift+Enter for newline \u00B7 Ctrl+Shift+K to toggle';
  }
}

function sendNormal(query) {
  // Same path as Spotlight: emit intent:plan and let the intent-executor
  // wire into the planner + executePlan. L2+ gates fire via Spotlight's
  // existing preview subscriber; we just mirror plan progress in our UI.
  eventBus.emit('intent:plan', { query, parsedIntent: null });
}

async function sendPlan(query) {
  // Preview-first: call planIntent() directly, show the plan inline,
  // wait for Approve/Discard, then call executePlan() on Approve.
  const waitingMsg = pushAssistantMessage('Planning\u2026', { kind: 'text' });
  try {
    const plannerMod = await import('../kernel/intent-planner.js');
    const memoryMod = await import('../kernel/conversation-memory.js');
    const sessionId = memoryMod.getOrCreateSession();
    const memory = await memoryMod.getRecentTurns(sessionId);

    const plan = await plannerMod.planIntent({ query, memory });

    if (plan.status === 'clarify') {
      updateMessage(waitingMsg.id, m => {
        m.kind = 'clarify';
        m.text = plan.question || 'Can you clarify?';
        m.meta = { question: plan.question, choices: plan.choices || [] };
      });
      return;
    }
    if (plan.status !== 'plan') {
      // No actionable plan — fall through to basic chat so the user
      // gets a real reply instead of "Could not plan: unknown." 2026-
      // 05-03 user request: "bypass mode and all the others should
      // have basic chat without planning built into them."
      removeMessage(waitingMsg.id);
      sendChat(query);
      return;
    }

    // Render plan card with Approve/Discard
    updateMessage(waitingMsg.id, m => {
      m.kind = 'plan-preview';
      m.text = '';
      m.meta = {
        plan,
        onApprove: () => runPlan(plan, { query, sessionId }),
        onDiscard: () => {
          pushSystemMessage('Plan discarded. No changes made.');
        },
      };
    });
  } catch (err) {
    // Planner threw — chat fallback rather than dead-ending the user.
    removeMessage(waitingMsg.id);
    pushSystemMessage('Planner unavailable — answering directly.');
    sendChat(query);
  }
}

async function sendBypass(query) {
  // Red-banner mode: skip gates. Plan + execute with auto-confirm.
  const waitingMsg = pushAssistantMessage('Planning (bypass)\u2026', { kind: 'text' });
  try {
    const plannerMod = await import('../kernel/intent-planner.js');
    const memoryMod = await import('../kernel/conversation-memory.js');
    const sessionId = memoryMod.getOrCreateSession();
    const memory = await memoryMod.getRecentTurns(sessionId);

    const plan = await plannerMod.planIntent({ query, memory });

    if (plan.status === 'clarify') {
      // Bypass mode still clarifies when the planner literally cannot
      // proceed — not a safety gate, just an information gap
      updateMessage(waitingMsg.id, m => {
        m.kind = 'clarify';
        m.text = plan.question || 'Can you clarify?';
        m.meta = { question: plan.question, choices: plan.choices || [] };
      });
      return;
    }
    if (plan.status !== 'plan') {
      // No actionable plan \u2014 fall through to basic chat (same as
      // PLAN mode; user wanted chat available regardless of mode).
      removeMessage(waitingMsg.id);
      sendChat(query);
      return;
    }

    // Remove waiting message and run plan
    updateMessage(waitingMsg.id, m => {
      m.kind = 'text';
      m.text = '\u26A1 Running plan with gates bypassed\u2026';
      m.cls = 'danger';
    });
    runPlan(plan, { query, sessionId, bypass: true });
  } catch (err) {
    removeMessage(waitingMsg.id);
    pushSystemMessage('Planner unavailable \u2014 answering directly.');
    sendChat(query);
  }
}

async function runPlan(plan, opts = {}) {
  const { query, sessionId, bypass } = opts;
  if (bypass) bypassAutoConfirmOn = true;
  try {
    const execMod = await import('../kernel/intent-executor.js');
    const memoryMod = await import('../kernel/conversation-memory.js');
    const result = await execMod.executePlan(plan, { query, sessionId });
    await memoryMod.recordTurn({
      sessionId,
      query,
      plan,
      ok: result.ok,
      error: result.error || null,
      capSummary: `plan (${plan.steps.length} steps)`,
    });
    // 2026-05-03 — if the plan failed (e.g. planner picked the wrong
    // capability + got rejected on a missing arg, like the
    // code.generate/suiteId failure on adversarial-audit prompts),
    // fall through to a basic chat answer. The user's question still
    // deserves a reply — don't dead-end them on a planner mistake.
    if (!result.ok && query) {
      pushSystemMessage('Plan didn’t fit — answering directly instead.');
      sendChat(query);
      return;
    }

    // 2026-05-03 — when a plan succeeds, surface the actual ANSWER as
    // a visible assistant message. Each entry in result.results is a
    // wrapper { index, cap, output, provenance } — the cap's actual
    // payload lives under .output. Walk in reverse and pull the
    // first non-empty answer/summary/text/reply.
    if (result.ok && Array.isArray(result.results)) {
      const findAnswer = (out) => {
        if (!out || typeof out !== 'object') return null;
        if (out.answer && typeof out.answer === 'string') return out.answer;
        if (out.summary && typeof out.summary === 'string') return out.summary;
        if (out.text && typeof out.text === 'string') return out.text;
        if (out.reply && typeof out.reply === 'string') return out.reply;
        // Recurse into any nested object (e.g. wrapper.output, wrapper.result)
        if (out.output && typeof out.output === 'object') {
          const r = findAnswer(out.output);
          if (r) return r;
        }
        if (out.result && typeof out.result === 'object') {
          const r = findAnswer(out.result);
          if (r) return r;
        }
        return null;
      };
      let answer = null;
      for (let i = result.results.length - 1; i >= 0; i--) {
        const found = findAnswer(result.results[i]);
        if (found) { answer = found; break; }
      }
      if (answer) {
        pushAssistantMessage(answer, {
          kind: 'text',
          meta: { brain: 's1', model: 'plan-executor', provider: 'ollama' },
        });
      } else {
        // No textual output found — give the user a clear note so the
        // plan doesn't dead-end on a silent "Done."
        pushSystemMessage('Plan finished but produced no readable answer. Try asking again or switch to Chat mode.');
      }
    }
  } catch (err) {
    // Executor crashed entirely — fall through to chat so the user
    // gets something rather than an empty void.
    if (query) {
      pushSystemMessage('Plan executor errored — answering directly.');
      sendChat(query);
    }
  } finally {
    if (bypass) bypassAutoConfirmOn = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENT SUBSCRIPTIONS — mirror kernel progress into the panel
// ═══════════════════════════════════════════════════════════════

function subscribeEvents() {
  eventBus.on('plan:started', onPlanStarted);
  eventBus.on('plan:preview', onPlanPreview);
  eventBus.on('plan:step:start', onStepStart);
  eventBus.on('plan:step:done', onStepDone);
  eventBus.on('plan:step:fail', onStepFail);
  eventBus.on('plan:completed', onPlanCompleted);
  eventBus.on('plan:failed', onPlanFailed);
  eventBus.on('plan:clarify', onPlanClarify);
  eventBus.on('interception:preview', onInterceptionPreview);

  // ─── Thought-phase indicator ──────────────────────────────────
  // Small breadcrumb under the header that narrates what the AI is
  // currently doing: planning → red-team reviewing → executing step N
  // → done. Gives the panel a "live agent" feel during Normal/Plan
  // mode. Cleared when plan:completed / plan:failed fires.
  eventBus.on('ai:thinking', () => setPhase('\u{1F9E0} Thinking\u2026'));
  eventBus.on('plan:started', ({ plan }) => setPhase(`\u{1F9E0} Planned ${plan?.steps?.length || 0} step${plan?.steps?.length === 1 ? '' : 's'}`));
  eventBus.on('interception:preview', ({ cap }) => setPhase(`\u{1F50E} Red-team reviewing: ${cap?.id || 'action'}`));
  eventBus.on('plan:step:start', ({ index, step }) => setPhase(`\u2699 Running step ${index + 1}: ${step?.cap || '?'}`));
  eventBus.on('plan:completed', () => setPhase('\u2713 Done', 3000));
  eventBus.on('plan:failed', ({ error }) => setPhase(`\u2717 ${error || 'failed'}`, 4000));
}

let phaseTimeout = null;
function setPhase(text, clearAfterMs) {
  if (!panelEl) return;
  const el = panelEl.querySelector('#cp-phase');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
  if (phaseTimeout) { clearTimeout(phaseTimeout); phaseTimeout = null; }
  if (clearAfterMs) {
    phaseTimeout = setTimeout(() => {
      el.textContent = '';
      el.classList.remove('visible');
    }, clearAfterMs);
  }
}

function onPlanStarted({ planId, plan, totalTokens, query, reasoning }) {
  // Only show progress card if this panel was the origin (i.e. we are
  // open and the plan matches the last user message). Heuristic: if
  // we're open and the query matches our most recent user message, own it.
  if (!isOpen && messages.length === 0) return;
  const group = {
    planId, plan, status: 'running',
    stepStates: plan.steps.map(() => 'pending'),
    query: query || '',
    mode: currentMode,
  };
  const msg = pushAssistantMessage('', { kind: 'plan-progress', planId, meta: { group } });
  group.messageId = msg.id;
  planGroups.set(planId, group);
}

function onPlanPreview({ planId, plan, totalTokens }) {
  // In Bypass mode, auto-confirm immediately. The user flipped the
  // switch and owns this call.
  if (bypassAutoConfirmOn) {
    setTimeout(() => eventBus.emit('plan:confirmed', { planId }), 0);
  }
  // In Normal mode, Spotlight's subscriber renders the approval UI —
  // we don't fight it. In Plan mode we never hit this because Plan
  // does its own gating before executePlan is called.
}

function onStepStart({ planId, index }) {
  const group = planGroups.get(planId);
  if (!group) return;
  group.stepStates[index] = 'running';
  refreshGroup(group);
}

function onStepDone({ planId, index }) {
  const group = planGroups.get(planId);
  if (!group) return;
  group.stepStates[index] = 'done';
  refreshGroup(group);
}

function onStepFail({ planId, index, error }) {
  const group = planGroups.get(planId);
  if (!group) return;
  group.stepStates[index] = 'failed';
  group.error = error || 'step failed';
  refreshGroup(group);
}

function onPlanCompleted({ planId, results }) {
  const group = planGroups.get(planId);
  if (!group) return;
  group.status = 'done';
  refreshGroup(group);
  // Short summary below the progress card
  const outputSummary = summarizeResults(results);
  if (outputSummary) pushAssistantMessage(outputSummary);
}

function onPlanFailed({ planId, error, atStep }) {
  const group = planGroups.get(planId);
  if (!group) {
    // Sometimes the plan fails pre-start (budget, unknown cap).
    // Surface it even without a group.
    pushAssistantMessage('\u2717 Failed: ' + (error || 'unknown'), { kind: 'text' });
    return;
  }
  group.status = 'failed';
  group.error = error || 'failed';
  if (typeof atStep === 'number' && atStep >= 0 && group.stepStates[atStep]) {
    group.stepStates[atStep] = 'failed';
  }
  refreshGroup(group);
}

function onPlanClarify({ query, question, choices }) {
  // Only surface if user's last message matches
  const last = [...messages].reverse().find(m => m.role === 'user');
  if (!last || last.text !== query) return;
  pushAssistantMessage(question, {
    kind: 'clarify',
    meta: { question, choices: choices || [] },
  });
}

function onInterceptionPreview({ id }) {
  // Bypass mode auto-confirms single-step L2+ intents too
  if (bypassAutoConfirmOn) {
    setTimeout(() => eventBus.emit('interception:confirm', { id }), 0);
  }
}

function refreshGroup(group) {
  if (!group.messageId) return;
  updateMessage(group.messageId, m => {
    m.meta = { group };
  });
}

function summarizeResults(results) {
  if (!Array.isArray(results) || results.length === 0) return '';
  // Pull any `path` or `id` fields for a compact summary
  const firstOutput = results[0]?.output;
  if (firstOutput?.path) return '\u2713 ' + firstOutput.path;
  if (firstOutput?.id) return '\u2713 ' + firstOutput.id;
  if (typeof firstOutput === 'string') return '\u2713 ' + firstOutput;
  return '\u2713 Done';
}

// ═══════════════════════════════════════════════════════════════
// KEYBOARD
// ═══════════════════════════════════════════════════════════════

// External integration point: any app can fire a CustomEvent
// 'astrion:chat-attach' with { name, content, question } in detail to
// pre-fill the chat panel + auto-attach text + drop a starter question.
// Used by Text Editor's ✨ Explain / Improve buttons; any future
// per-app AI button can use the same hook with no chat-panel changes.
window.addEventListener('astrion:chat-attach', (e) => {
  const { name, content, question } = e.detail || {};
  if (!content) return;
  if (!isOpen) openChatPanel();
  if (currentMode !== MODE.CHAT) setMode(MODE.CHAT);
  pendingAttachment = {
    name: name || 'attached',
    content: String(content).slice(0, 50000),
    bytes: content.length,
  };
  reflectAttachment();
  if (inputEl) {
    inputEl.value = question || '';
    setTimeout(() => inputEl.focus(), 50);
  }
  pushSystemMessage(`\u{1F4CE} ${name || 'content'} attached · ${question ? 'starter question pre-filled' : 'type a question + Enter'}`);
});

function subscribeKeyboard() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    /* Ctrl+Shift+K toggles the panel */
    if (mod && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      e.preventDefault();
      toggleChatPanel();
      return;
    }
    /* Ctrl+Shift+A — "Ask Astrion about this": grab whatever's
     * selected on the page and pre-fill the chat panel with it as
     * an attachment. Skips if no selection or selection is just
     * whitespace. Switches to Chat mode automatically so the
     * planner doesn't try to dispatch the selection as a command. */
    if (mod && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      const sel = window.getSelection?.()?.toString().trim();
      if (sel && sel.length > 0) {
        e.preventDefault();
        if (!isOpen) openChatPanel();
        if (currentMode !== MODE.CHAT) setMode(MODE.CHAT);
        pendingAttachment = {
          name: 'selection',
          content: sel.slice(0, 50000),
          bytes: sel.length,
        };
        reflectAttachment();
        if (inputEl) {
          inputEl.value = '';
          setTimeout(() => inputEl.focus(), 50);
        }
        pushSystemMessage(`\u{1F4CE} Selected ${sel.length} chars attached · type a question or hit Enter.`);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

function injectStyles() {
  if (document.getElementById('chat-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'chat-panel-styles';
  style.textContent = MARKDOWN_STYLES + `
    #chat-panel-toggle {
      position: fixed;
      right: 16px;
      bottom: 80px;
      z-index: 9998;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(30,30,42,0.92);
      color: white;
      font-size: 20px;
      cursor: pointer;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      transition: transform 0.15s ease, opacity 0.2s ease;
    }
    #chat-panel-toggle:hover { transform: scale(1.08); }
    #chat-panel-toggle.hidden { opacity: 0; pointer-events: none; }

    .chat-panel {
      position: fixed;
      top: 24px;
      right: 0;
      bottom: 72px;
      width: 380px;
      max-width: calc(100vw - 16px);
      background: rgba(22, 22, 30, 0.96);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-left: 1px solid rgba(255,255,255,0.08);
      border-top: 1px solid rgba(255,255,255,0.08);
      border-bottom: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px 0 0 14px;
      color: white;
      font-family: var(--font, -apple-system, BlinkMacSystemFont, sans-serif);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.22s cubic-bezier(.3,.9,.3,1);
      z-index: 9997;
      box-shadow: -8px 0 40px rgba(0,0,0,0.35);
    }
    .chat-panel.open { transform: translateX(0); }

    .chat-panel.cp-drag-over {
      box-shadow: inset 0 0 0 3px rgba(90,200,250,0.6);
    }
    .chat-panel.cp-drag-over::before {
      content: 'Drop file to attach as chat context';
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(90,200,250,0.12);
      color: #5ac8fa;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      pointer-events: none;
      z-index: 10;
    }

    .chat-panel[data-mode="bypass"] {
      border-color: rgba(255, 69, 58, 0.3);
      box-shadow: -8px 0 40px rgba(255, 69, 58, 0.18);
    }

    .cp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px 8px 14px;
    }
    .cp-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
    }
    .cp-title-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #34c759;
    }
    .cp-title-dot.mode-plan { background: #5ac8fa; }
    .cp-title-dot.mode-bypass { background: #ff453a; box-shadow: 0 0 8px rgba(255,69,58,0.7); }
    .cp-title-dot.mode-chat { background: #bf5af2; }

    .cp-header-actions { display: flex; gap: 4px; }
    .cp-iconbtn {
      width: 28px; height: 28px;
      border: none;
      background: transparent;
      color: rgba(255,255,255,0.55);
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .cp-iconbtn:hover { background: rgba(255,255,255,0.08); color: white; }
    .cp-iconbtn.active {
      background: rgba(90,200,250,0.18);
      color: #5ac8fa;
      border: 1px solid rgba(90,200,250,0.4);
    }

    .cp-mode-row {
      display: flex;
      gap: 4px;
      padding: 0 14px 8px 14px;
    }
    .cp-mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 6px 8px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.03);
      color: rgba(255,255,255,0.7);
      border-radius: 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      font-family: inherit;
    }
    .cp-mode-btn:hover { background: rgba(255,255,255,0.07); color: white; }
    .cp-mode-btn.active {
      background: rgba(90,200,250,0.18);
      border-color: rgba(90,200,250,0.5);
      color: white;
    }
    .cp-mode-btn[data-mode="bypass"].active {
      background: rgba(255,69,58,0.22);
      border-color: rgba(255,69,58,0.6);
    }
    .cp-mode-btn[data-mode="normal"].active {
      background: rgba(52,199,89,0.18);
      border-color: rgba(52,199,89,0.5);
    }
    .cp-mode-btn[data-mode="chat"].active {
      background: rgba(191,90,242,0.18);
      border-color: rgba(191,90,242,0.55);
    }
    .cp-mode-icon { font-size: 11px; }

    .cp-banner {
      max-height: 0;
      overflow: hidden;
      padding: 0 14px;
      font-size: 11px;
      color: rgba(90,200,250,0.95);
      transition: max-height 0.18s ease;
    }
    .cp-banner.visible {
      max-height: 80px;
      padding: 6px 14px 8px;
    }
    .cp-banner.danger {
      color: #ff6b5e;
      background: rgba(255,69,58,0.08);
    }

    .cp-phase {
      max-height: 0;
      overflow: hidden;
      padding: 0 14px;
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      font-family: ui-monospace, Menlo, monospace;
      transition: max-height 0.2s ease;
      border-bottom: 1px solid transparent;
    }
    .cp-phase.visible {
      max-height: 32px;
      padding: 5px 14px;
      border-bottom-color: rgba(255,255,255,0.04);
    }

    .cp-messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .cp-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: 14px;
      padding: 22px 18px;
      color: rgba(255,255,255,0.55);
      text-align: center;
      height: 100%;
      overflow-y: auto;
    }
    .cp-empty-icon { font-size: 30px; opacity: 0.55; margin-bottom: 0; }
    .cp-empty-text { font-size: 14px; color: rgba(255,255,255,0.92); margin-top: -4px; }
    .cp-empty-text strong { font-weight: 600; }
    .cp-empty-subtext { font-size: 11px; color: rgba(255,255,255,0.5); max-width: 260px; line-height: 1.5; }

    .cp-empty-section {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      max-width: 280px;
      align-items: stretch;
      text-align: left;
    }
    .cp-empty-section-label {
      font-size: 10px;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.35);
      font-weight: 600;
      padding: 0 2px;
    }
    .cp-empty-examples {
      display: flex;
      flex-direction: column;
      gap: 5px;
      width: 100%;
    }
    .cp-example {
      padding: 8px 11px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.78);
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      text-align: left;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }
    .cp-example:hover {
      background: rgba(90,200,250,0.10);
      color: white;
      border-color: rgba(90,200,250,0.28);
    }
    .cp-empty-tip {
      margin-top: 4px;
      font-size: 10px;
      color: rgba(255,255,255,0.35);
      max-width: 280px;
      line-height: 1.5;
    }
    .cp-empty-tip kbd {
      background: rgba(255,255,255,0.08);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10px;
      font-family: ui-monospace, Menlo, monospace;
      color: rgba(255,255,255,0.7);
    }

    .cp-msg { display: flex; flex-direction: column; }
    .cp-msg-user { align-items: flex-end; }
    .cp-msg-assistant { align-items: flex-start; }
    .cp-msg-system { align-items: center; }

    .cp-bubble {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 12.5px;
      line-height: 1.45;
      word-wrap: break-word;
      white-space: pre-wrap;
      /* Make sure text inside chat bubbles is always selectable —
       * some platform CSS sets user-select:none on app shells which
       * propagates here. Explicit here so highlight + copy works. */
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    }
    .cp-bubble.user {
      background: rgba(90,200,250,0.22);
      border: 1px solid rgba(90,200,250,0.28);
      border-bottom-right-radius: 4px;
    }
    .cp-bubble.assistant {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      border-bottom-left-radius: 4px;
    }
    .cp-bubble-text { color: white; }
    .cp-bubble-meta {
      display: block;
      margin-top: 4px;
      font-size: 9px;
      color: rgba(255,255,255,0.4);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .cp-bubble-actions {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      opacity: 0.55;
      transition: opacity 0.15s ease;
    }
    .cp-bubble.assistant:hover .cp-bubble-actions,
    .cp-bubble.user:hover .cp-bubble-actions { opacity: 1; }
    .cp-bubble-action {
      width: 22px; height: 22px;
      padding: 0;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      border-radius: 5px;
      color: rgba(255,255,255,0.7);
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    .cp-bubble-action {
      cursor: pointer;
    }
    .cp-bubble-action:hover {
      background: rgba(255,255,255,0.1);
      color: white;
    }
    .cp-mode-dot {
      display: inline-block;
      width: 6px; height: 6px; border-radius: 50%;
      margin-right: 5px;
      vertical-align: middle;
      background: #ff453a;
    }
    .cp-msg.danger .cp-bubble.assistant,
    .cp-msg-assistant.danger .cp-bubble.assistant {
      background: rgba(255,69,58,0.1);
      border-color: rgba(255,69,58,0.3);
    }

    .cp-sys {
      font-size: 10.5px;
      color: rgba(255,255,255,0.45);
      padding: 2px 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .cp-plan-card {
      width: 100%;
      max-width: 320px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 10px;
      font-size: 12px;
    }
    .cp-plan-card.progress { border-color: rgba(90,200,250,0.25); }
    .cp-plan-card.clarify { border-color: rgba(255,204,0,0.28); background: rgba(255,204,0,0.05); }
    .cp-plan-head {
      display: flex; align-items: center; gap: 6px;
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .cp-plan-reasoning {
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      margin-bottom: 8px;
      line-height: 1.4;
    }
    .cp-plan-steps, .cp-plan-progress {
      margin: 0 0 8px 0;
      padding-left: 20px;
      list-style: decimal;
      font-size: 11px;
      color: rgba(255,255,255,0.75);
    }
    .cp-plan-progress { list-style: none; padding-left: 4px; }
    .cp-plan-progress li {
      padding: 2px 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cp-plan-progress li.state-done { color: #34c759; }
    .cp-plan-progress li.state-running { color: #5ac8fa; }
    .cp-plan-progress li.state-failed { color: #ff453a; }
    .cp-step-icon { width: 14px; text-align: center; }
    .cp-plan-steps code, .cp-plan-progress code {
      background: rgba(255,255,255,0.08);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10.5px;
    }
    .cp-plan-args {
      color: rgba(255,255,255,0.45);
      margin-left: 6px;
      font-size: 10.5px;
    }
    .cp-plan-error {
      margin-top: 6px;
      padding: 5px 8px;
      background: rgba(255,69,58,0.12);
      border-radius: 5px;
      font-size: 11px;
      color: #ff6b5e;
    }
    .cp-plan-actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .cp-plan-approved, .cp-plan-discarded {
      font-size: 11px;
      color: rgba(255,255,255,0.6);
    }
    .cp-plan-approved { color: #34c759; }
    .cp-btn {
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      border: 1px solid transparent;
    }
    .cp-btn-primary {
      background: #34c759;
      color: white;
      border-color: #34c759;
    }
    .cp-btn-primary:hover { background: #2ab34a; }
    .cp-btn-ghost {
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.8);
      border-color: rgba(255,255,255,0.12);
    }
    .cp-btn-ghost:hover { background: rgba(255,255,255,0.12); color: white; }

    .cp-clarify-q { font-size: 12px; margin-bottom: 8px; color: rgba(255,255,255,0.85); }
    .cp-clarify-choices { display: flex; flex-wrap: wrap; gap: 5px; }

    .cp-input-row {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }
    #cp-input {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      color: white;
      border-radius: 8px;
      font-size: 12.5px;
      font-family: inherit;
      resize: none;
      outline: none;
      min-height: 36px;
      max-height: 140px;
    }
    #cp-input:focus {
      border-color: rgba(90,200,250,0.5);
      background: rgba(255,255,255,0.07);
    }
    .cp-send {
      width: 36px; height: 36px;
      border: none;
      background: var(--accent, #5ac8fa);
      color: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      align-self: flex-end;
    }
    .cp-send:hover { filter: brightness(1.1); }

    .cp-mic {
      width: 36px; height: 36px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.04);
      color: rgba(255,255,255,0.75);
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      align-self: flex-end;
      transition: background 160ms ease, color 160ms ease;
    }
    .cp-mic:hover {
      background: rgba(255,255,255,0.1);
      color: white;
    }
    .cp-mic.listening {
      background: rgba(255,69,58,0.18);
      border-color: rgba(255,69,58,0.6);
      color: #ff6b5e;
      animation: cp-mic-pulse 1.2s ease-in-out infinite;
    }
    @keyframes cp-mic-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(255,69,58,0.4); }
      50%      { box-shadow: 0 0 0 6px rgba(255,69,58,0); }
    }

    .cp-hint {
      padding: 0 12px 4px 12px;
      font-size: 10px;
      color: rgba(255,255,255,0.35);
      text-align: center;
    }

    .cp-footer-stats {
      padding: 0 12px 8px 12px;
      font-size: 10px;
      color: rgba(255,255,255,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .cp-budget-dot {
      display: inline-block;
      width: 6px; height: 6px; border-radius: 50%;
    }
    .cp-budget-text { font-family: ui-monospace, Menlo, monospace; }

    @media (max-width: 500px) {
      .chat-panel { width: 100vw; max-width: 100vw; border-radius: 0; }
    }
  `;
  document.head.appendChild(style);
}
