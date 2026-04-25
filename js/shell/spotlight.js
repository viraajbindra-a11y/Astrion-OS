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

// M5.P2.c: id of the interception:preview currently awaiting user input.
// Distinct from pendingConfirmPlanId because the per-call opaque id format
// differs and the two flows can in principle overlap (rare but possible if
// a plan-level cap fires a single-shot L2 cap mid-step).
let pendingInterceptionId = null;
let pendingInterceptionCap = null; // for render
let pendingInterceptionPONR = false; // M5.P4 — typed-confirm required

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
      // Agent Core Sprint + M5.P2.c: Escape behavior has four modes now:
      //  1. An interception preview is awaiting confirm → abort it
      //  2. A plan preview is awaiting confirm → abort it
      //  3. A plan is actively running → abort it
      //  4. Otherwise → normal Spotlight close
      if (pendingInterceptionId) {
        eventBus.emit('interception:abort', { id: pendingInterceptionId, reason: 'user-aborted' });
        pendingInterceptionId = null;
        pendingInterceptionCap = null;
        pendingInterceptionPONR = false;
        results.innerHTML = '';
        input.disabled = false;
        input.value = '';
        input.placeholder = '';
        input.focus();
        return;
      }
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

  // M5.P2.c + M6.P3 — generalised L2+ preview gate UI. Subscribes to the
  // operation-interceptor's interception:preview event, renders a 2-column
  // panel with PLANNER side (cap + args) and RED-TEAM side (review or
  // "reviewing…" placeholder), and emits interception:confirm or
  // interception:abort on user input. M6.P1: red-team agent emits
  // interception:enriched once it has analysed the pending interception
  // — that updates the right column in-place.
  function renderRedTeamColumn(ok, review, error) {
    if (!ok) {
      return `<div style="font-size:11px;color:rgba(255,255,255,0.4);">
        🤖 red-team unavailable: ${escapeHtml(error || 'unknown')}
      </div>`;
    }
    if (!review.risks.length) {
      return `<div style="font-size:11px;color:#a6e3a1;">
        🤖 red-team: ${escapeHtml(review.summary || 'no concerns')}
      </div>`;
    }
    const sevColor = { high: '#ff5555', medium: '#fab387', low: '#f1fa8c' };
    const recColor = { abort: '#ff5555', review: '#fab387', proceed: '#a6e3a1' };
    const riskRows = review.risks.map(r =>
      `<div style="font-size:11px;margin:4px 0;padding-left:14px;position:relative;">
        <span style="position:absolute;left:0;color:${sevColor[r.severity] || '#fff'};">●</span>
        <strong>${escapeHtml(r.label)}</strong>
        <span style="color:rgba(255,255,255,0.5);font-size:10px;"> [${escapeHtml(r.severity)}]</span>
        <div style="color:rgba(255,255,255,0.65);">${escapeHtml(r.reason)}</div>
      </div>`).join('');
    return `<div style="font-size:11px;color:${recColor[review.recommendation] || '#fff'};font-weight:600;margin-bottom:4px;">
        🤖 red-team: ${escapeHtml(review.recommendation)} — ${escapeHtml(review.summary || '')}
      </div>
      ${riskRows}`;
  }

  eventBus.on('interception:enriched', ({ id, ok, review, error }) => {
    if (id !== pendingInterceptionId) return;
    const col = results.querySelector('.icpt-redteam-col');
    if (!col) return;
    col.innerHTML = renderRedTeamColumn(ok, review, error);
  });

  // M4 Socratic spec UI: when an L2+ preview is for a cap that operates
  // on a graph node id (spec.freeze, app.promote, app.archive,
  // branch.merge, branch.rewind), the args summary is opaque — just an
  // id like {specId: 'n-abc...'}. The user has no way to evaluate the
  // approval. This helper async-fetches the underlying object and
  // appends a readable rendering to the preview panel.
  async function renderSocraticContext(cap, args) {
    if (!cap || !args) return '';
    try {
      if (cap.id === 'spec.freeze' && args.specId) {
        const { getSpec } = await import('../kernel/spec-generator.js');
        const spec = await getSpec(args.specId);
        if (!spec) return '';
        const criteria = (spec.acceptance_criteria || []).map((c, i) =>
          `<li style="margin:3px 0;">${escapeHtml(c)}</li>`).join('');
        const nonGoals = (spec.non_goals || []).map(n =>
          `<li style="margin:3px 0;color:rgba(255,255,255,0.55);">${escapeHtml(n)}</li>`).join('');
        const openQs = (spec.open_questions || []).map(q =>
          `<li style="margin:3px 0;color:#fab387;">${escapeHtml(q)}</li>`).join('');
        return `
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.15);">
            <div style="font-size:11px;color:#a6e3a1;font-weight:600;margin-bottom:6px;">📋 Spec to freeze</div>
            <div style="font-size:13px;color:#e0e0e0;margin-bottom:8px;font-weight:500;">${escapeHtml(spec.goal || '(no goal)')}</div>
            ${criteria ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px;">Acceptance criteria (${spec.acceptance_criteria.length}):</div><ol style="margin:0 0 8px 18px;padding:0;font-size:11px;color:#e0e0e0;">${criteria}</ol>` : ''}
            ${nonGoals ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px;">Non-goals:</div><ul style="margin:0 0 8px 18px;padding:0;font-size:11px;list-style:'– ';">${nonGoals}</ul>` : ''}
            ${spec.ux_notes ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px;">UX notes:</div><div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:8px;">${escapeHtml(spec.ux_notes)}</div>` : ''}
            ${openQs ? `<div style="font-size:11px;color:#fab387;margin-bottom:2px;">⚠ Open questions:</div><ul style="margin:0 0 4px 18px;padding:0;font-size:11px;list-style:'? ';">${openQs}</ul>` : ''}
          </div>`;
      }
      if ((cap.id === 'app.promote' || cap.id === 'app.archive') && args.appId) {
        const { getApp } = await import('../kernel/app-promoter.js');
        const app = await getApp(args.appId);
        if (!app) return '';
        const phases = app.provenance || {};
        return `
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.15);">
            <div style="font-size:11px;color:#a6e3a1;font-weight:600;margin-bottom:6px;">📦 Generated app · status: ${escapeHtml(app.status || 'unknown')}</div>
            <div style="font-size:13px;color:#e0e0e0;margin-bottom:6px;">${escapeHtml(app.intent || '(no intent recorded)')}</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.6);">Tests passed ${phases.testsPassed ?? '?'}/${phases.testsTotal ?? '?'} · code attempts ${phases.codeAttempts ?? '?'} · model ${escapeHtml(phases.codeModel || '?')}</div>
          </div>`;
      }
      if ((cap.id === 'branch.merge' || cap.id === 'branch.rewind' || cap.id === 'branch.discard') && args.branchId) {
        const branchMod = await import('../kernel/branch-manager.js');
        const branch = await branchMod.getBranch(args.branchId);
        if (!branch) return '';
        let diffSummary = '';
        let topMutations = '';
        try {
          const diff = await branchMod.diffBranch(args.branchId);
          if (diff?.lines?.length) {
            diffSummary = Object.entries(diff.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(' · ');
            topMutations = diff.lines.slice(0, 6).map((m, i) =>
              `<li style="margin:2px 0;font-family:ui-monospace,monospace;font-size:11px;color:rgba(255,255,255,0.7);"><span style="color:#a6e3a1;">${escapeHtml(m.kind)}</span> ${escapeHtml(m.describe || '')}</li>`).join('');
            if (diff.lines.length > 6) topMutations += `<li style="font-size:10px;color:rgba(255,255,255,0.4);list-style:none;">…and ${diff.lines.length - 6} more</li>`;
          }
        } catch {}
        const verb = cap.id === 'branch.merge' ? 'Merge' : cap.id === 'branch.rewind' ? 'Rewind' : 'Discard';
        const verbColor = cap.id === 'branch.merge' ? '#a6e3a1' : cap.id === 'branch.rewind' ? '#cba6f7' : 'rgba(255,255,255,0.5)';
        return `
          <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.15);">
            <div style="font-size:11px;color:${verbColor};font-weight:600;margin-bottom:6px;">⏮ ${verb} branch · status ${escapeHtml(branch.status || 'unknown')}</div>
            <div style="font-size:13px;color:#e0e0e0;margin-bottom:6px;">${escapeHtml(branch.name || '(unnamed)')}${branch.intent ? ' — ' + escapeHtml(branch.intent) : ''}</div>
            ${diffSummary ? `<div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:4px;">${escapeHtml(diffSummary)}</div>` : ''}
            ${topMutations ? `<ul style="margin:4px 0 4px 18px;padding:0;list-style:'• ';">${topMutations}</ul>` : '<div style="font-size:11px;color:rgba(255,255,255,0.4);">No mutations recorded.</div>'}
          </div>`;
      }
    } catch (err) { /* best-effort UI; never block on graph errors */ }
    return '';
  }

  eventBus.on('interception:preview', ({ id, cap, args, timeoutMs, requiresTypedConfirmation }) => {
    pendingInterceptionId = id;
    pendingInterceptionCap = cap;
    pendingInterceptionPONR = !!requiresTypedConfirmation;
    if (!isOpen) open();
    // For PONR ops, the input is ENABLED so the user can type the cap id;
    // for normal L2 the input is disabled so Enter just confirms.
    input.disabled = !pendingInterceptionPONR;
    input.value = '';
    if (pendingInterceptionPONR) {
      input.placeholder = 'Type ' + cap.id + ' to confirm';
      input.focus();
    }
    const argSummary = (() => {
      try {
        const clean = { ...args };
        delete clean._intent;
        const json = JSON.stringify(clean);
        return json.length > 240 ? json.slice(0, 240) + '…' : json;
      } catch { return ''; }
    })();
    const borderColor = pendingInterceptionPONR ? '#ff5555' : '#f1fa8c';
    const bgTint = pendingInterceptionPONR ? 'rgba(255,85,85,0.08)' : 'rgba(241,250,140,0.05)';
    const headerColor = pendingInterceptionPONR ? '#ff5555' : '#f1fa8c';
    const ponrBanner = pendingInterceptionPONR
      ? `<div style="font-size:11px;color:#ff5555;font-weight:600;margin-bottom:6px;">⚠ POINT OF NO RETURN — this action cannot be undone</div>`
      : '';
    const confirmHint = pendingInterceptionPONR
      ? `Type <code>${escapeHtml(cap.id)}</code> exactly + Enter to confirm · Esc to abort`
      : '↵ Press Enter to confirm · Esc to abort';
    // M6.P3: 2-column layout. Left = planner-proposed action (cap, args,
    // optional Socratic spec/app preview). Right = red-team review (placeholder
    // until interception:enriched arrives). Confirm hint + PONR banner span
    // both columns. For L0/L1 caps the right column is hidden — there's no
    // red-team review for sub-L2 caps.
    const showRedTeam = cap.level >= 2;
    results.innerHTML = `
      <div class="spotlight-result-group" style="border:2px solid ${borderColor};border-radius:8px;padding:12px 16px;background:${bgTint};">
        ${ponrBanner}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:12px;font-weight:600;color:${headerColor};">⚠ ${escapeHtml(cap.summary || cap.id)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5);">L${cap.level} · ${escapeHtml(cap.reversibility || 'bounded')} · ${escapeHtml(cap.blastRadius || 'file')}</div>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;">
          <div class="icpt-planner-col" style="flex:1;min-width:240px;padding-right:14px;${showRedTeam ? 'border-right:1px dashed rgba(255,255,255,0.12);' : ''}">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.4);margin-bottom:4px;">📋 Proposed action</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.7);font-family:ui-monospace,monospace;word-break:break-all;">${escapeHtml(cap.id)} ${escapeHtml(argSummary)}</div>
          </div>
          ${showRedTeam ? `<div class="icpt-redteam-col" style="flex:1;min-width:240px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.4);margin-bottom:4px;">🤖 Red-team review</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.45);font-style:italic;">reviewing…</div>
          </div>` : ''}
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.7);">${confirmHint} · auto-aborts in ${Math.round((timeoutMs || 60000) / 1000)}s</div>
      </div>`;
    // Async-fetch the underlying object (spec/app) and append a readable
    // preview INTO THE PLANNER COLUMN. Best-effort; only renders if this
    // interception is still pending.
    renderSocraticContext(cap, args).then((extra) => {
      if (!extra) return;
      if (id !== pendingInterceptionId) return;
      const col = results.querySelector('.icpt-planner-col');
      if (col) col.insertAdjacentHTML('beforeend', extra);
    });
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
      // M5.P2.c + Agent Core: Enter on empty query still counts when a
      // confirm gate is pending (interception or plan preview). Pass
      // through to handleSubmit so it can hijack and emit the confirm.
      if (query || pendingInterceptionId || pendingConfirmPlanId) handleSubmit(query);
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

    // Show recent searches
    const searchHistory = getSearchHistory();
    if (searchHistory.length > 0) {
      results.innerHTML += `
        <div class="spotlight-result-group">
          <div class="spotlight-result-label">Recent Searches</div>
          ${searchHistory.slice(0, 5).map(q => `<div class="spotlight-result-item spotlight-history-item" data-query="${escapeHtml(q)}" style="cursor:pointer;">
              <div class="spotlight-result-icon" style="font-size:14px; opacity:0.4;">\uD83D\uDD52</div>
              <div class="spotlight-result-text">
                <div class="spotlight-result-title" style="font-weight:400;">${escapeHtml(q)}</div>
              </div>
            </div>`).join('')}
        </div>`;
    }

    results.querySelectorAll('.spotlight-result-item').forEach(item => {
      item.addEventListener('click', () => {
        // If it's a history item, put the query in the input and search
        if (item.classList.contains('spotlight-history-item')) {
          input.value = item.dataset.query;
          input.dispatchEvent(new Event('input'));
          return;
        }
        handleResultClick(item, '');
      });
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

    // ─── "help" / "?" / "commands" — list every Spotlight command ───
    // Discoverability: users shouldn't need to read source to find
    // branches/timeline/skills/etc. One canonical index.
    if (/^(help|\?|commands|what can (i|you) (type|do|say))$/.test(lower)) {
      const commands = [
        { cmd: 'branches · timeline · history', desc: 'See recent L2+ operations with rewind buttons' },
        { cmd: 'rehearse <query> · preview <query>', desc: 'Dry-run a plan in a branch, see the diff, then Apply or Discard' },
        { cmd: 'upgrade yourself · improve yourself [js/apps/<file>]', desc: 'AI reads screen + source, proposes a fix, walks 5 M8 gates, writes to disk' },
        { cmd: 'compose skill <description> · make a skill that <X>', desc: 'AI drafts a .skill YAML file from your description; install in one click' },
        { cmd: 'undo upgrade · rollback upgrade', desc: 'Revert the most recent self-upgrade — restores the pre-upgrade file content' },
        { cmd: '<skill phrase>', desc: 'Run a skill by its phrase (see Settings > Skills)' },
        { cmd: '<math expression>', desc: 'Calculate: 2+2, sqrt(16), 5!, 15% of 200' },
        { cmd: '<N> <unit> to <unit>', desc: 'Convert: 5 lbs to kg, 100 cm to inches, 72 f to c' },
        { cmd: '<N> <currency> to <currency>', desc: '50 usd to eur, 100 gbp in yen' },
        { cmd: 'time in <city>', desc: 'Tokyo, London, NYC, Sydney, Dubai, etc.' },
        { cmd: 'age <yyyy-mm-dd>', desc: 'Age in years + days since birth' },
        { cmd: 'roman <num> · <num> in binary', desc: 'Numeral base conversions' },
        { cmd: 'morse <text> · rot13 <text>', desc: 'Encoding conversions' },
        { cmd: 'tip <amount> · emoji <char>', desc: 'Tip calculator, emoji meaning' },
        { cmd: 'random color · coin flip · roll dice', desc: 'Random generators' },
        { cmd: '<app name>', desc: 'Open an app — also aliases: calc, term, note, msg' },
      ];
      results.innerHTML = `<div class="spotlight-result-group">
        <div class="spotlight-result-label">? Spotlight Commands</div>
        ${commands.map(c => `
          <div class="spotlight-result-item" style="padding:8px 16px;">
            <div style="font-family:var(--font-mono,monospace);font-size:12px;color:var(--accent,#007aff);">${c.cmd}</div>
            <div style="font-size:11px;opacity:0.7;margin-top:2px;">${c.desc}</div>
          </div>
        `).join('')}
      </div>`;
      return;
    }

    // ─── M8.P5 Self-Upgrade rollback: "undo upgrade" / "rollback upgrade" / "undo last upgrade" ───
    // Finds the most recent self-upgrade whose status is 'approved' (meaning
    // it was written to disk and isn't already rolled back), previews it,
    // and rolls back on click. Writes oldContent back to the file.
    if (/^(?:undo|rollback|revert)\s+(?:last\s+)?(?:self[- ]?)?(?:upgrade|improvement|change)$/i.test(lower)) {
      try {
        const upgMod = await import('../kernel/self-upgrader.js');
        const last = await upgMod.getLastApplied();
        if (!last) {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u{1F4ED} No recent self-upgrade to undo</div>
            <div class="spotlight-result-subtitle" style="padding:10px 16px;opacity:0.6;">Try <code>upgrade yourself</code> first.</div>
          </div>`;
          return;
        }
        const ageMs = Date.now() - (last.appliedAt || last.createdAt || Date.now());
        const ageStr = ageMs < 60000 ? Math.round(ageMs/1000) + 's' : ageMs < 3600000 ? Math.round(ageMs/60000) + 'm' : Math.round(ageMs/3600000) + 'h';
        results.innerHTML = `
          <div class="spotlight-result-group">
            <div class="spotlight-result-label">\u21A9 Undo last self-upgrade?</div>
            <div style="padding:12px 16px;">
              <div style="font-size:13px;margin-bottom:4px;"><strong>Target:</strong> <code>${escapeHtml(last.target)}</code></div>
              <div style="font-size:12px;margin-bottom:4px;color:rgba(255,255,255,0.75);"><strong>What it did:</strong> ${escapeHtml(last.reason || '')}</div>
              <div style="font-size:11px;margin-bottom:10px;color:rgba(255,255,255,0.55);">Applied ${ageStr} ago \u00B7 ${escapeHtml(last.model || 'unknown model')}</div>
              <button id="spotlight-undo-confirm" data-id="${escapeHtml(last.id)}" style="padding:7px 14px;border-radius:6px;border:none;background:#cba6f7;color:#1e1e2e;font-size:12px;cursor:pointer;font-family:var(--font);font-weight:600;">\u21A9 Restore previous content</button>
              <div id="spotlight-undo-status" style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:10px;"></div>
            </div>
          </div>`;
        results.querySelector('#spotlight-undo-confirm').addEventListener('click', async () => {
          const status = results.querySelector('#spotlight-undo-status');
          status.textContent = 'Restoring\u2026';
          status.style.color = 'rgba(255,255,255,0.6)';
          const r = await upgMod.rollbackUpgrade(last.id);
          if (r.ok) {
            results.innerHTML = `<div class="spotlight-result-group">
              <div class="spotlight-result-label">\u2713 Rolled back</div>
              <div style="padding:12px 16px;">
                <div style="font-size:12px;margin-bottom:6px;"><code>${escapeHtml(r.target)}</code> restored (${r.bytes} bytes)</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.55);">${escapeHtml(r.note || '')}</div>
              </div>
            </div>`;
          } else {
            status.textContent = '\u2717 ' + (r.error || 'failed');
            status.style.color = '#ff5555';
          }
        });
      } catch (err) {
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">\u2717 Undo failed</div>
          <div class="spotlight-result-subtitle" style="padding:8px 16px;color:#ff5555;">${escapeHtml(err?.message || String(err))}</div>
        </div>`;
      }
      return;
    }

    // ─── M8.P5 Self-Upgrade: "upgrade yourself" / "improve yourself" / "self-improve" ───
    // The AI reads screen state + a source file, proposes ONE improvement,
    // walks the existing M8 5-gate sandbox, and (if all gates pass) writes
    // the change to disk via /api/files/write. Allow-list restricts the
    // AI to js/apps + js/shell + css/apps — kernel + safety rails are
    // never reachable from this path.
    // ─── Skill composer: "compose skill <description>" / "make a skill that <description>" ───
    // Asks the AI to draft a .skill YAML file from a natural-language
    // description. Shows the generated YAML inline + Install button
    // that calls installUserSkill (lesson 155 still applies — won't
    // shadow a bundled skill).
    const composeMatch = lower.match(/^(?:compose|make|create|draft|new)\s+(?:a\s+)?skill\s+(?:that\s+|to\s+)?(.+)/i)
      || lower.match(/^(?:skill|skill\s+for)\s*:\s*(.+)/i);
    if (composeMatch) {
      const desc = (composeMatch[1] || '').trim();
      if (!desc) {
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">\u{1F9E9} Compose a skill</div>
          <div class="spotlight-result-subtitle" style="padding:10px 16px;">Describe what you want — e.g. "compose skill that opens the calendar at 9am every weekday"</div>
        </div>`;
        return;
      }
      results.innerHTML = `<div class="spotlight-result-group">
        <div class="spotlight-result-label">\u{1F9E9} Drafting skill…</div>
        <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.7;">${escapeHtml(desc)}</div>
      </div>`;
      try {
        const aiMod = await import('../kernel/ai-service.js');
        const sys = `You generate Astrion .skill files. The format is YAML with these top-level keys:
  goal: short one-line description
  trigger:
    - phrase: "exact spoken phrase"   # zero or more
    - cron: "0 9 * * 1-5"            # optional, standard cron
    - event: "events:eventName"      # optional
  do: |
    Multi-line natural-language instruction for what Astrion should do.
  constraints:
    level: L0 | L1 | L2
    budget_tokens: 5

Return ONLY the YAML content, no \`\`\` fences, no commentary.`;
        const reply = await aiMod.aiService.ask(
          'Compose a .skill file for this request: ' + desc,
          { skipHistory: true, capCategory: 'skill-compose', maxTokens: 500 }
        );
        const yaml = (reply || '').trim().replace(/^```(?:yaml|yml)?\s*/i, '').replace(/```\s*$/i, '');
        if (!yaml) {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">✗ Empty draft</div>
            <div class="spotlight-result-subtitle" style="padding:10px 16px;color:#ff5555;">AI returned no content. Try a more specific description.</div>
          </div>`;
          return;
        }
        results.innerHTML = `
          <div class="spotlight-result-group">
            <div class="spotlight-result-label">\u{1F9E9} Drafted skill</div>
            <div style="padding:12px 16px;">
              <pre style="font-family:ui-monospace,monospace;font-size:11.5px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:10px;color:#e0e0e0;max-height:280px;overflow:auto;white-space:pre-wrap;margin:0;">${escapeHtml(yaml)}</pre>
              <div style="display:flex;gap:8px;margin-top:12px;">
                <button id="spotlight-skill-install" style="padding:7px 14px;border-radius:6px;border:none;background:#34c759;color:white;font-size:12px;cursor:pointer;font-family:var(--font);font-weight:600;">✓ Install</button>
                <button id="spotlight-skill-discard" style="padding:7px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.75);font-size:12px;cursor:pointer;font-family:var(--font);">Discard</button>
                <span id="spotlight-skill-status" style="font-size:11px;color:rgba(255,255,255,0.55);align-self:center;"></span>
              </div>
            </div>
          </div>`;
        results.querySelector('#spotlight-skill-install').addEventListener('click', async () => {
          const status = results.querySelector('#spotlight-skill-status');
          status.textContent = 'Installing…';
          try {
            const sm = await import('../kernel/skill-registry.js');
            const r = await sm.installUserSkill(yaml);
            if (r.ok) {
              status.textContent = '✓ Installed as ' + r.name;
              status.style.color = '#a6e3a1';
            } else {
              status.textContent = '✗ ' + r.error;
              status.style.color = '#ff5555';
            }
          } catch (err) {
            status.textContent = '✗ ' + (err?.message || String(err));
            status.style.color = '#ff5555';
          }
        });
        results.querySelector('#spotlight-skill-discard').addEventListener('click', () => {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">✕ Discarded</div>
            <div class="spotlight-result-subtitle" style="padding:10px 16px;opacity:0.6;">Nothing installed.</div>
          </div>`;
        });
      } catch (err) {
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">✗ Compose error</div>
          <div class="spotlight-result-subtitle" style="padding:8px 16px;color:#ff5555;">${escapeHtml(err?.message || String(err))}</div>
        </div>`;
      }
      return;
    }

    const upgradeMatch = lower.match(/^(?:upgrade|improve|self[- ]?improve|self[- ]?upgrade)\s*(?:yourself|astrion|os)?(?:\s+(.+))?$/i);
    if (upgradeMatch && /upgrade|improve/.test(lower)) {
      const focusHint = (upgradeMatch[1] || '').trim() || null;
      results.innerHTML = `<div class="spotlight-result-group">
        <div class="spotlight-result-label">\u{1F916} Self-upgrade: looking at screen + source\u2026</div>
        <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.7;">
          ${focusHint ? 'Focus: ' + escapeHtml(focusHint) : 'Scanning allow-listed source files'}
        </div>
      </div>`;
      try {
        const upgMod = await import('../kernel/self-upgrader.js');
        const focusPath = focusHint && /^js\/(apps|shell)\//.test(focusHint) ? focusHint : null;
        const r = await upgMod.proposeUpgrade({ focus: focusPath });
        if (!r.ok) {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u2717 Self-upgrade failed</div>
            <div class="spotlight-result-subtitle" style="padding:10px 16px;color:#ff5555;">${escapeHtml(r.error || 'unknown')}</div>
          </div>`;
          return;
        }
        if (r.status === 'pass') {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u{1F4AD} Nothing to improve right now</div>
            <div class="spotlight-result-subtitle" style="padding:10px 16px;">${escapeHtml(r.reason || '')}</div>
          </div>`;
          return;
        }
        // r.status === 'propose' — render the diff + gate preview + Apply button
        const diffLines = (r.diff || '').split('\n').slice(0, 40);
        const moreLines = (r.diff || '').split('\n').length - diffLines.length;
        const diffHtml = diffLines.map(l => {
          if (l.startsWith('+')) return `<div style="background:rgba(52,199,89,0.12);color:#a6e3a1;">${escapeHtml(l)}</div>`;
          if (l.startsWith('-')) return `<div style="background:rgba(255,69,58,0.12);color:#f38ba8;">${escapeHtml(l)}</div>`;
          if (l.startsWith('@@') || l.startsWith('+++') || l.startsWith('---')) return `<div style="color:rgba(255,255,255,0.45);">${escapeHtml(l)}</div>`;
          return `<div>${escapeHtml(l)}</div>`;
        }).join('');

        results.innerHTML = `
          <div class="spotlight-result-group">
            <div class="spotlight-result-label">\u{1F916} Self-upgrade proposal</div>
            <div style="padding:12px 16px;">
              <div style="font-size:13px;margin-bottom:4px;"><strong>Target:</strong> <code>${escapeHtml(r.target)}</code></div>
              <div style="font-size:12px;margin-bottom:8px;color:rgba(255,255,255,0.75);"><strong>Why:</strong> ${escapeHtml(r.reason)}</div>
              ${r.rollback_description ? `<div style="font-size:11px;margin-bottom:8px;color:rgba(255,255,255,0.55);"><strong>Rollback:</strong> ${escapeHtml(r.rollback_description)}</div>` : ''}

              <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.45);margin:10px 0 4px;">Diff preview (first ${diffLines.length} lines)</div>
              <div style="max-height:240px;overflow-y:auto;font-family:ui-monospace,monospace;font-size:11px;line-height:1.5;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px;">${diffHtml}</div>
              ${moreLines > 0 ? `<div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:4px;">(+${moreLines} more lines)</div>` : ''}

              <div style="margin-top:14px;padding:10px 12px;background:rgba(255,69,58,0.08);border:1px solid rgba(255,69,58,0.3);border-radius:6px;">
                <div style="font-size:11px;font-weight:600;color:#ff6b5e;margin-bottom:4px;">\u26A0 5 gates + typed confirm required</div>
                <div style="font-size:10.5px;color:rgba(255,255,255,0.7);margin-bottom:8px;">
                  To apply: type the proposal id exactly, then hit Apply. Golden-integrity, value-lock, red-team, and rollback-plan gates fire automatically.
                </div>
                <div style="font-family:ui-monospace,monospace;font-size:11px;background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:4px;color:#a6e3a1;margin-bottom:6px;user-select:all;">${escapeHtml(r.proposalId)}</div>
                <input type="text" id="spotlight-upgrade-confirm" placeholder="Type the id above" style="width:100%;padding:7px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:white;font-family:ui-monospace,monospace;font-size:11px;box-sizing:border-box;outline:none;">
                <div id="spotlight-upgrade-status" style="font-size:10.5px;color:rgba(255,255,255,0.55);margin-top:6px;"></div>
              </div>
              <div style="display:flex;gap:8px;margin-top:10px;">
                <button id="spotlight-upgrade-apply" data-id="${escapeHtml(r.proposalId)}" style="padding:7px 14px;border-radius:6px;border:none;background:#ff453a;color:white;font-size:12px;cursor:pointer;font-family:var(--font);font-weight:600;">\u{1F50C} Apply to disk</button>
                <button id="spotlight-upgrade-discard" data-id="${escapeHtml(r.proposalId)}" style="padding:7px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.75);font-size:12px;cursor:pointer;font-family:var(--font);">Discard</button>
              </div>
            </div>
          </div>`;

        results.querySelector('#spotlight-upgrade-apply').addEventListener('click', async () => {
          const proposalId = r.proposalId;
          const typed = results.querySelector('#spotlight-upgrade-confirm')?.value || '';
          const status = results.querySelector('#spotlight-upgrade-status');
          if (typed !== proposalId) {
            status.textContent = '✗ Typed text must match the id exactly.';
            status.style.color = '#ff5555';
            return;
          }
          status.textContent = 'Running gates\u2026';
          status.style.color = 'rgba(255,255,255,0.6)';
          const applyRes = await upgMod.applyUpgrade(proposalId, { typedConfirm: typed });
          if (applyRes.ok) {
            results.innerHTML = `<div class="spotlight-result-group">
              <div class="spotlight-result-label">\u2713 Self-upgrade applied to disk</div>
              <div style="padding:12px 16px;">
                <div style="font-size:12px;margin-bottom:6px;"><strong>File:</strong> <code>${escapeHtml(applyRes.target)}</code> (${applyRes.bytes} bytes)</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.7);margin-bottom:8px;">Gates passed: ${applyRes.gatesPassed?.join(', ')}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:10px;">${escapeHtml(applyRes.note || '')}</div>
                <button id="spotlight-upgrade-undo" data-id="${escapeHtml(applyRes.proposalId)}" style="padding:6px 12px;border-radius:6px;border:1px solid rgba(203,166,247,0.5);background:transparent;color:#cba6f7;font-size:11px;cursor:pointer;font-family:var(--font);">\u21A9 Undo this upgrade</button>
                <div id="spotlight-undo-inline-status" style="font-size:10.5px;color:rgba(255,255,255,0.55);margin-top:8px;"></div>
              </div>
            </div>`;
            results.querySelector('#spotlight-upgrade-undo')?.addEventListener('click', async () => {
              const statusEl = results.querySelector('#spotlight-undo-inline-status');
              statusEl.textContent = 'Restoring\u2026';
              const r = await upgMod.rollbackUpgrade(applyRes.proposalId);
              if (r.ok) {
                statusEl.textContent = '\u2713 Restored. Reload to see the pre-upgrade state.';
                statusEl.style.color = '#a6e3a1';
                const btn = results.querySelector('#spotlight-upgrade-undo');
                if (btn) btn.disabled = true;
              } else {
                statusEl.textContent = '\u2717 ' + (r.error || 'failed');
                statusEl.style.color = '#ff5555';
              }
            });
          } else {
            status.innerHTML = '✗ ' + escapeHtml(applyRes.error || 'failed');
            status.style.color = '#ff5555';
            if (applyRes.gatesFailed) {
              status.innerHTML += '<ul style="margin:6px 0 0;padding-left:18px;">' +
                applyRes.gatesFailed.map(g => `<li>${escapeHtml(g.check)}: ${escapeHtml(g.reason)}</li>`).join('') +
                '</ul>';
            }
          }
        });
        results.querySelector('#spotlight-upgrade-discard').addEventListener('click', async () => {
          const proposalId = r.proposalId;
          try {
            const sm = await import('../kernel/selfmod-sandbox.js');
            await sm.discardProposal(proposalId, 'user-discarded');
          } catch {}
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u2715 Proposal discarded</div>
            <div class="spotlight-result-subtitle" style="padding:10px 16px;opacity:0.6;">No changes made.</div>
          </div>`;
        });
      } catch (err) {
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">\u2717 Self-upgrade error</div>
          <div class="spotlight-result-subtitle" style="padding:8px 16px;color:#ff5555;">${escapeHtml(err?.message || String(err))}</div>
        </div>`;
      }
      return;
    }

    // ─── Clone-preview wrapper: "rehearse X" / "preview X" / "dry-run X" ───
    // Runs X through the planner, then records graph-writing steps into
    // a branch WITHOUT calling their real execute(). Shows the diff + any
    // non-graph-writer steps that would run for real on approval. User
    // approves → runs the real plan; user discards → throws away the
    // rehearsal branch cleanly (soft-deleted for audit).
    const rehearseMatch = lower.match(/^(?:rehearse|preview|dry[- ]run|what would happen if i)\s+(.+)/i);
    if (rehearseMatch) {
      const target = rehearseMatch[1].trim();
      results.innerHTML = `<div class="spotlight-result-group">
        <div class="spotlight-result-label">\u{1F50D} Rehearsing\u2026</div>
        <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.7;">${escapeHtml(target)}</div>
      </div>`;
      try {
        const [{ planIntent }, rehearser] = await Promise.all([
          import('../kernel/intent-planner.js'),
          import('../kernel/plan-rehearser.js'),
        ]);
        const plan = await planIntent({ query: target, parsedIntent: parseIntent(target) });
        if (plan.status === 'clarify') {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">? Need clarification</div>
            <div class="spotlight-result-subtitle" style="padding:8px 16px;">${escapeHtml(plan.question || '')}</div>
          </div>`;
          return;
        }
        if (plan.status !== 'plan') {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u2717 Could not plan</div>
            <div class="spotlight-result-subtitle" style="padding:8px 16px;color:#ff5555;">${escapeHtml(plan.error || 'unknown error')}</div>
          </div>`;
          return;
        }
        const r = await rehearser.rehearsePlan(plan, { query: target });
        if (!r.ok) {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u2717 Rehearsal failed</div>
            <div class="spotlight-result-subtitle" style="padding:8px 16px;color:#ff5555;">${escapeHtml(r.error || '')}</div>
          </div>`;
          return;
        }
        const summary = rehearser.summarizeDiff(r.diff);
        const lines = (r.diff?.lines || []).slice(0, 10);
        const unreh = r.unrehearsable || [];
        results.innerHTML = `
          <div class="spotlight-result-group">
            <div class="spotlight-result-label">\u{1F50D} Rehearsal preview</div>
            <div style="padding:10px 16px;">
              <div style="font-size:12px;margin-bottom:6px;"><strong>${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}</strong> \u00B7 ${escapeHtml(summary)}</div>
              ${plan.reasoning ? `<div style="font-size:11px;color:rgba(255,255,255,0.55);margin-bottom:10px;">${escapeHtml(plan.reasoning)}</div>` : ''}

              ${lines.length ? `
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.45);margin-top:8px;margin-bottom:4px;">Graph changes (previewed in branch)</div>
                <ul style="font-size:11px;font-family:ui-monospace,monospace;color:#a6e3a1;margin:0 0 10px;padding-left:18px;line-height:1.6;">
                  ${lines.map(l => `<li>${escapeHtml(l.describe || l.kind)}</li>`).join('')}
                </ul>
              ` : ''}

              ${unreh.length ? `
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(255,255,255,0.45);margin-top:8px;margin-bottom:4px;">Will run for real on Apply (can't rehearse)</div>
                <ul style="font-size:11px;font-family:ui-monospace,monospace;color:#fab387;margin:0 0 10px;padding-left:18px;line-height:1.6;">
                  ${unreh.map(u => `<li>${escapeHtml(u.cap)}(${escapeHtml(JSON.stringify(u.args || {}).slice(0, 60))})</li>`).join('')}
                </ul>
              ` : ''}

              <div style="display:flex;gap:8px;margin-top:12px;">
                <button id="spotlight-rehearse-apply" data-branch-id="${r.branchId}" style="padding:6px 14px;border-radius:6px;border:none;background:#34c759;color:white;font-size:12px;cursor:pointer;font-family:var(--font);font-weight:600;">\u2713 Apply</button>
                <button id="spotlight-rehearse-discard" data-branch-id="${r.branchId}" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.75);font-size:12px;cursor:pointer;font-family:var(--font);">\u2715 Discard</button>
              </div>
            </div>
          </div>`;
        results.querySelector('#spotlight-rehearse-apply')?.addEventListener('click', async () => {
          const bId = r.branchId;
          await rehearser.acceptRehearsal(bId);
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u25D4 Running for real\u2026</div>
            <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.7;">${escapeHtml(target)}</div>
          </div>`;
          // Fire the normal plan execution path; L2+ gates still fire.
          eventBus.emit('intent:plan', { query: target, parsedIntent: parseIntent(target) });
        });
        results.querySelector('#spotlight-rehearse-discard')?.addEventListener('click', async () => {
          const bId = r.branchId;
          await rehearser.rejectRehearsal(bId, 'user-discarded-from-spotlight');
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">\u2715 Discarded</div>
            <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.6;">Nothing was changed.</div>
          </div>`;
        });
      } catch (err) {
        console.warn('[spotlight] rehearse failed:', err);
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">\u2717 Rehearsal error</div>
          <div class="spotlight-result-subtitle" style="padding:8px 16px;color:#ff5555;">${escapeHtml(err?.message || String(err))}</div>
        </div>`;
      }
      return;
    }

    // ─── M5.P3.b + M5.P3.c: "branches" / "timeline" command ───
    // Typing "branches" (or "branch"/"timeline"/"history"/"log"/"rewind"/"undo")
    // shows a chronological timeline of recent branches with status,
    // mutation count, age, and intent. Click a row to expand and see
    // each mutation. Committed branches get a "Rewind" pill that fires
    // branch.rewind via the intent path — automatic M5.P2 gate +
    // red-team review.
    if (/^(branches?|timeline|history|log|rewind|undo)$/.test(lower)) {
      try {
        const branchMod = await import('../kernel/branch-manager.js');
        const branches = await branchMod.listBranches('*', 20);
        if (!branches.length) {
          results.innerHTML = `<div class="spotlight-result-group">
            <div class="spotlight-result-label">⏮ Timeline</div>
            <div class="spotlight-result-subtitle" style="padding:12px 16px;opacity:0.6;">No branches yet. Branches are created when L2+ ops stage their changes.</div>
          </div>`;
          return;
        }
        const fmtTs = (ts) => {
          if (!ts) return '—';
          const d = new Date(ts);
          const now = new Date();
          const sameDay = d.toDateString() === now.toDateString();
          const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (sameDay) return time;
          const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
          return `${date} ${time}`;
        };
        const fmtAge = (ts) => {
          if (!ts) return '';
          const ms = Date.now() - ts;
          if (ms < 60000) return Math.round(ms/1000) + 's';
          if (ms < 3600000) return Math.round(ms/60000) + 'm';
          if (ms < 86400000) return Math.round(ms/3600000) + 'h';
          return Math.round(ms/86400000) + 'd';
        };
        const statusColor = { open: '#fab387', committed: '#a6e3a1', discarded: 'rgba(255,255,255,0.4)', rewound: '#cba6f7' };
        const RAIL_LEFT = '14px';
        const NODE_LEFT = '8px';
        const rows = branches.map((b, idx) => {
          const color = statusColor[b.status] || '#fff';
          const mutCount = (b.pendingMutations || []).length;
          const isLast = idx === branches.length - 1;
          const rewindBtn = b.status === 'committed'
            ? `<button class="spotlight-branch-rewind" data-branch-id="${b.id}" style="margin-left:8px;padding:3px 10px;border-radius:5px;border:1px solid #cba6f7;background:transparent;color:#cba6f7;font-size:11px;cursor:pointer;font-family:var(--font);">⏪ Rewind</button>`
            : '';
          const pivot = b.committedAt || b.discardedAt || b.rewoundAt || b.createdAt;
          const railSegment = isLast ? '' : `<div style="position:absolute;left:${RAIL_LEFT};top:24px;bottom:-8px;width:1.5px;background:rgba(255,255,255,0.12);"></div>`;
          return `<div class="spotlight-branch-row" data-branch-id="${b.id}" style="position:relative;padding:8px 14px 8px 36px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;">
            ${railSegment}
            <div style="position:absolute;left:${NODE_LEFT};top:12px;width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 0 2px #1a1a1f, 0 0 0 3px rgba(255,255,255,0.08);"></div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:baseline;gap:8px;">
                  <span style="font-size:13px;color:#fff;">${escapeHtml(b.name || b.id.slice(-8))}</span>
                  <span style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(b.status)}</span>
                </div>
                <div style="font-size:11px;color:rgba(255,255,255,0.55);font-family:ui-monospace,monospace;margin-top:2px;">
                  ${fmtTs(pivot)} · ${fmtAge(pivot)} ago · ${mutCount} mut${b.intent ? ' · ' + escapeHtml(b.intent.slice(0, 40)) : ''}
                </div>
              </div>
              ${rewindBtn}
            </div>
            <div class="spotlight-branch-detail" data-detail-for="${b.id}" style="display:none;margin-top:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;font-family:ui-monospace,monospace;font-size:11px;color:rgba(255,255,255,0.7);"></div>
          </div>`;
        }).join('');
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">⏮ Timeline  ·  ${branches.length} branches  ·  click row to expand</div>
          ${rows}
        </div>`;
        // Click row to toggle the diff detail pane
        results.querySelectorAll('.spotlight-branch-row').forEach(row => {
          row.addEventListener('click', async (e) => {
            // Ignore clicks on the rewind button — it has its own handler
            if (e.target.closest('.spotlight-branch-rewind')) return;
            const id = row.dataset.branchId;
            const detail = row.querySelector('.spotlight-branch-detail');
            if (!detail) return;
            if (detail.style.display === 'block') {
              detail.style.display = 'none';
              return;
            }
            detail.style.display = 'block';
            detail.innerHTML = '<span style="opacity:0.5;">Loading diff…</span>';
            try {
              const diff = await branchMod.diffBranch(id);
              if (!diff.lines.length) {
                detail.innerHTML = '<span style="opacity:0.5;">No mutations recorded.</span>';
                return;
              }
              const summary = Object.entries(diff.counts)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k}: ${v}`).join(' · ');
              const items = diff.lines.map((m, i) =>
                `<div style="margin:2px 0;"><span style="color:rgba(255,255,255,0.4);">${String(i+1).padStart(2,' ')}.</span> <span style="color:#a6e3a1;">${escapeHtml(m.kind)}</span> <span style="color:rgba(255,255,255,0.6);">${escapeHtml(m.describe || '')}</span></div>`
              ).join('');
              detail.innerHTML = `<div style="margin-bottom:6px;color:rgba(255,255,255,0.5);">${escapeHtml(summary)}</div>${items}`;
            } catch (err) {
              detail.innerHTML = `<span style="color:#ff5555;">diff failed: ${escapeHtml(err.message || String(err))}</span>`;
            }
          });
        });
        // Wire rewind buttons — each fires branch.rewind via the intent path,
        // which goes through the M5.P2 interception gate (so user sees the
        // preview panel, gets red-team review, confirms with Enter).
        results.querySelectorAll('.spotlight-branch-rewind').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.branchId;
            eventBus.emit('intent:execute', {
              verb: 'rewind', target: 'branch',
              args: { branchId: id }, confidence: 1.0,
            });
          });
        });
        return;
      } catch (err) {
        console.warn('[spotlight] timeline command failed:', err);
      }
    }

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
      const smartAction = smart.action === 'launch' ? 'launch' : smart.action === 'event' ? 'event' : smart.copyValue ? 'copy' : 'none';
      const smartData = smart.action === 'launch' ? `data-app="${smart.appId}"` : smart.action === 'event' ? `data-event="${smart.event}"` : smart.copyValue ? `data-copy="${escapeHtml(smart.copyValue)}"` : '';
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
    // Exact + substring match first, then fuzzy fallback for typos
    let matchedApps = apps.filter(a =>
      a.name.toLowerCase().includes(lower) || a.id.includes(lower) || a.id === aliasMatch
    );
    // Fuzzy match if no exact results and query is 3+ chars
    if (matchedApps.length === 0 && lower.length >= 3) {
      matchedApps = apps.filter(a => {
        const name = a.name.toLowerCase();
        // Simple Levenshtein-ish: count matching chars in order
        let j = 0;
        for (let i = 0; i < name.length && j < lower.length; i++) {
          if (name[i] === lower[j]) j++;
        }
        return j >= lower.length * 0.7; // 70%+ chars match in order
      }).slice(0, 3);
    }

    // App descriptions for richer search results
    const APP_DESC = {
      finder:'File manager',browser:'Web browser',notes:'Write and organize notes',
      terminal:'Command line',messages:'AI chat assistant',music:'Music player',
      photos:'Image viewer',calculator:'Math calculator',weather:'Forecast',
      calendar:'Date planner',settings:'System preferences',clock:'World clock & timer',
      'text-editor':'Code editor',draw:'Drawing canvas',youtube:'Video player',
      chess:'Strategy game','2048':'Number puzzle',snake:'Classic game',
      tetris:'Block puzzle',minesweeper:'Logic game',todo:'Task list',
      reminders:'Scheduled alerts','activity-monitor':'System monitor',
      'video-editor':'Edit videos','ai-art':'Generate art from text',
      'ai-writer':'AI writing assistant',animate:'Character animation',
      'beat-studio':'Music maker','pixel-art':'Pixel drawing',
      kanban:'Project board',journal:'Daily writing',budget:'Money tracker',
      'typing-test':'WPM test',wordle:'Word guessing game',
      sudoku:'Number puzzle',meditation:'Breathing exercises',
    };

    if (matchedApps.length > 0) {
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">Applications</div>`;
      matchedApps.forEach(app => {
        const desc = APP_DESC[app.id] || 'Application';
        html += `<div class="spotlight-result-item" data-action="launch" data-app="${app.id}">
          <div class="spotlight-result-icon">${app.icon}</div>
          <div class="spotlight-result-text">
            <div class="spotlight-result-title">${app.name}</div>
            <div class="spotlight-result-subtitle">${desc}</div>
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

    // M5.P2.c — interception preview takes priority over plan preview
    // (rare but possible if a plan-step fires a single-shot L2 cap that
    // hits the interceptor mid-plan).
    if (pendingInterceptionId) {
      // M5.P4: when the cap is point-of-no-return, the user must type
      // the exact cap id before Enter is accepted as confirmation.
      if (pendingInterceptionPONR) {
        const expected = pendingInterceptionCap?.id || '';
        const typed = (query || '').trim();
        if (typed !== expected) {
          // Wrong text — show a hint, don't confirm or abort.
          input.value = '';
          results.querySelector('.spotlight-result-group')?.insertAdjacentHTML('beforeend',
            `<div style="font-size:11px;color:#ff5555;margin-top:6px;">Typed text did not match. Type <code>${escapeHtml(expected)}</code> exactly.</div>`);
          input.focus();
          return;
        }
      }
      const iid = pendingInterceptionId;
      pendingInterceptionId = null;
      pendingInterceptionCap = null;
      pendingInterceptionPONR = false;
      eventBus.emit('interception:confirm', { id: iid });
      input.disabled = false;
      input.value = '';
      input.placeholder = '';
      results.innerHTML = '';
      return;
    }

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

    // M7.P2 skill dispatch — if the trimmed query matches a registered
    // skill's phrase trigger, fire the skill instead of parsing the query
    // as free text. The skill's `do` prompt is usually better-calibrated
    // than what a user would type fresh. Exact case-insensitive match
    // only; fuzzy matching can come later.
    try {
      const { matchPhrase, runSkill } = await import('../kernel/skill-registry.js');
      const hit = matchPhrase(query);
      if (hit) {
        const context = getContextBundle();
        input.disabled = true;
        results.innerHTML = `<div class="spotlight-result-group">
          <div class="spotlight-result-label">🧩 Skill · ${escapeHtml(hit.skill.goal)}</div>
          <div class="spotlight-result-subtitle" style="padding:8px 16px;opacity:0.7;">${escapeHtml(hit.name)} · L${escapeHtml(hit.skill.constraints.level || 'L1')} · budget ${hit.skill.constraints.budget_tokens || '?'} tokens</div>
        </div>`;
        runSkill(hit.name, { context });
        return;
      }
    } catch (err) {
      console.warn('[spotlight] skill dispatch failed, falling back:', err?.message);
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
      // M6.P2 Socratic prompter: cheap pre-planner ambiguity check.
      // If the parser confidence is high (>0.85), askSocratic returns
      // 'proceed' in 0ms with no AI call. Otherwise it asks the model
      // for a clarifying question — if one comes back, render it via
      // the existing planState.clarify UI (click on a choice resubmits
      // with the chosen disambiguation as the new query) and skip the
      // planner. The planner spends 500+ tokens; Socratic spends 200.
      try {
        const { askSocratic } = await import('../kernel/socratic-prompter.js');
        const socratic = await askSocratic(query, intent);
        if (socratic && socratic.type === 'ask') {
          planState.clarify = { question: socratic.question, choices: socratic.choices || [] };
          planState.query = query;
          input.disabled = false;
          activePlanId = null;
          renderPlanPanel();
          return;
        }
      } catch (err) {
        console.warn('[spotlight] socratic prompter threw, proceeding with planner:', err?.message);
      }
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
    } else if (action === 'event') {
      const evt = item.dataset.event;
      if (evt) eventBus.emit(evt);
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
