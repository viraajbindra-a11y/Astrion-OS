// Astrion OS — Budget Manager (M3 Dual-Process Runtime, Phase 2)
//
// Tracks per-day and per-intent spending on the S2 (cloud) AI brain.
// Enforces hard daily caps so a runaway loop can't drain API credits.
// All state is in localStorage (survives refresh, not cross-tab atomic,
// but single-tab browser context is fine).
//
// Design:
//   - Each S2 call logs its token count and estimated cost
//   - Daily cap defaults to $0.50 (configurable in Settings)
//   - Per-intent cap defaults to $0.05
//   - When a cap is hit, the caller gets a rejection and should fall
//     back to S1 (Ollama) or show the user a "budget exceeded" message
//   - Costs are estimated from model pricing, not exact (Anthropic
//     returns usage in the response; we'll update with real counts when
//     M3.P2 ships the full Anthropic wrapper)
//
// Non-goals:
//   - No real billing integration. This is a client-side guard rail.
//   - No credit card management. That's console.anthropic.com's job.
//   - No cross-session aggregation (each day resets at midnight local).

const BUDGET_KEY = 'astrion-s2-budget';
const SETTINGS_KEY = 'astrion-s2-budget-settings';

// Default pricing estimates (per 1K tokens, USD)
const MODEL_PRICING = {
  'claude-haiku-4-5-20251001':  { input: 0.001, output: 0.005 },
  'claude-sonnet-4-6':          { input: 0.003, output: 0.015 },
  'claude-opus-4-6':            { input: 0.015, output: 0.075 },
};

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch { return {}; }
}

function getState() {
  try {
    const raw = JSON.parse(localStorage.getItem(BUDGET_KEY)) || {};
    const today = getTodayKey();
    if (raw.day !== today) {
      // New day — reset
      return { day: today, totalCostUsd: 0, callCount: 0, totalInputTokens: 0, totalOutputTokens: 0, log: [] };
    }
    return raw;
  } catch {
    return { day: getTodayKey(), totalCostUsd: 0, callCount: 0, totalInputTokens: 0, totalOutputTokens: 0, log: [] };
  }
}

function saveState(state) {
  localStorage.setItem(BUDGET_KEY, JSON.stringify(state));
}

// ─── Public API ───

/**
 * Get the daily spending cap in USD. Default $0.50.
 */
export function getDailyCap() {
  return getSettings().dailyCapUsd ?? 0.50;
}

/**
 * Get the per-intent spending cap in USD. Default $0.05.
 */
export function getPerIntentCap() {
  return getSettings().perIntentCapUsd ?? 0.05;
}

/**
 * Set the daily spending cap. Called from Settings > AI.
 */
export function setDailyCap(usd) {
  const s = getSettings();
  s.dailyCapUsd = Math.max(0.01, parseFloat(usd) || 0.50);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/**
 * Set the per-intent spending cap. Called from Settings > AI.
 */
export function setPerIntentCap(usd) {
  const s = getSettings();
  s.perIntentCapUsd = Math.max(0.001, parseFloat(usd) || 0.05);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/**
 * Check whether a proposed S2 call is within budget.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 *
 * @param {object} estimate
 * @param {number} estimate.inputTokens - estimated input token count
 * @param {number} estimate.outputTokens - estimated output token count
 * @param {string} [estimate.model] - model ID for pricing lookup
 */
export function checkBudget(estimate = {}) {
  const state = getState();
  const dailyCap = getDailyCap();
  const perIntentCap = getPerIntentCap();
  const model = estimate.model || 'claude-haiku-4-5-20251001';
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-haiku-4-5-20251001'];

  const inputTokens = estimate.inputTokens || 2000; // conservative default
  const outputTokens = estimate.outputTokens || 500;
  const estimatedCost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;

  // Check per-intent cap
  if (estimatedCost > perIntentCap) {
    return { allowed: false, reason: `Estimated cost $${estimatedCost.toFixed(4)} exceeds per-intent cap $${perIntentCap.toFixed(2)}` };
  }

  // Check daily cap
  if (state.totalCostUsd + estimatedCost > dailyCap) {
    return { allowed: false, reason: `Daily budget $${dailyCap.toFixed(2)} would be exceeded (spent: $${state.totalCostUsd.toFixed(4)}, this call: ~$${estimatedCost.toFixed(4)})` };
  }

  return { allowed: true, estimatedCost };
}

/**
 * Record an S2 call that was made. Updates the daily spending total.
 * Call this AFTER the API response comes back, with real token counts
 * from the Anthropic usage field if available.
 *
 * @param {object} record
 * @param {number} record.inputTokens
 * @param {number} record.outputTokens
 * @param {string} [record.model]
 * @param {string} [record.query] - for the log
 * @param {boolean} [record.ok] - did the call succeed?
 */
export function recordS2Call(record = {}) {
  const state = getState();
  const model = record.model || 'claude-haiku-4-5-20251001';
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-haiku-4-5-20251001'];

  const inputTokens = record.inputTokens || 0;
  const outputTokens = record.outputTokens || 0;
  const cost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;

  state.totalCostUsd += cost;
  state.callCount++;
  state.totalInputTokens += inputTokens;
  state.totalOutputTokens += outputTokens;

  // Keep a rolling log of the last 50 calls (for the Settings dashboard)
  state.log = state.log || [];
  state.log.push({
    ts: Date.now(),
    model,
    inputTokens,
    outputTokens,
    cost: Math.round(cost * 10000) / 10000,
    query: (record.query || '').slice(0, 100),
    ok: record.ok !== false,
  });
  if (state.log.length > 50) state.log = state.log.slice(-50);

  saveState(state);
  return { cost, totalToday: state.totalCostUsd };
}

/**
 * Get today's spending summary. Used by the Settings dashboard.
 */
export function getTodaySummary() {
  const state = getState();
  const dailyCap = getDailyCap();
  return {
    day: state.day,
    totalCostUsd: Math.round(state.totalCostUsd * 10000) / 10000,
    callCount: state.callCount,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    dailyCapUsd: dailyCap,
    remainingUsd: Math.round((dailyCap - state.totalCostUsd) * 10000) / 10000,
    percentUsed: Math.round((state.totalCostUsd / dailyCap) * 100),
    log: state.log || [],
  };
}

/**
 * Reset today's spending (for testing or manual override).
 */
export function resetBudget() {
  saveState({ day: getTodayKey(), totalCostUsd: 0, callCount: 0, totalInputTokens: 0, totalOutputTokens: 0, log: [] });
}

export function initBudgetManager() {
  console.log(`[budget-manager] initialized, daily cap: $${getDailyCap().toFixed(2)}, today: $${getState().totalCostUsd.toFixed(4)} spent`);
}
