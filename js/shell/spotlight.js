// NOVA OS — Search (AI Command Palette)
//
// M1.P1 — Search is the primary input for the Intent Kernel. Every keystroke
// goes through `parseIntent()` and if the parser recognizes a structured
// intent with high enough confidence, it's shown as the #1 result with a
// "Press Enter to run" call to action. Hitting Enter dispatches to the
// capability executor (M1.P2+) which actually executes the intent.

import { eventBus } from '../kernel/event-bus.js';
import { processManager } from '../kernel/process-manager.js';
import { fileSystem } from '../kernel/file-system.js';
import { aiService } from '../kernel/ai-service.js';
import { parseIntent, summarizeIntent, intentToNaturalLanguage } from '../kernel/intent-parser.js';
// Agent Core Sprint — heuristic router + context snapshot for the planner.
import { routeQuery } from '../kernel/intent-planner.js';
import { getContextBundle } from '../kernel/context-bundle.js';
import { recordSample } from '../kernel/calibration-tracker.js';
import { graphStore } from '../kernel/graph-store.js';
import { query as graphQuery } from '../kernel/graph-query.js';
import { getRecentApps } from './recent-apps.js';
import { getSmartAnswer } from '../lib/smart-answers.js';

let isOpen = false;
// Search history — persisted to localStorage
const SEARCH_HISTORY_KEY = 'nova-search-history';
const MAX_SEARCH_HISTORY = 15;

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || []; }
  catch { return []; }
}

function addToSearchHistory(query) {
  if (!query || query.length < 2) return;
  let history = getSearchHistory();
  history = history.filter(q => q !== query);
  history.unshift(query);
  if (history.length > MAX_SEARCH_HISTORY) history = history.slice(0, MAX_SEARCH_HISTORY);
  try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history)); } catch {}
}

// Rotating tips — shown in the Spotlight placeholder
const SPOTLIGHT_TIPS = [
  'Try: "5 lbs in kg" for instant conversion',
  'Try: "time in tokyo" for world clock',
  'Try: "#ff6b6b" to preview a color',
  'Try: "timer 5m" to set a timer',
  'Try: "uuid" to generate a UUID',
  'Try: "flip a coin" for a random choice',
  'Try: "255 in hex" for base conversion',
  'Try: "15% of 200" for quick math',
  'Tip: Right-click titlebar to pin windows on top',
  'Tip: Ctrl+Shift+P for mini mode (PiP)',
  'Tip: Ctrl+Shift+V for clipboard history',
  'Tip: Alt+Scroll on titlebar to change opacity',
];

// Agent Core Sprint: the id of the plan currently streaming in the panel,
// so we can scope `plan:*` events and ignore stale ones after abort.
let activePlanId = null;
let pendingConfirmPlanId = null;

export function initSpotlight() {
  const spotlight = document.getElementById('spotlight');
  const input = document.getElementById('spotlight-input');
  const results = document.getElementById('spotlight-results');

  // Cmd+Space or Ctrl+Space
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen) {
      // Agent Core Sprint: Escape behavior has three modes now:
      //  1. A plan preview is awaiting confirm → abort it (don't close yet)
      //  2. A plan is actively running → abort it
      //  3. Otherwise → normal Spotlight close
      if (pendingConfirmPlanId) {
        eventBus.emit('plan:aborted', { planId: pendingConfirmPlanId, reason: 'user-aborted' });
        pendingConfirmPlanId = null;
        planState.awaitingConfirm = false;
        resetPlanState();
        activePlanId = null;
        results.innerHTML = '';
        input.disabled = false;
        input.focus();
        return;
      }
      if (activePlanId) {
        eventBus.emit('plan:aborted', { planId: activePlanId, reason: 'user-aborted' });
        activePlanId = null;
        resetPlanState();
        results.innerHTML = '';
        input.disabled = false;
        input.focus();
        return;
      }
      close();
    }
  });

  eventBus.on('spotlight:toggle', toggle);

  // M1.P4 — intent execution progress toasts. When executeIntent() fires
  // its lifecycle events, show a tiny floating toast in the corner so the
  // user sees the kernel doing something. Disappears after 3 seconds.
  eventBus.on('intent:started', ({ intent, naturalDescription, costEstimate }) => {
    showIntentToast({
      icon: '⚡',
      title: 'Astrion',
      body: naturalDescription || 'Working...',
      tone: 'progress',
    });
  });
  eventBus.on('intent:completed', ({ intent, success, result, error }) => {
    if (success) {
      showIntentToast({
        icon: '✅',
        title: 'Done',
        body: intent.raw,
        tone: 'success',
      });
    } else {
      showIntentToast({
        icon: '⚠️',
        title: 'Failed',
        body: error || 'Something went wrong',
        tone: 'error',
      });
    }
  });
  eventBus.on('intent:rejected', ({ intent, reason }) => {
    showIntentToast({
      icon: '🤔',
      title: "I don't know how to do that yet",
      body: reason,
      tone: 'warning',
    });
  });

  // ─── M3 — capture last AI brain metadata for badge/feedback ───
  let lastAiMeta = null;
  eventBus.on('ai:response', (meta) => { lastAiMeta = meta; });

  // ─── Agent Core Sprint — plan:* event subscriptions ───
  // Render a streaming step panel in the Spotlight results area when a
  // multi-step plan is running. Every event re-renders the panel using
  // the current in-memory `planState`.
  const planState = {
    planId: null,
    query: '',
    reasoning: '',
    steps: [],        // [{ cap, status: 'pending'|'running'|'done'|'failed', output?, error? }]
    awaitingConfirm: false,
    totalTokens: 0,
    clarify: null,
  };

  function resetPlanState() {
    planState.planId = null;
    planState.query = '';
    planState.reasoning = '';
    planState.steps = [];
    planState.awaitingConfirm = false;
    planState.totalTokens = 0;
    planState.clarify = null;
  }

  eventBus.on('plan:started', ({ planId, plan, query, totalTokens, reasoning }) => {
    activePlanId = planId;
    planState.planId = planId;
    planState.query = query || '';
    planState.reasoning = reasoning || '';
    planState.totalTokens = totalTokens || 0;
    planState.steps = (plan.steps || []).map(s => ({
      cap: s.cap,
      summary: s.args?.name || s.args?.path || s.cap,
      status: 'pending',
    }));
    planState.clarify = null;
    renderPlanPanel();
    if (!isOpen) open(); // force Spotlight open if planner fired from elsewhere
  });

  eventBus.on('plan:preview', ({ planId, plan, totalTokens, reasoning }) => {
    if (planId !== activePlanId) return;
    pendingConfirmPlanId = planId;
    planState.awaitingConfirm = true;
    planState.totalTokens = totalTokens || 0;
    planState.reasoning = reasoning || planState.reasoning;
    planState.steps = (plan.steps || []).map(s => ({
      cap: s.cap,
      summary: s.args?.name || s.args?.path || s.cap,
      status: 'awaiting-confirm',
    }));
    renderPlanPanel();
  });

  eventBus.on('plan:step:start', ({ planId, index }) => {
    if (planId !== activePlanId) return;
    if (planState.steps[index]) planState.steps[index].status = 'running';
    renderPlanPanel();
  });

  eventBus.on('plan:step:done', ({ planId, index, output }) => {
    if (planId !== activePlanId) return;
    if (planState.steps[index]) {
      planState.steps[index].status = 'done';
      planState.steps[index].output = output;
    }
    renderPlanPanel();
  });

  eventBus.on('plan:step:fail', ({ planId, index, error }) => {
    if (planId !== activePlanId) return;
    if (planState.steps[index]) {
      planState.steps[index].status = 'failed';
      planState.steps[index].error = error;
    }
    renderPlanPanel();
  });

  eventBus.on('plan:completed', ({ planId }) => {
    if (planId !== activePlanId) return;
    // Mark any pending as done and show "Done" with brain badge + feedback.
    // Don't auto-clear — let the user see the result, give feedback, then
    // type a new query or press Escape. Input is re-enabled so typing works.
    renderPlanPanel({ completed: true });
    resetPlanState();
    activePlanId = null;
    input.value = '';
    input.disabled = false;
    input.focus();
  });

  eventBus.on('plan:failed', ({ planId, error, atStep }) => {
    if (planId && planId !== activePlanId) return;
    renderPlanPanel({ failed: true, error, atStep });
  });

  eventBus.on('plan:clarify', ({ query, question, choices }) => {
    planState.clarify = { question, choices: Array.isArray(choices) ? choices : [] };
    planState.query = query || planState.query;
    // Soak-test fix: re-enable input so user can interact with choices
    // (handleSubmit disabled it when entering the plan branch).
    input.disabled = false;
    activePlanId = null;
    renderPlanPanel();
    if (!isOpen) open();
  });

  // ─── Render functions ───

  function renderPlanPanel(extra = {}) {
    if (!planState.planId && !planState.clarify) return;
    const stepRows = planState.steps.map((s, i) => {
      const icons = {
        'pending':          '⏳',
        'running':          '▶',
        'done':             '✓',
        'failed':           '✗',
        'awaiting-confirm': '…',
      };
      const colors = {
        'pending':          'rgba(255,255,255,0.5)',
        'running':          '#8be9fd',
        'done':             '#50fa7b',
        'failed':           '#ff5f57',
        'awaiting-confirm': '#f1fa8c',
      };
      return `<div class="spotlight-result-item" style="cursor:default;border-left:3px solid ${colors[s.status]};padding-left:13px;">
        <div class="spotlight-result-icon" style="font-size:18px;color:${colors[s.status]};">${icons[s.status] || '·'}</div>
        <div class="spotlight-result-text">
          <div class="spotlight-result-title" style="color:${colors[s.status]};">${escapeHtml(s.summary)}</div>
          <div class="spotlight-result-subtitle">${escapeHtml(s.cap)}${s.error ? ' · ' + escapeHtml(s.error) : ''}</div>
        </div>
      </div>`;
    }).join('');

    let header;
    if (extra.failed) {
      header = `<div class="spotlight-result-label" style="color:#ff5f57;">⚠️ Plan failed${extra.atStep >= 0 ? ' at step ' + (extra.atStep + 1) : ''}: ${escapeHtml(extra.error || 'unknown error')}</div>`;
    } else if (extra.completed) {
      header = `<div class="spotlight-result-label" style="color:#50fa7b;">✓ Done — ${escapeHtml(planState.query)}</div>`;
    } else if (planState.awaitingConfirm) {
      header = `<div class="spotlight-result-label" style="color:#f1fa8c;">⚠ This plan changes real data (${planState.totalTokens} tokens). Press <kbd style="background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;">↵ Enter</kbd> to confirm or <kbd>Esc</kbd> to abort.</div>`;
    } else {
      header = `<div class="spotlight-result-label">🧠 Planning · ${escapeHtml(planState.query)}</div>`;
    }

    const reasoning = planState.reasoning
      ? `<div class="spotlight-result-subtitle" style="padding:4px 16px 8px 16px;opacity:0.8;">${escapeHtml(planState.reasoning)}</div>`
      : '';

    let clarifyBlock = '';
    if (planState.clarify) {
      clarifyBlock = `<div class="spotlight-result-group">
        <div class="spotlight-result-label" style="color:#8be9fd;">❓ ${escapeHtml(planState.clarify.question)}</div>
        ${planState.clarify.choices.map((c, i) => `
          <div class="spotlight-result-item" data-action="clarify" data-choice="${escapeHtml(c)}">
            <div class="spotlight-result-icon">${i + 1}</div>
            <div class="spotlight-result-text">
              <div class="spotlight-result-title">${escapeHtml(c)}</div>
            </div>
          </div>
        `).join('')}
      </div>`;
    }

    // M3 — brain badge row after plan steps (when plan is done or failed)
    let brainRow = '';
    if ((extra.completed || extra.failed) && lastAiMeta) {
      const meta = lastAiMeta;
      const brainLabel = meta.brain === 'offline' ? 'OFF' : meta.brain.toUpperCase();
      const confPct = meta.confidence != null ? Math.round(meta.confidence * 100) : '?';
      const timeStr = meta.responseTimeMs ? `${(meta.responseTimeMs / 1000).toFixed(1)}s` : '';
      brainRow = `<div class="spotlight-ai-meta">
        <span class="spotlight-brain-badge" data-brain="${meta.brain}" title="Click for details">
          ${brainLabel} · ${confPct}%${timeStr ? ' · ' + timeStr : ''}
        </span>
        <span class="spotlight-feedback">
          <button class="spotlight-fb-btn" data-vote="up" title="Good answer">👍</button>
          <button class="spotlight-fb-btn" data-vote="down" title="Bad answer">👎</button>
        </span>
      </div>`;
    }

    results.innerHTML = `
      <div class="spotlight-result-group">
        ${header}
        ${reasoning}
        ${stepRows}
      </div>
      ${brainRow}
      ${clarifyBlock}
    `;

    // M3 — wire brain badge + feedback in plan panel
    if (brainRow && lastAiMeta) {
      const badge = results.querySelector('.spotlight-brain-badge');
      if (badge) {
        badge.addEventListener('click', () => {
          let trace = results.querySelector('.spotlight-reasoning');
          if (!trace) {
            trace = document.createElement('div');
            trace.className = 'spotlight-reasoning';
            badge.closest('.spotlight-ai-meta').after(trace);
          }
          if (trace.style.display === 'none' || !trace.innerHTML) {
            trace.style.display = '';
            trace.innerHTML = buildReasoningTrace(lastAiMeta);
          } else {
            trace.style.display = 'none';
          }
        });
      }
      results.querySelectorAll('.spotlight-fb-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const isUp = btn.dataset.vote === 'up';
          results.querySelectorAll('.spotlight-fb-btn').forEach(b => {
            b.style.opacity = b === btn ? '1' : '0.3';
            b.disabled = true;
          });
          const meta = lastAiMeta;
          recordSample({
            brain: meta.brain,
            capCategory: meta.capCategory || 'general',
            ok: isUp,
            query: meta.query || '',
            responseTimeMs: meta.responseTimeMs || 0,
            userFeedback: true,
          });
        });
      });
    }

    // Wire clarify clicks: submitting the choice as a fresh planner turn
    if (planState.clarify) {
      results.querySelectorAll('[data-action="clarify"]').forEach(el => {
        el.addEventListener('click', () => {
          const choice = el.dataset.choice;
          planState.clarify = null;
          input.value = choice;
          handleSubmit(choice);
        });
      });
    }
  }

  // Click backdrop to close
  spotlight.querySelector('.spotlight-backdrop').addEventListener('click', close);

  // Input handling
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      // Re-show recent/suggested when query is cleared
      const recents = getRecentApps();
      const allApps = processManager.getAllApps();
      const fallbackNames = ['Notes', 'Terminal', 'Messages', 'Browser', 'Music', 'Weather', 'Calculator', 'Beat Studio'];
      const appItems = recents.length >= 3
        ? recents.slice(0, 8).map(r => allApps.find(a => a.id === r.appId)).filter(Boolean)
        : fallbackNames.map(name => allApps.find(a => a.name === name)).filter(Boolean);
      const sectionLabel = recents.length >= 3 ? 'Recent' : 'Suggested';
      results.innerHTML = `
        <div class="spotlight-result-group">
          <div class="spotlight-result-label">${sectionLabel}</div>
          ${appItems.map(app => `<div class="spotlight-result-item" data-action="launch" data-app="${app.id}">
              <div class="spotlight-result-icon">${app.icon}</div>
              <div class="spotlight-result-text">
                <div class="spotlight-result-title">${app.name}</div>
                <div class="spotlight-result-subtitle">Application</div>
              </div>
            </div>`).join('')}
        </div>`;
      results.querySelectorAll('.spotlight-result-item').forEach(item => {
        item.addEventListener('click', () => handleResultClick(item, ''));
      });
      return;
    }
    debounceTimer = setTimeout(() => handleQuery(query), 200);
  });

  let selectedResultIdx = -1;

  function getResultItems() {
    return [...results.querySelectorAll('.spotlight-result-item')];
  }

  function highlightResult(idx) {
    const items = getResultItems();
    items.forEach((el, i) => {
      el.style.background = i === idx ? 'rgba(255,255,255,0.08)' : '';
    });
    selectedResultIdx = idx;
    if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('keydown', (e) => {
    const items = getResultItems();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = selectedResultIdx < items.length - 1 ? selectedResultIdx + 1 : 0;
      highlightResult(next);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = selectedResultIdx > 0 ? selectedResultIdx - 1 : items.length - 1;
      highlightResult(prev);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // If a result is selected, click it
      if (selectedResultIdx >= 0 && items[selectedResultIdx]) {
        handleResultClick(items[selectedResultIdx], input.value.trim());
        return;
      }
      const query = input.value.trim();
      if (query) handleSubmit(query);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    // Reset selection when typing
    selectedResultIdx = -1;
  });

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function open() {
    // Agent Core Sprint: fire BEFORE focusing the Spotlight input so
    // context-bundle can snapshot the user's selection before it gets wiped.
    eventBus.emit('spotlight:will-open');
    spotlight.classList.remove('hidden');
    input.value = '';
    // Soak-test fix: always re-enable input on open. The plan branch in
    // handleSubmit disables it, but if the plan ends in clarify/abort/fail
    // without hitting plan:completed, input stays disabled forever.
    input.disabled = false;
    // Rotate tip in placeholder
    input.placeholder = SPOTLIGHT_TIPS[Math.floor(Math.random() * SPOTLIGHT_TIPS.length)];
    // Show recent apps (if any), otherwise fall back to static suggestions
    const recents = getRecentApps();
    const allApps = processManager.getAllApps();
    const fallbackNames = ['Notes', 'Terminal', 'Messages', 'Browser', 'Music', 'Weather', 'Calculator', 'Beat Studio'];
    const appItems = recents.length >= 3
      ? recents.slice(0, 8).map(r => allApps.find(a => a.id === r.appId)).filter(Boolean)
      : fallbackNames.map(name => allApps.find(a => a.name === name)).filter(Boolean);
    const sectionLabel = recents.length >= 3 ? 'Recent' : 'Suggested';
    results.innerHTML = `
      <div class="spotlight-result-group">
        <div class="spotlight-result-label">${sectionLabel}</div>
        ${appItems.map(app => `<div class="spotlight-result-item" data-action="launch" data-app="${app.id}">
            <div class="spotlight-result-icon">${app.icon}</div>
            <div class="spotlight-result-text">
              <div class="spotlight-result-title">${app.name}</div>
              <div class="spotlight-result-subtitle">Application</div>
            </div>
          </div>`).join('')}
      </div>`;
    results.querySelectorAll('.spotlight-result-item').forEach(item => {
      item.addEventListener('click', () => handleResultClick(item, ''));
    });
    input.focus();
    isOpen = true;
  }

  function close() {
    spotlight.classList.add('hidden');
    isOpen = false;
    input.value = '';
    input.disabled = false; // soak-test fix: reset disabled state on close
    results.innerHTML = '';
    activePlanId = null;
    pendingConfirmPlanId = null;
    resetPlanState();
    // Agent Core Sprint: let context-bundle drop the cached selection.
    eventBus.emit('spotlight:closed');
  }

  async function handleQuery(query) {
    // M1.P1 — Parse the query as a structured intent and show it as the #1
    // result if confidence is high enough. The intent card appears above all
    // other results (apps, files, AI ask) and is what Enter triggers.
    let topIntent = null;
    try {
      const intent = parseIntent(query);
      if (intent && intent.confidence >= 0.55) {
        topIntent = intent;
        console.log('[intent]', summarizeIntent(intent), intent);
        eventBus.emit('intent:parsed', intent);
      }
    } catch (err) {
      console.warn('[intent-parser] error:', err);
    }

    const lower = query.toLowerCase();
    let html = '';

    // ─── Intent card (M1.P1) — shown as #1 result when parse confidence ≥ 0.55 ───
    if (topIntent) {
      const naturalDescription = intentToNaturalLanguage(topIntent);
      const confPct = Math.round(topIntent.confidence * 100);
      const brainColor = topIntent.verb === 'delete' ? '#ff5f57' :
                         topIntent.verb === 'compute' || topIntent.verb === 'explain' ? '#bd93f9' :
                         '#8be9fd';
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">🧠 Intent  ·  ${confPct}% confident</div>
        <div class="spotlight-result-item" data-action="intent" style="background:rgba(139,233,253,0.08);border-left:3px solid ${brainColor};padding-left:13px;">
          <div class="spotlight-result-icon" style="font-size:28px;">${getIntentIcon(topIntent.verb)}</div>
          <div class="spotlight-result-text">
            <div class="spotlight-result-title" style="color:${brainColor};">${escapeHtml(naturalDescription)}</div>
            <div class="spotlight-result-subtitle">Press <kbd style="background:rgba(255,255,255,0.1);padding:1px 6px;border-radius:3px;">↵ Enter</kbd> to run</div>
          </div>
        </div>
      </div>`;
    }

    // Inline calculator — detect math expressions + math functions
    // Support: sqrt, sin, cos, tan, log, ln, abs, ceil, floor, round, pow, pi, e
    const mathFnQuery = query
      .replace(/\bsqrt\b/gi, 'Math.sqrt')
      .replace(/\bsin\b/gi, 'Math.sin')
      .replace(/\bcos\b/gi, 'Math.cos')
      .replace(/\btan\b/gi, 'Math.tan')
      .replace(/\blog\b/gi, 'Math.log10')
      .replace(/\bln\b/gi, 'Math.log')
      .replace(/\babs\b/gi, 'Math.abs')
      .replace(/\bceil\b/gi, 'Math.ceil')
      .replace(/\bfloor\b/gi, 'Math.floor')
      .replace(/\bround\b/gi, 'Math.round')
      .replace(/\bpow\b/gi, 'Math.pow')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/gi, 'Math.E')
      .replace(/\^/g, '**');
    const mathClean = mathFnQuery.replace(/[^0-9+\-*/.() %Math.sqrtsincoanlgbefhpow,PI E]/g, '');
    const hasMathContent = /\d/.test(mathClean) && (/[\d].*[+\-*/^%].*[\d]/.test(mathClean) || /Math\.\w+/.test(mathClean));
    if (mathClean.length > 2 && mathClean.length < 200 && hasMathContent) {
      try {
        const result = Function('"use strict"; return (' + mathClean + ')')();
        if (typeof result === 'number' && isFinite(result)) {
          html += `<div class="spotlight-result-group">
            <div class="spotlight-result-label">Calculator</div>
            <div class="spotlight-result-item" data-action="none" style="cursor:default;">
              <div class="spotlight-result-icon" style="font-size:20px;">\uD83D\uDCF1</div>
              <div class="spotlight-result-text">
                <div class="spotlight-result-title" style="font-size:24px;font-weight:300;">${result}</div>
                <div class="spotlight-result-subtitle">${query} =</div>
              </div>
            </div>
          </div>`;
        }
      } catch {}
    }

    // Smart instant answers — unit conversion, time zones, colors, etc.
    const smart = getSmartAnswer(query);
    if (smart) {
      const iconHtml = smart.iconIsHtml ? smart.icon : `<div class="spotlight-result-icon" style="font-size:20px;">${smart.icon}</div>`;
      const smartAction = smart.action === 'launch' ? 'launch' : smart.copyValue ? 'copy' : 'none';
      const smartData = smart.action === 'launch' ? `data-app="${smart.appId}"` : smart.copyValue ? `data-copy="${escapeHtml(smart.copyValue)}"` : '';
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">Instant Answer</div>
        <div class="spotlight-result-item" data-action="${smartAction}" ${smartData} style="cursor:${smartAction !== 'none' ? 'pointer' : 'default'};">
          ${iconHtml}
          <div class="spotlight-result-text">
            <div class="spotlight-result-title" style="font-size:20px;font-weight:400;">${smart.title}</div>
            <div class="spotlight-result-subtitle">${smart.subtitle}${smart.copyValue ? ' · Click to copy' : ''}</div>
          </div>
        </div>
      </div>`;
    }

    // Search apps (by name, ID, or alias)
    const APP_ALIASES = {
      calc: 'calculator', term: 'terminal', msg: 'messages', chat: 'messages',
      files: 'finder', fm: 'finder', edit: 'text-editor', code: 'text-editor',
      web: 'browser', safari: 'browser', chrome: 'browser', mail: 'messages',
      paint: 'draw', pic: 'photos', img: 'photos', vid: 'video-player',
      cam: 'photos', sys: 'system-info', task: 'activity-monitor', htop: 'activity-monitor',
      pwd: 'password-gen', pw: 'password-gen', md: 'markdown', yt: 'youtube',
      todo: 'todo', note: 'notes', remind: 'reminders', cal: 'calendar',
      clk: 'clock', time: 'clock', weather: 'weather', set: 'settings',
      puzzle: 'sudoku', game: 'snake', recipe: 'recipe-book', cook: 'recipe-book',
      food: 'recipe-book', emoji: 'emoji-kitchen', mix: 'emoji-kitchen',
      speed: 'speed-test', wifi: 'speed-test', zen: 'meditation',
      breathe: 'meditation', relax: 'meditation', sfx: 'soundboard',
      sound: 'soundboard', timer: 'timer', event: 'countdown',
      reaction: 'reaction-test', reflex: 'reaction-test',
      palette: 'color-palette', colors: 'color-palette',
      word: 'wordle', guess: 'wordle',
      rps: 'rock-paper-scissors', ttt: 'tic-tac-toe', xo: 'tic-tac-toe',
      facts: 'random-facts', trivia: 'random-facts', bmi: 'bmi-calc',
      health: 'bmi-calc', weight: 'bmi-calc',
    };
    const aliasMatch = APP_ALIASES[lower];
    const apps = processManager.getAllApps();
    const matchedApps = apps.filter(a =>
      a.name.toLowerCase().includes(lower) || a.id.includes(lower) || a.id === aliasMatch
    );

    if (matchedApps.length > 0) {
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">Applications</div>`;
      matchedApps.forEach(app => {
        html += `<div class="spotlight-result-item" data-action="launch" data-app="${app.id}">
          <div class="spotlight-result-icon">${app.icon}</div>
          <div class="spotlight-result-text">
            <div class="spotlight-result-title">${app.name}</div>
            <div class="spotlight-result-subtitle">Application</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    // Search graph nodes (notes, todos, reminders)
    try {
      const graphTypes = ['note', 'todo', 'reminder'];
      const graphResults = [];
      for (const gType of graphTypes) {
        const nodes = await graphQuery(graphStore, {
          type: 'select',
          from: gType,
          where: { 'props.title': { contains: query } },
          orderBy: { field: 'updatedAt', dir: 'desc' },
          limit: 3,
        });
        graphResults.push(...nodes.map(n => ({ ...n, _gType: gType })));
      }
      // Also search content for notes
      if (graphResults.length < 5) {
        const contentHits = await graphQuery(graphStore, {
          type: 'select',
          from: 'note',
          where: { 'props.content': { contains: query } },
          orderBy: { field: 'updatedAt', dir: 'desc' },
          limit: 3,
        });
        for (const n of contentHits) {
          if (!graphResults.find(r => r.id === n.id)) {
            graphResults.push({ ...n, _gType: 'note' });
          }
        }
      }
      if (graphResults.length > 0) {
        const gIcons = { note: '\uD83D\uDCDD', todo: '\u2705', reminder: '\u23F0' };
        const gLabels = { note: 'Note', todo: 'To-Do', reminder: 'Reminder' };
        html += `<div class="spotlight-result-group">
          <div class="spotlight-result-label">Graph</div>`;
        graphResults.slice(0, 6).forEach(node => {
          const title = node.props?.title || node.props?.text || 'Untitled';
          const sub = node._gType === 'todo' ? (node.props?.done ? 'Done' : 'Pending')
            : node._gType === 'reminder' ? (node.props?.list || 'Reminder')
            : (node.props?.content || '').substring(0, 60).replace(/\n/g, ' ') || gLabels[node._gType];
          html += `<div class="spotlight-result-item" data-action="open-graph-node" data-node-id="${node.id}" data-node-type="${node._gType}">
            <div class="spotlight-result-icon">${gIcons[node._gType] || '\uD83D\uDCC4'}</div>
            <div class="spotlight-result-text">
              <div class="spotlight-result-title">${escapeHtml(title)}</div>
              <div class="spotlight-result-subtitle">${escapeHtml(sub)}</div>
            </div>
          </div>`;
        });
        html += `</div>`;
      }
    } catch (err) {
      console.warn('[spotlight] graph search failed:', err);
    }

    // Search files
    const files = await fileSystem.search(query);
    if (files.length > 0) {
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">Files</div>`;
      files.slice(0, 5).forEach(file => {
        const icon = fileSystem.getFileIcon(file);
        const name = fileSystem.getFileName(file.path);
        html += `<div class="spotlight-result-item" data-action="open-file" data-path="${file.path}" data-type="${file.type}">
          <div class="spotlight-result-icon">${icon}</div>
          <div class="spotlight-result-text">
            <div class="spotlight-result-title">${name}</div>
            <div class="spotlight-result-subtitle">${file.path}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    // Web search option — always works, no AI needed
    html += `<div class="spotlight-result-group">
      <div class="spotlight-result-label">Web</div>
      <div class="spotlight-result-item" data-action="web-search" data-query="${escapeHtml(query)}">
        <div class="spotlight-result-icon" style="font-size:18px;">🌐</div>
        <div class="spotlight-result-text">
          <div class="spotlight-result-title">Search: "${escapeHtml(query.substring(0, 50))}"</div>
          <div class="spotlight-result-subtitle">Open in Browser</div>
        </div>
      </div>
    </div>`;

    // Always show AI option
    html += `<div class="spotlight-result-group">
      <div class="spotlight-result-label">Astrion AI</div>
      <div class="spotlight-result-item" data-action="ask-ai">
        <div class="spotlight-result-icon" style="background:linear-gradient(135deg,#007aff,#5856d6);border-radius:50%;color:white;font-size:14px;font-weight:bold;">A</div>
        <div class="spotlight-result-text">
          <div class="spotlight-result-title">Ask Astrion: "${escapeHtml(query.substring(0, 50))}"</div>
          <div class="spotlight-result-subtitle">Press Enter to ask AI</div>
        </div>
      </div>
    </div>`;

    results.innerHTML = html;

    // Click handlers for results
    results.querySelectorAll('.spotlight-result-item').forEach(item => {
      item.addEventListener('click', () => {
        handleResultClick(item, query);
      });
    });
  }

  async function handleSubmit(query) {
    // Record search history
    addToSearchHistory(query);

    // Agent Core Sprint — if the Spotlight is waiting on an L2+ preview
    // confirmation, Enter confirms the pending plan rather than submitting
    // a new one.
    if (pendingConfirmPlanId) {
      const pid = pendingConfirmPlanId;
      pendingConfirmPlanId = null;
      planState.awaitingConfirm = false;
      eventBus.emit('plan:confirmed', { planId: pid });
      return;
    }

    // Agent Core Sprint — heuristic router: decide whether this query goes
    // through the fast single-capability path or the multi-step planner.
    const intent = parseIntent(query);
    const route = routeQuery(query, intent);
    if (route === 'plan') {
      // Multi-step planner — keep Spotlight open, stream per-step progress.
      const context = getContextBundle();
      input.disabled = true;
      results.innerHTML = `<div class="spotlight-result-group">
        <div class="spotlight-result-label">🧠 Planning…</div>
        <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.7;">${escapeHtml(query)}</div>
      </div>`;
      eventBus.emit('intent:plan', { query, context, parsedIntent: intent });
      return; // NB: no close() — plan:completed handler will reset the panel
    }

    // M1.P1 — fast single-shot path. The intent:execute event is handled
    // by the step executor (M1.P3), which calls into capability providers
    // (M1.P2) to actually do the work.
    if (intent && intent.confidence >= 0.55) {
      eventBus.emit('intent:execute', intent);
      close();
      return;
    }

    // Check for app launch commands
    const lower = query.toLowerCase();
    const appCommands = {
      'open terminal': 'terminal',
      'open notes': 'notes',
      'open finder': 'finder',
      'open calculator': 'calculator',
      'open settings': 'settings',
      'open text editor': 'text-editor',
      'open editor': 'text-editor',
      'open browser': 'browser',
      'open music': 'music',
      'open calendar': 'calendar',
      'open draw': 'draw',
      'open app store': 'appstore',
      'open store': 'appstore',
      'open photos': 'photos',
      'open weather': 'weather',
      'open clock': 'clock',
      'open reminders': 'reminders',
      'open activity monitor': 'activity-monitor',
      'open monitor': 'activity-monitor',
      'open vault': 'vault',
      'open passwords': 'vault',
      'open password manager': 'vault',
      'record screen': 'screen-recorder',
      'screen recorder': 'screen-recorder',
      'open screen recorder': 'screen-recorder',
      'open trash': 'trash',
      'empty trash': 'trash',
      'install astrion': 'installer',
      'install astrion os': 'installer',
      'install to disk': 'installer',
      'installer': 'installer',
      'open task manager': 'activity-monitor',
      'task manager': 'activity-monitor',
      'open budget': 'budget',
      'budget tracker': 'budget',
      'open whiteboard': 'whiteboard',
      'open chess': 'chess',
      'play chess': 'chess',
      'open snake': 'snake',
      'play snake': 'snake',
      'play 2048': '2048',
      'open stopwatch': 'stopwatch',
      'open timer': 'timer-app',
      'set timer': 'timer-app',
      'open journal': 'journal',
      'open diary': 'journal',
      'open todo': 'todo',
      'todo list': 'todo',
      'open sticky notes': 'sticky-notes',
      'open stickies': 'sticky-notes',
      'open contacts': 'contacts',
      'open maps': 'maps',
      'open map': 'maps',
      'directions': 'maps',
      'open voice memos': 'voice-memos',
      'record voice': 'voice-memos',
      'open pomodoro': 'pomodoro',
      'pomodoro timer': 'pomodoro',
      'focus timer': 'pomodoro',
      'open pdf': 'pdf-viewer',
      'pdf viewer': 'pdf-viewer',
      'open kanban': 'kanban',
      'project board': 'kanban',
      'open habits': 'habit-tracker',
      'habit tracker': 'habit-tracker',
      'open video': 'video-player',
      'video player': 'video-player',
      'play video': 'video-player',
      'system info': 'system-info',
      'neofetch': 'system-info',
      'about this computer': 'system-info',
    };

    for (const [cmd, appId] of Object.entries(appCommands)) {
      if (lower.includes(cmd) || lower === cmd) {
        processManager.launch(appId);
        close();
        return;
      }
    }

    // Ask AI
    results.innerHTML = `<div class="spotlight-loading">Thinking...</div>`;
    const response = await aiService.ask(query);

    // Check if AI response mentions opening an app
    const lowerResp = response.toLowerCase();
    if (lowerResp.includes('opening')) {
      for (const [cmd, appId] of Object.entries(appCommands)) {
        const appName = cmd.replace('open ', '');
        if (lowerResp.includes(appName)) {
          processManager.launch(appId);
          close();
          return;
        }
      }
    }

    renderAiResponse(results, response);
  }

  // ─── M3 — AI response with brain badge, feedback, reasoning trace ───

  function renderAiResponse(container, text) {
    const meta = lastAiMeta || { brain: 'offline', confidence: 0.3, provider: 'mock' };
    const brainLabel = meta.brain === 'offline' ? 'OFF' : meta.brain.toUpperCase();
    const confPct = meta.confidence != null ? Math.round(meta.confidence * 100) : '?';
    const timeStr = meta.responseTimeMs ? `${(meta.responseTimeMs / 1000).toFixed(1)}s` : '';

    container.innerHTML = `
      <div class="spotlight-ai-response">${escapeHtml(text)}</div>
      <div class="spotlight-ai-meta">
        <span class="spotlight-brain-badge" data-brain="${meta.brain}" title="Click for details">
          ${brainLabel} · ${confPct}%${timeStr ? ' · ' + timeStr : ''}
        </span>
        <span class="spotlight-feedback">
          <button class="spotlight-fb-btn" data-vote="up" title="Good answer">👍</button>
          <button class="spotlight-fb-btn" data-vote="down" title="Bad answer">👎</button>
        </span>
      </div>
      <div class="spotlight-reasoning hidden"></div>
    `;

    // Badge click → toggle reasoning trace
    const badge = container.querySelector('.spotlight-brain-badge');
    const tracePanel = container.querySelector('.spotlight-reasoning');
    badge.addEventListener('click', () => {
      if (tracePanel.classList.contains('hidden')) {
        tracePanel.classList.remove('hidden');
        tracePanel.innerHTML = buildReasoningTrace(meta);
      } else {
        tracePanel.classList.add('hidden');
      }
    });

    // Feedback buttons
    container.querySelectorAll('.spotlight-fb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isUp = btn.dataset.vote === 'up';
        container.querySelectorAll('.spotlight-fb-btn').forEach(b => {
          b.style.opacity = b === btn ? '1' : '0.3';
          b.disabled = true;
        });
        recordSample({
          brain: meta.brain,
          capCategory: meta.capCategory || 'general',
          ok: isUp,
          query: meta.query || '',
          responseTimeMs: meta.responseTimeMs || 0,
          userFeedback: true,
        });
      });
    });
  }

  function buildReasoningTrace(meta) {
    const brainName = meta.brain === 's1' ? 'S1 (Ollama local)'
      : meta.brain === 's2' ? 'S2 (Claude cloud)' : 'Offline (mock)';
    const model = meta.model || 'unknown';
    const time = meta.responseTimeMs ? `${(meta.responseTimeMs / 1000).toFixed(1)}s` : 'n/a';
    const conf = meta.confidence != null ? `${Math.round(meta.confidence * 100)}%` : 'n/a';
    const escalated = meta.escalated
      ? `<div class="spotlight-reasoning-row" style="color:#f1fa8c;">⚡ Escalated: S1 accuracy for "${escapeHtml(meta.capCategory || 'general')}" was below 70%</div>`
      : '';
    return `
      <div class="spotlight-reasoning-row">Brain: ${escapeHtml(brainName)}</div>
      <div class="spotlight-reasoning-row">Model: ${escapeHtml(model)}</div>
      <div class="spotlight-reasoning-row">Response time: ${time}</div>
      <div class="spotlight-reasoning-row">Confidence: ${conf}</div>
      ${escalated}
    `;
  }

  function handleResultClick(item, query) {
    const action = item.dataset.action;

    if (action === 'launch') {
      processManager.launch(item.dataset.app);
      close();
    } else if (action === 'open-file') {
      if (item.dataset.type === 'folder') {
        processManager.launch('finder', { openPath: item.dataset.path });
      } else {
        processManager.launch('text-editor', {
          filePath: item.dataset.path,
          title: fileSystem.getFileName(item.dataset.path)
        });
      }
      close();
    } else if (action === 'open-graph-node') {
      const nodeType = item.dataset.nodeType;
      const nodeId = item.dataset.nodeId;
      // Open the right app for the node type, passing the node ID
      if (nodeType === 'note') {
        processManager.launch('notes', { openNodeId: nodeId });
      } else if (nodeType === 'todo') {
        processManager.launch('todos', { openNodeId: nodeId });
      } else if (nodeType === 'reminder') {
        processManager.launch('reminders', { openNodeId: nodeId });
      }
      close();
    } else if (action === 'web-search') {
      const q = item.dataset.query;
      if (q) processManager.launch('browser', { initialUrl: `search.html?q=${encodeURIComponent(q)}` });
      close();
    } else if (action === 'copy') {
      const text = item.dataset.copy;
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
        // Flash feedback
        item.style.background = 'rgba(0,122,255,0.2)';
        setTimeout(() => { item.style.background = ''; }, 300);
      }
    } else if (action === 'ask-ai') {
      handleSubmit(query);
    }
  }
}

// M1.P4 — tiny floating toast used by intent execution lifecycle events.
// Stacks in the top-right, auto-dismisses after 3s.
function showIntentToast({ icon, title, body, tone }) {
  let stack = document.getElementById('intent-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'intent-toast-stack';
    stack.style.cssText = `
      position: fixed; top: 44px; right: 16px; z-index: 99999;
      display: flex; flex-direction: column; gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(stack);
  }

  const toneColors = {
    progress: { bg: 'rgba(139,233,253,0.12)', border: '#8be9fd', text: '#8be9fd' },
    success:  { bg: 'rgba(80,250,123,0.12)',  border: '#50fa7b', text: '#50fa7b' },
    error:    { bg: 'rgba(255,95,87,0.12)',   border: '#ff5f57', text: '#ff5f57' },
    warning:  { bg: 'rgba(241,250,140,0.12)', border: '#f1fa8c', text: '#f1fa8c' },
  };
  const c = toneColors[tone] || toneColors.progress;

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(20,20,30,0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid ${c.border};
    border-left: 3px solid ${c.border};
    color: white;
    padding: 10px 14px 10px 12px;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    min-width: 260px;
    max-width: 360px;
    font-family: -apple-system, sans-serif;
    font-size: 13px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    pointer-events: auto;
    animation: intent-toast-in 0.25s cubic-bezier(0.16,1,0.3,1);
  `;
  toast.innerHTML = `
    <div style="font-size:20px;line-height:1;flex-shrink:0;margin-top:1px;">${icon}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-weight:600;color:${c.text};margin-bottom:2px;">${escapeHtml(title)}</div>
      <div style="color:rgba(255,255,255,0.85);word-break:break-word;">${escapeHtml(body || '')}</div>
    </div>
  `;

  // Ensure animation keyframes exist
  if (!document.getElementById('intent-toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'intent-toast-keyframes';
    style.textContent = `
      @keyframes intent-toast-in {
        from { opacity: 0; transform: translateX(20px) scale(0.95); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes intent-toast-out {
        from { opacity: 1; transform: translateX(0); }
        to   { opacity: 0; transform: translateX(20px); }
      }
    `;
    document.head.appendChild(style);
  }

  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'intent-toast-out 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// Intent verb → emoji icon for the Spotlight intent card (M1.P1)
function getIntentIcon(verb) {
  const ICONS = {
    make:      '✨',
    find:      '🔍',
    open:      '🚀',
    close:     '✖️',
    edit:      '✏️',
    delete:    '🗑️',
    move:      '➡️',
    copy:      '📋',
    send:      '📤',
    install:   '📦',
    uninstall: '🗑️',
    play:      '▶️',
    pause:     '⏸️',
    schedule:  '📅',
    remind:    '🔔',
    translate: '🌐',
    convert:   '🔄',
    compute:   '🧮',
    explain:   '💡',
    summarize: '📝',
    ask:       '❓',
    navigate:  '🧭',
    save:      '💾',
    share:     '📤',
    download:  '⬇️',
    upload:    '⬆️',
    print:     '🖨️',
    toggle:    '🔀',
    increase:  '🔊',
    decrease:  '🔉',
    mute:      '🔇',
    unmute:    '🔊',
  };
  return ICONS[verb] || '⚡';
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
