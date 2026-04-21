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
import { parseSkill, validateSkill } from './skill-parser.js';

const MANIFEST_URL = '/skills/manifest.json';
const SKILL_URL = (name) => '/skills/examples/' + name + '.skill';
const DISABLED_KEY = 'astrion-skills-disabled';
const USER_SKILLS_KEY = 'astrion-user-skills'; // M7.P4 — array of { name, source }

const byName = new Map();       // name → { name, skill (parsed), source (raw text) }
const byPhrase = new Map();     // lowercased phrase → name
let loaded = false;

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function readDisabled() {
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function writeDisabled(set) {
  try { localStorage.setItem(DISABLED_KEY, JSON.stringify([...set])); } catch {}
}

export function isSkillEnabled(name) {
  return !readDisabled().has(name);
}

export function setSkillEnabled(name, enabled) {
  const s = readDisabled();
  if (enabled) s.delete(name); else s.add(name);
  writeDisabled(s);
}

export function getDisabledSkills() {
  return [...readDisabled()];
}

// ─── User-installed skills (M7.P4) ───

function readUserSkills() {
  try {
    const raw = localStorage.getItem(USER_SKILLS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeUserSkills(arr) {
  try { localStorage.setItem(USER_SKILLS_KEY, JSON.stringify(arr)); } catch {}
}

/**
 * Install a user-authored skill from raw .skill source. Parses + validates;
 * if the parser throws, returns { ok: false, error }. On success the skill
 * is persisted in localStorage and merged into the live registry.
 *
 * Name collisions with bundled (default) skills are rejected — user skills
 * cannot shadow defaults. (User can disable a default first if they want
 * to replace it.)
 */
export async function installUserSkill(source) {
  if (typeof source !== 'string' || !source.trim()) return { ok: false, error: 'source required' };
  let parsed;
  try { parsed = parseSkill(source); }
  catch (err) { return { ok: false, error: 'parse failed: ' + (err?.message || err) }; }

  // Semantic validation — catches bad level/reversibility/cron that the
  // parser accepts syntactically but registry + scheduler would choke on.
  const v = validateSkill(parsed);
  if (!v.ok) return { ok: false, error: 'invalid skill: ' + v.errors.join('; ') };

  // Derive a stable name. Prefer goal slug, fall back to a 'user-' uuid.
  const slug = parsed.goal.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    || ('user-' + Date.now().toString(36));
  let name = slug;
  let suffix = 1;
  while (byName.has(name)) {
    if (byName.get(name)?.userInstalled) { name = slug + '-' + (++suffix); continue; }
    return { ok: false, error: 'name collides with bundled skill: ' + name };
  }

  // Persist
  const list = readUserSkills();
  list.push({ name, source });
  writeUserSkills(list);

  // Merge into live registry
  byName.set(name, { name, skill: parsed, source, userInstalled: true });
  for (const t of parsed.trigger) {
    if (t.phrase) {
      const key = norm(t.phrase);
      if (!byPhrase.has(key)) byPhrase.set(key, name);
    }
  }
  return { ok: true, name };
}

export function uninstallUserSkill(name) {
  const entry = byName.get(name);
  if (!entry || !entry.userInstalled) return { ok: false, error: 'not a user-installed skill' };
  const list = readUserSkills().filter(s => s.name !== name);
  writeUserSkills(list);
  byName.delete(name);
  // Drop phrase entries that pointed at this name
  for (const [phrase, owner] of [...byPhrase.entries()]) {
    if (owner === name) byPhrase.delete(phrase);
  }
  return { ok: true };
}

export function listSkills() {
  const disabled = readDisabled();
  return [...byName.values()].map(({ name, skill, userInstalled }) => ({
    name,
    goal: skill.goal,
    phrases: skill.trigger.filter(t => t.phrase).map(t => t.phrase),
    level: skill.constraints.level,
    budget: skill.constraints.budget_tokens,
    enabled: !disabled.has(name),
    userInstalled: !!userInstalled,
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
    // M7.P4: silently skip disabled skills — fall through to the
    // normal planner path so the user can still type the phrase.
    if (readDisabled().has(name)) return null;
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

  // M7.P4: merge in user-installed skills from localStorage
  let userCount = 0;
  for (const u of readUserSkills()) {
    try {
      const skill = parseSkill(u.source);
      if (byName.has(u.name)) continue; // skip on name collision (bundled wins)
      byName.set(u.name, { name: u.name, skill, source: u.source, userInstalled: true });
      for (const t of skill.trigger) {
        if (t.phrase) {
          const key = norm(t.phrase);
          if (!byPhrase.has(key)) byPhrase.set(key, u.name);
        }
      }
      userCount++;
    } catch (err) {
      console.warn('[skill-registry] user skill failed to parse:', u.name, err?.message);
    }
  }

  console.log('[skill-registry] loaded ' + byName.size + ' skills (' + names.length + ' bundled, ' + userCount + ' user), ' + byPhrase.size + ' phrase triggers indexed');
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
