// Astrion OS — Intent Parser (M1.P1 — full version)
//
// The heart of the Intent Kernel. Converts natural-language queries into
// structured intent objects that the Capability Provider layer (M1.P2) can
// actually execute.
//
// Design goals:
//   1. Recognize ~30 verbs and ~40 target types.
//   2. Extract arguments via preposition patterns (called X, with X, about X,
//      from X to Y, on X, at X, before X, after X).
//   3. Return confidence score + alternative interpretations.
//   4. Pure function — no side effects, no state, safe to call on every
//      keystroke.
//   5. Fast — under 2ms per parse for typical queries.
//
// Example:
//   parseIntent("create a note called shopping with items apples bread milk")
//   → {
//       verb: 'make',
//       target: 'note',
//       args: {
//         name: 'shopping',
//         items: ['apples', 'bread', 'milk'],
//         _raw: 'with items apples bread milk'
//       },
//       confidence: 0.92,
//       raw: 'create a note called shopping with items apples bread milk',
//       parsedAt: <epoch ms>,
//       alternatives: [],
//     }

// ═══════════════════════════════════════════════════════════════
// CANONICAL VERBS + SYNONYMS
// ═══════════════════════════════════════════════════════════════

/**
 * Every canonical verb maps to a list of synonyms (including itself).
 * The parser walks the first 2-3 tokens of the query looking for any
 * match, then collapses to the canonical verb.
 */
export const VERB_SYNONYMS = {
  make:      ['make', 'create', 'new', 'add', 'build', 'generate', 'draft', 'write', 'take', 'capture'],
  find:      ['find', 'search', 'lookup', 'locate', 'list', 'show', 'get', 'see'],
  open:      ['open', 'launch', 'start', 'run', 'fire', 'boot'],
  close:     ['close', 'quit', 'exit', 'kill', 'stop', 'end'],
  edit:      ['edit', 'modify', 'change', 'update', 'tweak', 'fix', 'rename'],
  delete:    ['delete', 'remove', 'trash', 'erase', 'destroy'],
  move:      ['move', 'relocate', 'transfer'],
  copy:      ['copy', 'duplicate', 'clone'],
  send:      ['send', 'message', 'text', 'email', 'dm'],
  install:   ['install', 'setup', 'get'],
  uninstall: ['uninstall', 'remove'],
  play:      ['play', 'listen', 'watch', 'resume'],
  pause:     ['pause', 'halt'],
  schedule:  ['schedule', 'plan', 'book'],
  remind:    ['remind', 'remember', 'notify'],
  translate: ['translate'],
  convert:   ['convert'],
  compute:   ['compute', 'calculate', 'calc', 'math'],
  explain:   ['explain', 'define', 'describe', 'what'],
  summarize: ['summarize', 'summary', 'tldr', 'sum'],
  ask:       ['ask', 'tell', 'answer', 'why', 'how'],
  navigate:  ['navigate', 'go', 'visit', 'browse'],
  save:      ['save', 'store', 'keep'],
  share:     ['share'],
  download:  ['download', 'dl', 'save'],
  upload:    ['upload'],
  print:     ['print'],
  toggle:    ['toggle', 'switch', 'flip'],
  increase:  ['increase', 'raise', 'up', 'louder', 'brighter'],
  decrease:  ['decrease', 'lower', 'down', 'quieter', 'dimmer'],
  mute:      ['mute', 'silence'],
  unmute:    ['unmute'],
};

// Flat lookup: word → canonical verb
const VERB_LOOKUP = {};
for (const [canonical, synonyms] of Object.entries(VERB_SYNONYMS)) {
  for (const syn of synonyms) {
    if (!VERB_LOOKUP[syn]) VERB_LOOKUP[syn] = [];
    VERB_LOOKUP[syn].push(canonical);
  }
}

// ═══════════════════════════════════════════════════════════════
// CANONICAL TARGETS + SYNONYMS
// ═══════════════════════════════════════════════════════════════

/**
 * Every canonical target maps to a list of synonyms/aliases.
 * The parser looks for any of these after the verb.
 */
export const TARGET_SYNONYMS = {
  note:        ['note', 'notes'],
  file:        ['file', 'files', 'document', 'doc'],
  folder:      ['folder', 'folders', 'directory', 'dir'],
  todo:        ['todo', 'todos', 'task', 'tasks'],
  reminder:    ['reminder', 'reminders'],
  event:       ['event', 'events', 'meeting', 'appointment'],
  email:       ['email', 'emails', 'mail'],
  message:     ['message', 'messages', 'text', 'dm'],
  contact:     ['contact', 'contacts', 'person', 'friend'],
  photo:       ['photo', 'photos', 'image', 'picture'],
  song:        ['song', 'music', 'track', 'album', 'playlist'],
  video:       ['video', 'movie', 'film', 'clip'],
  app:         ['app', 'apps', 'application', 'program'],
  setting:     ['setting', 'settings', 'preference'],
  tab:         ['tab', 'tabs'],
  window:      ['window', 'windows'],
  bookmark:    ['bookmark', 'bookmarks', 'favorite'],
  password:    ['password', 'passwords', 'pwd', 'credential'],
  clipboard:   ['clipboard', 'clip'],
  timer:       ['timer', 'timers'],
  alarm:       ['alarm', 'alarms'],
  calculator:  ['calculator', 'calc'],
  weather:     ['weather', 'forecast'],
  calendar:    ['calendar'],
  terminal:    ['terminal', 'shell', 'console', 'cmd'],
  browser:     ['browser', 'web'],
  editor:      ['editor', 'code'],
  vault:       ['vault'],
  trash:       ['trash', 'bin', 'recycle'],
  finder:      ['finder', 'files'],
  draw:        ['draw', 'drawing', 'paint'],
  volume:      ['volume', 'sound', 'audio'],
  brightness:  ['brightness', 'screen'],
  wifi:        ['wifi', 'wi-fi', 'network'],
  bluetooth:   ['bluetooth', 'bt'],
  notification:['notification', 'notifications', 'notifs'],
  screenshot:  ['screenshot', 'screen', 'capture'],
  word:        ['word', 'definition', 'meaning'],
  url:         ['url', 'link', 'site', 'website', 'page'],
  chess:       ['chess'],
  snake:       ['snake'],
};

const TARGET_LOOKUP = {};
for (const [canonical, synonyms] of Object.entries(TARGET_SYNONYMS)) {
  for (const syn of synonyms) {
    if (!TARGET_LOOKUP[syn]) TARGET_LOOKUP[syn] = [];
    TARGET_LOOKUP[syn].push(canonical);
  }
}

// ═══════════════════════════════════════════════════════════════
// STOP WORDS + PREPOSITIONS
// ═══════════════════════════════════════════════════════════════

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'some', 'any', 'this', 'that',
  'please', 'pls', 'could', 'would', 'can', 'will', 'just',
  'to', 'from',
]);

// Preposition-based argument extractors. Each extractor looks for a
// pattern and returns an { key, value } pair if it matches.
const ARG_EXTRACTORS = [
  {
    key: 'name',
    regex: /(?:called|named|titled)\s+"?([^"]+?)"?(?:\s+(?:with|about|from|to|in|on|at|before|after)|$)/i,
  },
  {
    key: 'topic',
    regex: /about\s+"?([^"]+?)"?(?:\s+(?:with|from|to|in|on|at)|$)/i,
  },
  {
    key: 'from',
    regex: /from\s+"?([^"]+?)"?(?:\s+(?:to|with|about|on|at)|$)/i,
  },
  {
    key: 'to',
    regex: /\bto\s+"?([^"]+?)"?(?:\s+(?:from|with|about|on|at)|$)/i,
  },
  {
    key: 'destination',
    regex: /into\s+"?([^"]+?)"?(?:\s|$)/i,
  },
  {
    key: 'location',
    regex: /\bin\s+"?([^"]+?)"?(?:\s+(?:on|at|with|from|to)|$)/i,
  },
  {
    key: 'when',
    regex: /\b(?:on|at)\s+"?([^"]+?)"?(?:\s+(?:with|from|to)|$)/i,
  },
  {
    key: 'before',
    regex: /\bbefore\s+"?([^"]+?)"?(?:\s|$)/i,
  },
  {
    key: 'after',
    regex: /\bafter\s+"?([^"]+?)"?(?:\s|$)/i,
  },
];

/**
 * Extract `items` from "with items A, B, and C" or "with A B C" patterns.
 */
function extractItems(text) {
  if (!text) return null;
  // Look for "with items <...>" or "with <...>"
  const itemsMatch = text.match(/with\s+(?:items\s+)?([^]+?)(?:\s+(?:called|named|titled|about|from|to|in|on|at|before|after)|$)/i);
  if (!itemsMatch) return null;
  const raw = itemsMatch[1].trim();
  // Split on commas, " and ", or whitespace if it looks like a list
  let items;
  if (/[,]/.test(raw)) {
    items = raw.split(/\s*,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean);
  } else if (/\s+and\s+/.test(raw)) {
    items = raw.split(/\s+and\s+/).map(s => s.trim()).filter(Boolean);
  } else {
    // Space-separated words — only use if there are 2-5 short words
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 5 && words.every(w => w.length < 16)) {
      items = words;
    }
  }
  return items && items.length > 0 ? items : null;
}

/**
 * Extract `url` if the query contains what looks like a URL.
 */
function extractUrl(text) {
  if (!text) return null;
  const urlMatch = text.match(/\b(https?:\/\/[^\s]+|[a-z0-9-]+\.(?:com|net|org|io|dev|app|xyz|co|ai|gg|tv|me)[^\s]*)/i);
  return urlMatch ? urlMatch[0] : null;
}

/**
 * Extract numbers — useful for volume/brightness/count intents.
 */
function extractNumber(text) {
  if (!text) return null;
  const n = text.match(/\b(\d+(?:\.\d+)?)\s*(%|percent)?/);
  return n ? parseFloat(n[1]) : null;
}

// ═══════════════════════════════════════════════════════════════
// CORE PARSER
// ═══════════════════════════════════════════════════════════════

/**
 * Parse a natural-language query into a structured intent.
 * @param {string} query
 * @returns {Intent | null}
 */
export function parseIntent(query) {
  if (!query || typeof query !== 'string') return null;

  const raw = query.trim();
  if (!raw) return null;

  const lowered = raw.toLowerCase();
  const words = lowered.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  // ─── Find the verb ───
  // Scan the first 3 tokens for any verb synonym (skipping stop words).
  let verbIdx = -1;
  let verb = null;
  let verbCandidates = [];
  for (let i = 0; i < Math.min(4, words.length); i++) {
    const w = words[i];
    if (STOP_WORDS.has(w)) continue;
    const canonicals = VERB_LOOKUP[w];
    if (canonicals) {
      verbIdx = i;
      verb = canonicals[0]; // primary interpretation
      verbCandidates = canonicals;
      break;
    }
  }

  // Special-case: math queries like "5 + 3" or "what is 5 * 17"
  if (!verb && /^[^a-z]*\d[\d\s+\-*/().%^]*[\d)]\s*$/.test(lowered)) {
    return {
      verb: 'compute',
      target: 'calculator',
      args: { expression: raw.replace(/^(what is|calculate|compute|calc)\s+/i, '').trim() },
      confidence: 0.88,
      raw,
      parsedAt: Date.now(),
      alternatives: [],
    };
  }

  if (!verb) return null;

  // ─── Find the target ───
  let targetIdx = -1;
  let target = null;
  let targetCandidates = [];
  for (let i = verbIdx + 1; i < words.length; i++) {
    const w = words[i];
    if (STOP_WORDS.has(w)) continue;
    const canonicals = TARGET_LOOKUP[w];
    if (canonicals) {
      targetIdx = i;
      target = canonicals[0];
      targetCandidates = canonicals;
      break;
    }
  }

  // Verb without a target — acceptable for some verbs like "compute 5+3",
  // "explain recursion", or "navigate to github.com" where the target is
  // implicit or free-form.
  if (!target) {
    const VERB_WITHOUT_TARGET = new Set([
      'compute', 'explain', 'translate', 'summarize', 'ask',
      'mute', 'unmute', 'navigate', 'download', 'upload',
    ]);
    if (!VERB_WITHOUT_TARGET.has(verb)) {
      return null;
    }
  }

  // ─── Extract arguments ───
  const argsPortion = words.slice(targetIdx >= 0 ? targetIdx + 1 : verbIdx + 1).join(' ');
  const args = extractArgs(verb, target, argsPortion, raw);

  // ─── Confidence scoring ───
  let confidence = 0.5;
  if (verb) confidence += 0.2;
  if (target) confidence += 0.2;
  if (Object.keys(args).filter(k => !k.startsWith('_')).length > 0) confidence += 0.15;
  if (verbCandidates.length === 1) confidence += 0.03; // unambiguous verb
  if (targetCandidates.length === 1) confidence += 0.02; // unambiguous target
  // Penalty for very short queries (usually incomplete)
  if (words.length < 2) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  // ─── Build alternative interpretations ───
  // If verb/target had multiple canonicals, surface them.
  const alternatives = [];
  if (verbCandidates.length > 1) {
    for (const alt of verbCandidates.slice(1)) {
      alternatives.push({ verb: alt, target, args, confidence: confidence - 0.1 });
    }
  }

  return {
    verb,
    target,
    args,
    confidence,
    raw,
    parsedAt: Date.now(),
    alternatives,
  };
}

// ═══════════════════════════════════════════════════════════════
// ARGUMENT EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractArgs(verb, target, argsText, fullRaw) {
  const args = {};
  if (argsText) args._rawArgs = argsText;

  // For explain/summarize/ask/translate with no explicit topic-via-preposition,
  // treat the rest of the query as the topic/text.
  if (['explain', 'summarize', 'ask'].includes(verb) && argsText) {
    args.topic = argsText.replace(/^(about\s+)/i, '').trim();
  }

  // Run all preposition extractors
  for (const { key, regex } of ARG_EXTRACTORS) {
    if (args[key]) continue;
    const m = argsText.match(regex);
    if (m && m[1]) {
      args[key] = m[1].trim();
    }
  }

  // Items (for notes/todos/lists)
  const items = extractItems(argsText);
  if (items) args.items = items;

  // URL (for browser.navigate)
  const url = extractUrl(argsText);
  if (url) args.url = url;

  // Number (for volume/brightness)
  if (['increase', 'decrease', 'volume', 'brightness'].includes(verb) ||
      target === 'volume' || target === 'brightness') {
    const n = extractNumber(argsText);
    if (n != null) args.level = n;
  }

  // Compute expression
  if (verb === 'compute') {
    args.expression = argsText
      .replace(/^(what is|calculate|compute|calc)\s+/i, '')
      .trim() || fullRaw.replace(/^(compute|calculate|calc|what is)\s+/i, '').trim();
  }

  // Translate text
  if (verb === 'translate') {
    // "translate <text> to <lang>"
    const m = argsText.match(/^(.+?)\s+to\s+(.+)$/i);
    if (m) {
      args.text = m[1].trim();
      args.toLang = m[2].trim();
    } else {
      args.text = argsText;
    }
  }

  return args;
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY + DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Format an intent as a human-readable summary for Spotlight display.
 * @param {Intent} intent
 * @returns {string}
 */
export function summarizeIntent(intent) {
  if (!intent) return '';
  const confPct = Math.round(intent.confidence * 100);
  const argParts = Object.entries(intent.args)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}=[${v.join(', ')}]`;
      if (typeof v === 'string' && v.length > 30) return `${k}="${v.slice(0, 27)}…"`;
      return `${k}=${typeof v === 'string' ? `"${v}"` : v}`;
    });
  const argsStr = argParts.length ? ` { ${argParts.join(', ')} }` : '';
  const targetStr = intent.target ? ` ${intent.target}` : '';
  return `${intent.verb}${targetStr}${argsStr} (${confPct}%)`;
}

/**
 * Turn an intent into a short, human-friendly one-liner describing what
 * will happen — used for Socratic confirmation prompts in M6.
 * @param {Intent} intent
 * @returns {string}
 */
export function intentToNaturalLanguage(intent) {
  if (!intent) return '';
  const { verb, target, args } = intent;
  const niceName = args.name ? `"${args.name}"` : '';
  const niceItems = args.items ? ` with ${args.items.join(', ')}` : '';
  const niceTopic = args.topic ? ` about "${args.topic}"` : '';
  const niceUrl = args.url ? ` to ${args.url}` : '';

  switch (verb) {
    case 'make':
      return `Create a new ${target}${niceName ? ' ' + niceName : ''}${niceItems}`;
    case 'find':
      return `Find ${target ? target + 's' : 'something'}${niceTopic}`;
    case 'open':
      return `Open ${target}${niceName ? ' ' + niceName : ''}${niceUrl}`;
    case 'close':
      return `Close ${target}`;
    case 'delete':
      return `⚠️ Delete ${target}${niceName ? ' ' + niceName : ''}`;
    case 'edit':
      return `Edit ${target}${niceName ? ' ' + niceName : ''}`;
    case 'compute':
      return `Calculate ${args.expression || '…'}`;
    case 'navigate':
      return `Go to ${args.url || target}`;
    case 'translate':
      return `Translate "${args.text}"${args.toLang ? ' to ' + args.toLang : ''}`;
    case 'summarize':
      return `Summarize ${target || 'this'}`;
    case 'explain':
      return `Explain ${target || args.topic || '…'}`;
    case 'ask':
      return `Ask the AI: "${intent.raw}"`;
    case 'remind':
      return `Set a reminder${args.when ? ' for ' + args.when : ''}${niceName ? ' about ' + niceName : ''}`;
    case 'schedule':
      return `Schedule ${target || 'an event'}${args.when ? ' for ' + args.when : ''}`;
    case 'play':
      return `Play ${niceName || target || 'music'}`;
    case 'mute':
      return `Mute audio`;
    case 'unmute':
      return `Unmute audio`;
    case 'increase':
      return `Increase ${target || 'volume'}${args.level != null ? ' to ' + args.level + '%' : ''}`;
    case 'decrease':
      return `Decrease ${target || 'volume'}${args.level != null ? ' to ' + args.level + '%' : ''}`;
    default:
      return `${verb} ${target || ''}`.trim();
  }
}

/**
 * Return the list of verbs + targets the parser recognizes — useful
 * for showing a "what can I say?" cheat sheet in Spotlight.
 */
export function listKnownIntents() {
  return {
    verbs: Object.keys(VERB_SYNONYMS),
    targets: Object.keys(TARGET_SYNONYMS),
  };
}

// ═══════════════════════════════════════════════════════════════
// INLINE SANITY TESTS
// ═══════════════════════════════════════════════════════════════
//
// Runs at import time in localhost dev. Catches regressions when
// expanding verbs/targets/patterns.

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const tests = [
    { input: 'make a note called shopping', expect: { verb: 'make', target: 'note' } },
    { input: 'create a new todo called homework', expect: { verb: 'make', target: 'todo' } },
    { input: 'find notes about school', expect: { verb: 'find', target: 'note' } },
    { input: 'open terminal', expect: { verb: 'open', target: 'terminal' } },
    { input: 'launch the browser', expect: { verb: 'open', target: 'browser' } },
    { input: 'close all windows', expect: { verb: 'close', target: 'window' } },
    { input: 'delete the file report.txt', expect: { verb: 'delete', target: 'file' } },
    { input: 'compute 5 + 3 * 2', expect: { verb: 'compute' } },
    { input: '5 + 3', expect: { verb: 'compute' } },
    { input: 'what is 42 * 17', expect: { verb: 'compute' } },
    { input: 'translate hello to spanish', expect: { verb: 'translate' } },
    { input: 'mute', expect: { verb: 'mute' } },
    { input: 'navigate to github.com', expect: { verb: 'navigate' } },
    { input: 'explain recursion', expect: { verb: 'explain' } },
    { input: 'summarize this page', expect: { verb: 'summarize' } },
    { input: 'increase volume to 80', expect: { verb: 'increase', target: 'volume' } },
    { input: 'take a screenshot', expect: { verb: 'make', target: 'screenshot' } },
    { input: 'random text that is not an intent', expect: null },
    { input: '', expect: null },
  ];

  let failures = 0;
  for (const t of tests) {
    const result = parseIntent(t.input);
    if (t.expect === null) {
      if (result !== null) {
        console.warn('[intent-parser] expected null, got:', t.input, '→', result);
        failures++;
      }
    } else {
      if (!result) {
        console.warn('[intent-parser] expected match, got null:', t.input);
        failures++;
        continue;
      }
      if (t.expect.verb && result.verb !== t.expect.verb) {
        console.warn('[intent-parser] wrong verb:', t.input, 'expected', t.expect.verb, 'got', result.verb);
        failures++;
      }
      if (t.expect.target && result.target !== t.expect.target) {
        console.warn('[intent-parser] wrong target:', t.input, 'expected', t.expect.target, 'got', result.target);
        failures++;
      }
    }
  }
  if (failures === 0) {
    console.log(`[intent-parser] all ${tests.length} sanity tests pass`);
  } else {
    console.warn(`[intent-parser] ${failures}/${tests.length} sanity tests FAILED`);
  }
}

/**
 * @typedef {object} Intent
 * @property {string} verb - canonical verb
 * @property {string|null} target - canonical target
 * @property {object} args - extracted args (name, items, url, topic, etc.)
 * @property {number} confidence - 0..1
 * @property {string} raw - original query
 * @property {number} parsedAt - epoch ms
 * @property {Intent[]} alternatives - other likely interpretations
 */
