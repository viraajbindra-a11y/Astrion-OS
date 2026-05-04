// Astrion OS — Intent Planner (Agent Core Sprint, Phase 3)
//
// Decomposes a natural-language query into an ordered list of capability
// calls that the executor runs sequentially. This is the piece that lets
// "create a folder called Projects on the Desktop and put a file called
// ideas.txt in it with some project ideas" become:
//   1. files.createFolder { path: "/Desktop", name: "Projects" } → binds folderPath
//   2. files.createFile   { parent: "${binds.folderPath}", name: "ideas.txt",
//                            content: "<AI-generated ideas>" }
//
// Design notes:
//   - Pulls the full capability catalog from the registry so the planner's
//     prompt is always in sync with what the executor can actually run.
//   - Calls aiService.ask() (currently wired to Claude Haiku 4.5). Plain
//     text in, JSON string out — we parse strictly with one retry.
//   - If the planner wants disambiguation, it returns
//     `{ status: 'clarify', question, choices }` which the executor/Spotlight
//     show as an inline question.
//   - All binding references use the string form `${binds.NAME}` so the
//     executor can do substitution at run time.
//   - Returns a normalized result object — never throws on bad input.
//
// Non-goals for M2:
//   - Streaming partial tokens (aiService.ask is non-streaming)
//   - Per-step cost optimization (relies on capability estimateCost)
//   - Recovery via alternate models (M3 will add S1/S2 routing)

import { aiService } from './ai-service.js';
import { listCapabilities, getCapability } from './capability-api.js';
import { summarizeContext } from './context-bundle.js';

// ---------- prompt construction ----------

function buildCatalog() {
  // Compact catalog that Claude can reference. Level shown so the planner
  // understands which steps are cheap (L0/L1) and which need confirmation.
  return listCapabilities().map(cap => ({
    id: cap.id,
    verb: cap.verb,
    target: cap.target,
    level: cap.level,
    summary: cap.summary,
  }));
}

function buildPlannerPrompt({ query, context, memory, parsedIntent }) {
  const catalog = buildCatalog();
  const catalogLines = catalog.map(c => `  - ${c.id}  (L${c.level})  — ${c.summary}`).join('\n');

  const memLines = (memory && memory.length)
    ? memory.map(t => `  [${t.relative}] "${t.query}" → ${t.ok ? 'ok' : 'fail'} (${t.capSummary || 'plan'})`).join('\n')
    : '  (no prior turns this session)';

  const ctxSummary = summarizeContext(context) || '(no context)';
  const parsedHint = parsedIntent
    ? `\nFast parser first-guess: verb=${parsedIntent.verb}, target=${parsedIntent.target || '(none)'}, confidence=${parsedIntent.confidence}`
    : '';

  return `You are the Astrion OS intent planner. Decompose the user's query
into an ORDERED list of capability calls from the catalog below. Respond
with ONLY a JSON object, no markdown, no prose, no code fences.

CATALOG (capabilityId, level, summary):
${catalogLines}

LEVELS: L0 = read-only, L1 = sandbox (safe), L2 = touches user data
(asks user to confirm before running), L3 = self-modify (not allowed).

CONTEXT:
${ctxSummary}

RECENT TURNS THIS SESSION:
${memLines}
${parsedHint}

USER QUERY: ${JSON.stringify(query)}

RESPOND WITH ONE OF:

(A) A plan — when the query is clear:
{
  "status": "plan",
  "reasoning": "one short sentence about what you're doing",
  "steps": [
    {
      "cap": "capabilityId.from.catalog",
      "args": { "key": "value", "other": "\${binds.NAME}" },
      "binds": "NAME_IF_LATER_STEP_NEEDS_OUTPUT"
    }
  ]
}

(B) A clarify request — only when the query is genuinely ambiguous:
{
  "status": "clarify",
  "question": "short question for the user",
  "choices": ["option one", "option two"]
}

RULES:
1. Use ONLY capability ids from the catalog above. Never invent.
2. If step N needs step M's output, use "\${binds.NAME}" in step N args
   where NAME was set as step M's "binds" field.
3. files.createFile takes args { parent: "/Desktop/...", name: "foo.txt",
   content: "..." }. Generate content INLINE in your JSON — don't punt it
   to a separate step.
4. files.createFolder takes args { path: "/Desktop" (or another root),
   name: "FolderName" }. After running, binds the new folder path.
5. Valid path roots: /Desktop, /Documents, /Downloads, /Pictures, /Music.
5b. system.setBrightness takes { level: 0..100 } e.g. { "level": 50 }.
5c. system.shutdown takes { mode: "shutdown" | "restart" | "sleep" }.
   Defaults to "shutdown" when omitted. POINT-OF-NO-RETURN — never plan
   it for ambiguous queries; only when the user explicitly asks.
5d. system.lock takes no args ({}).
5e. terminal.exec takes { cmd: "ls -la /tmp" }. Use for shell tasks that
   no other capability covers. Keep cmd short and self-contained; the
   user reads it before approving. NEVER chain rm/dd/mkfs into a plan
   without an explicit user request — they're refused at the safety layer.
6. Keep plans to the minimum number of steps. Don't pad with launchApp
   unless the user asks to open something.
7. If the query is a simple single-capability intent (like "open terminal"
   or "5 + 3"), still respond with a one-step plan — the executor handles it.
8. If the user's intent CANNOT be satisfied by any combination of catalog
   capabilities (e.g. "delete everything" when no delete capability exists),
   respond with a CLARIFY status explaining what you can't do. NEVER force
   a plan that doesn't match the user's actual intent.
9. **DEFAULT TO ai.ask FOR CHATTY QUERIES.** If the user is asking a
   question, requesting an opinion, audit, summary, comparison,
   explanation, or analysis of anything, use a single-step plan with
   ai.ask (or ai.explain / ai.summarize as appropriate). DO NOT use
   code.generate, files.createFile, terminal.exec, or any code-writing
   capability unless the user EXPLICITLY asks you to write code, build
   an app, or create a file. "Audit my OS" is ai.ask, not code.generate.
   "Compare X to Y" is ai.ask, not code.generate. When in doubt, ai.ask.
10. Respond with JSON only. Nothing before, nothing after.`;
}

// ---------- JSON parsing (tolerant) ----------

/**
 * Try to extract a JSON object from Claude's response. Tolerates leading
 * prose, trailing prose, and markdown code fences — all failure modes we've
 * seen from both Haiku and Sonnet in practice.
 */
function tryParseJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim();

  // Strip markdown code fence
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Try raw parse first
  try { return JSON.parse(text); } catch {}

  // Find the first { and the matching last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try { return JSON.parse(slice); } catch {}
  return null;
}

// ---------- schema validation ----------

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return { ok: false, error: 'plan not an object' };

  if (plan.status === 'clarify') {
    if (typeof plan.question !== 'string' || !plan.question.trim()) {
      return { ok: false, error: 'clarify requires a non-empty question' };
    }
    return { ok: true };
  }

  if (plan.status !== 'plan') {
    return { ok: false, error: `unknown status: ${plan.status}` };
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { ok: false, error: 'plan has no steps' };
  }
  if (plan.steps.length > 20) {
    return { ok: false, error: `plan too large: ${plan.steps.length} steps (max 20)` };
  }
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (!step || typeof step !== 'object') return { ok: false, error: `step ${i} not an object` };
    if (typeof step.cap !== 'string') return { ok: false, error: `step ${i} missing cap id` };
    const cap = getCapability(step.cap);
    if (!cap) return { ok: false, error: `step ${i} references unknown capability: ${step.cap}` };
    if (step.args && typeof step.args !== 'object') return { ok: false, error: `step ${i} args not an object` };
    if (step.binds && typeof step.binds !== 'string') return { ok: false, error: `step ${i} binds not a string` };
  }
  return { ok: true };
}

// ---------- public API ----------

/**
 * Ask the planner to decompose a query into a plan.
 *
 * @param {object} input
 * @param {string} input.query — the raw user text
 * @param {object} input.context — snapshot from context-bundle.getContextBundle()
 * @param {Array} input.memory — recent turn summaries (conversation-memory)
 * @param {object|null} input.parsedIntent — hint from the fast parser
 * @returns {Promise<{
 *   status: 'plan' | 'clarify' | 'failed',
 *   steps?: Array,
 *   reasoning?: string,
 *   question?: string,
 *   choices?: Array<string>,
 *   error?: string,
 *   raw?: string,
 * }>}
 */
// Fast pre-classifier: if a query is clearly conversational (a
// question, opinion ask, audit, explanation, etc.) skip the AI
// planner entirely and return a single-step ai.ask plan. This both
// (a) eliminates a 90s+ planner call for prompts the AI is just
// going to mis-classify, and (b) prevents the planner from picking
// code.generate / files.createFile / etc. for chatty queries.
//
// Verified failure case (2026-05-03): "do an adversarial audit of
// my operating system" → planner picked code.generate as step 1 →
// failed at step 0 in 117.7s with "suiteId required." Lesson #184.
const CHATTY_LEAD = /^(?:what|who|when|where|why|how|which|is|are|am|do|does|did|can|could|would|should|will|may|might|tell|explain|describe|define|summari[sz]e|compare|contrast|review|audit|analy[sz]e|critique|recommend|suggest|opine|opinion|think|feel|imagine|consider)\b/i;
const CHATTY_PHRASE = /\b(adversarial audit|opinion|recommend|recommendation|pros and cons|strengths? (and|&) weakness|weaknesses?|areas? of improvement|areas? to improve|am i ready|what.*think|your thoughts|what.*about)\b/i;
const COMMAND_LEAD = /^(?:open|launch|create|make|new|delete|move|rename|copy|find|search|set|change|toggle|enable|disable|install|uninstall|build|generate|write|implement|fix|edit|update|run|start|stop|kill|quit|close|reboot|restart|shutdown|sleep|lock|unlock|upgrade|undo|redo|play|pause|skip)\b/i;

function looksConversational(query) {
  const q = query.trim();
  if (q.length < 6) return false; // too short to confidently classify
  // Explicit command verbs win — even if the query also has chatty words.
  if (COMMAND_LEAD.test(q)) return false;
  if (CHATTY_LEAD.test(q)) return true;
  if (CHATTY_PHRASE.test(q)) return true;
  // Question-mark heuristic: ends with "?" → almost certainly a chat.
  if (q.endsWith('?')) return true;
  return false;
}

export async function planIntent({ query, context, memory, parsedIntent }) {
  if (!query || typeof query !== 'string') {
    return { status: 'failed', error: 'empty query' };
  }

  // ─── Fast-path: conversational queries skip the planner ───
  if (looksConversational(query)) {
    return {
      status: 'plan',
      steps: [{ cap: 'ai.ask', args: { question: query }, binds: 'answer' }],
      reasoning: 'conversational query — answering directly via ai.ask (skipped planner)',
      raw: '(fast-path: looksConversational matched)',
      meta: { brain: 'fast-path', confidence: 1, provider: 'heuristic' },
    };
  }

  const prompt = buildPlannerPrompt({ query, context, memory, parsedIntent });

  // ─── First attempt ───
  let raw, meta;
  try {
    // Use askWithMeta so the brain (s1/s2/offline) flows back to the executor
    // for accurate calibration. The global ai:response event is racy when
    // multiple intents fire concurrently; per-call meta is not.
    const r = await aiService.askWithMeta(prompt, {
      maxTokens: 500, skipHistory: true, capCategory: 'planner', format: 'json',
    });
    raw = r.reply;
    meta = r.meta;
  } catch (err) {
    return { status: 'failed', error: `planner ai call threw: ${err?.message || err}` };
  }

  let plan = tryParseJSON(raw);
  let validation = plan ? validatePlan(plan) : { ok: false, error: 'could not parse JSON' };

  // ─── One retry with the error echoed back ───
  if (!validation.ok) {
    const retryPrompt = `${prompt}

YOUR PREVIOUS RESPONSE WAS REJECTED:
\`\`\`
${(raw || '').slice(0, 400)}
\`\`\`
REJECTION REASON: ${validation.error}

Try again. Respond with JSON only. No prose, no markdown.`;

    let retryRaw;
    try {
      const r = await aiService.askWithMeta(retryPrompt, {
        maxTokens: 500, skipHistory: true, capCategory: 'planner', format: 'json',
      });
      retryRaw = r.reply;
      meta = r.meta;
    } catch (err) {
      return { status: 'failed', error: `planner retry threw: ${err?.message || err}`, raw, meta };
    }
    const retryPlan = tryParseJSON(retryRaw);
    const retryValidation = retryPlan ? validatePlan(retryPlan) : { ok: false, error: 'retry also un-parseable' };
    if (!retryValidation.ok) {
      const kind = retryPlan ? 'invalid' : 'unparseable';
      return {
        status: 'failed',
        error: `planner output ${kind} twice: ${retryValidation.error}`,
        raw: retryRaw || raw, meta,
      };
    }
    plan = retryPlan;
  }

  if (plan.status === 'clarify') {
    return {
      status: 'clarify',
      question: plan.question,
      choices: Array.isArray(plan.choices) ? plan.choices : [],
      raw, meta,
    };
  }

  return {
    status: 'plan',
    steps: plan.steps,
    reasoning: typeof plan.reasoning === 'string' ? plan.reasoning : '',
    raw, meta,
  };
}

// ---------- heuristic router (decides: fast path vs. planner) ----------

/**
 * Fast check to decide whether a query should go through the planner or
 * through the existing single-capability intent-executor path.
 *
 * We want >80% of queries to stay on the fast single-shot path.
 * The planner is expensive (S2 API call), so we only engage when we
 * see a real compound query OR the fast parser was uncertain.
 *
 * @param {string} query
 * @param {object|null} parsedIntent — from parseIntent(); may be null
 * @returns {'fast' | 'plan'}
 */
export function routeQuery(query, parsedIntent) {
  if (!query || typeof query !== 'string') return 'fast';
  const q = query.trim().toLowerCase();

  // Compound markers — these force the planner
  if (/\b(?:and then|after that|then)\b/.test(q)) return 'plan';
  if (/\s+and\s+/.test(q) && /\s/.test(q)) {
    // "X and Y" with a verb on each side, OR "X and Y Z" where Y triggers
    // a verb word — keep it simple: if the query has " and " plus a second
    // verb word AFTER the "and", plan it.
    const afterAnd = q.split(/\s+and\s+/)[1] || '';
    const VERB_HINTS = /\b(create|make|open|find|put|save|delete|send|add|copy|paste|move|ask|tell|write|read|list|show|play|mute|unmute|navigate|explain|summarize|translate|install|remind|schedule|upload|download|turn|set|close|quit|kill|launch|run|increase|decrease|take|capture|compute|calculate)\b/;
    if (VERB_HINTS.test(afterAnd)) return 'plan';
  }
  if (q.includes(';')) return 'plan';

  // Fast parser said "I don't know" → let the planner try
  if (!parsedIntent || parsedIntent.confidence < 0.55) return 'plan';

  return 'fast';
}

// ---------- inline sanity tests (localhost only) ----------

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  // Route decider sanity — pure function, no AI call
  const routeTests = [
    { q: 'open terminal', parsed: { confidence: 0.9 }, expect: 'fast' },
    { q: '5 + 3', parsed: { confidence: 0.9 }, expect: 'fast' },
    { q: 'create a folder called Projects on the Desktop and put a file called ideas.txt in it', parsed: { confidence: 0.8 }, expect: 'plan' },
    { q: 'make a note; then open it', parsed: { confidence: 0.9 }, expect: 'plan' },
    { q: 'unknown gibberish', parsed: null, expect: 'plan' },
    { q: 'copy this and paste it into notes', parsed: { confidence: 0.7 }, expect: 'plan' },
    { q: 'what is 42 * 17', parsed: { confidence: 0.9 }, expect: 'fast' },
  ];
  let fail = 0;
  for (const t of routeTests) {
    const got = routeQuery(t.q, t.parsed);
    if (got !== t.expect) {
      console.warn('[intent-planner] route FAIL:', JSON.stringify(t.q), '→', got, 'expected', t.expect);
      fail++;
    }
  }

  // JSON parser sanity — tolerates prose/code-fences
  const jsonTests = [
    { in: '{"a":1}', expectKey: 'a' },
    { in: '```json\n{"a":1}\n```', expectKey: 'a' },
    { in: 'Here is my plan:\n{"a":1}\nDone.', expectKey: 'a' },
    { in: 'not json at all', expectKey: null },
  ];
  for (const t of jsonTests) {
    const parsed = tryParseJSON(t.in);
    const key = parsed && typeof parsed === 'object' ? Object.keys(parsed)[0] : null;
    if (key !== t.expectKey) {
      console.warn('[intent-planner] parse FAIL:', t.in, '→', parsed);
      fail++;
    }
  }

  // Schema validator sanity — catches hallucinated capability ids
  const schemaTests = [
    { plan: { status: 'plan', steps: [{ cap: 'does.not.exist', args: {} }] }, expectOk: false },
    { plan: { status: 'clarify', question: 'Which one?' }, expectOk: true },
    { plan: { status: 'plan', steps: [] }, expectOk: false },
    { plan: { status: 'weird' }, expectOk: false },
  ];
  for (const t of schemaTests) {
    const v = validatePlan(t.plan);
    if (v.ok !== t.expectOk) {
      console.warn('[intent-planner] schema FAIL:', JSON.stringify(t.plan), '→', v);
      fail++;
    }
  }

  const total = routeTests.length + jsonTests.length + schemaTests.length;
  if (fail === 0) console.log(`[intent-planner] all ${total} sanity tests pass`);
  else console.warn(`[intent-planner] ${fail}/${total} sanity tests FAILED`);
}
