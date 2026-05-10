// Astrion OS — Graph Learner
//
// Five graph-adaptation features that all share the same pattern: watch
// note/todo/calendar content, extract structure, write graph edges,
// log via Adaptation Engine (GRAPH category) so each one is revertable.
//
//   #5  Noun binding ("the Monday meeting" → calendar event id)
//   #6  Auto-link cross-app (note mentions a date → link to calendar)
//   #10 Domain vocabulary (proper nouns → person/place/project nodes)
//   #12 Project clustering (todos sharing keywords → project group)
//   #15 Auto-tag notes (extract topic tags from content)
//
// The detection here is intentionally simple — pattern-matching, not
// AI inference. A future iteration can swap any of these for a real
// model call. The point of v1 is to land the loop: detect → propose
// or apply → log → revert.

import { eventBus } from './event-bus.js';
import {
  recordAdaptation,
  registerRevertHandler,
  getBoldness,
  getBudgetRemaining,
  CATEGORY,
  BOLDNESS,
} from './adaptation-engine.js';

const NOUNS_KEY        = 'astrion-noun-bindings-v1';
const TAGS_KEY         = 'astrion-auto-tags-v1';
const PROJECTS_KEY     = 'astrion-project-clusters-v1';
const VOCAB_KEY        = 'astrion-domain-vocab-v1';
const LINKS_KEY        = 'astrion-cross-links-v1';

function loadJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

let initialized = false;

// ─── #5 Noun binding ──────────────────────────────────────────────

/** Bind a noun phrase ("the Monday meeting") to a graph reference. */
export async function bindNoun(phrase, ref, opts = {}) {
  if (!phrase || !ref) return { ok: false, error: 'phrase + ref required' };
  if (getBudgetRemaining(CATEGORY.ALIAS) <= 0) return { ok: false, error: 'alias budget exhausted' };
  const bindings = loadJson(NOUNS_KEY, {});
  bindings[String(phrase).toLowerCase()] = { ref, addedAt: Date.now() };
  saveJson(NOUNS_KEY, bindings);
  return recordAdaptation({
    category: CATEGORY.ALIAS,
    summary: `Bound "${phrase}" → ${typeof ref === 'string' ? ref : JSON.stringify(ref).slice(0, 40)}`,
    trigger: opts.trigger || 'User-taught',
    revert: { kind: 'noun:unbind', args: { phrase: String(phrase).toLowerCase() } },
  });
}

export function resolveNoun(phrase) {
  return loadJson(NOUNS_KEY, {})[String(phrase || '').toLowerCase()]?.ref;
}

export function listNounBindings() { return loadJson(NOUNS_KEY, {}); }

function revertNounBinding(args) {
  if (!args?.phrase) return;
  const b = loadJson(NOUNS_KEY, {});
  delete b[args.phrase];
  saveJson(NOUNS_KEY, b);
}

// ─── #15 Auto-tag notes ────────────────────────────────────────────

const STOPWORDS = new Set('a an the and or but if then so to of for in on at by with as is are was were be been being have has had do does did this that these those it its'.split(/\s+/));

function extractTags(text, max = 5) {
  if (!text || typeof text !== 'string') return [];
  const counts = new Map();
  const re = /[A-Za-z][A-Za-z0-9'-]{2,}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const w = m[0].toLowerCase();
    if (STOPWORDS.has(w) || w.length < 4) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .filter(([, c]) => c >= 2)
    .map(([w]) => w);
}

async function maybeAutoTag(noteId, content) {
  if (!noteId || !content) return;
  if (getBudgetRemaining(CATEGORY.GRAPH) <= 0) return;
  const tags = extractTags(content, 4);
  if (tags.length === 0) return;
  const all = loadJson(TAGS_KEY, {});
  const prev = all[noteId] || [];
  const fresh = tags.filter(t => !prev.includes(t));
  if (fresh.length === 0) return;
  all[noteId] = [...prev, ...fresh];
  saveJson(TAGS_KEY, all);
  if (getBoldness(CATEGORY.GRAPH) === BOLDNESS.HIGH) {
    await recordAdaptation({
      category: CATEGORY.GRAPH,
      summary: `Auto-tagged note "${noteId}" with: ${fresh.join(', ')}`,
      trigger: 'Frequent terms in note content',
      silent: true,
      revert: { kind: 'tags:remove', args: { noteId, tags: fresh } },
    });
  } else {
    eventBus.emit('graph-learner:tag-proposal', { noteId, tags: fresh });
  }
}

export function getAutoTags(noteId) { return loadJson(TAGS_KEY, {})[noteId] || []; }

function revertTags(args) {
  if (!args?.noteId) return;
  const all = loadJson(TAGS_KEY, {});
  const remaining = (all[args.noteId] || []).filter(t => !(args.tags || []).includes(t));
  if (remaining.length === 0) delete all[args.noteId];
  else all[args.noteId] = remaining;
  saveJson(TAGS_KEY, all);
}

// ─── #10 Domain vocabulary ─────────────────────────────────────────

const PROPER_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;

async function maybeExtractVocab(noteId, content) {
  if (!content || typeof content !== 'string') return;
  if (getBudgetRemaining(CATEGORY.GRAPH) <= 0) return;
  const found = new Set();
  let m;
  while ((m = PROPER_RE.exec(content)) !== null) {
    const phrase = m[1].trim();
    if (phrase.length < 3) continue;
    if (STOPWORDS.has(phrase.toLowerCase())) continue;
    found.add(phrase);
  }
  if (found.size === 0) return;
  const vocab = loadJson(VOCAB_KEY, {});
  const newPhrases = [...found].filter(p => !vocab[p]);
  if (newPhrases.length === 0) return;
  for (const p of newPhrases) vocab[p] = { addedAt: Date.now(), source: noteId };
  saveJson(VOCAB_KEY, vocab);
  await recordAdaptation({
    category: CATEGORY.GRAPH,
    summary: `Learned ${newPhrases.length} new term${newPhrases.length === 1 ? '' : 's'}: ${newPhrases.slice(0, 3).join(', ')}${newPhrases.length > 3 ? '…' : ''}`,
    trigger: `Extracted from "${noteId}"`,
    silent: true,
    revert: { kind: 'vocab:remove', args: { phrases: newPhrases } },
  });
}

export function listDomainVocab() { return loadJson(VOCAB_KEY, {}); }

function revertVocab(args) {
  if (!args?.phrases) return;
  const vocab = loadJson(VOCAB_KEY, {});
  for (const p of args.phrases) delete vocab[p];
  saveJson(VOCAB_KEY, vocab);
}

// ─── #6 Auto-link cross-app ────────────────────────────────────────

async function maybeAutoLink(noteId, content) {
  if (!content) return;
  if (getBudgetRemaining(CATEGORY.GRAPH) <= 0) return;
  // Match references to known noun bindings + proper nouns + dates.
  const refs = [];
  const bindings = loadJson(NOUNS_KEY, {});
  for (const phrase of Object.keys(bindings)) {
    if (content.toLowerCase().includes(phrase)) {
      refs.push({ phrase, ref: bindings[phrase].ref });
    }
  }
  if (refs.length === 0) return;
  const links = loadJson(LINKS_KEY, {});
  const prev = links[noteId] || [];
  const fresh = refs.filter(r => !prev.find(p => p.phrase === r.phrase));
  if (fresh.length === 0) return;
  links[noteId] = [...prev, ...fresh];
  saveJson(LINKS_KEY, links);
  await recordAdaptation({
    category: CATEGORY.GRAPH,
    summary: `Linked note "${noteId}" to ${fresh.length} reference${fresh.length === 1 ? '' : 's'}`,
    trigger: `Mentions: ${fresh.map(r => r.phrase).slice(0, 3).join(', ')}`,
    silent: true,
    revert: { kind: 'links:remove', args: { noteId, phrases: fresh.map(r => r.phrase) } },
  });
}

function revertLinks(args) {
  if (!args?.noteId) return;
  const links = loadJson(LINKS_KEY, {});
  const remaining = (links[args.noteId] || []).filter(p => !(args.phrases || []).includes(p.phrase));
  if (remaining.length === 0) delete links[args.noteId];
  else links[args.noteId] = remaining;
  saveJson(LINKS_KEY, links);
}

export function getCrossLinks(noteId) { return loadJson(LINKS_KEY, {})[noteId] || []; }

// ─── #12 Project clustering ────────────────────────────────────────

const KEYWORD_RE = /[A-Za-z][A-Za-z0-9_-]{2,}/g;

function extractKeywords(text) {
  const out = new Set();
  let m;
  while ((m = KEYWORD_RE.exec(String(text || ''))) !== null) {
    const w = m[0].toLowerCase();
    if (STOPWORDS.has(w) || w.length < 4) continue;
    out.add(w);
  }
  return out;
}

/** Recompute clusters from a list of items. Each item: { id, title?, content? }. */
export async function recomputeProjectClusters(items) {
  if (!Array.isArray(items)) return { ok: false, error: 'items array required' };
  if (getBudgetRemaining(CATEGORY.GRAPH) <= 0) return { ok: false, error: 'graph budget exhausted' };
  const keywordsByItem = new Map();
  for (const it of items) {
    const text = [it.title, it.content].filter(Boolean).join(' ');
    keywordsByItem.set(it.id, extractKeywords(text));
  }
  // Simple cluster: keywords that appear in 2+ items become anchors;
  // each item joins the cluster of its strongest anchor.
  const anchorCounts = new Map();
  for (const set of keywordsByItem.values()) {
    for (const w of set) anchorCounts.set(w, (anchorCounts.get(w) || 0) + 1);
  }
  const anchors = [...anchorCounts.entries()].filter(([, c]) => c >= 2).map(([w]) => w);
  const clusters = {};
  for (const a of anchors) clusters[a] = [];
  for (const [id, set] of keywordsByItem) {
    let bestAnchor = null;
    let bestScore = 0;
    for (const a of anchors) if (set.has(a)) { const score = anchorCounts.get(a) || 0; if (score > bestScore) { bestAnchor = a; bestScore = score; } }
    if (bestAnchor) clusters[bestAnchor].push(id);
  }
  // Drop empty clusters.
  for (const a of Object.keys(clusters)) if (clusters[a].length < 2) delete clusters[a];
  saveJson(PROJECTS_KEY, clusters);
  if (Object.keys(clusters).length === 0) return { ok: true, clusters: {} };
  await recordAdaptation({
    category: CATEGORY.GRAPH,
    summary: `Grouped ${items.length} items into ${Object.keys(clusters).length} project cluster${Object.keys(clusters).length === 1 ? '' : 's'}`,
    trigger: 'Shared keywords across notes / todos',
    silent: true,
    revert: { kind: 'projects:clear', args: {} },
  });
  return { ok: true, clusters };
}

export function listProjectClusters() { return loadJson(PROJECTS_KEY, {}); }

function revertProjects() {
  saveJson(PROJECTS_KEY, {});
}

// ─── Init ──────────────────────────────────────────────────────────

export function initGraphLearner() {
  registerRevertHandler('noun:unbind',   revertNounBinding);
  registerRevertHandler('tags:remove',   revertTags);
  registerRevertHandler('vocab:remove',  revertVocab);
  registerRevertHandler('links:remove',  revertLinks);
  registerRevertHandler('projects:clear', revertProjects);
  if (initialized) return;
  initialized = true;
  // graph-store emits these — filter for note nodes. We deliberately
  // watch the canonical graph events instead of asking each note-style
  // app to emit a custom 'note:created' (which would mean N integration
  // points instead of one).
  const onGraphNode = ({ node }) => {
    if (!node || node.type !== 'note') return;
    const id = node.id;
    const content = (node.props && node.props.content) || '';
    if (!id || !content) return;
    maybeAutoTag(id, content).catch(() => {});
    maybeExtractVocab(id, content).catch(() => {});
    maybeAutoLink(id, content).catch(() => {});
  };
  eventBus.on('graph:node:created', onGraphNode);
  eventBus.on('graph:node:updated', onGraphNode);
}

// ─── Test helpers ─────────────────────────────────────────────────

export function _resetForTests() {
  initialized = false;
  for (const k of [NOUNS_KEY, TAGS_KEY, PROJECTS_KEY, VOCAB_KEY, LINKS_KEY]) {
    try { localStorage.removeItem(k); } catch {}
  }
}

export const _internal = {
  extractTags,
  extractKeywords,
  maybeAutoTag,
  maybeExtractVocab,
  maybeAutoLink,
};
