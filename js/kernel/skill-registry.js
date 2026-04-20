// Astrion OS — Skill registry + runner (M7.P2b)
//
// Loads .skill files via the server (/skills/manifest.json lists the
// examples). Parses each with skill-parser. Indexes phrase triggers
// to a case-insensitive lookup map so Spotlight can translate a user
// query into a skill dispatch in O(1).
//
// The runner is thin by design:
//   - A skill's `do` field is a natural-language directive.
//   - runSkill fires that directive through the existing intent:plan
//     pipeline — same path as any typed query. The planner sees a
//     richer, higher-quality prompt than free-form typing.
//   - Constraints enforcement is deferred to M7.P2c — for now the
//     skill's constraints travel alongside the plan so subscribers
//     (interceptor, red-team) can read them.

import { eventBus } from './event-bus.js';
import { parseSkill } from './skill-parser.js';

const MANIFEST_URL = '/skills/manifest.json';
const SKILL_URL = (name) => '/skills/examples/' + name + '.skill';

const byName = new Map();       // name → { name, skill (parsed), source (raw text) }
const byPhrase = new Map();     // lowercased phrase → name
let loaded = false;

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

export function listSkills() {
  return [...byName.values()].map(({ name, skill }) => ({
    name,
    goal: skill.goal,
    phrases: skill.trigger.filter(t => t.phrase).map(t => t.phrase),
    level: skill.constraints.level,
    budget: skill.constraints.budget_tokens,
  }));
}

export function getSkill(name) {
  return byName.get(name)?.skill || null;
}

export function matchPhrase(query) {
  const q = norm(query);
  if (!q) return null;
  // exact match first — phrases are expected to be short, so exact > fuzzy
  if (byPhrase.has(q)) {
    const name = byPhrase.get(q);
    return { name, skill: byName.get(name).skill };
  }
  return null;
}

/**
 * Dispatch a skill. Emits intent:plan with the skill's `do` as the
 * query and extra metadata so downstream subscribers (interceptor,
 * red-team, Spotlight UI) know this plan came from a skill.
 */
export function runSkill(name, opts = {}) {
  const entry = byName.get(name);
  if (!entry) throw new Error('skill not found: ' + name);
  const context = opts.context || {};
  eventBus.emit('intent:plan', {
    query: entry.skill.do,
    context,
    parsedIntent: null,
    skill: {
      name: entry.name,
      goal: entry.skill.goal,
      constraints: entry.skill.constraints,
    },
  });
}

async function loadOne(name) {
  const res = await fetch(SKILL_URL(name));
  if (!res.ok) throw new Error('fetch failed: ' + name + ' (' + res.status + ')');
  const text = await res.text();
  const skill = parseSkill(text);
  byName.set(name, { name, skill, source: text });
  for (const t of skill.trigger) {
    if (t.phrase) {
      const key = norm(t.phrase);
      if (byPhrase.has(key)) {
        const existing = byPhrase.get(key);
        if (existing !== name) console.warn('[skill-registry] phrase collision:', key, 'between', existing, 'and', name);
      } else {
        byPhrase.set(key, name);
      }
    }
  }
}

/**
 * Load every skill listed in the manifest. Idempotent — subsequent
 * calls noop if already loaded. Returns the count of skills loaded.
 */
export async function loadSkillRegistry() {
  if (loaded) return byName.size;
  loaded = true;
  let manifest;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error('manifest ' + res.status);
    manifest = await res.json();
  } catch (err) {
    console.warn('[skill-registry] manifest load failed, no skills available:', err?.message);
    return 0;
  }
  const names = Array.isArray(manifest.examples) ? manifest.examples : [];
  const results = await Promise.allSettled(names.map(loadOne));
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    for (const f of failed) console.warn('[skill-registry] load failed:', f.reason?.message || f.reason);
  }
  console.log('[skill-registry] loaded ' + byName.size + '/' + names.length + ' skills, ' + byPhrase.size + ' phrase triggers indexed');
  return byName.size;
}

export function _resetForTests() {
  byName.clear();
  byPhrase.clear();
  loaded = false;
}

// ─── Sanity tests (localhost only) ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  let f = 0;
  // norm
  if (norm('  HELLO  ') !== 'hello') { console.warn('[skill-registry] norm FAIL'); f++; }
  if (norm(null) !== '') { console.warn('[skill-registry] norm null FAIL'); f++; }
  // matchPhrase on empty registry
  if (matchPhrase('anything') !== null) { console.warn('[skill-registry] empty match FAIL'); f++; }
  if (f === 0) console.log('[skill-registry] all 3 sanity tests pass (registry not yet loaded)');
  else console.warn('[skill-registry]', f, 'sanity tests failed');
}
