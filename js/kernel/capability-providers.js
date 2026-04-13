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
      const offset = parseInt(args.offset) || 0;
      const limit = parseInt(args.limit) || 100;
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
  'files.createFolder',
  'files.createFile',
  'chat.sendAsAgent',
  'code.readFile',
  'code.listDir',
  'code.search',
  'code.writeFile',
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
