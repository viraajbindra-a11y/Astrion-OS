/*
 * Astrion — Self-Healing Apps (idea #2 from the 2026-06-04 brainstorm)
 *
 * When an app throws an uncaught exception, the healer agent:
 *   1. Captures the error + stack + best-guess file:line.
 *   2. Fetches the source around that line.
 *   3. Asks the AI service for a minimal one-line fix as a unified diff.
 *   4. Submits the diff through the existing M8 self-mod gates
 *      (`selfmod-sandbox.proposeSelfMod`) — same path manual proposals
 *      use, same 6-gate review, same audit trail.
 *   5. Emits `healer:proposal` so the shell can surface a toast.
 *
 * Deliberately CONSERVATIVE on what it tries to heal:
 *   - Throttles per-error-signature (no spam from a tight loop).
 *   - Refuses obvious non-fixable categories (SyntaxError at boot,
 *     network failures, abort exceptions, OOM).
 *   - Caps per-session healing budget (8 attempts) so an AI mis-fire
 *     can't drain tokens.
 *   - NEVER auto-applies. The proposal sits in the audit trail
 *     (`apps/healer-log.js`) until the user accepts via the existing
 *     self-mod confirmation flow.
 *
 * Read order: this file → js/shell/healer-toast.js → js/apps/healer-log.js.
 */

import { eventBus } from './event-bus.js';
import { aiService } from './ai-service.js';
import { proposeSelfMod, listProposals } from './selfmod-sandbox.js';

const MAX_HEALINGS_PER_SESSION = 8;
const SOURCE_CONTEXT_LINES = 12;
const DEDUP_TTL_MS = 5 * 60 * 1000;  // re-propose same error after 5 min

const state = {
  initialized: false,
  attempts: 0,
  /** Map of signature → { lastTriedAt, status }. */
  seen: new Map(),
  enabled: true,
};

/* ─── Public API ─────────────────────────────────────────────── */

export function initHealer() {
  if (state.initialized) return;
  state.initialized = true;

  // User can disable via Settings; honor the toggle on every event.
  try {
    state.enabled = localStorage.getItem('nova-healer-enabled') !== 'false';
  } catch {}

  // Two error pathways: thrown errors with `window.onerror` style and
  // unhandled promise rejections. Cover both.
  if (typeof window !== 'undefined') {
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
  }

  console.log('[healer] initialized; max', MAX_HEALINGS_PER_SESSION, 'attempts/session');
}

/** Allow shell / settings to toggle the healer at runtime. */
export function setHealerEnabled(enabled) {
  state.enabled = !!enabled;
  try {
    localStorage.setItem('nova-healer-enabled', String(state.enabled));
  } catch {}
  eventBus.emit('healer:toggled', { enabled: state.enabled });
}

export function getHealerStatus() {
  return {
    enabled: state.enabled,
    attemptsThisSession: state.attempts,
    maxAttemptsPerSession: MAX_HEALINGS_PER_SESSION,
    seenErrors: state.seen.size,
  };
}

/** List historical healer proposals (any status). Used by the audit app. */
export async function listHealerProposals(status = '*') {
  const all = await listProposals(status, 100);
  return all.filter(p => p.proposer === 'healer');
}

/* ─── Test hook ──────────────────────────────────────────────── */

/** v03 + manual smoke testing. Resets in-memory state. */
export function _resetHealerForTests() {
  state.attempts = 0;
  state.seen.clear();
}

/** v03 + manual smoke testing. Runs the healing pipeline against a
 * synthetic error without touching window.onerror. */
export async function _runHealerOnce({ message, filename, lineno, colno, error }) {
  return diagnose({ message, filename, lineno, colno, error });
}

/* ─── Internals ──────────────────────────────────────────────── */

function onWindowError(event) {
  if (!state.enabled) return;
  diagnose({
    message: event.message || (event.error && event.error.message) || 'unknown error',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
  });
}

function onUnhandledRejection(event) {
  if (!state.enabled) return;
  const reason = event.reason;
  const msg = reason && reason.message ? reason.message : String(reason);
  let filename = '', lineno = 0;
  if (reason && reason.stack) {
    const parsed = parseFirstStackFrame(reason.stack);
    if (parsed) { filename = parsed.filename; lineno = parsed.lineno; }
  }
  diagnose({ message: msg, filename, lineno, colno: 0, error: reason });
}

async function diagnose(err) {
  if (state.attempts >= MAX_HEALINGS_PER_SESSION) {
    console.warn('[healer] budget exhausted; skipping');
    return { skipped: 'budget' };
  }

  if (!isHealable(err)) {
    return { skipped: 'category', reason: err.message };
  }

  const sig = signatureFor(err);
  const prior = state.seen.get(sig);
  if (prior && Date.now() - prior.lastTriedAt < DEDUP_TTL_MS) {
    return { skipped: 'dedup', sig };
  }
  state.seen.set(sig, { lastTriedAt: Date.now(), status: 'in-flight' });
  state.attempts += 1;

  eventBus.emit('healer:diagnosing', { signature: sig, message: err.message, file: err.filename });

  let source = '';
  try {
    source = await fetchSourceContext(err.filename, err.lineno);
  } catch (e) {
    console.warn('[healer] source fetch failed:', e.message);
    state.seen.set(sig, { lastTriedAt: Date.now(), status: 'no-source' });
    return { skipped: 'source-fetch', error: e.message };
  }
  if (!source) {
    state.seen.set(sig, { lastTriedAt: Date.now(), status: 'no-source' });
    return { skipped: 'no-source' };
  }

  let aiReply = '';
  try {
    aiReply = await askAIForFix(err, source);
  } catch (e) {
    console.warn('[healer] AI call failed:', e.message);
    state.seen.set(sig, { lastTriedAt: Date.now(), status: 'ai-error' });
    return { skipped: 'ai', error: e.message };
  }

  const parsed = parseFix(aiReply);
  if (!parsed) {
    state.seen.set(sig, { lastTriedAt: Date.now(), status: 'no-fix' });
    eventBus.emit('healer:no-fix', { signature: sig, message: err.message });
    return { skipped: 'no-fix' };
  }

  const reason =
    `Healer-proposed fix for runtime error: ${truncate(err.message, 120)}\n\n` +
    `AI diagnosis: ${truncate(parsed.explanation, 240)}`;

  // Normalize the target to a path-only string (strip http://host prefix
  // so the audit + future apply logic doesn't have to deal with two forms).
  let cleanTarget = err.filename;
  try {
    const u = new URL(err.filename, location.origin);
    cleanTarget = u.pathname;
  } catch {}

  let proposalId;
  try {
    proposalId = await proposeSelfMod({
      target: cleanTarget,
      diff: buildUnifiedDiff(cleanTarget, parsed),
      reason,
      proposer: 'healer',
    });
  } catch (e) {
    console.error('[healer] proposeSelfMod failed:', e.message);
    state.seen.set(sig, { lastTriedAt: Date.now(), status: 'propose-error' });
    return { skipped: 'propose', error: e.message };
  }

  state.seen.set(sig, { lastTriedAt: Date.now(), status: 'proposed', proposalId });
  eventBus.emit('healer:proposal', {
    proposalId, signature: sig,
    target: err.filename, line: err.lineno,
    message: err.message,
    explanation: parsed.explanation,
  });
  return { proposalId };
}

function isHealable(err) {
  const msg = (err.message || '').toLowerCase();
  // Skip clear network failures, aborts, and OOMs — not the healer's job.
  if (/network|failed to fetch|abort|out of memory|loading chunk/i.test(msg)) return false;
  // Skip syntax errors — those are CI's job; runtime can't load a syntactically
  // broken file anyway.
  if (/syntaxerror/i.test(msg)) return false;
  // Need a filename + line to know what to read.
  if (!err.filename || !err.lineno) return false;
  // Only heal our own source files (not 3rd-party scripts hosted elsewhere).
  try {
    const u = new URL(err.filename, location.origin);
    if (u.origin !== location.origin) return false;
    if (!u.pathname.endsWith('.js')) return false;
  } catch {
    return false;
  }
  return true;
}

function signatureFor(err) {
  return `${err.filename}:${err.lineno}:${err.colno || 0}::${err.message}`;
}

function parseFirstStackFrame(stack) {
  if (!stack) return null;
  // Match common forms:
  //   at fn (http://host/path/file.js:12:5)
  //   at http://host/path/file.js:12:5
  const re = /(?:at\s.+?\()?(\S+?\.js):(\d+):(\d+)\)?/;
  const m = re.exec(stack);
  if (!m) return null;
  return { filename: m[1], lineno: parseInt(m[2], 10), colno: parseInt(m[3], 10) };
}

async function fetchSourceContext(filename, lineno) {
  const u = new URL(filename, location.origin);
  // Same-origin fetch through the dev server — Express serves JS files
  // directly, so the source is just at the same path.
  const res = await fetch(u.pathname);
  if (!res.ok) throw new Error(`fetch ${u.pathname}: ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n');
  const start = Math.max(0, lineno - SOURCE_CONTEXT_LINES);
  const end   = Math.min(lines.length, lineno + SOURCE_CONTEXT_LINES);
  const window = lines.slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(4, ' ')}  ${l}`)
    .join('\n');
  return { window, fullLines: lines, errorLineIndex: lineno - 1, errorLineText: lines[lineno - 1] || '' };
}

async function askAIForFix(err, source) {
  const prompt =
`You are Astrion's self-healing agent. An app threw this runtime error:

  ERROR: ${err.message}
  AT:    ${err.filename}:${err.lineno}

Here is the source context (line ${err.lineno} is the error line):

\`\`\`
${source.window}
\`\`\`

Propose a MINIMAL fix. Rules:
- Change at most 3 lines.
- Do not change function signatures or add new functions.
- Prefer defensive checks (early-return on null, optional chaining) over deep refactors.
- If no obvious fix exists, reply with exactly: NO_FIX
- Otherwise, reply in this exact format:

EXPLANATION: <one sentence about what's wrong and why this fixes it>
OLD:
\`\`\`
<the exact original lines to replace, with no line numbers>
\`\`\`
NEW:
\`\`\`
<the replacement lines, with no line numbers>
\`\`\`
`;
  const reply = await aiService.ask(prompt, { mode: 'chat', maxTokens: 600 });
  return reply || '';
}

function parseFix(reply) {
  if (!reply || /^\s*NO_FIX\s*$/m.test(reply)) return null;
  const expMatch = /EXPLANATION:\s*(.+?)(?:\n|$)/i.exec(reply);
  const oldMatch = /OLD:\s*```[a-z]*\n([\s\S]*?)```/i.exec(reply);
  const newMatch = /NEW:\s*```[a-z]*\n([\s\S]*?)```/i.exec(reply);
  if (!oldMatch || !newMatch) return null;
  // AI sometimes prefixes each line with the source line number even
  // when told not to. Strip "  123  " / "123  " / "123:" prefixes if
  // they appear on every non-blank line in BOTH blocks.
  const strip = (text) => {
    const lines = text.split('\n');
    const hasNum = lines.every(l => !l.trim() || /^\s*\d+[\s:]\s/.test(l));
    if (!hasNum) return text;
    return lines.map(l => l.replace(/^\s*\d+[\s:]\s+/, '')).join('\n');
  };
  const oldText = strip(oldMatch[1].replace(/\n+$/, ''));
  const newText = strip(newMatch[1].replace(/\n+$/, ''));
  if (!oldText.trim() || oldText === newText) return null;
  return {
    explanation: (expMatch ? expMatch[1] : 'AI-proposed fix').trim(),
    oldText,
    newText,
  };
}

function buildUnifiedDiff(filename, parsed) {
  const oldLines = parsed.oldText.split('\n');
  const newLines = parsed.newText.split('\n');
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  // Minimal hunk header — line numbers are 1 since we don't carry context.
  // The selfmod-sandbox accepts any diff string; M8.P3+ will rigor-check.
  const header =
`--- a/${filename}
+++ b/${filename}
@@ -1,${oldCount} +1,${newCount} @@
`;
  const body =
    oldLines.map(l => `-${l}`).join('\n') + '\n' +
    newLines.map(l => `+${l}`).join('\n');
  return header + body;
}

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
