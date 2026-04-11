// Astrion OS — Core Capability Providers (M1.P2)
//
// The first batch of real capabilities that the Intent Kernel can dispatch to.
// Each provider handles one verb+target combo and calls into existing OS
// primitives (processManager, fileSystem, aiService) to do the actual work.
//
// These are deliberately narrow and safe. The goal is "demo works end-to-end"
// not "every possible action is supported." Additional providers land in M1.P2
// continuations and M2+.

import {
  registerCapability,
  runCapability,
  LEVEL,
  REVERSIBILITY,
  BLAST_RADIUS,
} from './capability-api.js';

import { processManager } from './process-manager.js';
import { fileSystem } from './file-system.js';
import { aiService } from './ai-service.js';
import { notifications } from './notifications.js';
import { eventBus } from './event-bus.js';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Safe notification helper — wraps notifications.show() in a try/catch
 * so UI glitches (missing DOM host, etc.) never fail the underlying
 * capability. The side-effect of the capability (the actual data write)
 * has already happened by the time we try to notify.
 */
function safeNotify(opts) {
  try {
    notifications?.show?.(opts);
  } catch (err) {
    console.warn('[capability] notification failed:', err?.message || err);
  }
}

/**
 * Map generic target names to Astrion app IDs. Used by open/close.
 */
const APP_ID_MAP = {
  note: 'notes',
  file: 'finder',
  folder: 'finder',
  todo: 'todo',
  reminder: 'reminders',
  terminal: 'terminal',
  browser: 'browser',
  calculator: 'calculator',
  editor: 'text-editor',
  calendar: 'calendar',
  finder: 'finder',
  draw: 'draw',
  vault: 'vault',
  trash: 'trash',
  setting: 'settings',
  calendar: 'calendar',
  photo: 'photos',
  song: 'music',
  video: 'video-player',
  weather: 'weather',
  message: 'messages',
  contact: 'contacts',
  chess: 'chess',
  snake: 'snake',
};

function resolveAppId(target) {
  if (!target) return null;
  return APP_ID_MAP[target] || target;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER 1: open.* — launch any Astrion app
// ═══════════════════════════════════════════════════════════════

const openApp = {
  id: 'app.open',
  verb: 'open',
  target: '*', // wildcard — handles any open intent
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Open an Astrion app',
  estimateCost: () => ({ timeMs: 200, irreversibilityTokens: 0 }),
  validate: (args) => {
    // Target is required (the app to open)
    if (!args._intent?.target && !args.appId) {
      return { ok: false, errors: ['Missing target app'] };
    }
    return { ok: true, errors: [] };
  },
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const appId = args.appId || resolveAppId(args._intent?.target);
      if (!appId) throw new Error('Could not resolve target app');
      const instance = processManager.launch(appId);
      if (!instance) throw new Error(`App not found: ${appId}`);
      return { appId, instanceId: instance };
    });
  },
};
registerCapability(openApp);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 2: notes.create — create a new note
// ═══════════════════════════════════════════════════════════════

const notesCreate = {
  id: 'notes.create',
  verb: 'make',
  target: 'note',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Create a new note',
  estimateCost: () => ({ timeMs: 300, irreversibilityTokens: 1 }),
  validate: (args) => ({ ok: true, errors: [] }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const title = args.name || 'Untitled note';
      const contentLines = [title];
      if (args.items && args.items.length) {
        contentLines.push('', ...args.items.map(i => `• ${i}`));
      } else if (args.topic) {
        contentLines.push('', args.topic);
      }
      const content = contentLines.join('\n');

      // Notes app reads from localStorage 'nova-notes' with shape:
      // { id, content, createdAt, updatedAt } — where title is derived
      // from content.split('\n')[0].
      const noteId = `note-${Date.now()}`;
      const noteData = { id: noteId, content, createdAt: Date.now(), updatedAt: Date.now() };
      const existing = JSON.parse(localStorage.getItem('nova-notes') || '[]');
      existing.unshift(noteData);
      localStorage.setItem('nova-notes', JSON.stringify(existing));

      // Launch Notes so the user sees their new note
      processManager.launch('notes');

      // Fire a notification so the user knows
      safeNotify({
        title: '📝 Note created',
        body: title + (args.items ? ` (${args.items.length} items)` : ''),
      });

      return { noteId, title, itemCount: args.items?.length || 0 };
    });
  },
};
registerCapability(notesCreate);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 3: todo.create — create a new todo item
// ═══════════════════════════════════════════════════════════════

const todoCreate = {
  id: 'todo.create',
  verb: 'make',
  target: 'todo',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Create a new todo item',
  estimateCost: () => ({ timeMs: 200, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const text = args.name || args._rawArgs || 'New todo';
      const todoId = `todo-${Date.now()}`;
      const item = { id: todoId, text, done: false, createdAt: Date.now() };
      const existing = JSON.parse(localStorage.getItem('nova-todos') || '[]');
      existing.unshift(item);
      localStorage.setItem('nova-todos', JSON.stringify(existing));

      processManager.launch('todo');

      safeNotify({
        title: '✅ Todo added',
        body: text,
      });

      return { todoId, text };
    });
  },
};
registerCapability(todoCreate);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 4: reminder.create — set a reminder
// ═══════════════════════════════════════════════════════════════

const reminderCreate = {
  id: 'reminder.create',
  verb: 'remind',
  target: '*',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Set a reminder',
  estimateCost: () => ({ timeMs: 200, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const text = args.name || args.topic || args._rawArgs || 'Reminder';
      const when = args.when || args.after || args.before || 'later';
      const reminderId = `reminder-${Date.now()}`;
      const item = { id: reminderId, text, when, createdAt: Date.now() };
      const existing = JSON.parse(localStorage.getItem('nova-reminders') || '[]');
      existing.unshift(item);
      localStorage.setItem('nova-reminders', JSON.stringify(existing));

      safeNotify({
        title: '🔔 Reminder set',
        body: `${text} — ${when}`,
      });

      return { reminderId, text, when };
    });
  },
};
registerCapability(reminderCreate);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 5: compute.calculate — evaluate math expression
// ═══════════════════════════════════════════════════════════════

const computeCalc = {
  id: 'compute.calculate',
  verb: 'compute',
  target: '*',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Evaluate a math expression',
  estimateCost: () => ({ timeMs: 10, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const expr = (args.expression || args._rawArgs || '')
        .replace(/[^0-9+\-*/.() %^]/g, '')
        .replace(/\^/g, '**');
      if (!expr || expr.length < 1) throw new Error('No expression');
      const result = Function('"use strict"; return (' + expr + ')')();
      if (typeof result !== 'number' || !isFinite(result)) {
        throw new Error('Not a valid math result');
      }
      safeNotify({
        title: '🧮 ' + expr + ' =',
        body: String(result),
      });
      return { expression: expr, result };
    });
  },
};
registerCapability(computeCalc);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 6: ai.ask — forward to the AI service
// ═══════════════════════════════════════════════════════════════

const aiAsk = {
  id: 'ai.ask',
  verb: 'ask',
  target: '*',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.EXTERNAL,
  summary: 'Ask the AI a question',
  estimateCost: () => ({ timeMs: 3000, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const prompt = args._intent?.raw || args.question || args._rawArgs || args.topic || '';
      if (!prompt) throw new Error('No question');
      const answer = await aiService.ask(prompt);
      safeNotify({
        title: '🤖 Astrion',
        body: answer.length > 200 ? answer.slice(0, 200) + '…' : answer,
      });
      return { question: prompt, answer };
    });
  },
};
registerCapability(aiAsk);

// Register ai.ask as the handler for explain/summarize too — they all just
// forward the raw query to the AI. This lets "explain recursion" and
// "summarize this article" work without creating separate providers.
registerCapability({ ...aiAsk, id: 'ai.explain', verb: 'explain' });
registerCapability({ ...aiAsk, id: 'ai.summarize', verb: 'summarize' });

// ═══════════════════════════════════════════════════════════════
// PROVIDER 7: browser.navigate — open a URL
// ═══════════════════════════════════════════════════════════════

const browserNavigate = {
  id: 'browser.navigate',
  verb: 'navigate',
  target: '*',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Open a URL in the browser',
  estimateCost: () => ({ timeMs: 500, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      let url = args.url;
      if (!url) throw new Error('No URL');
      if (!/^https?:\/\//.test(url)) url = 'https://' + url;
      // Launch the browser app with the URL
      processManager.launch('browser', { initialUrl: url });
      return { url };
    });
  },
};
registerCapability(browserNavigate);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 8: volume.set — change system volume
// ═══════════════════════════════════════════════════════════════

const volumeSet = {
  id: 'volume.set',
  verb: 'increase',
  target: 'volume',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.ACCOUNT,
  summary: 'Change system volume',
  estimateCost: () => ({ timeMs: 100, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const level = args.level ?? 50;
      // Fire an event the control-center/volume-hud listens to
      eventBus.emit('volume:set', { level });
      safeNotify({ title: '🔊 Volume', body: `Set to ${level}%` });
      return { level };
    });
  },
};
registerCapability(volumeSet);

const volumeDecrease = {
  ...volumeSet,
  id: 'volume.decrease',
  verb: 'decrease',
  summary: 'Decrease system volume',
};
registerCapability(volumeDecrease);

const volumeMute = {
  id: 'volume.mute',
  verb: 'mute',
  target: '*',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.ACCOUNT,
  summary: 'Mute audio',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      eventBus.emit('volume:mute');
      safeNotify({ title: '🔇 Muted', body: 'Audio is now muted' });
      return { muted: true };
    });
  },
};
registerCapability(volumeMute);

const volumeUnmute = {
  ...volumeMute,
  id: 'volume.unmute',
  verb: 'unmute',
  summary: 'Unmute audio',
  execute: async function(args) {
    return runCapability(this, args, async () => {
      eventBus.emit('volume:unmute');
      safeNotify({ title: '🔊 Unmuted', body: 'Audio is back on' });
      return { muted: false };
    });
  },
};
registerCapability(volumeUnmute);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 9: translate.text — translate via AI
// ═══════════════════════════════════════════════════════════════

const translateText = {
  id: 'translate.text',
  verb: 'translate',
  target: '*',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.EXTERNAL,
  summary: 'Translate text via AI',
  estimateCost: () => ({ timeMs: 2000, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const text = args.text || args._rawArgs || '';
      const toLang = args.toLang || 'English';
      if (!text) throw new Error('No text to translate');
      const prompt = `Translate this to ${toLang}. Respond with ONLY the translation, no explanation:\n\n${text}`;
      const answer = await aiService.ask(prompt);
      safeNotify({
        title: `🌐 ${toLang}`,
        body: answer.length > 200 ? answer.slice(0, 200) + '…' : answer,
      });
      return { original: text, translation: answer, toLang };
    });
  },
};
registerCapability(translateText);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 10: screenshot.take — capture the screen
// ═══════════════════════════════════════════════════════════════

const screenshotTake = {
  id: 'screenshot.take',
  verb: 'make',
  target: 'screenshot',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Take a screenshot',
  estimateCost: () => ({ timeMs: 300, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      eventBus.emit('screenshot:take');
      safeNotify({
        title: '📸 Screenshot',
        body: 'Captured — check your Pictures folder',
      });
      return { triggered: true };
    });
  },
};
registerCapability(screenshotTake);

// ═══════════════════════════════════════════════════════════════
// PROVIDER BUNDLE EXPORT
// ═══════════════════════════════════════════════════════════════

/**
 * Import this file at boot time to register all core capabilities.
 * boot.js should `import './kernel/capability-providers.js'`
 * and that's enough — the registrations happen as side effects.
 */
export const CORE_CAPABILITIES = [
  'app.open',
  'notes.create',
  'todo.create',
  'reminder.create',
  'compute.calculate',
  'ai.ask',
  'browser.navigate',
  'volume.set',
  'volume.decrease',
  'volume.mute',
  'volume.unmute',
  'translate.text',
  'screenshot.take',
];

console.log(`[capability-providers] Registered ${CORE_CAPABILITIES.length} core capabilities`);
