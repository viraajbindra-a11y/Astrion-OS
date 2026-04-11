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

let isOpen = false;
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
    // Mark any pending as done, then show "Ready" for ~1.2s before clearing
    renderPlanPanel({ completed: true });
    setTimeout(() => {
      if (planState.planId === planId && isOpen) {
        resetPlanState();
        activePlanId = null;
        results.innerHTML = '';
        input.value = '';
        input.disabled = false;
        input.focus();
      }
    }, 1200);
  });

  eventBus.on('plan:failed', ({ planId, error, atStep }) => {
    if (planId && planId !== activePlanId) return;
    renderPlanPanel({ failed: true, error, atStep });
  });

  eventBus.on('plan:clarify', ({ query, question, choices }) => {
    planState.clarify = { question, choices: Array.isArray(choices) ? choices : [] };
    planState.query = query || planState.query;
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

    results.innerHTML = `
      <div class="spotlight-result-group">
        ${header}
        ${reasoning}
        ${stepRows}
      </div>
      ${clarifyBlock}
    `;

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
      results.innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(() => handleQuery(query), 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = input.value.trim();
      if (query) handleSubmit(query);
    }
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
    // Show suggested apps when empty
    const suggestions = ['Notes', 'Terminal', 'Messages', 'Browser', 'Music', 'Weather', 'Calculator', 'Beat Studio'];
    results.innerHTML = `
      <div class="spotlight-result-group">
        <div class="spotlight-result-label">Suggested</div>
        ${suggestions.map(name => {
          const apps = processManager.getAllApps();
          const app = apps.find(a => a.name === name);
          if (!app) return '';
          return `<div class="spotlight-result-item" data-action="launch" data-app="${app.id}">
            <div class="spotlight-result-icon">${app.icon}</div>
            <div class="spotlight-result-text">
              <div class="spotlight-result-title">${app.name}</div>
              <div class="spotlight-result-subtitle">Application</div>
            </div>
          </div>`;
        }).join('')}
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
    results.innerHTML = '';
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

    // Inline calculator — detect math expressions
    const mathClean = query.replace(/[^0-9+\-*/.() %^]/g, '');
    if (mathClean.length > 2 && /[\d].*[+\-*/^%].*[\d]/.test(mathClean)) {
      try {
        const expr = mathClean.replace(/\^/g, '**');
        const result = Function('"use strict"; return (' + expr + ')')();
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

    // Search apps
    const apps = processManager.getAllApps();
    const matchedApps = apps.filter(a =>
      a.name.toLowerCase().includes(lower) || a.id.includes(lower)
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

    // Always show AI option
    html += `<div class="spotlight-result-group">
      <div class="spotlight-result-label">NOVA AI</div>
      <div class="spotlight-result-item" data-action="ask-ai">
        <div class="spotlight-result-icon" style="background:linear-gradient(135deg,#007aff,#5856d6);border-radius:50%;color:white;font-size:14px;font-weight:bold;">N</div>
        <div class="spotlight-result-text">
          <div class="spotlight-result-title">Ask NOVA: "${query.substring(0, 50)}"</div>
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

    results.innerHTML = `<div class="spotlight-ai-response">${escapeHtml(response)}</div>`;
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
