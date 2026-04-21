// Astrion OS — Red-Team Agent (M6.P1)
//
// A second AI whose only job is to find what's wrong with a proposed
// L2+ action. Subscribes to `interception:preview` from the
// operation-interceptor, runs an adversarial review against the
// capability + args, and emits `interception:enriched` with the
// risks list. Spotlight (and any other subscriber) appends the red-
// team output to the preview panel so the user sees the planner's
// proposal AND the critic's concerns side-by-side.
//
// Design contract:
//   - Different prompt persona than the planner (adversarial role)
//   - Same model is fine for now; M6.P2 can swap to a different one
//     for true model diversity (and fits cleanly because the only
//     coupling is through aiService.askWithMeta).
//   - Output is a structured JSON list of risks. Each risk has a
//     short label + severity + reasoning.
//   - One retry on schema/parse failure. On second failure: emit an
//     "unavailable" enrichment so the UI knows red-team didn't run.
//   - Bounded prompt budget — 600 tokens out per review.
//
// Why this matters: the M5 chain is "preview-then-confirm." That's
// safe-by-default but it doesn't help the user catch what they
// don't know to look for. The red-team's job is to surface risks
// the user wouldn't have thought of. Combined with the M5.P2 gate,
// this is the "reasonably-skeptical second opinion" the audit
// flagged as a missing safety primitive.
//
// Non-goals for M6.P1:
//   - Hard veto. The red-team can recommend abort but the user
//     still has the final say. M8 will gate self-mod on red-team
//     signoff specifically; M6 is advisory across the OS.
//   - Per-cap allowlist. Every L2+ cap gets a review.
//   - Caching. Every preview triggers a fresh review. M6.P3 can
//     add similarity-based caching if the cost matters.

import { eventBus } from './event-bus.js';
import { aiService } from './ai-service.js';

// 60s, sized for local Ollama (qwen2.5:7b takes ~10s on a tight prompt
// and up to 30-50s on a slower one). Anthropic Haiku is sub-second so
// this is comfortable headroom; the cost of a slower review is much
// less than the cost of "red-team unavailable" on every L2+ preview.
const REVIEW_TIMEOUT_MS = 60000;
const MAX_PARALLEL = 4; // hard cap on concurrent red-team calls
const inFlight = new Map();

// ─── Prompt construction ───

function buildReviewPrompt(cap, args) {
  let argSummary;
  try {
    const clean = { ...args };
    delete clean._intent;
    argSummary = JSON.stringify(clean);
    if (argSummary.length > 800) argSummary = argSummary.slice(0, 800) + '…';
  } catch { argSummary = '(unserialisable)'; }

  return `You are the Astrion OS red-team agent. Your job is to find
what could go wrong with the action below. Be specific and
actionable. Output JSON only.

ACTION:
  capability:        ${JSON.stringify(cap.id)}
  level (1=sandbox, 2=real, 3=self-mod):  ${cap.level}
  reversibility:     ${cap.reversibility}
  blastRadius:       ${cap.blastRadius}
  pointOfNoReturn:   ${!!cap.pointOfNoReturn}
  summary:           ${JSON.stringify(cap.summary || '')}
  args:              ${argSummary}

OUTPUT SHAPE:
{
  "risks": [
    {
      "label": "short title for the risk",
      "severity": "low" | "medium" | "high",
      "reason": "one sentence explanation"
    }
  ],
  "recommendation": "proceed" | "review" | "abort",
  "summary": "one short sentence covering the overall stance"
}

RULES:
1. Empty risks array is allowed if you genuinely can't find any
   problem. Do NOT fabricate risks.
2. severity 'high' is reserved for irreversible damage to user data
   or external state. Use 'medium' for confusing UX or minor data
   loss. Use 'low' for stylistic / preference issues.
3. recommendation 'abort' is reserved for cases where any reasonable
   user would say no. 'review' = the user should slow down and read
   carefully. 'proceed' = no concerns or only 'low' severity ones.
4. Keep risks array <= 5 items. Quality over quantity.
5. Respond with JSON only, no prose, no markdown.`;
}

function tryParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  return null;
}

function validateReview(review) {
  if (!review || typeof review !== 'object') return { ok: false, error: 'review not an object' };
  if (!Array.isArray(review.risks)) return { ok: false, error: 'risks must be an array' };
  if (review.risks.length > 5) return { ok: false, error: 'risks too long: ' + review.risks.length };
  for (let i = 0; i < review.risks.length; i++) {
    const r = review.risks[i];
    if (!r || typeof r !== 'object') return { ok: false, error: `risks[${i}] not an object` };
    if (typeof r.label !== 'string' || !r.label.trim()) return { ok: false, error: `risks[${i}].label required` };
    if (!['low', 'medium', 'high'].includes(r.severity)) return { ok: false, error: `risks[${i}].severity must be low|medium|high` };
    if (typeof r.reason !== 'string' || !r.reason.trim()) return { ok: false, error: `risks[${i}].reason required` };
  }
  if (!['proceed', 'review', 'abort'].includes(review.recommendation)) {
    return { ok: false, error: 'recommendation must be proceed|review|abort' };
  }
  if (typeof review.summary !== 'string') return { ok: false, error: 'summary must be a string' };
  return { ok: true };
}

// ─── Public review function ───

/**
 * Run an adversarial review on a capability + args. Returns
 * { ok, review?, error? } where review is { risks, recommendation,
 * summary, brain, model }. Never throws.
 */
// M8.P3.b: route red-team to a DIFFERENT model than the planner when
// one is configured. The user sets nova-ai-redteam-model in Settings
// (or directly in localStorage). Empty = use the default model.
//
// Why this matters: the red-team's adversarial prompt already pushes
// against sycophancy, but a truly independent second opinion requires
// a different model. Same-model review still catches obvious
// mistakes; different-model review catches model-specific blind
// spots too.
function redteamModelOverride() {
  try {
    const v = localStorage.getItem('nova-ai-redteam-model');
    return v && v.trim() ? v.trim() : null;
  } catch { return null; }
}

function baseOpts() {
  const opts = { maxTokens: 600, skipHistory: true, capCategory: 'red-team', format: 'json' };
  const override = redteamModelOverride();
  if (override) opts.model = override;
  return opts;
}

export async function reviewAction(cap, args) {
  if (!cap) return { ok: false, error: 'cap required' };
  const prompt = buildReviewPrompt(cap, args);
  let raw, meta;
  try {
    const r = await aiService.askWithMeta(prompt, baseOpts());
    raw = r.reply;
    meta = r.meta;
  } catch (err) {
    return { ok: false, error: 'ai call threw: ' + (err?.message || err) };
  }
  let review = tryParseJSON(raw);
  let validation = review ? validateReview(review) : { ok: false, error: 'could not parse JSON' };
  if (!validation.ok) {
    // One retry with the error echoed back
    const retryPrompt = `${prompt}

YOUR PREVIOUS RESPONSE WAS REJECTED:
\`\`\`
${(raw || '').slice(0, 400)}
\`\`\`
REJECTION: ${validation.error}

Try again. Respond with JSON only.`;
    let retryRaw;
    try {
      const r = await aiService.askWithMeta(retryPrompt, baseOpts());
      retryRaw = r.reply;
      meta = r.meta;
    } catch (err) {
      return { ok: false, error: 'retry threw: ' + (err?.message || err) };
    }
    const retryReview = tryParseJSON(retryRaw);
    const retryValidation = retryReview ? validateReview(retryReview) : { ok: false, error: 'retry un-parseable' };
    if (!retryValidation.ok) {
      return { ok: false, error: 'red-team output invalid twice: ' + retryValidation.error };
    }
    review = retryReview;
  }
  return {
    ok: true,
    review: {
      risks: review.risks,
      recommendation: review.recommendation,
      summary: review.summary,
      brain: meta?.brain || 'unknown',
      model: meta?.model || 'unknown',
    },
  };
}

// ─── Auto-subscribe (M6.P1) ───
//
// When the operation-interceptor emits interception:preview, fire a
// red-team review in the background and emit interception:enriched
// when it returns. The UI listens for both events and merges them.

export function initRedTeamAgent() {
  eventBus.on('interception:preview', async ({ id, cap, args }) => {
    if (!cap || cap.level < 2) return; // only L2+ caps get reviewed
    if (inFlight.size >= MAX_PARALLEL) return; // bound concurrency
    if (inFlight.has(id)) return;
    inFlight.set(id, Date.now());
    try {
      const result = await Promise.race([
        reviewAction(cap, args),
        new Promise((r) => setTimeout(() => r({ ok: false, error: 'timeout' }), REVIEW_TIMEOUT_MS)),
      ]);
      eventBus.emit('interception:enriched', {
        id,
        ok: !!result.ok,
        review: result.review || null,
        error: result.error || null,
      });
    } finally {
      inFlight.delete(id);
    }
  });
  console.log('[red-team] subscribed to interception:preview');
}

export function listInFlight() {
  return Array.from(inFlight.entries()).map(([id, ts]) => ({ id, startedAt: ts }));
}
