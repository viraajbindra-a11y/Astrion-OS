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
import { graphStore } from './graph-store.js';

// ═══════════════════════════════════════════════════════════════
// VFS PATH RESOLUTION (shared by files.* providers)
// ═══════════════════════════════════════════════════════════════

// Agent Core Sprint — Phase 1. The planner and user both say things like
// "Desktop", "my documents", "/Desktop" — all need to resolve to a real
// VFS path. We restrict writes to the five user-visible roots; anything
// that escapes this set (or contains `..`) is hard-rejected.
const VFS_ROOTS = ['/Desktop', '/Documents', '/Downloads', '/Pictures', '/Music'];
const VFS_ROOT_ALIASES = {
  desktop:    '/Desktop',
  documents:  '/Documents',
  docs:       '/Documents',
  downloads:  '/Downloads',
  pictures:   '/Pictures',
  photos:     '/Pictures',
  music:      '/Music',
};

function resolveVfsPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let path = raw.trim();
  // Reject traversal BEFORE any normalization (TOCTOU defense)
  if (path.includes('..')) return null;
  // Strip "my " / "the " / leading articles
  path = path.replace(/^(my|the|in|on)\s+/i, '');
  // Alias lookup — lowercase literal roots or "desktop folder" → "/Desktop"
  const aliasKey = path.toLowerCase().replace(/\s+folder$/i, '').trim();
  if (VFS_ROOT_ALIASES[aliasKey]) return VFS_ROOT_ALIASES[aliasKey];
  if (!path.startsWith('/')) path = '/' + path;
  // Normalize: collapse double slashes, drop trailing slash
  path = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  // Second check after normalize (belt-and-suspenders)
  if (path.includes('..')) return null;
  return path;
}

function isPathWithinRoots(path) {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..')) return false;
  if (path === '/') return false;
  for (const root of VFS_ROOTS) {
    if (path === root || path.startsWith(root + '/')) return true;
  }
  return false;
}

function joinVfsPath(parent, name) {
  if (!parent || !name) return null;
  const leaf = String(name).replace(/^\/+/, '');
  // Reject slashes and traversal in leaf names
  if (leaf.includes('/') || leaf.includes('..')) return null;
  const base = parent.replace(/\/$/, '');
  return `${base}/${leaf}`;
}

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

      // M2.P4: write to the hypergraph. Notes app reads from the graph
      // via graphQuery and refreshes on graph:node:created events.
      const created = await graphStore.createNode('note', {
        title,
        content,
        date: new Date().toISOString(),
      }, {
        createdBy: { kind: 'user' },
        capabilityId: 'notes.create',
        intentId: args._intent?.id,
      });

      // Launch Notes so the user sees their new note
      processManager.launch('notes');

      // Fire a notification so the user knows
      safeNotify({
        title: '📝 Note created',
        body: title + (args.items ? ` (${args.items.length} items)` : ''),
      });

      return { noteId: created.id, title, itemCount: args.items?.length || 0 };
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
      // M2.P4: write to the hypergraph.
      const created = await graphStore.createNode('todo', {
        text,
        done: false,
      }, {
        createdBy: { kind: 'user' },
        capabilityId: 'todo.create',
        intentId: args._intent?.id,
      });

      processManager.launch('todo');

      safeNotify({
        title: '✅ Todo added',
        body: text,
      });

      return { todoId: created.id, text };
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
      // M2.P4: write to the hypergraph. Reminders app groups by `list`;
      // capability-created reminders go into the "Today" list by default.
      const created = await graphStore.createNode('reminder', {
        text,
        when,
        done: false,
        list: 'Today',
      }, {
        createdBy: { kind: 'user' },
        capabilityId: 'reminder.create',
        intentId: args._intent?.id,
      });

      safeNotify({
        title: '🔔 Reminder set',
        body: `${text} — ${when}`,
      });

      return { reminderId: created.id, text, when };
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
      // Stream tokens (lesson #185 — user wanted live plan progress
      // in Spotlight). The executor passes planId + stepIndex via
      // args._planContext so Spotlight can attribute chunks to the
      // right step. If those aren't set we just don't emit and the
      // call still works.
      const planId = args._planContext?.planId;
      const stepIndex = args._planContext?.stepIndex;
      const emit = (type, payload) => {
        if (planId == null) return;
        try {
          // Lazy-import event-bus to avoid circular dep at module load.
          import('./event-bus.js').then(m => {
            m.eventBus.emit(type, { planId, stepIndex, ...payload });
          }).catch(() => {});
        } catch {}
      };
      let assembled = '';
      let answer;
      try {
        const r = await aiService.askStream(
          prompt,
          { skipHistory: true, capCategory: 'ai-ask-step', maxTokens: 800 },
          (delta) => {
            assembled += delta;
            emit('plan:step:chunk', { kind: 'content', text: assembled });
          },
          (delta) => {
            emit('plan:step:chunk', { kind: 'thinking', textDelta: delta });
          },
        );
        answer = r?.reply || assembled;
      } catch (err) {
        // Fallback to non-streaming if the stream path errors.
        answer = await aiService.ask(prompt);
      }
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
// PROVIDER 6.5: spec.generate + spec.freeze — M4.P1
//   Turn an intent into a plain-English structured spec. Store it as
//   a draft graph node. A later user-approval step freezes it.
//   Generated code must reference a frozen spec id.
// ═══════════════════════════════════════════════════════════════

const specGenerate = {
  id: 'spec.generate',
  verb: 'spec',
  target: '*',
  level: LEVEL.OBSERVE, // generates text + writes a draft node; no user data touched
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Generate a structured plain-English spec from an intent (M4.P1)',
  estimateCost: () => ({ timeMs: 4000, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const intent = args._intent?.raw || args.intent || args.query || args.topic || '';
      if (!intent) throw new Error('spec.generate: no intent');
      const mod = await import('./spec-generator.js');
      const result = await mod.generateSpec(intent, { context: args.context || {} });
      if (result.status !== 'draft') {
        throw new Error('spec.generate failed: ' + (result.error || 'unknown'));
      }
      const specId = await mod.storeSpec(result.spec);
      safeNotify({
        title: '📝 Draft spec ready',
        body: result.spec.goal.slice(0, 140),
      });
      return { specId, status: 'draft', goal: result.spec.goal, criteriaCount: result.spec.acceptance_criteria.length };
    });
  },
};
registerCapability(specGenerate);

const specFreeze = {
  id: 'spec.freeze',
  verb: 'freeze',
  target: 'spec',
  level: LEVEL.REAL, // freezing is user approval; a real decision
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Freeze a draft spec (user approval gate) — makes it immutable',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const id = args.specId || args.id;
      if (!id) throw new Error('spec.freeze: specId required');
      const mod = await import('./spec-generator.js');
      const node = await mod.freezeSpec(id);
      if (!node) throw new Error('spec.freeze: spec not found or already frozen: ' + id);
      return { specId: id, status: 'frozen' };
    });
  },
};
registerCapability(specFreeze);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 6.6: tests.generate — M4.P2
//   Generate a unit test suite from a frozen spec. Returns the new
//   suite id and per-test count. Spec must be frozen — drafts are
//   rejected so users can't accidentally test against unapproved
//   criteria.
// ═══════════════════════════════════════════════════════════════

const testsGenerate = {
  id: 'tests.generate',
  verb: 'generate',
  target: 'tests',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Generate a unit test suite from a frozen spec (M4.P2)',
  estimateCost: () => ({ timeMs: 6000, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const specId = args.specId || args.id;
      if (!specId) throw new Error('tests.generate: specId required');
      const mod = await import('./test-generator.js');
      const result = await mod.generateTests(specId);
      if (result.status !== 'ok') throw new Error('tests.generate failed: ' + result.error);
      const suiteId = await mod.storeTestSuite(result.suite);
      safeNotify({
        title: '🧪 Test suite ready',
        body: `${result.suite.tests.length} tests for spec ${specId.slice(0, 8)}`,
      });
      return { suiteId, specId, testCount: result.suite.tests.length };
    });
  },
};
registerCapability(testsGenerate);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 6.7: tests.run — M4.P3
//   Execute a stored test suite in an iframe sandbox (allow-scripts,
//   no allow-same-origin → unique origin, no parent access). Records
//   per-test results back onto the suite node.
// ═══════════════════════════════════════════════════════════════

const testsRun = {
  id: 'tests.run',
  verb: 'run',
  target: 'tests',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Run a stored test suite in an isolated sandbox (M4.P3)',
  estimateCost: (args) => ({ timeMs: 3000, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const suiteId = args.suiteId || args.id;
      if (!suiteId) throw new Error('tests.run: suiteId required');
      const mod = await import('./test-runner.js');
      const opts = args.sharedCode ? { sharedCode: args.sharedCode } : {};
      const result = await mod.runSuite(suiteId, opts);
      safeNotify({
        title: result.passes === result.total ? '✅ All tests passed' : `❌ ${result.fails} test${result.fails === 1 ? '' : 's'} failed`,
        body: `${result.passes}/${result.total} in ${result.durationMs}ms`,
      });
      return result;
    });
  },
};
registerCapability(testsRun);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 6.8: code.generate — M4.P3.b
//   Iterate code until the suite passes (or maxAttempts hits).
//   Stores the resulting artifact as a 'generated-code' graph node
//   linked back to the suite via an 'implements' edge.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// PROVIDER 6.9: app.bundle + app.promote + app.archive — M4.P4
//   Bundle a verified spec/suite/code into a 'generated-app' graph
//   node (sandboxed). User L2 promote moves it to docked. Archive
//   soft-deletes.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// PROVIDER 7: branch.* — M5.P1 (branching storage layer)
//   create / merge / discard branches that stage mutations against
//   the live M2 graph. The Operation Interceptor (M5.P2) will use
//   these to wrap every L2+ capability execute() in a branch the
//   user can confirm or rewind.
// ═══════════════════════════════════════════════════════════════

const branchCreate = {
  id: 'branch.create',
  verb: 'create',
  target: 'branch',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Create an open branch for staged mutations (M5.P1)',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const mod = await import('./branch-manager.js');
      const b = await mod.createBranch({ name: args.name, intent: args.intent });
      return { branchId: b.id, name: b.name, status: b.status };
    });
  },
};
registerCapability(branchCreate);

const branchMerge = {
  id: 'branch.merge',
  verb: 'merge',
  target: 'branch',
  level: LEVEL.REAL, // applies to live graph — user-approval gate
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Apply a branch\'s pending mutations to live graph (user-approval)',
  estimateCost: () => ({ timeMs: 200, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const id = args.branchId || args.id;
      if (!id) throw new Error('branch.merge: branchId required');
      const mod = await import('./branch-manager.js');
      const result = await mod.mergeBranch(id);
      if (!result.ok) throw new Error('branch.merge failed at step ' + result.failedAt + ': ' + result.error);
      safeNotify({ title: '✅ Branch merged', body: result.applied + ' mutations applied' });
      return result;
    });
  },
};
registerCapability(branchMerge);

const branchDiscard = {
  id: 'branch.discard',
  verb: 'discard',
  target: 'branch',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Discard a branch without applying its mutations (soft-delete)',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const id = args.branchId || args.id;
      if (!id) throw new Error('branch.discard: branchId required');
      const mod = await import('./branch-manager.js');
      return await mod.discardBranch(id, args.reason || '');
    });
  },
};
registerCapability(branchDiscard);

const branchRewind = {
  id: 'branch.rewind',
  verb: 'rewind',
  target: 'branch',
  level: LEVEL.REAL, // undoing a committed branch IS a real change to live state
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Reverse every mutation a previous merge produced (M5.P3)',
  estimateCost: () => ({ timeMs: 500, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const id = args.branchId || args.id;
      if (!id) throw new Error('branch.rewind: branchId required');
      const mod = await import('./branch-manager.js');
      const result = await mod.rewindBranch(id);
      safeNotify({
        title: '⏪ Branch rewound',
        body: result.rewound + ' mutation' + (result.rewound === 1 ? '' : 's') + ' undone',
      });
      return result;
    });
  },
};
registerCapability(branchRewind);

const appBundle = {
  id: 'app.bundle',
  verb: 'bundle',
  target: 'app',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Bundle spec/suite/code into a sandboxed generated-app node (M4.P4)',
  estimateCost: () => ({ timeMs: 100, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const codeId = args.codeId || args.id;
      if (!codeId) throw new Error('app.bundle: codeId required');
      const mod = await import('./app-promoter.js');
      const result = await mod.bundleApp(codeId);
      if (!result.ok) throw new Error('app.bundle: ' + result.error);
      return { appId: result.appId, status: 'sandboxed' };
    });
  },
};
registerCapability(appBundle);

const appPromote = {
  id: 'app.promote',
  verb: 'promote',
  target: 'app',
  level: LEVEL.REAL, // user-approval gate — sandbox -> dock is a real decision
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Promote a sandboxed app to docked (user L2 approval) (M4.P4)',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const appId = args.appId || args.id;
      if (!appId) throw new Error('app.promote: appId required');
      const mod = await import('./app-promoter.js');
      const result = await mod.promoteApp(appId);
      if (!result.ok) throw new Error('app.promote: ' + result.error);
      safeNotify({ title: '🚀 App promoted to dock', body: 'app ' + appId.slice(0, 8) });
      return result;
    });
  },
};
registerCapability(appPromote);

const appArchive = {
  id: 'app.archive',
  verb: 'archive',
  target: 'app',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Archive (soft-delete) a generated app (M4.P4)',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 1 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const appId = args.appId || args.id;
      if (!appId) throw new Error('app.archive: appId required');
      const mod = await import('./app-promoter.js');
      const result = await mod.archiveApp(appId);
      if (!result.ok) throw new Error('app.archive: ' + result.error);
      return result;
    });
  },
};
registerCapability(appArchive);

const codeGenerate = {
  id: 'code.generate',
  verb: 'generate',
  target: 'code',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Generate JS code that satisfies a test suite, iterating up to N times (M4.P3.b)',
  estimateCost: (args) => ({ timeMs: 9000 * (args.maxAttempts || 3), irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const suiteId = args.suiteId || args.id;
      if (!suiteId) throw new Error('code.generate: suiteId required');
      const mod = await import('./code-generator.js');
      const result = await mod.generateCode(suiteId, { maxAttempts: args.maxAttempts });
      let codeId = null;
      if (result.status === 'ok') {
        codeId = await mod.storeGeneratedCode(suiteId, result);
      }
      safeNotify({
        title: result.status === 'ok' ? '🛠 Code passed all tests' : '❌ Code generation failed',
        body: result.status === 'ok'
          ? `${result.attempts} attempt${result.attempts === 1 ? '' : 's'}, ${result.finalResults.total} tests`
          : (result.error || 'unknown'),
      });
      return { codeId, suiteId, status: result.status, attempts: result.attempts };
    });
  },
};
registerCapability(codeGenerate);

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
// PROVIDER 8.b: system.setBrightness / lock / shutdown
// ═══════════════════════════════════════════════════════════════
//
// The system.* cluster — screen brightness, lock screen, machine
// shutdown. All L2 because they touch real hardware/state. shutdown
// is point-of-no-return (typed-confirm gate fires).

const systemSetBrightness = {
  id: 'system.setBrightness',
  verb: 'set',
  target: 'brightness',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.ACCOUNT,
  summary: 'Set screen brightness',
  estimateCost: () => ({ timeMs: 200, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      let level = parseInt(args.level ?? args.value ?? args.percent ?? 75);
      if (isNaN(level)) throw new Error('level required (0-100)');
      level = Math.max(0, Math.min(100, level));
      // Best-effort POST to the server endpoint that writes
      // /sys/class/backlight/*/brightness on Linux. Falls back
      // to a CSS filter so the change is at least visible in the
      // web shell when the hardware path isn't writable.
      try {
        await fetch('/api/brightness', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level }),
        });
      } catch {}
      // Live preview fallback (also what the control-center slider does)
      const desktop = document.getElementById('desktop');
      if (desktop) desktop.style.filter = `brightness(${Math.max(0.3, level / 100)})`;
      safeNotify({ title: '☀️ Brightness', body: `Set to ${level}%` });
      return { level };
    });
  },
};
registerCapability(systemSetBrightness);

const systemLock = {
  id: 'system.lock',
  verb: 'lock',
  target: 'screen',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.ACCOUNT,
  summary: 'Lock the screen',
  estimateCost: () => ({ timeMs: 100, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      // lockScreen() is exported by js/shell/lock-screen.js — dynamic import
      // so the kernel layer doesn't take a hard dep on the shell.
      try {
        const m = await import('../shell/lock-screen.js');
        if (typeof m.lockScreen === 'function') m.lockScreen();
        else if (typeof m.default === 'function') m.default();
      } catch (err) {
        // Native shell path: emit an event the C layer can pick up
        eventBus.emit('system:lock');
      }
      return { locked: true };
    });
  },
};
registerCapability(systemLock);

const systemShutdown = {
  id: 'system.shutdown',
  verb: 'shutdown',
  target: 'system',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.PERMANENT,
  blastRadius: BLAST_RADIUS.ACCOUNT,
  pointOfNoReturn: true, // M5.P4: typed-confirm gate fires
  summary: 'Shut down the machine',
  estimateCost: () => ({ timeMs: 500, irreversibilityTokens: 5 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const mode = (args.mode || 'shutdown').toLowerCase();
      const path = mode === 'restart' || mode === 'reboot'
        ? '/api/system/restart'
        : mode === 'sleep' || mode === 'suspend'
        ? '/api/system/sleep'
        : '/api/system/shutdown';
      safeNotify({
        title: mode === 'restart' ? '🔄 Restarting…' : mode === 'sleep' ? '😴 Sleeping…' : '⏻ Shutting down…',
        body: 'Action requested',
      });
      try {
        await fetch(path, { method: 'POST' });
      } catch (err) {
        return { mode, ok: false, error: err.message };
      }
      return { mode, ok: true };
    });
  },
};
registerCapability(systemShutdown);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 8.c: terminal.exec — run a shell command (L2)
// ═══════════════════════════════════════════════════════════════
//
// Runs `cmd` via /api/terminal/exec (bash -c). The L2 preview gate
// shows the command to the user before it runs, so the user reads
// it. Output is capped at 30KB per stream and 10s default timeout
// at the server side.
//
// NOT marked pointOfNoReturn — the command itself decides
// reversibility. The user is responsible for reading the preview.
// Skills that want extra safety should use the M7.P2c constraint
// system to cap their level.

const terminalExec = {
  id: 'terminal.exec',
  verb: 'run',
  target: 'command',
  level: LEVEL.REAL,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.ACCOUNT,
  summary: 'Run a shell command in a terminal',
  estimateCost: (args) => ({
    timeMs: Math.min(parseInt(args?.timeout) || 5000, 30000),
    irreversibilityTokens: 2,
  }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const cmd = (args.cmd || args.command || args._rawArgs || '').trim();
      if (!cmd) throw new Error('cmd required');
      // Soft-block a few patterns that the L2 preview can't reasonably
      // protect against — the user should not be able to be tricked into
      // approving these via Spotlight one-liners. Skills can still run them
      // by paste-into-terminal.
      const FORBIDDEN = [
        /:\(\)\{:\|:&\};:/,           // fork bomb
        /\bdd\s+if=\/dev\/(zero|random|urandom).*of=\/dev\/(sd|nvme|hd)/, // disk wipe
      ];
      for (const re of FORBIDDEN) {
        if (re.test(cmd)) throw new Error('refused: command matches forbidden pattern');
      }
      const r = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd,
          cwd: args.cwd,
          timeout: args.timeout,
        }),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => 'unknown');
        throw new Error(`terminal.exec http ${r.status}: ${err}`);
      }
      const data = await r.json();
      // Show a brief notification with first line of output
      const preview = (data.stdout || data.stderr || '').split('\n')[0].slice(0, 80);
      safeNotify({
        title: data.ok ? '⌨️ Command done' : '⌨️ Command failed',
        body: preview || `exit ${data.code}`,
      });
      return data;
    });
  },
};
registerCapability(terminalExec);

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
// PROVIDER 11: files.createFolder — make a folder in the VFS
// ═══════════════════════════════════════════════════════════════

// Agent Core Sprint — Phase 1. The planner decomposes compound queries
// like "create a folder called Projects on the Desktop and put a file in it"
// into `files.createFolder` + `files.createFile`. Both accept plain props
// (path, name, parent) because the JSON emitted by Claude isn't always in
// exactly the same shape — we're tolerant at the capability layer.
const filesCreateFolder = {
  id: 'files.createFolder',
  verb: 'make',
  target: 'folder',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.DIRECTORY,
  summary: 'Create a folder in the VFS',
  estimateCost: () => ({ timeMs: 150, irreversibilityTokens: 1 }),
  validate: (args) => {
    const name = args.name || args._intent?.args?.name;
    const rawParent = args.path || args.parent || args.location || args._intent?.args?.location;
    if (!name && !args.fullPath) return { ok: false, errors: ['Missing folder name'] };
    const parent = args.fullPath ? null : resolveVfsPath(rawParent || '/Desktop');
    const full = args.fullPath || (parent && name ? joinVfsPath(parent, name) : null);
    if (!full) return { ok: false, errors: ['Could not resolve folder path'] };
    if (!isPathWithinRoots(full)) {
      return { ok: false, errors: [`Path outside allowed roots: ${full}`] };
    }
    return { ok: true, errors: [] };
  },
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const name = args.name || args._intent?.args?.name;
      const rawParent = args.path || args.parent || args.location || args._intent?.args?.location;
      const parent = args.fullPath ? null : resolveVfsPath(rawParent || '/Desktop');
      const fullPath = args.fullPath || joinVfsPath(parent, name);
      if (!isPathWithinRoots(fullPath)) {
        throw new Error(`Path outside allowed roots: ${fullPath}`);
      }
      await fileSystem.createFolder(fullPath);
      safeNotify({
        title: '📁 Folder created',
        body: fullPath,
      });
      return { path: fullPath, name };
    });
  },
};
registerCapability(filesCreateFolder);

// ═══════════════════════════════════════════════════════════════
// PROVIDER 12: files.createFile — write a file in the VFS
// ═══════════════════════════════════════════════════════════════

const filesCreateFile = {
  id: 'files.createFile',
  verb: 'make',
  target: 'file',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.FILE,
  summary: 'Create a file in the VFS',
  estimateCost: () => ({ timeMs: 150, irreversibilityTokens: 1 }),
  validate: (args) => {
    const name = args.name || args._intent?.args?.name;
    if (!name && !args.fullPath) return { ok: false, errors: ['Missing file name'] };
    const rawParent = args.parent || args.path || args.location;
    const parent = args.fullPath ? null : resolveVfsPath(rawParent || '/Documents');
    const full = args.fullPath || (parent && name ? joinVfsPath(parent, name) : null);
    if (!full) return { ok: false, errors: ['Could not resolve file path'] };
    if (!isPathWithinRoots(full)) {
      return { ok: false, errors: [`Path outside allowed roots: ${full}`] };
    }
    return { ok: true, errors: [] };
  },
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const name = args.name || args._intent?.args?.name;
      const rawParent = args.parent || args.path || args.location;
      const parent = args.fullPath ? null : resolveVfsPath(rawParent || '/Documents');
      const fullPath = args.fullPath || joinVfsPath(parent, name);
      if (!isPathWithinRoots(fullPath)) {
        throw new Error(`Path outside allowed roots: ${fullPath}`);
      }
      const content = typeof args.content === 'string'
        ? args.content
        : (args.body || args.text || '');
      await fileSystem.writeFile(fullPath, content);
      safeNotify({
        title: '📄 File created',
        body: fullPath + (content ? ` (${content.length} chars)` : ''),
      });
      return { path: fullPath, name, bytes: content.length };
    });
  },
};
registerCapability(filesCreateFile);

// ═══════════════════════════════════════════════════════════════
// PROVIDER: chat.sendAsAgent — cross-context AI reply into Messages
// ═══════════════════════════════════════════════════════════════

const chatSendAsAgent = {
  id: 'chat.sendAsAgent',
  verb: 'send',
  target: 'message',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Send a reply as Astrion into the Messages chat',
  estimateCost: () => ({ timeMs: 50, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const text = args.text || args.message || '';
      if (!text) throw new Error('No message text');
      const convoId = args.conversationId || 'astrion-ai';
      eventBus.emit('chat:agent-reply', { text, conversationId: convoId });
      return { sent: true, conversationId: convoId };
    });
  },
};
registerCapability(chatSendAsAgent);

// ═══════════════════════════════════════════════════════════════
// PROVIDERS: code.* — Server File I/O Bridge (Phase 1)
// ═══════════════════════════════════════════════════════════════
//
// These capabilities let the AI read, list, search, and write real source
// files by calling the Express /api/files/* endpoints added in Phase 1.
// The browser VFS (fileSystem) is an in-browser IndexedDB store; these
// capabilities bypass it and hit the actual filesystem via the server.

const codeReadFile = {
  id: 'code.readFile',
  verb: 'find',  // "show me", "read", "find" all route here via "find file"
  target: 'file',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Read a source file from the project',
  estimateCost: () => ({ timeMs: 200, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const path = args.path || args.name || args._rawArgs || '';
      if (!path) throw new Error('No file path specified');

      // First pass: if fromEnd is set, we need totalLines to compute offset
      let offset = parseInt(args.offset) || 0;
      let limit = parseInt(args.limit) || 100;

      if (args.fromEnd) {
        // Fetch with limit=0 just to get totalLines, then re-fetch the tail
        const probe = await fetch(`/api/files/read?path=${encodeURIComponent(path)}&offset=0&limit=1`);
        if (!probe.ok) {
          const err = await probe.json().catch(() => ({ error: probe.statusText }));
          throw new Error(err.error || `Read failed: ${probe.status}`);
        }
        const probeData = await probe.json();
        offset = Math.max(0, probeData.totalLines - parseInt(args.fromEnd));
        limit = parseInt(args.fromEnd);
      }

      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Read failed: ${res.status}`);
      }
      const data = await res.json();
      safeNotify({ title: '📄 File read', body: `${data.path} (${data.lines}/${data.totalLines} lines)` });
      return data;
    });
  },
};
registerCapability(codeReadFile);

const codeListDir = {
  id: 'code.listDir',
  verb: 'find',
  target: 'folder',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'List files in a project directory',
  estimateCost: () => ({ timeMs: 150, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const path = args.path || args.name || args._rawArgs || '.';
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `List failed: ${res.status}`);
      }
      const data = await res.json();
      safeNotify({ title: '📂 Directory listed', body: `${data.path} (${data.count} entries)` });
      return data;
    });
  },
};
registerCapability(codeListDir);

const codeSearch = {
  id: 'code.search',
  verb: 'find',
  target: '*',  // "search for X", "grep for X", "find X in code"
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Search for text in project source files (grep)',
  estimateCost: () => ({ timeMs: 500, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const query = args.query || args.text || args._rawArgs || '';
      if (!query) throw new Error('No search query');
      const searchPath = args.path || '.';
      const ext = args.ext || '';
      const limit = parseInt(args.limit) || 50;
      const url = `/api/files/search?query=${encodeURIComponent(query)}&path=${encodeURIComponent(searchPath)}&ext=${encodeURIComponent(ext)}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Search failed: ${res.status}`);
      }
      const data = await res.json();
      safeNotify({ title: '🔍 Search complete', body: `"${query}" → ${data.count} matches` });
      return data;
    });
  },
};
registerCapability(codeSearch);

/**
 * Minimal unified-diff generator for code.writeFile preview. Shows which
 * lines were added (+) and removed (-). Not a full Myers diff — just a
 * simple line-by-line comparison that's good enough for AI-proposed edits.
 */
function simpleDiff(oldText, newText, fileName) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const out = [`--- a/${fileName}`, `+++ b/${fileName}`];

  // Walk both arrays and emit hunks. Very naive — no LCS, just scan for
  // matching lines and emit context/add/remove as we go.
  let oi = 0, ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      // Context line — skip (we emit only changed lines for compactness)
      oi++; ni++;
    } else if (oi < oldLines.length && (ni >= newLines.length || !newLines.includes(oldLines[oi]))) {
      out.push(`-${oldLines[oi]}`);
      oi++;
    } else if (ni < newLines.length) {
      out.push(`+${newLines[ni]}`);
      ni++;
    } else {
      oi++; ni++;
    }
  }
  return out.join('\n');
}

const codeWriteFile = {
  id: 'code.writeFile',
  verb: 'edit',
  target: 'file',
  level: LEVEL.REAL,      // L2 — touches user data, requires confirmation
  reversibility: REVERSIBILITY.BOUNDED,
  blastRadius: BLAST_RADIUS.FILE,
  summary: 'Write or modify a source file in the project (requires approval)',
  estimateCost: () => ({ timeMs: 300, irreversibilityTokens: 3 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const path = args.path || args.name || '';
      const content = args.content || args.text || '';
      if (!path) throw new Error('No file path specified');
      if (typeof content !== 'string') throw new Error('Content must be a string');

      // Read current content for diff generation (if file exists)
      let oldContent = null;
      try {
        const readRes = await fetch(`/api/files/read?path=${encodeURIComponent(path)}&limit=10000`);
        if (readRes.ok) {
          const readData = await readRes.json();
          oldContent = readData.content;
        }
      } catch { /* file doesn't exist yet — that's fine */ }

      const res = await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Write failed: ${res.status}`);
      }
      const data = await res.json();

      // Generate diff for the Spotlight/Messages preview
      const isNew = oldContent == null;
      const diff = isNew ? null : simpleDiff(oldContent, content, data.path);
      const diffSummary = isNew
        ? `Created ${data.path} (${data.bytes} bytes)`
        : `Updated ${data.path} (${data.bytes} bytes)`;
      safeNotify({ title: '✏️ File written', body: diffSummary });
      return { ...data, oldContent, isNew, diff };
    });
  },
};
registerCapability(codeWriteFile);

// ═══════════════════════════════════════════════════════════════
// PROVIDERS: game.* — Game Autoplay Bridge (Phase 4 prep)
// ═══════════════════════════════════════════════════════════════
//
// Capabilities that let the AI interact with running game instances.
// Each game exports getState() and makeMove() — the capabilities
// just dispatch to the right game.

// Lazy imports — games aren't loaded until actually needed
async function getGameModule(gameId) {
  const modules = {
    snake: () => import('../apps/snake.js'),
    chess: () => import('../apps/chess.js'),
    '2048': () => import('../apps/2048.js'),
  };
  const loader = modules[gameId];
  if (!loader) return null;
  return loader();
}

const gameGetState = {
  id: 'game.getState',
  verb: 'find',
  target: '*',
  level: LEVEL.OBSERVE,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Get the current state of a running game',
  estimateCost: () => ({ timeMs: 10, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const gameId = args.game || args.name || args._intent?.target || '';
      const mod = await getGameModule(gameId);
      if (!mod) throw new Error(`Unknown game: ${gameId}. Available: snake, chess, 2048`);
      const getter = {
        snake: mod.getSnakeState,
        chess: mod.getChessState,
        '2048': mod.get2048State,
      }[gameId];
      if (!getter) throw new Error(`No getState for ${gameId}`);
      const state = getter();
      if (!state) throw new Error(`${gameId} is not currently running — open it first`);
      return { game: gameId, ...state };
    });
  },
};
registerCapability(gameGetState);

const gameMakeMove = {
  id: 'game.makeMove',
  verb: 'play',
  target: '*',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Make a move in a running game',
  estimateCost: () => ({ timeMs: 10, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const gameId = args.game || args.name || args._intent?.target || '';
      const mod = await getGameModule(gameId);
      if (!mod) throw new Error(`Unknown game: ${gameId}. Available: snake, chess, 2048`);
      if (gameId === 'snake') {
        const dir = args.direction || args.move || args._rawArgs || '';
        return mod.makeSnakeMove(dir);
      } else if (gameId === 'chess') {
        const { fromR, fromC, toR, toC } = args;
        if (fromR == null || fromC == null || toR == null || toC == null) {
          throw new Error('Chess move requires fromR, fromC, toR, toC');
        }
        return mod.makeChessMove(fromR, fromC, toR, toC);
      } else if (gameId === '2048') {
        const dir = args.direction || args.move || args._rawArgs || '';
        return mod.make2048Move(dir);
      }
      throw new Error(`No makeMove for ${gameId}`);
    });
  },
};
registerCapability(gameMakeMove);

const gameAutoplay = {
  id: 'game.autoplay',
  verb: 'play',
  target: '*',
  level: LEVEL.SANDBOX,
  reversibility: REVERSIBILITY.FREE,
  blastRadius: BLAST_RADIUS.NONE,
  summary: 'Start AI autoplay for a game (snake/2048)',
  estimateCost: () => ({ timeMs: 100, irreversibilityTokens: 0 }),
  execute: async function(args) {
    return runCapability(this, args, async () => {
      const gameId = args.game || args.name || args._intent?.target || 'snake';
      if (gameId !== 'snake' && gameId !== '2048') {
        throw new Error(`Autoplay only supported for snake and 2048 (chess needs a real engine)`);
      }

      // Launch the game if not running
      if (!processManager.isRunning(gameId)) {
        processManager.launch(gameId);
        await new Promise(r => setTimeout(r, 300)); // let it mount
      }

      const mod = await getGameModule(gameId);
      if (!mod) throw new Error(`Could not load ${gameId} module`);

      // Simple autoplay loop — runs for up to 200 ticks or until game over
      const MAX_TICKS = 200;
      let ticks = 0;

      if (gameId === 'snake') {
        const autoInterval = setInterval(() => {
          const state = mod.getSnakeState();
          if (!state || !state.alive || ticks >= MAX_TICKS) {
            clearInterval(autoInterval);
            safeNotify({
              title: '🐍 Autoplay finished',
              body: `Score: ${state?.score || 0} in ${ticks} moves`,
            });
            return;
          }
          // Simple greedy strategy: move toward the food, avoid walls and self
          const { snake, dir, food, width, height } = state;
          const head = snake[0];
          const dirs = [
            { name: 'up', x: 0, y: -1 },
            { name: 'down', x: 0, y: 1 },
            { name: 'left', x: -1, y: 0 },
            { name: 'right', x: 1, y: 0 },
          ];
          // Filter out reverse direction
          const validDirs = dirs.filter(d => !(d.x === -dir.x && d.y === -dir.y));
          // Score each direction: prefer moves toward food that don't hit walls/snake
          const scored = validDirs.map(d => {
            const nx = head.x + d.x, ny = head.y + d.y;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) return { ...d, score: -100 };
            if (snake.some(s => s.x === nx && s.y === ny)) return { ...d, score: -100 };
            const dist = Math.abs(nx - food.x) + Math.abs(ny - food.y);
            return { ...d, score: -dist };
          });
          scored.sort((a, b) => b.score - a.score);
          if (scored[0] && scored[0].score > -100) {
            mod.makeSnakeMove(scored[0].name);
          }
          ticks++;
        }, 130); // Slightly slower than game tick (120ms)
      } else if (gameId === '2048') {
        // Simple 2048 strategy: cycle through left, down, left, down, right, up
        const moves = ['left', 'down', 'left', 'down', 'right', 'up'];
        let mi = 0;
        const autoInterval = setInterval(() => {
          const state = mod.get2048State();
          if (!state || state.gameOver || ticks >= MAX_TICKS) {
            clearInterval(autoInterval);
            safeNotify({
              title: '🎲 Autoplay finished',
              body: `Score: ${state?.score || 0} in ${ticks} moves`,
            });
            return;
          }
          const result = mod.make2048Move(moves[mi % moves.length]);
          if (!result.moved) mi++; // try next direction if current didn't move
          else mi = 0; // reset cycle on successful move
          ticks++;
        }, 200);
      }

      safeNotify({ title: `🤖 Autoplay started`, body: `Playing ${gameId}...` });
      return { game: gameId, autoplay: true, maxTicks: MAX_TICKS };
    });
  },
};
registerCapability(gameAutoplay);

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
  'spec.generate',
  'spec.freeze',
  'tests.generate',
  'tests.run',
  'code.generate',
  'app.bundle',
  'app.promote',
  'app.archive',
  'branch.create',
  'branch.merge',
  'branch.discard',
  'branch.rewind',
  'browser.navigate',
  'volume.set',
  'volume.decrease',
  'volume.mute',
  'volume.unmute',
  'translate.text',
  'screenshot.take',
  'files.createFolder',
  'files.createFile',
  'chat.sendAsAgent',
  'code.readFile',
  'code.listDir',
  'code.search',
  'code.writeFile',
  'game.getState',
  'game.makeMove',
  'game.autoplay',
  'system.lock',
  'system.shutdown',
  'system.restart',
  'system.sleep',
];

// Path-resolution sanity check — runs only on localhost, at import time.
// Catches regressions in the alias map + isPathWithinRoots guard.
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const pathTests = [
    { in: 'Desktop',     expect: '/Desktop' },
    { in: 'my documents', expect: '/Documents' },
    { in: 'downloads folder', expect: '/Downloads' },
    { in: '/Desktop',    expect: '/Desktop' },
    { in: '/Desktop/',   expect: '/Desktop' },
    { in: 'Photos',      expect: '/Pictures' },
  ];
  let pfail = 0;
  for (const t of pathTests) {
    const got = resolveVfsPath(t.in);
    if (got !== t.expect) {
      console.warn('[capability-providers] path-resolve FAIL:', JSON.stringify(t.in), '→', got, 'expected', t.expect);
      pfail++;
    }
  }
  const rootTests = [
    { in: '/Desktop/Projects', expect: true },
    { in: '/etc/passwd',       expect: false },
    { in: '/Desktop/../etc',   expect: false },
    { in: '/Music/song.mp3',   expect: true },
  ];
  for (const t of rootTests) {
    const got = isPathWithinRoots(t.in);
    if (got !== t.expect) {
      console.warn('[capability-providers] root-guard FAIL:', t.in, '→', got, 'expected', t.expect);
      pfail++;
    }
  }
  if (pfail === 0) {
    console.log(`[capability-providers] path sanity: ${pathTests.length + rootTests.length}/${pathTests.length + rootTests.length} pass`);
  }
}

console.log(`[capability-providers] Registered ${CORE_CAPABILITIES.length} core capabilities`);
