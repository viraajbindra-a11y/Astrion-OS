// Astrion OS — App Generation Pipeline
//
// Single entry point that chains the M4 spec/tests/code/bundle/promote
// capabilities into "user types description → real app installed →
// app launches." Was the M1.P3+ gap I called out earlier — this is
// what closes it.
//
// Why this is its own module (not a single capability):
//   - The chain has TWO L2+ approval gates (spec.freeze + app.promote)
//     that the user has implicitly already approved by clicking
//     "Generate" in the intent-miss banner. We pass skipInterception
//     so the pipeline runs end-to-end without re-asking for the same
//     consent. The first consent IS the consent.
//   - Each step needs the previous step's result (spec → suite → code →
//     app), so this can't just be a planner-generated multi-step plan
//     without bind-passing infrastructure.
//   - Failure reporting matters here. The pipeline returns the
//     specific step that failed + the reason, so the toast shows
//     "❌ code.generate failed: 3 attempts, 2/4 tests still red"
//     instead of just dropping the user into a free-text AI reply.
//
// Public shape:
//   const r = await runAppGenerationPipeline('quote of the day');
//   r = { ok: true,  appId, attempts, durationMs, launched }
//   r = { ok: false, errorAt: 'code.generate', error: '…', durationMs }
//
// Side effects:
//   - Emits a notification per stage start + final outcome.
//   - On success, calls processManager.launch(appId) — opens the new app.
//   - Records ONE adaptation entry in CATEGORY.SKILL with revert that
//     archives the generated app.

import { eventBus } from './event-bus.js';
import { notifications } from './notifications.js';
import { resolveCapability } from './capability-api.js';
import { processManager } from './process-manager.js';
import {
  recordAdaptation,
  registerRevertHandler,
  CATEGORY,
} from './adaptation-engine.js';

let initialized = false;

const STAGES = [
  { id: 'spec.generate',  label: 'Drafting spec',     emoji: '📝' },
  { id: 'spec.freeze',    label: 'Freezing spec',     emoji: '🔒' },
  { id: 'tests.generate', label: 'Generating tests',  emoji: '🧪' },
  { id: 'code.generate',  label: 'Writing code',      emoji: '🛠' },
  { id: 'app.bundle',     label: 'Bundling app',      emoji: '📦' },
  { id: 'app.promote',    label: 'Installing app',    emoji: '🚀' },
];

async function runStage(stageId, args) {
  const cap = (await import('./capability-api.js')).getCapability(stageId);
  if (!cap || typeof cap.execute !== 'function') {
    throw new Error('capability not found: ' + stageId);
  }
  // Pass _intent.skipInterception=true via a wrapper intent so the
  // operation-interceptor lets L2+ steps through. The user already
  // consented by clicking Generate.
  const wrapped = { ...args, _intent: { ...(args._intent || {}), skipInterception: true } };
  // capabilities go through runCapability() which wraps the inner
  // result in { ok, output, provenance }. Unwrap output here so the
  // pipeline code can use result.specId / result.suiteId / etc
  // directly.
  const wrapped_result = await cap.execute(wrapped);
  if (!wrapped_result || wrapped_result.ok === false) {
    throw new Error(wrapped_result?.error || stageId + ' returned ok=false');
  }
  return wrapped_result.output || {};
}

async function archiveApp(appId) {
  try {
    const cap = (await import('./capability-api.js')).getCapability('app.archive');
    if (cap) await cap.execute({ appId, _intent: { skipInterception: true } });
  } catch (err) {
    console.warn('[app-generation-pipeline] archive failed:', err);
  }
}

/**
 * Run the full chain for `description`. Returns { ok, appId?, ... }.
 * Each stage emits a "Building…" notification with the stage label.
 *
 * On small local models (qwen2.5:7b and below) the chain is fragile —
 * the spec's 3-7 criteria default exceeds the model's working memory
 * and tests.generate / code.generate fail. The pipeline biases the
 * description toward a 1-2 criterion spec by default, which makes
 * the chain reach completion on smaller models. Set opts.minimal=false
 * to use the original prompts (recommended only for gpt-oss:16b or
 * Anthropic).
 */
export async function runAppGenerationPipeline(description, opts = {}) {
  const t0 = Date.now();
  const minimal = opts.minimal !== false;
  if (!description || typeof description !== 'string') {
    return { ok: false, errorAt: 'input', error: 'description required', durationMs: 0 };
  }
  // Bias the spec generator toward a tiny spec on small models. The
  // preamble runs through spec-generator's prompt verbatim and the
  // model honors it.
  const biasedDescription = minimal
    ? `${description}\n\nKEEP IT MINIMAL: 1 acceptance criterion only. ` +
      `One core feature, one test. Skip non_goals beyond one entry. ` +
      `Smaller is faster + more reliable on a small local model.`
    : description;
  notifications.show({
    title: '✨ Building your app',
    body: `Step 1/${STAGES.length}: ${STAGES[0].emoji} ${STAGES[0].label}…\n"${description}"`,
    icon: '🛠',
    duration: 60000,
  });
  let specId, suiteId, codeId, appId;
  try {
    // 1. spec.generate
    const spec = await runStage('spec.generate', { intent: biasedDescription, query: biasedDescription, topic: biasedDescription });
    specId = spec.specId;

    // 2. spec.freeze (auto-confirmed)
    notifications.show({ title: '✨ Building your app', body: `Step 2/${STAGES.length}: 🔒 Freezing spec…`, icon: '🛠', duration: 30000 });
    await runStage('spec.freeze', { specId });

    // 3. tests.generate
    notifications.show({ title: '✨ Building your app', body: `Step 3/${STAGES.length}: 🧪 Generating tests…`, icon: '🛠', duration: 30000 });
    const suite = await runStage('tests.generate', { specId });
    suiteId = suite.suiteId;

    // 4. code.generate (iterative — slowest). Default to 5 attempts:
    //    small models often need an extra pass or two to fix typos
    //    that turn up in the second test run.
    notifications.show({
      title: '✨ Building your app',
      body: `Step 4/${STAGES.length}: 🛠 Writing code (iterates until tests pass)…`,
      icon: '🛠', duration: 90000,
    });
    const code = await runStage('code.generate', { suiteId, maxAttempts: opts.maxAttempts || 5 });
    if (code.status !== 'ok') {
      throw new Error(`code didn't pass tests (${code.attempts} attempts)`);
    }
    codeId = code.codeId;

    // 5. app.bundle
    notifications.show({ title: '✨ Building your app', body: `Step 5/${STAGES.length}: 📦 Bundling app…`, icon: '🛠', duration: 30000 });
    const bundle = await runStage('app.bundle', { codeId });
    appId = bundle.appId;

    // 6. app.promote (auto-confirmed)
    notifications.show({ title: '✨ Building your app', body: `Step 6/${STAGES.length}: 🚀 Installing to dock…`, icon: '🛠', duration: 30000 });
    await runStage('app.promote', { appId });

    // Generated-app-loader subscribes to app:promoted; give it one tick
    // to register with processManager before we try to launch.
    await new Promise(r => setTimeout(r, 200));

    // Launch the new app.
    let launched = false;
    try {
      processManager.launch(appId);
      launched = true;
    } catch (err) {
      console.warn('[app-generation-pipeline] launch failed:', err);
    }

    // Record the adaptation so the user can revert from the panel.
    recordAdaptation({
      category: CATEGORY.SKILL,
      summary: `Generated + installed app from "${description}"`,
      trigger: 'You asked Astrion to build it via Spotlight',
      revert: { kind: 'generated-app:archive', args: { appId } },
    });

    const dur = Date.now() - t0;
    notifications.show({
      title: '✓ App built + installed',
      body: `"${description}" — ${(dur / 1000).toFixed(1)}s, ${code.attempts} attempt${code.attempts === 1 ? '' : 's'}. Open it from the dock or revert from Adaptations.`,
      icon: '✨', duration: 8000,
    });
    return { ok: true, appId, specId, suiteId, codeId, attempts: code.attempts, launched, durationMs: dur };

  } catch (err) {
    const errorAt = err?.message?.includes('spec.generate') ? 'spec.generate'
      : err?.message?.includes('tests.generate') ? 'tests.generate'
      : err?.message?.includes(`code didn't pass`) ? 'code.generate'
      : err?.message?.includes('app.bundle') ? 'app.bundle'
      : err?.message?.includes('app.promote') ? 'app.promote'
      : 'unknown';
    // Stage-specific guidance. code.generate failures usually mean
    // the local model is too small to write code that passes the
    // generated tests; tests.generate failures usually mean the spec
    // had too many criteria for the model to track. Roadmap target
    // for the chain is gpt-oss:16b OR claude-haiku-4-5.
    const hint = errorAt === 'code.generate'
      ? '\n\nTip: try a smaller / simpler description, or switch to a bigger model in Settings (gpt-oss:16b or Anthropic).'
      : errorAt === 'tests.generate'
      ? '\n\nTip: try a more focused description with fewer requirements.'
      : '\n\nTip: try a more specific description.';
    notifications.show({
      title: '❌ App build failed',
      body: `Failed at ${errorAt}: ${err?.message || String(err)}\n\nNothing was installed.${hint}`,
      icon: '⚠️', duration: 12000,
    });
    // Best-effort cleanup of any partial bundle.
    if (appId) await archiveApp(appId);
    return {
      ok: false,
      errorAt,
      error: err?.message || String(err),
      partialState: { specId, suiteId, codeId, appId },
      durationMs: Date.now() - t0,
    };
  }
}

async function revertGeneratedApp(args) {
  if (args?.appId) await archiveApp(args.appId);
}

export function initAppGenerationPipeline() {
  registerRevertHandler('generated-app:archive', revertGeneratedApp);
  if (initialized) return;
  initialized = true;
  // intent-miss-proposer fires this when the user clicks "Generate"
  // on a wish-phrase or repeat-miss banner.
  eventBus.on('intent-miss:generate', ({ description, source }) => {
    if (!description) return;
    runAppGenerationPipeline(description, { source }).catch(err => {
      console.warn('[app-generation-pipeline] uncaught:', err);
    });
  });
}

export function _resetForTests() { initialized = false; }
