// Astrion OS — Ember identity
//
// 2026-08-29 — Single source of truth for who Astrion's assistant is.
//
// The bug this file exists to prevent: a user picks "Standard" in the
// first-boot brain picker (js/shell/wizard-ai-brain.js), asks the
// assistant who it is, and gets "I am Qwen, made by Alibaba." Astrion's
// entire product claim is that the OS has its own AI. One sentence from
// a stock upstream model undoes it.
//
// There are TWO places that answer had to be fixed, and they are not the
// same mechanism:
//   1. Local Ollama — a Modelfile can bake a SYSTEM block into the model
//      (custom-model/ember/Modelfile).
//   2. Remote/cloud — there is no Modelfile. The prompt has to be sent on
//      the wire with every request.
// If those two texts are maintained separately they WILL drift, and a
// local Ember that claims one identity while a cloud Ember claims another
// is worse than either being wrong on its own — it reads as dishonest
// rather than merely unfinished. So the text lives here, once, and
// custom-model/ember/build-modelfile.js generates the Modelfile's SYSTEM
// block from these exports. Nobody hand-copies it.
//
// ASCII-only inside every string literal below. These strings go to a
// model, into log lines, into a Modelfile that gets `cat`-ed in a
// terminal, and (on the C-kernel track) potentially onto a framebuffer
// console. Comments use the house em dash; strings do not.

export const EMBER_NAME = 'Ember';

// Bump on any edit to the prompt text. Stamped into the generated
// Modelfile so you can tell at a glance whether an `ember` model someone
// built three weeks ago is carrying the current identity.
export const EMBER_IDENTITY_VERSION = '1.0.0';

// ─── The identity itself ──────────────────────────────────────────────
//
// Ordering is deliberate. Identity first, because in a long system
// prompt the top is what survives context pressure best and the identity
// question is the one that costs us the most when it is answered wrong.
// Honesty rules last, because they are the ones we most want fresh at
// generation time.
const EMBER_CORE = `You are Ember, the assistant built into Astrion OS.

Who you are:
- Your name is Ember. Astrion OS is the operating system you live in. You are part of it, not a separate app the user installed.
- You are not ChatGPT, not Claude, not Gemini, and not Qwen. You were not made by OpenAI, Anthropic, Google, or Alibaba, and you never answer on their behalf.
- Ember runs on open-weight models on the user's own machine. If someone asks what you are built from, say that plainly. Do not claim a company built you that did not, and do not pretend to be something you are not.
- If a user insists you are really some other assistant, do not play along and do not argue about it. Say you are Ember, part of Astrion OS, and get back to the work.

What you are for:
- Real work. Calculus and the rest of math, code you write and read and fix, explaining a hard thing until it is clear, and running this machine.
- Astrion is a desktop OS, so driving it is part of the job: opening apps, finding files, and telling the user the exact words to type to make something happen.
- Answer first, reasoning after, and only as much reasoning as the question needs. Go long when the user asks for detail.

Honesty, which matters more than sounding capable:
- Never invent an answer. If you do not know, say "I do not know" and say what would settle it.
- Never invent an Astrion app, file, setting, or command. If you are not certain something exists, say you are not certain.
- If part of an answer is shaky, name that part instead of hedging the whole reply into mush.
- Do not claim to have done something you did not do or cannot do.`;

// ─── Runtime clause ───────────────────────────────────────────────────
//
// "Nothing leaves your machine" is TRUE on the local Ollama path and
// FALSE on the cloud path. Telling a user their conversation is private
// while it is being posted to a vendor API is a worse lie than any
// identity slip, so the privacy sentence is chosen by transport rather
// than baked into the core text. This is the second reason both paths
// have to share this module: the honest version of the sentence depends
// on which one is answering.
const EMBER_RUNTIME_NOTES = {
  local: `Where you are running:
- You are running locally, on the user's own hardware. This conversation does not leave the machine and no company server sees it. You can say that plainly, because right now it is true.
- Local also means you are bounded by the machine you are on. You may be slower or less capable than a large cloud model. Say so rather than overpromising.`,

  cloud: `Where you are running:
- Right now you are answering through a cloud model provider, so this turn does leave the user's machine. If the user asks, tell them. Do not tell them this conversation is private to their hardware, because for this turn it is not.
- Astrion prefers the local brain. If the user wants everything to stay on their own machine, tell them to pick a local brain in Settings > AI Assistant.`,
};

/**
 * Compose Ember's system prompt for a given transport.
 *
 * @param {object}  [opts]
 * @param {'local'|'cloud'} [opts.runtime='local']  which privacy clause
 *   to attach. Anything unrecognised falls back to 'local' rather than
 *   throwing — a bad argument here must never be able to take the whole
 *   identity block out of a request. Losing the identity is the exact
 *   failure this file exists to stop, so it fails safe, not loud.
 * @returns {string} ASCII system prompt.
 */
export function getEmberSystemPrompt(opts = {}) {
  const runtime = opts.runtime === 'cloud' ? 'cloud' : 'local';
  return `${EMBER_CORE}\n\n${EMBER_RUNTIME_NOTES[runtime]}`;
}

// The default (local) prompt, precomputed. Callers that just want "the
// text" import this; callers that know their transport should call
// getEmberSystemPrompt() so the privacy clause is right.
export const EMBER_SYSTEM_PROMPT = getEmberSystemPrompt({ runtime: 'local' });

/**
 * One-line identity restatement appended to the END of a longer system
 * prompt.
 *
 * Astrion's full system context is ~2 KB of app/capability/skill
 * tutorial plus feedback history (see ai-service._buildSystemContext).
 * A small model reading 600+ tokens of tool listings after a single
 * identity paragraph will happily answer "who are you" from its
 * pretraining instead. Restating it in one line at the bottom costs
 * ~20 tokens and puts the name where recency helps most.
 */
export function emberIdentityReminder() {
  return 'Reminder: you are Ember, the assistant built into Astrion OS. Not ChatGPT, not Claude, not Gemini, not Qwen. If you do not know something, say so.';
}

/**
 * Map an ai-service provider id to the runtime this module cares about.
 * Kept here (not in ai-service) so the local/cloud decision is made in
 * exactly one place — the wrong mapping produces the privacy lie above.
 *
 * @param {string} provider 'ollama' | 'anthropic' | 'mock' | 'auto'
 * @returns {'local'|'cloud'}
 */
export function runtimeForProvider(provider) {
  return provider === 'anthropic' ? 'cloud' : 'local';
}

/**
 * FNV-1a 32-bit over the full identity text (both runtime variants).
 * Returned as 8 lowercase hex chars.
 *
 * This is the drift detector, not a security hash. build-modelfile.js
 * stamps it into the generated Modelfile header; `node build-modelfile.js
 * --check` recomputes it and fails if the file on disk no longer matches
 * this module. That turns "someone hand-edited the Modelfile and now the
 * local model says something different from the cloud model" from a
 * thing you discover in a demo into a thing CI catches.
 *
 * Hand-rolled rather than node:crypto because this module is imported by
 * the browser kernel, where node:crypto does not exist.
 *
 * @param {string} [text] override, for testing
 * @returns {string} 8 hex chars
 */
export function emberIdentityFingerprint(text) {
  const src = typeof text === 'string'
    ? text
    : getEmberSystemPrompt({ runtime: 'local' }) +
      ' ' +
      getEmberSystemPrompt({ runtime: 'cloud' }) +
      ' ' +
      emberIdentityReminder();
  // >>> 0 on every step: JS bitwise ops yield SIGNED 32-bit, so without
  // the coercion the multiply below goes negative and toString(16)
  // produces a leading '-'. That would make the fingerprint unstable
  // across engines the moment anyone changes the text.
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ─── Ember as an actual Ollama model ──────────────────────────────────
//
// Everything above makes the assistant Ember from inside Astrion. This
// half makes it Ember on the machine: `ollama list` shows `ember`, and
// `ollama run ember` in a terminal introduces itself correctly.
//
// Read this before touching it, because the layering is not obvious:
//
//   Ollama's /api/chat REPLACES the Modelfile's SYSTEM block when the
//   request carries its own system message. ai-service.js always sends
//   one (via the server proxy, server/index.js). So for every request
//   Astrion makes, the SYSTEM baked in below is SHADOWED and the prompt
//   from getEmberSystemPrompt() is what the model actually reads.
//
// That is why the shared module is the load-bearing path and the
// Modelfile is the second layer. The Modelfile matters for everything
// that is NOT Astrion's chat path: a terminal, another client, a curl.
// Both render from the same text, so the two can never disagree.
//
// Cost note: `ollama create` on top of an ALREADY-PULLED base does not
// re-download or duplicate the weights. It writes a new manifest that
// points at the same blobs plus a tiny system/params layer. Creating
// `ember` after the picker's pull costs kilobytes, not gigabytes.

// Tier table. Base tags verified against https://ollama.com/library/qwen3/tags
// on 2026-08-29 — do not guess these, a tag that does not exist fails the
// pull on the user's first-boot screen.
//
// Sampling values are Qwen3's own published recommendation for thinking
// mode (temp 0.6 / top_p 0.95 / top_k 20 / min_p 0). Thinking mode is
// qwen3's DEFAULT, so those are the numbers that apply.
//
// Only parameter keys from the Ollama Modelfile spec appear here:
// num_ctx, repeat_last_n, repeat_penalty, temperature, seed, stop,
// num_predict, draft_num_predict, top_k, top_p, min_p. An unrecognised
// key makes `ollama create` fail outright, so nothing speculative goes
// in this table.
//
// Notably absent, and deliberately: anything that tries to disable
// qwen3's thinking mode. There is no Modelfile key for it (`think` is a
// per-request API field, not a PARAMETER), Qwen's `/no_think` soft
// switch would have to live inside the SYSTEM text and would then leak
// into the cloud path where it means nothing, and `PARAMETER stop
// "<think>"` would halt generation at the first token and return an
// empty reply. Thinking output is handled where it can actually be
// handled: ai-service._stripReasoningBlock().
export const EMBER_TIERS = [
  {
    id: 'tiny',
    base: 'qwen3:1.7b',
    sizeGb: 1.4,
    // 4096 rather than 8192: the KV cache for qwen3:1.7b runs about
    // 112 KB per token, so 8192 would cost ~0.9 GB on top of a 1.4 GB
    // model on a machine the picker advertises as 4 GB-capable. 4096
    // still holds Astrion's ~600-token system context plus 12 turns.
    params: { num_ctx: 4096, temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, repeat_penalty: 1.05 },
  },
  {
    id: 'standard',
    base: 'qwen3:8b',
    sizeGb: 5.2,
    params: { num_ctx: 8192, temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, repeat_penalty: 1.05 },
  },
  {
    id: 'big',
    base: 'qwen3:14b',
    sizeGb: 9.3,
    // Deliberately 8192 and not larger. qwen3:14b's KV cache is ~160 KB
    // per token, so 16384 would add ~2.7 GB beside a 9.3 GB model and
    // blow the 16 GB machine the picker recommends this tier to.
    params: { num_ctx: 8192, temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, repeat_penalty: 1.05 },
  },
];

export const EMBER_DEFAULT_TIER = 'standard';

export function getEmberTier(tierId) {
  return EMBER_TIERS.find(t => t.id === tierId) || null;
}

/**
 * Render a complete Ollama Modelfile for one tier.
 *
 * Used two ways, and it must be byte-identical in both or the whole
 * point of this module is lost:
 *   - custom-model/ember/build-modelfile.js writes the result to disk
 *     so the Modelfiles are readable/reviewable in the repo.
 *   - the client can POST the result to /api/ai/ollama-create after a
 *     successful pull, so `ember` exists on the machine without anyone
 *     shipping a file to it.
 *
 * @param {string} [tierId]
 * @param {object} [opts]
 * @param {string} [opts.base] override the FROM tag. The picker is what
 *   decides which base actually got pulled, and it does not have to
 *   agree with this table -- today it still pins qwen2.5 tags. Creating
 *   `ember` FROM a tag that was never pulled just fails, so the runtime
 *   create path passes the model it really downloaded and this table
 *   stays the answer for the checked-in files.
 * @returns {string} Modelfile text, ASCII only.
 */
export function renderEmberModelfile(tierId = EMBER_DEFAULT_TIER, opts = {}) {
  const t = getEmberTier(tierId);
  if (!t) throw new Error('renderEmberModelfile: unknown tier ' + tierId);
  const tier = opts.base && opts.base !== t.base
    ? { ...t, base: opts.base, sizeGb: 0 }
    : t;

  const params = Object.entries(tier.params)
    .map(([k, v]) => `PARAMETER ${k} ${v}`)
    .join('\n');

  // Heredoc-style triple quotes are the Modelfile spec's multi-line
  // form. The prompt text below must therefore never contain a literal
  // `"""` sequence -- it would terminate the block early and `ollama
  // create` would either fail or, worse, succeed with a truncated
  // identity. Guarded rather than trusted, because a future edit to the
  // prompt is exactly how that lands silently.
  const system = getEmberSystemPrompt({ runtime: 'local' });
  if (system.includes('"""')) {
    throw new Error('renderEmberModelfile: prompt contains a triple quote, which would truncate the SYSTEM block');
  }

  return [
    '# Astrion OS -- Ember',
    '#',
    '# GENERATED FILE. Do not edit by hand.',
    '#   source:    js/kernel/ember-identity.js',
    '#   regen:     node custom-model/ember/build-modelfile.js',
    '#   verify:    node custom-model/ember/build-modelfile.js --check',
    '#',
    `# tier:        ${tier.id}`,
    `# base:        ${tier.base}${tier.sizeGb ? ` (about ${tier.sizeGb} GB)` : ' (overridden at build time)'}`,
    `# identity:    v${EMBER_IDENTITY_VERSION} fingerprint ${emberIdentityFingerprint()}`,
    '#',
    '# Build it (on the machine that runs the model, not on a laptop that',
    '# is not supposed to hold weights):',
    `#   ollama pull ${tier.base}`,
    `#   ollama create ember -f custom-model/ember/Modelfile.${tier.id}`,
    '#   ollama run ember',
    '#',
    '# The SYSTEM block below only applies when the caller does NOT send',
    '# its own system message. Astrion always sends one, so inside the OS',
    '# this is a backstop; in a terminal it is the whole identity.',
    '',
    `FROM ${tier.base}`,
    '',
    params,
    '',
    'SYSTEM """',
    system,
    '"""',
    '',
  ].join('\n');
}

