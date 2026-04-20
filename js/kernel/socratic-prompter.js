// Astrion OS — Socratic Prompter (M6.P2)
//
// A cheap pre-planner check. The planner (intent-planner) can already
// return status:'clarify' from INSIDE its full AI call, but that
// burns a planner-budget token round-trip (~500 tokens) before
// learning the query is ambiguous. The Socratic prompter runs first
// with a tighter prompt (~200 tokens out) and either:
//   - returns {type: 'proceed'} so the planner runs as normal, OR
//   - returns {type: 'ask', question, choices?} so the user can
//     clarify before the planner sees the query.
//
// Confidence-thresholded:
//   - parsedIntent.confidence >= 0.85 → silent proceed (no AI call)
//   - parsedIntent.confidence  < 0.85 → AI call to decide
//
// Why this matters: ambiguous intents waste budget AND mislead the
// user. The Socratic prompter is the "did you really mean X?" voice
// that surfaces ambiguity early. Pairs with M6.P1 (red-team AFTER
// plan) and M6.P4 (rubber-stamp tracker) to make the whole gate
// actually engage the user's brain.
//
// Design:
//   - One AI call, no retry. If parsing fails, default to 'proceed'
//     — silent failure beats blocking the planner on a malformed
//     Socratic response.
//   - Short prompt. JSON output. format:'json' for Ollama.
//   - 30s timeout (Anthropic Haiku finishes <1s; qwen2.5:7b ~10s).

import { aiService } from './ai-service.js';

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
// 60s, sized for local Ollama (qwen2.5:7b takes 10-30s on a typical
// Socratic prompt; up to ~50s for an 'ask' decision with full choices).
// Anthropic Haiku is sub-second so this is comfortable headroom.
const SOCRATIC_TIMEOUT_MS = 60000;
const MAX_QUERY_LEN = 400;

function buildSocraticPrompt(query, parsedIntent) {
  const parsedSummary = parsedIntent
    ? `parser hint: verb=${parsedIntent.verb || '?'} target=${parsedIntent.target || '?'} confidence=${(parsedIntent.confidence ?? 0).toFixed(2)}`
    : 'parser hint: none';

  return `You are Astrion's pre-planner Socratic agent. The user's query
will go to a multi-step planner next. Your job: decide if the planner
should proceed as-is, or if the user should clarify FIRST. Be
conservative — most queries should proceed.

USER QUERY: ${JSON.stringify(query)}
${parsedSummary}

OUTPUT SHAPE — one of these two JSON objects:
  { "decision": "proceed" }
  { "decision": "ask", "question": "one short clarifying question (max 80 chars)", "choices": ["short option A", "short option B"] }

Use "ask" ONLY when the query is genuinely ambiguous between two or
more materially different actions. Examples:
  - "delete my notes"   → ambiguous (which notes? all? recent?)
  - "open it"           → ambiguous (open what?)
  - "make it darker"    → maybe ambiguous (darker = wallpaper, theme, contrast?)

Use "proceed" when the query is specific enough:
  - "delete the file called draft.md on Desktop"
  - "set wallpaper to aurora"
  - "create a folder Projects on Desktop"

RULES:
1. Keep "question" short — < 80 chars. No preamble.
2. Provide 2 to 4 short "choices" that disambiguate. Each choice <
   40 chars. Each choice should be something the user could
   re-submit verbatim as a clarified query.
3. Respond with JSON only. No prose, no markdown fences.`;
}

function tryParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  return null;
}

function validateSocratic(out) {
  if (!out || typeof out !== 'object') return null;
  if (out.decision === 'proceed') return { type: 'proceed' };
  if (out.decision === 'ask') {
    const q = typeof out.question === 'string' ? out.question.trim() : '';
    if (!q) return null;
    if (q.length > 200) return null;
    const choices = Array.isArray(out.choices)
      ? out.choices.filter(c => typeof c === 'string' && c.trim() && c.length < 80).slice(0, 4)
      : [];
    return { type: 'ask', question: q, choices };
  }
  return null;
}

/**
 * Run the Socratic check. Returns {type: 'proceed'} or
 * {type: 'ask', question, choices}. Never throws — falls back to
 * 'proceed' on any failure (silent failure beats blocking the
 * planner on a bad Socratic response).
 *
 * @param {string} query — raw user text
 * @param {object|null} parsedIntent — output of parseIntent()
 * @returns {Promise<{type: 'proceed'} | {type: 'ask', question: string, choices: string[]}>}
 */
export async function askSocratic(query, parsedIntent = null) {
  if (!query || typeof query !== 'string') return { type: 'proceed' };
  if (query.length > MAX_QUERY_LEN) return { type: 'proceed' };

  // High parser confidence — the user's intent is clear enough that
  // the Socratic AI call would just cost tokens for no value.
  if (parsedIntent && (parsedIntent.confidence ?? 0) >= HIGH_CONFIDENCE_THRESHOLD) {
    return { type: 'proceed' };
  }

  const prompt = buildSocraticPrompt(query, parsedIntent);
  let raw;
  try {
    const r = await Promise.race([
      aiService.askWithMeta(prompt, {
        maxTokens: 200, skipHistory: true, capCategory: 'socratic', format: 'json',
      }),
      new Promise((res) => setTimeout(() => res({ reply: null, meta: null }), SOCRATIC_TIMEOUT_MS)),
    ]);
    raw = r.reply;
  } catch {
    return { type: 'proceed' };
  }
  if (!raw) return { type: 'proceed' };
  const parsed = tryParseJSON(raw);
  const valid = validateSocratic(parsed);
  if (!valid) return { type: 'proceed' };
  return valid;
}

// ─── Sanity tests (localhost only) ───

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  let f = 0;
  // High-confidence parsedIntent → proceed without AI call
  (async () => {
    const r = await askSocratic('open terminal', { verb: 'open', target: 'app', confidence: 0.95 });
    if (r.type !== 'proceed') { console.warn('[socratic] high-confidence FAIL:', r); f++; }

    // Validator: well-formed proceed
    const v1 = validateSocratic({ decision: 'proceed' });
    if (v1?.type !== 'proceed') { console.warn('[socratic] validateProceed FAIL:', v1); f++; }

    // Validator: well-formed ask
    const v2 = validateSocratic({ decision: 'ask', question: 'which one?', choices: ['a', 'b'] });
    if (v2?.type !== 'ask' || v2.question !== 'which one?' || v2.choices.length !== 2) {
      console.warn('[socratic] validateAsk FAIL:', v2); f++;
    }

    // Validator: bad shape
    const v3 = validateSocratic({ decision: 'maybe' });
    if (v3 !== null) { console.warn('[socratic] validateBad FAIL:', v3); f++; }

    // Validator: ask with no question
    const v4 = validateSocratic({ decision: 'ask', question: '   ' });
    if (v4 !== null) { console.warn('[socratic] validateEmptyQ FAIL:', v4); f++; }

    if (f === 0) console.log('[socratic] all 5 sanity tests pass');
    else console.warn('[socratic]', f, 'sanity tests failed');
  })();
}
