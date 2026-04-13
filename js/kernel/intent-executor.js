// Astrion OS — Intent Step Executor (M1.P3)
//
// Takes a parsed Intent, resolves it to a Capability, runs the capability
// through the runCapability wrapper, and emits events at each step so the
// Spotlight UI (M1.P4) can show live progress.
//
// Currently executes single-step intents (one capability per intent). Multi-
// step chains (e.g., "find notes about X and email them to Y") come in M1.P5+
// via an intent planner.
//
// Event flow:
//   intent:execute (from Spotlight) → executeIntent()
//     → intent:started                  { intent, cap }
//     → capability:start                (emitted by runCapability)
//     → capability:success OR error     (emitted by runCapability)
//     → intent:completed                { intent, result, success }
//   OR intent:rejected                  { intent, reason }

import { resolveCapability, getCapability, runCapability, LEVEL } from './capability-api.js';
import { eventBus } from './event-bus.js';
import { intentToNaturalLanguage } from './intent-parser.js';

// ═══════════════════════════════════════════════════════════════
// BUDGET TRACKING
// ═══════════════════════════════════════════════════════════════

// Simple daily irreversibility-token budget. Persisted to localStorage.
// When exceeded, the executor asks the user via a Socratic prompt
// (real Socratic loop ships in M6 — for now we just warn).
const DAILY_BUDGET_KEY = 'astrion-budget-day';
const DAILY_TOKEN_LIMIT = 50;

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getBudgetUsed() {
  const stored = JSON.parse(localStorage.getItem(DAILY_BUDGET_KEY) || '{}');
  const today = getTodayKey();
  if (stored.day !== today) return 0;
  return stored.used || 0;
}

function recordBudgetUsed(tokens) {
  const today = getTodayKey();
  const stored = { day: today, used: getBudgetUsed() + tokens };
  localStorage.setItem(DAILY_BUDGET_KEY, JSON.stringify(stored));
}

/**
 * Atomically check + reserve budget. Returns { ok, remaining } or { ok: false }.
 * Prevents concurrent executePlan calls from both passing the budget check
 * before either records usage (the race condition from the audit).
 */
function reserveBudget(tokens) {
  const today = getTodayKey();
  const stored = JSON.parse(localStorage.getItem(DAILY_BUDGET_KEY) || '{}');
  const used = (stored.day === today) ? (stored.used || 0) : 0;
  const remaining = DAILY_TOKEN_LIMIT - used;
  if (tokens > remaining) return { ok: false, remaining };
  // Reserve immediately (atomic read-modify-write via localStorage)
  localStorage.setItem(DAILY_BUDGET_KEY, JSON.stringify({ day: today, used: used + tokens }));
  return { ok: true, remaining: remaining - tokens };
}

export function getRemainingBudget() {
  return Math.max(0, DAILY_TOKEN_LIMIT - getBudgetUsed());
}

// ═══════════════════════════════════════════════════════════════
// EXECUTOR
// ═══════════════════════════════════════════════════════════════

/**
 * Execute a parsed intent. Returns the capability result or a rejection.
 * @param {Intent} intent
 * @returns {Promise<{ok: boolean, result?: any, error?: string}>}
 */
export async function executeIntent(intent) {
  if (!intent) {
    return { ok: false, error: 'No intent to execute' };
  }

  // ─── 1. Resolve to a capability ───
  const cap = resolveCapability(intent);
  if (!cap) {
    const error = `No capability for ${intent.verb} ${intent.target || ''}`;
    eventBus.emit('intent:rejected', { intent, reason: error });
    console.warn('[intent-executor]', error);
    return { ok: false, error };
  }

  // ─── 2. Budget check ───
  const cost = cap.estimateCost(intent.args);
  const remaining = getRemainingBudget();
  if (cost.irreversibilityTokens > remaining) {
    const error = `Daily budget exceeded (${cost.irreversibilityTokens} > ${remaining} tokens remaining)`;
    eventBus.emit('intent:rejected', { intent, reason: error });
    return { ok: false, error };
  }

  // ─── 3. Announce execution ───
  eventBus.emit('intent:started', {
    intent,
    cap,
    naturalDescription: intentToNaturalLanguage(intent),
    costEstimate: cost,
  });

  console.log(
    `[intent-executor] ${cap.id} (${cost.timeMs}ms, ${cost.irreversibilityTokens} tokens)`,
    intent.args
  );

  // ─── 4. Build args (inject _intent for providers that need context) ───
  const args = { ...intent.args, _intent: intent };

  // ─── 5. Execute via the capability ───
  let result;
  try {
    result = await cap.execute(args);
  } catch (err) {
    const error = err?.message || String(err);
    eventBus.emit('intent:completed', { intent, success: false, error });
    return { ok: false, error };
  }

  // ─── 6. Record budget + emit completion ───
  if (result.ok) {
    recordBudgetUsed(cost.irreversibilityTokens);
  }

  eventBus.emit('intent:completed', {
    intent,
    success: result.ok,
    result,
    error: result.error,
  });

  return result.ok
    ? { ok: true, result: result.output, provenance: result.provenance }
    : { ok: false, error: result.error };
}

// ═══════════════════════════════════════════════════════════════
// PLAN EXECUTION (Agent Core Sprint, Phase 4)
// ═══════════════════════════════════════════════════════════════
//
// Runs a multi-step plan produced by intent-planner.js. Each step is a
// capability call with args. If step N depends on step M's output, step N
// uses `${binds.NAME}` in its args where NAME was set as step M's "binds".
//
// Event lifecycle (all events carry a stable `planId`):
//   plan:started     { planId, plan, totalTokens }
//   plan:preview     { planId, plan, totalTokens }   — only when any step is L2+
//   plan:confirmed   { planId }                       — from Spotlight's ↵
//   plan:aborted     { planId, reason }
//   plan:step:start  { planId, index, step, resolvedArgs }
//   plan:step:done   { planId, index, step, output }
//   plan:step:fail   { planId, index, step, error }
//   plan:completed   { planId, bindings, results }
//   plan:failed      { planId, error, atStep }

const PLAN_CONFIRM_TIMEOUT_MS = 60_000;

/**
 * Walk an args object and replace every `${binds.NAME}` string with the
 * corresponding value from the bindings map. Returns a fresh object; never
 * mutates the original.
 */
export function resolveBindings(args, bindings) {
  if (args == null) return args;
  if (typeof args === 'string') {
    return args.replace(/\$\{binds\.([a-zA-Z0-9_]+)\}/g, (match, name) => {
      if (bindings[name] == null) return match; // leave unresolved for validation
      return typeof bindings[name] === 'string' ? bindings[name] : JSON.stringify(bindings[name]);
    });
  }
  if (Array.isArray(args)) {
    return args.map(v => resolveBindings(v, bindings));
  }
  if (typeof args === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(args)) out[k] = resolveBindings(v, bindings);
    return out;
  }
  return args;
}

/**
 * Walk a resolved-args tree and collect any binding references that survived
 * substitution (i.e., `${binds.NAME}` the executor couldn't resolve). Returns
 * the list of unresolved binding names. Used by `executePlan` to fail with a
 * clean error instead of letting the downstream capability complain about a
 * nonsense path or string.
 */
export function findUnresolvedBindings(value) {
  const out = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'string') {
      const re = /\$\{binds\.([a-zA-Z0-9_]+)\}/g;
      let m;
      while ((m = re.exec(v))) out.add(m[1]);
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v).forEach(walk); }
  };
  walk(value);
  return Array.from(out);
}

/**
 * Given a step output, pick the value to bind (if the step declared a
 * `binds` field). For files.createFolder we want the `path` field; for a
 * generic capability we take `path` if present, otherwise the whole output.
 */
export function pickBindValue(output) {
  if (output == null || typeof output !== 'object') return output;
  if (typeof output.path === 'string') return output.path;
  if (typeof output.id === 'string') return output.id;
  return output;
}

function makePlanId() {
  return 'p-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function waitForConfirm(planId) {
  return new Promise((resolve) => {
    let settled = false;
    const onConfirm = ({ planId: pid }) => {
      if (pid !== planId || settled) return;
      settled = true;
      eventBus.off?.('plan:confirmed', onConfirm);
      eventBus.off?.('plan:aborted', onAbort);
      clearTimeout(timer);
      resolve({ ok: true });
    };
    const onAbort = ({ planId: pid, reason }) => {
      if (pid !== planId || settled) return;
      settled = true;
      eventBus.off?.('plan:confirmed', onConfirm);
      eventBus.off?.('plan:aborted', onAbort);
      clearTimeout(timer);
      resolve({ ok: false, reason: reason || 'aborted' });
    };
    eventBus.on('plan:confirmed', onConfirm);
    eventBus.on('plan:aborted', onAbort);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      eventBus.off?.('plan:confirmed', onConfirm);
      eventBus.off?.('plan:aborted', onAbort);
      resolve({ ok: false, reason: 'timeout' });
    }, PLAN_CONFIRM_TIMEOUT_MS);
  });
}

/**
 * Execute a planner plan end-to-end.
 *
 * @param {object} plan — `{ status:'plan', steps:[...], reasoning? }`
 * @param {object} [opts]
 * @param {string} [opts.sessionId]  — for conversation memory
 * @param {string} [opts.query]      — original user query, echoed in events
 * @returns {Promise<{ ok:boolean, planId:string, bindings:object, results:Array, error?:string, atStep?:number }>}
 */
export async function executePlan(plan, opts = {}) {
  const planId = makePlanId();
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    eventBus.emit('plan:failed', { planId, error: 'empty plan', atStep: -1 });
    return { ok: false, planId, bindings: {}, results: [], error: 'empty plan' };
  }

  // ─── Resolve capabilities + compute total cost up-front ───
  const resolved = [];
  let totalTokens = 0;
  let maxLevel = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const cap = getCapability(step.cap);
    if (!cap) {
      const error = `unknown capability at step ${i}: ${step.cap}`;
      eventBus.emit('plan:failed', { planId, error, atStep: i });
      return { ok: false, planId, bindings: {}, results: [], error, atStep: i };
    }
    const cost = cap.estimateCost(step.args || {});
    totalTokens += cost.irreversibilityTokens || 0;
    if (cap.level > maxLevel) maxLevel = cap.level;
    resolved.push({ cap, step });
  }

  // Atomic budget reservation — prevents concurrent plans from both passing
  // the check before either records usage (audit bug #3)
  const budgetCheck = reserveBudget(totalTokens);
  if (!budgetCheck.ok) {
    const error = `plan exceeds daily budget (${totalTokens} > ${budgetCheck.remaining} tokens)`;
    eventBus.emit('plan:failed', { planId, error, atStep: -1 });
    return { ok: false, planId, bindings: {}, results: [], error };
  }

  // ─── Announce + optional preview gate for L2+ ───
  eventBus.emit('plan:started', {
    planId,
    plan,
    query: opts.query || '',
    totalTokens,
    reasoning: plan.reasoning || '',
  });

  if (maxLevel >= LEVEL.REAL) {
    eventBus.emit('plan:preview', { planId, plan, totalTokens, reasoning: plan.reasoning || '' });
    const gate = await waitForConfirm(planId);
    if (!gate.ok) {
      eventBus.emit('plan:failed', { planId, error: `plan not confirmed: ${gate.reason}`, atStep: -1 });
      return { ok: false, planId, bindings: {}, results: [], error: `not confirmed: ${gate.reason}` };
    }
  }

  // ─── Sequential execution with binding resolution ───
  const bindings = {};
  const results = [];

  for (let i = 0; i < resolved.length; i++) {
    const { cap, step } = resolved[i];
    const subbed = resolveBindings(step.args || {}, bindings);
    // Agent Core Sprint follow-up: if any `${binds.X}` survived substitution
    // (typo in the planner output, missing upstream binds field, etc.), fail
    // fast with a clean error. Without this the downstream capability would
    // get a garbled string like "/${binds.nope}/foo" and complain about a
    // "path outside allowed roots" — confusing and hard to debug.
    const unresolved = findUnresolvedBindings(subbed);
    if (unresolved.length > 0) {
      const error = `unresolved binding${unresolved.length > 1 ? 's' : ''}: ${unresolved.map(n => '${binds.' + n + '}').join(', ')}`;
      eventBus.emit('plan:step:fail', { planId, index: i, step, error });
      eventBus.emit('plan:failed', { planId, error, atStep: i });
      return { ok: false, planId, bindings, results, error, atStep: i };
    }
    const resolvedArgs = {
      ...subbed,
      _intent: { raw: opts.query || '', args: step.args || {} },
    };
    eventBus.emit('plan:step:start', { planId, index: i, step, resolvedArgs });

    let result;
    try {
      result = await cap.execute(resolvedArgs);
    } catch (err) {
      const error = err?.message || String(err);
      eventBus.emit('plan:step:fail', { planId, index: i, step, error });
      eventBus.emit('plan:failed', { planId, error, atStep: i });
      return { ok: false, planId, bindings, results, error, atStep: i };
    }

    if (!result || !result.ok) {
      const error = result?.error || 'step returned not-ok';
      eventBus.emit('plan:step:fail', { planId, index: i, step, error });
      eventBus.emit('plan:failed', { planId, error, atStep: i });
      return { ok: false, planId, bindings, results, error, atStep: i };
    }

    // Bind step output for later steps
    if (step.binds) {
      bindings[step.binds] = pickBindValue(result.output);
    }
    results.push({ index: i, cap: cap.id, output: result.output, provenance: result.provenance });
    // Budget already reserved atomically upfront (reserveBudget) — no per-step recording needed
    eventBus.emit('plan:step:done', { planId, index: i, step, output: result.output });
  }

  eventBus.emit('plan:completed', { planId, bindings, results });
  return { ok: true, planId, bindings, results };
}

// ═══════════════════════════════════════════════════════════════
// AUTO-WIRE: listen for intent:execute events from Spotlight
// ═══════════════════════════════════════════════════════════════

/**
 * Hook the executor into the event bus so any code that emits
 * `intent:execute` automatically triggers this executor.
 */
export function initIntentExecutor() {
  eventBus.on('intent:execute', async (intent) => {
    const result = await executeIntent(intent);
    if (!result.ok) {
      console.warn('[intent-executor] failed:', result.error);
    }
  });
  // Agent Core Sprint: Spotlight emits `intent:plan` for compound queries
  // (see js/kernel/intent-planner.js routeQuery). The handler calls the
  // planner then kicks off executePlan(). Also: session management + turn
  // recording via conversation-memory.
  eventBus.on('intent:plan', async ({ query, context, parsedIntent }) => {
    try {
      const { planIntent } = await import('./intent-planner.js');
      const memoryMod = await import('./conversation-memory.js');
      const sessionId = memoryMod.getOrCreateSession();
      const memory = await memoryMod.getRecentTurns(sessionId);

      const plan = await planIntent({ query, context, memory, parsedIntent });

      if (plan.status === 'clarify') {
        eventBus.emit('plan:clarify', {
          query,
          question: plan.question,
          choices: plan.choices,
        });
        return;
      }
      if (plan.status !== 'plan') {
        eventBus.emit('plan:failed', {
          planId: 'pre-' + Date.now().toString(36),
          error: plan.error || 'planner returned no plan',
          atStep: -1,
        });
        await memoryMod.recordTurn({
          sessionId, query, parsedIntent, ok: false,
          error: plan.error || 'planner returned no plan',
          capSummary: 'planner-failed',
        });
        return;
      }

      const result = await executePlan(plan, { query, sessionId });
      await memoryMod.recordTurn({
        sessionId,
        query,
        parsedIntent,
        plan,
        ok: result.ok,
        error: result.error || null,
        capSummary: `plan (${plan.steps.length} steps)`,
      });
    } catch (err) {
      console.warn('[intent-executor] plan handler threw:', err);
    }
  });
  console.log('[intent-executor] ready, daily budget: ' + getRemainingBudget() + ' tokens');
}
