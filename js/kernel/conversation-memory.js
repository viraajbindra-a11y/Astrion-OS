// Astrion OS — Conversation Memory (Agent Core Sprint, Phase 5)
//
// Session-scoped short-term memory for the intent planner. Every turn
// becomes a `conversation-turn` node in the M2 hypergraph with a
// `sessionId` prop that we filter on. The planner feeds the last 5 turns
// back into its prompt so follow-ups ("ok now do the same for Documents")
// have context.
//
// Design:
//   - One "session" spans from Spotlight open → 10 minutes idle → next open.
//   - Session IDs are opaque random strings, not tied to user identity.
//   - Memory NEVER leaks between sessions; the planner can only see the
//     current session's turns.
//   - Turns are full graph nodes with mutations — free rewind in M5.
//   - Summaries for the planner prompt are compact: one line per turn.
//
// Lesson #66: accessibility/verification applies here too. This stores
// conversation context in IndexedDB; it's local-only, no network. Don't
// claim "private" without noting that IndexedDB is readable by any JS
// running on the same origin.

import { graphStore } from './graph-store.js';
import { query as graphQuery } from './graph-query.js';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_TURNS_PER_PROMPT = 5;

let _sessionId = null;
let _lastActivity = 0;

// ---------- session lifecycle ----------

function makeSessionId() {
  return 's-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Return the current session id, creating a new one if there isn't one
 * yet or the last activity was more than 10 minutes ago.
 */
export function getOrCreateSession() {
  const now = Date.now();
  if (!_sessionId || (now - _lastActivity) > IDLE_TIMEOUT_MS) {
    _sessionId = makeSessionId();
  }
  _lastActivity = now;
  return _sessionId;
}

/**
 * Force a new session — e.g. when the user hits Escape to clear Spotlight.
 */
export function startFreshSession() {
  _sessionId = makeSessionId();
  _lastActivity = Date.now();
  return _sessionId;
}

/**
 * Current session id without touching last-activity timestamp.
 */
export function getCurrentSession() {
  return _sessionId;
}

// ---------- turn recording ----------

/**
 * Save a conversation turn as a graph node.
 *
 * @param {object} turn
 * @param {string} turn.sessionId
 * @param {string} turn.query            — raw user text
 * @param {object} [turn.plan]           — the plan object if planner engaged
 * @param {object} [turn.parsedIntent]   — fast-parser result if applicable
 * @param {boolean} turn.ok              — did execution succeed?
 * @param {string} [turn.error]          — error message if !ok
 * @param {string} [turn.capSummary]     — human-readable "notes.create" or "plan (2 steps)"
 * @returns {Promise<object>} the created node
 */
export async function recordTurn(turn) {
  if (!turn || !turn.sessionId || !turn.query) return null;
  try {
    const node = await graphStore.createNode(
      'conversation-turn',
      {
        sessionId: turn.sessionId,
        query: turn.query,
        plan: turn.plan || null,
        parsedIntent: turn.parsedIntent || null,
        ok: !!turn.ok,
        error: turn.error || null,
        capSummary: turn.capSummary || null,
        ts: Date.now(),
      },
      {
        createdBy: { kind: 'ai', capabilityId: 'conversation.recordTurn' },
      },
    );
    _lastActivity = Date.now();
    return node;
  } catch (err) {
    console.warn('[conversation-memory] recordTurn failed:', err?.message || err);
    return null;
  }
}

// ---------- turn fetching ----------

/**
 * Fetch the most recent N turns for the given session, oldest→newest.
 * Returns plain objects shaped for the planner prompt.
 */
export async function getRecentTurns(sessionId, n = MAX_TURNS_PER_PROMPT) {
  if (!sessionId) return [];
  try {
    const results = await graphQuery(graphStore, {
      type: 'select',
      from: 'conversation-turn',
      where: { 'props.sessionId': sessionId },
      orderBy: { field: 'createdAt', dir: 'desc' },
      limit: n,
    });
    // results is newest→oldest; flip for the planner (chronological order)
    const chrono = results.slice().reverse();
    return chrono.map(node => turnToPromptRow(node));
  } catch (err) {
    console.warn('[conversation-memory] getRecentTurns failed:', err?.message || err);
    return [];
  }
}

function turnToPromptRow(node) {
  const p = node.props || {};
  return {
    query: p.query || '',
    ok: !!p.ok,
    capSummary: p.capSummary || (p.plan?.steps ? `plan (${p.plan.steps.length} steps)` : 'plan'),
    error: p.error || null,
    relative: formatRelativeTime(p.ts || node.createdAt || Date.now()),
    ts: p.ts || node.createdAt || 0,
  };
}

function formatRelativeTime(ts) {
  const delta = Date.now() - ts;
  if (delta < 5000) return 'just now';
  if (delta < 60 * 1000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 60 * 60 * 1000) return `${Math.floor(delta / (60 * 1000))} min ago`;
  return `${Math.floor(delta / (60 * 60 * 1000))}h ago`;
}

// ---------- init (thin; no event subscriptions needed) ----------

/**
 * Fetch ALL turns across all sessions, newest first. Used by Settings >
 * AI > Conversation history. Capped at limit so a few thousand turns
 * don't kill the UI.
 */
export async function getAllTurns(limit = 100) {
  try {
    const results = await graphQuery(graphStore, {
      type: 'select',
      from: 'conversation-turn',
      where: {},
      orderBy: { field: 'createdAt', dir: 'desc' },
      limit,
    });
    return results.map(n => ({
      id: n.id,
      sessionId: n.props.sessionId,
      query: n.props.query,
      ok: n.props.ok,
      error: n.props.error,
      capSummary: n.props.capSummary,
      ts: n.props.ts || n.createdAt,
    }));
  } catch (err) {
    console.warn('[conversation-memory] getAllTurns failed:', err?.message || err);
    return [];
  }
}

export function initConversationMemory() {
  // Nothing to wire — this module is pull-based. The planner calls
  // getOrCreateSession() + getRecentTurns() on every query; the executor
  // calls recordTurn() after every query finishes.
  console.log('[conversation-memory] initialized');
}
