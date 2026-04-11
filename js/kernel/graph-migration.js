// Astrion OS — LocalStorage → Graph Migration (M2.P3)
//
// One-shot boot-time migrator that walks known legacy localStorage keys
// (nova-notes, nova-todos, nova-reminders) and converts each item into
// a typed graph node. Flagged via `astrion-graph-migrated-v1` in
// localStorage so it only runs once per user.
//
// Day 4 consumers (Notes/Todo/Reminders) read from the graph going
// forward. Legacy localStorage is preserved as a read-only backup for
// post-mortem and manual recovery; it is NOT kept in sync with the graph.
//
// SHAPE DECISIONS:
// - note: preserves { title, content, date, legacyId } in props. Notes.js
//   uses multi-line content with title derived from first line, but the
//   legacy key stores a separate title field; we carry both.
// - todo: { text, done, legacyIndex } — legacyIndex preserves insertion
//   order so Day 4 can orderBy it until real createdAt semantics take over.
// - reminder: { text, done, list, legacyIndex } — the legacy shape is
//   nested by list ({ 'Today': [...], 'Personal': [...] }); we flatten by
//   promoting list name to a prop. Day 4 queries with where.list === X.

import { graphStore } from './graph-store.js';

const FLAG_KEY = 'astrion-graph-migrated-v1';

// --- per-type migrators ---

async function migrateNotes() {
  const raw = JSON.parse(localStorage.getItem('nova-notes') || '[]');
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (const n of raw) {
    if (!n || typeof n !== 'object') continue;
    const title = typeof n.title === 'string' ? n.title : 'Untitled';
    const content = typeof n.content === 'string' ? n.content : '';
    const date = typeof n.date === 'string' ? n.date : new Date().toISOString();
    await graphStore.createNode('note', {
      title,
      content,
      date,
      legacyId: n.id != null ? String(n.id) : undefined,
    }, { createdBy: { kind: 'system' } });
    count++;
  }
  return count;
}

async function migrateTodos() {
  const raw = JSON.parse(localStorage.getItem('nova-todos') || '[]');
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (!t || typeof t !== 'object') continue;
    await graphStore.createNode('todo', {
      text: typeof t.text === 'string' ? t.text : '',
      done: !!t.done,
      legacyIndex: i,
    }, { createdBy: { kind: 'system' } });
    count++;
  }
  return count;
}

async function migrateReminders() {
  const raw = JSON.parse(localStorage.getItem('nova-reminders') || 'null');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  let count = 0;
  for (const listName of Object.keys(raw)) {
    const items = raw[listName];
    if (!Array.isArray(items)) continue;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || typeof it !== 'object') continue;
      await graphStore.createNode('reminder', {
        text: typeof it.text === 'string' ? it.text : '',
        done: !!it.done,
        list: listName,
        legacyIndex: i,
      }, { createdBy: { kind: 'system' } });
      count++;
    }
  }
  return count;
}

// --- public entry ---

export async function migrateLocalStorageToGraph() {
  // flag short-circuit: don't migrate twice
  if (localStorage.getItem(FLAG_KEY) === 'done') {
    return { skipped: true, reason: 'already-migrated' };
  }

  // safety: if the graph already has content of any migrated type, assume
  // a previous run (or a dev manually seeded it) and refuse to double-fill.
  // Mark the flag so subsequent boots skip cleanly.
  const [existingNotes, existingTodos, existingReminders] = await Promise.all([
    graphStore.getNodesByType('note', { limit: 1 }),
    graphStore.getNodesByType('todo', { limit: 1 }),
    graphStore.getNodesByType('reminder', { limit: 1 }),
  ]);
  if (existingNotes.length || existingTodos.length || existingReminders.length) {
    localStorage.setItem(FLAG_KEY, 'done');
    return { skipped: true, reason: 'graph-not-empty' };
  }

  const results = { notes: 0, todos: 0, reminders: 0, errors: [] };
  try { results.notes = await migrateNotes(); }
  catch (err) { results.errors.push(['notes', err.message]); }
  try { results.todos = await migrateTodos(); }
  catch (err) { results.errors.push(['todos', err.message]); }
  try { results.reminders = await migrateReminders(); }
  catch (err) { results.errors.push(['reminders', err.message]); }

  localStorage.setItem(FLAG_KEY, 'done');

  const total = results.notes + results.todos + results.reminders;
  if (total > 0) {
    console.log(`[graph-migration] migrated ${results.notes} notes, ${results.todos} todos, ${results.reminders} reminders.`);
  } else {
    console.log('[graph-migration] nothing to migrate (clean install)');
  }
  if (results.errors.length) {
    console.warn('[graph-migration] errors:', results.errors);
  }
  return results;
}

// Escape hatch for dev: force re-run by clearing the flag + the graph data.
// Exposed as window.__astrionMigrationReset in dev so you can test the
// migration path without manually poking IndexedDB.
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  window.__astrionMigrationReset = async () => {
    localStorage.removeItem(FLAG_KEY);
    for (const type of ['note', 'todo', 'reminder']) {
      const nodes = await graphStore.getNodesByType(type, { limit: 10000 });
      for (const n of nodes) await graphStore.deleteNode(n.id);
    }
    console.log('[graph-migration] flag + graph nodes cleared. Reload to re-run migration.');
  };
}
