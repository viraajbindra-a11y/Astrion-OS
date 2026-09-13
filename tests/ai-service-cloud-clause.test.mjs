// Does the product actually send the CLOUD privacy clause on the cloud leg?
//
// js/kernel/ai-service.js builds its system prompt per transport leg:
// _buildSystemContext('local') for Ollama, _buildSystemContext('cloud') for
// Anthropic. The two differ in one load-bearing sentence -- local says the
// conversation "does not leave the machine", cloud says "this turn does leave
// the user's machine". In 'auto' mode a single askWithMeta() can try Ollama,
// fail, and fall through to Anthropic, which is exactly where a refactor that
// builds the prompt once would make Ember tell the user their conversation is
// private while it is being posted to a vendor API.
//
// custom-model/ember/identity_gate.py judges what a MODEL says when given a
// prompt. Nothing judged what the PRODUCT sends. This does. No network: fetch
// is stubbed, every request is captured, and the captured `system` field is
// what gets asserted on.
//
//   node tests/ai-service-cloud-clause.test.mjs
//
// The last section is the control: it plants the bug (a _buildSystemContext
// that ignores its runtime argument) and requires the same assertions to go
// red. A test that has never been seen to fail is not a test.

// ---- browser globals the kernel modules expect ---------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};
globalThis.window = globalThis;

// ---- fetch stub: records every request, answers per endpoint -------------
const calls = [];
let ollamaUp = false;          // /api/ai/ollama answers when true
let ollamaStreamUp = false;    // /api/ai/ollama-stream answers when true
const ndjson = (obj) => new TextEncoder().encode(JSON.stringify(obj) + '\n');
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : {};
  calls.push({ url, body });
  if (url === '/api/ai/ollama') {
    if (!ollamaUp) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, json: async () => ({ reply: 'local reply' }) };
  }
  if (url === '/api/ai/ollama-stream') {
    if (!ollamaStreamUp) return { ok: false, status: 502, body: null };
    return {
      ok: true,
      body: new ReadableStream({
        start(c) { c.enqueue(ndjson({ message: { content: 'streamed ' } }));
                   c.enqueue(ndjson({ message: { content: 'reply' } }));
                   c.close(); },
      }),
    };
  }
  if (url === '/api/ai') {
    return { ok: true, json: async () => ({
      content: [{ text: 'cloud reply' }],
      usage: { input_tokens: 10, output_tokens: 5 } }) };
  }
  throw new Error('unexpected fetch ' + url);
};

const { aiService } = await import('../js/kernel/ai-service.js');
const { getEmberSystemPrompt } = await import('../js/kernel/ember-identity.js');

// ---- what "the cloud clause" and "the local clause" are, from the source --
// Derived from ember-identity.js rather than typed here, so a rewording of
// the clauses cannot silently make this test assert on stale text.
const LOCAL_PROMPT = getEmberSystemPrompt({ runtime: 'local' });
const CLOUD_PROMPT = getEmberSystemPrompt({ runtime: 'cloud' });
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const LOCAL_ONLY = lines(LOCAL_PROMPT).filter((l) => !CLOUD_PROMPT.includes(l));
const CLOUD_ONLY = lines(CLOUD_PROMPT).filter((l) => !LOCAL_PROMPT.includes(l));

let failures = 0;
function check(ok, what) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
  return ok;
}

// The clauses must actually differ, and differ about leaving the machine --
// otherwise every assertion below is vacuous.
check(LOCAL_ONLY.length > 0 && CLOUD_ONLY.length > 0,
  `local and cloud prompts differ (${LOCAL_ONLY.length} local-only, ${CLOUD_ONLY.length} cloud-only lines)`);
check(LOCAL_ONLY.some((l) => /does not leave/i.test(l)),
  'the local-only text says the conversation does not leave the machine');
check(CLOUD_ONLY.some((l) => /does leave/i.test(l)),
  'the cloud-only text says this turn does leave the machine');

function systemOf(url) {
  const c = [...calls].reverse().find((x) => x.url === url);
  return c ? c.body.system : null;
}
function isCloudSystem(sys) {
  return typeof sys === 'string'
    && CLOUD_ONLY.every((l) => sys.includes(l))
    && !LOCAL_ONLY.some((l) => sys.includes(l));
}
function isLocalSystem(sys) {
  return typeof sys === 'string'
    && LOCAL_ONLY.every((l) => sys.includes(l))
    && !CLOUD_ONLY.some((l) => sys.includes(l));
}

async function scenario(name, provider, { ollama = false, stream = false } = {}, run) {
  calls.length = 0;
  ollamaUp = ollama;
  ollamaStreamUp = stream;
  aiService.clearHistory();
  aiService.setProvider(provider);
  const r = await run();
  return { name, r };
}

// ---- the assertions ------------------------------------------------------
async function assertions(tag = '') {
  const t = (s) => (tag ? `[${tag}] ` : '') + s;

  // 1. auto mode, Ollama down: the leg that answers is Anthropic and it MUST
  //    carry the cloud clause and not the local one.
  await scenario('auto/ollama-down', 'auto', {}, () => aiService.askWithMeta('hello'));
  let ol = systemOf('/api/ai/ollama'), an = systemOf('/api/ai');
  check(ol !== null && an !== null, t('auto: Ollama was tried first, then Anthropic'));
  check(isLocalSystem(ol), t('auto: the Ollama request carried the LOCAL clause'));
  const a1 = check(isCloudSystem(an), t('auto: the Anthropic fallback carried the CLOUD clause, not the local one'));

  // 2. explicit anthropic provider.
  await scenario('anthropic', 'anthropic', {}, () => aiService.askWithMeta('hello'));
  const a2 = check(isCloudSystem(systemOf('/api/ai')), t('anthropic: the request carried the CLOUD clause'));
  check(systemOf('/api/ai/ollama') === null, t('anthropic: Ollama was not contacted'));

  // 3. explicit ollama provider, Ollama up: local clause, and no cloud call.
  await scenario('ollama-up', 'ollama', { ollama: true }, () => aiService.askWithMeta('hello'));
  check(isLocalSystem(systemOf('/api/ai/ollama')), t('ollama: the request carried the LOCAL clause'));
  check(systemOf('/api/ai') === null, t('ollama: Anthropic was not contacted'));

  // 4. askStream in auto mode with the stream down: falls through to
  //    askWithMeta -> Ollama down -> Anthropic. The stream request must be
  //    local; the Anthropic request must be cloud.
  const chunks = [];
  await scenario('stream/auto/down', 'auto', {}, () =>
    aiService.askStream('hello', {}, (c) => chunks.push(c)));
  check(isLocalSystem(systemOf('/api/ai/ollama-stream')), t('askStream: the stream request carried the LOCAL clause'));
  const a4 = check(isCloudSystem(systemOf('/api/ai')), t('askStream: the Anthropic fallback carried the CLOUD clause'));
  check(chunks.join('') === 'cloud reply', t('askStream: the fallback reply reached onChunk'));

  // 5. askStream with the stream up: stays local, never touches the cloud.
  chunks.length = 0;
  await scenario('stream/auto/up', 'auto', { stream: true }, () =>
    aiService.askStream('hello', {}, (c) => chunks.push(c)));
  check(isLocalSystem(systemOf('/api/ai/ollama-stream')), t('askStream up: the stream request carried the LOCAL clause'));
  check(systemOf('/api/ai') === null, t('askStream up: Anthropic was not contacted'));
  check(chunks.join('') === 'streamed reply', t('askStream up: chunks assembled'));

  return a1 && a2 && a4;
}

console.log('ai-service cloud clause -- fetch stubbed, no network\n');
const live = await assertions();

// ---- the control: plant the bug and require the test to notice ------------
// A _buildSystemContext that ignores its runtime argument is the exact
// regression this test exists for ("build it once up front"). With it in
// place the cloud-leg assertions above must go red.
console.log('\ncontrol: planting a _buildSystemContext that ignores runtime\n');
const original = aiService._buildSystemContext;
aiService._buildSystemContext = function () { return original.call(this, 'local'); };
const before = failures;
const cloudOkWithBug = await assertions('control');
const controlFlipped = failures - before;
aiService._buildSystemContext = original;

if (cloudOkWithBug) {
  console.log('\nCONTROL FAIL: the planted bug (runtime ignored) was not detected. '
    + 'This test cannot see the regression it exists for.');
  process.exit(1);
}
// The control's own failures are expected; do not count them.
failures = before;
console.log(`\ncontrol: ${controlFlipped} assertion(s) went red with the bug planted -- the test can fail.`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall assertions hold; cloud leg carries the cloud clause');
process.exit(failures ? 1 : 0);
