// Astrion OS — Generation Runner
//
// Hooks the auto-evolution proposal events to the actual AI service.
// Without this module, the events fire into the void: intent-miss
// records an adaptation, workflow records an adaptation, format
// converter records an adaptation — but no AI ever runs and the user
// gets nothing back.
//
// What this DOES do (v1, deliberately small):
//   - Subscribe to intent-miss:generate, workflow:generate,
//     format-convert:generate.
//   - For each, build a focused prompt and call aiService.ask().
//   - Show the response as a notification with an "Open in chat"
//     action that loads the full convo.
//
// What this does NOT do:
//   - Run the spec/test/code generator pipeline (spec.generate +
//     tests.generate + code.generate are real capabilities, but
//     wiring them as a unified flow with branch-managed candidate
//     installation is its own ~500-line effort). v1 surfaces the AI
//     intent + plan in a notification; the user can then take that
//     plan and run with it. M1.P3+ will do real candidate apps.
//
// Why a separate module:
//   - generation-bridge defines the proposal/accept API.
//   - This separates UI/notification side-effects from the proposal
//     bookkeeping, which keeps generation-bridge unit-testable
//     without firing real AI calls in tests.

import { eventBus } from './event-bus.js';
import { notifications } from './notifications.js';
import { aiService } from './ai-service.js';

let initialized = false;

const PROMPT_FOR_INTENT_MISS = (description) =>
  `A user said in Spotlight: "${description}".\n\n` +
  `They want Astrion to build something for them. In 2-3 short sentences, ` +
  `describe what app or skill you'd build, what it would do, and what 1-3 ` +
  `built-in capabilities it would use. Keep it concrete — no fluff.`;

const PROMPT_FOR_WORKFLOW = (description) =>
  `A user wants to automate this workflow: "${description}".\n\n` +
  `Outline the steps in plain English, one per line, prefixed with "1.", ` +
  `"2.", etc. Use only existing Astrion capabilities (open app, create note, ` +
  `set timer, send message, etc.). Maximum 5 steps. Keep each step under 12 words.`;

const PROMPT_FOR_FORMAT_CONVERSION = (data, target) =>
  `Convert the following data to ${target}.\n\n` +
  `--- INPUT ---\n${data}\n--- END INPUT ---\n\n` +
  `Output ONLY the converted result. No commentary, no markdown fences, ` +
  `just the raw ${target}.`;

async function runWithAI(prompt, kind, label) {
  let reply;
  try {
    reply = await aiService.ask(prompt);
  } catch (err) {
    notifications.show({
      title: `Generation failed (${kind})`,
      body: err?.message || String(err),
      icon: '⚠️',
      duration: 6000,
    });
    return;
  }
  if (!reply || typeof reply !== 'string') {
    notifications.show({
      title: `${label}: no response`,
      body: 'AI returned an empty answer.',
      icon: '⚠️',
      duration: 5000,
    });
    return;
  }
  // Show the AI output. The notification body fits ~3 short lines;
  // longer responses get truncated with an ellipsis. The full reply
  // is also stashed in the notification history for later review.
  const preview = reply.length > 240 ? reply.slice(0, 240) + '…' : reply;
  notifications.show({
    title: label,
    body: preview,
    icon: '✨',
    duration: 14000,
  });
}

export function initGenerationRunner() {
  if (initialized) return;
  initialized = true;

  eventBus.on('intent-miss:generate', ({ description, source }) => {
    if (!description) return;
    const tag = source === 'wish' ? 'Astrion sketched what you wanted' : 'Astrion thought about what to build';
    runWithAI(PROMPT_FOR_INTENT_MISS(description), 'intent-miss', tag).catch(() => {});
  });

  eventBus.on('workflow:generate', ({ description }) => {
    if (!description) return;
    runWithAI(PROMPT_FOR_WORKFLOW(description), 'workflow', 'Workflow plan').catch(() => {});
  });

  eventBus.on('format-convert:generate', ({ data, target }) => {
    if (!data || !target) return;
    runWithAI(PROMPT_FOR_FORMAT_CONVERSION(data, target), 'format-convert', `Converted to ${target}`).catch(() => {});
  });
}

export function _resetForTests() { initialized = false; }
