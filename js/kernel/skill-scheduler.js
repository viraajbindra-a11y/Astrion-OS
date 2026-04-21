// Astrion OS — Skill scheduler (M7 runtime for cron + event triggers)
//
// Phrase triggers are handled by the Spotlight path (M7.P2b). Cron and
// event triggers need their own runtime: this module subscribes every
// registered skill's cron + event clauses on init, fires runSkill()
// when conditions match, and honors the skill registry's
// enabled/disabled state at fire time (so toggling OFF stops future
// fires without restart).
//
// Cron support today: standard 5-field cron ("m h dom mon dow"). Each
// cron skill gets a timer that wakes every minute, rounded to the
// minute, and fires runSkill() if the current time matches. Survives
// tab suspension at coarse granularity — drift on wake is bounded by
// the 1-minute tick.
//
// Event support today: for each skill with `event: "foo"` trigger,
// eventBus.on('foo', ...) fires runSkill() when the payload matches
// the trigger's optional `where` clause (currently plain string
// containment; M7.P2.d will grow a proper predicate parser).
//
// Safety: ALL scheduler-triggered fires go through the same runSkill()
// path that Spotlight uses. M7.P2c constraint enforcement still
// applies — a scheduled skill cannot escape its declared level /
// reversibility caps.

import { eventBus } from './event-bus.js';
import { compile as compilePredicate } from './predicate-parser.js';

const CRON_TICK_MS = 60_000; // 1 minute
const wiredCron = new Map();   // skill name → interval id
const wiredEvent = new Map();  // skill name → array of { eventName, off }
const FIRE_HISTORY_KEY = 'astrion-skill-fires'; // { [skillName]: [{ts, source}...] }
const FIRE_HISTORY_MAX = 10;   // per-skill ring buffer

function readFireHistory() {
  try { return JSON.parse(localStorage.getItem(FIRE_HISTORY_KEY) || '{}'); } catch { return {}; }
}

function recordFire(name, source) {
  try {
    const all = readFireHistory();
    if (!Array.isArray(all[name])) all[name] = [];
    all[name].push({ ts: Date.now(), source });
    while (all[name].length > FIRE_HISTORY_MAX) all[name].shift();
    localStorage.setItem(FIRE_HISTORY_KEY, JSON.stringify(all));
  } catch {}
}

export function getFireHistory(name) {
  const all = readFireHistory();
  if (!name) return all;
  return all[name] || [];
}

// ─── Cron parsing ───
// Standard 5-field: minute hour dom mon dow. Each field is '*',
// a number, or a comma-list of numbers. Ranges (1-5) and steps (*/5)
// supported.

function parseCronField(raw, min, max) {
  raw = String(raw).trim();
  if (raw === '*') return { match: () => true };
  if (raw.startsWith('*/')) {
    const step = parseInt(raw.slice(2), 10);
    if (!isFinite(step) || step <= 0) return null;
    return { match: (v) => ((v - min) % step) === 0 };
  }
  const parts = raw.split(',');
  const set = new Set();
  for (const p of parts) {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(s => parseInt(s.trim(), 10));
      if (!isFinite(a) || !isFinite(b) || a > b) return null;
      for (let v = a; v <= b; v++) set.add(v);
    } else {
      const n = parseInt(p.trim(), 10);
      if (!isFinite(n) || n < min || n > max) return null;
      set.add(n);
    }
  }
  return { match: (v) => set.has(v) };
}

export function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const m = parseCronField(parts[0], 0, 59);
  const h = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const mon = parseCronField(parts[3], 1, 12);
  const dow = parseCronField(parts[4], 0, 6); // 0 = Sunday
  if (!m || !h || !dom || !mon || !dow) return null;
  return {
    matches(date) {
      return m.match(date.getMinutes())
        && h.match(date.getHours())
        && dom.match(date.getDate())
        && mon.match(date.getMonth() + 1)
        && dow.match(date.getDay());
    },
  };
}

// ─── Event where-clause matching (M7.P2.d) ───
// Compile via the dedicated predicate-parser. Compilation is cached
// per-source-string in a tiny WeakMap-equivalent (Map keyed by string).
// Bad predicates compile to "always false" and emit a console.warn so
// skill authors find them.

const _predicateCache = new Map();

function matchesWhere(where, payload) {
  if (!where) return true;
  let cached = _predicateCache.get(where);
  if (!cached) {
    cached = compilePredicate(where);
    if (!cached.ok) {
      console.warn('[skill-scheduler] bad predicate', JSON.stringify(where), '→', cached.error);
      cached = { ok: true, predicate: () => false };
    }
    _predicateCache.set(where, cached);
  }
  return cached.predicate(payload);
}

// ─── Wire / unwire ───

async function safeRunSkill(name, opts) {
  try {
    const reg = await import('./skill-registry.js');
    if (!reg.isSkillEnabled(name)) return;
    recordFire(name, opts?.source || 'unknown');
    reg.runSkill(name, opts);
  } catch (err) {
    console.warn('[skill-scheduler] runSkill failed:', name, err?.message);
  }
}

function wireCron(name, expr) {
  const cron = parseCron(expr);
  if (!cron) { console.warn('[skill-scheduler] bad cron for', name + ':', expr); return; }
  let lastFireMinute = null;
  const tick = () => {
    const now = new Date();
    const key = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + '-' + now.getHours() + '-' + now.getMinutes();
    if (key === lastFireMinute) return; // don't re-fire inside the same minute
    if (cron.matches(now)) {
      lastFireMinute = key;
      eventBus.emit('skill:cron-fire', { skill: name, expr, ts: now.getTime() });
      safeRunSkill(name, { source: 'cron', expr });
    }
  };
  const id = setInterval(tick, CRON_TICK_MS);
  // Also check immediately in case boot lands right on the minute
  setTimeout(tick, 100);
  wiredCron.set(name, id);
}

function wireEvent(name, eventName, where) {
  const handler = (payload) => {
    if (!matchesWhere(where, payload)) return;
    eventBus.emit('skill:event-fire', { skill: name, eventName, payload });
    safeRunSkill(name, { source: 'event', eventName, payload });
  };
  // eventBus.on returns an unsubscribe closure — store it so stopSkillScheduler
  // can tear down cleanly without leaking handlers (lesson: track subscriptions
  // at wire time, not teardown time).
  const unsub = eventBus.on(eventName, handler);
  const list = wiredEvent.get(name) || [];
  list.push({ eventName, handler, unsub });
  wiredEvent.set(name, list);
}

export async function startSkillScheduler() {
  const reg = await import('./skill-registry.js');
  await reg.loadSkillRegistry();
  const skills = reg.listSkills();
  // Need the full parsed trigger data; listSkills only returns phrases.
  // Re-fetch each skill for the trigger array.
  let cronCount = 0, eventCount = 0;
  for (const s of skills) {
    const skill = reg.getSkill(s.name);
    if (!skill) continue;
    for (const t of skill.trigger) {
      if (t.cron) { wireCron(s.name, t.cron); cronCount++; }
      if (t.event) { wireEvent(s.name, t.event, t.where); eventCount++; }
    }
  }
  console.log('[skill-scheduler] wired ' + cronCount + ' cron trigger(s) + ' + eventCount + ' event trigger(s) across ' + skills.length + ' skills');
}

export function stopSkillScheduler() {
  for (const id of wiredCron.values()) clearInterval(id);
  wiredCron.clear();
  // Call each subscription's unsub closure so listeners don't leak.
  // Previously this was a TODO; eventBus.on already returns an unsub,
  // so wireEvent now stores it and we just drain the map here.
  for (const list of wiredEvent.values()) {
    for (const sub of list) {
      try { sub.unsub?.(); } catch {}
    }
  }
  wiredEvent.clear();
}

// ─── Sanity tests ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  let f = 0;
  const c1 = parseCron('0 9 * * *');
  if (!c1 || !c1.matches(new Date('2026-04-20T09:00:00'))) { console.warn('[scheduler] cron 0 9 * * * FAIL'); f++; }
  if (c1 && c1.matches(new Date('2026-04-20T10:00:00'))) { console.warn('[scheduler] cron 0 9 * * * should NOT match 10:00'); f++; }
  const c2 = parseCron('*/15 * * * *');
  if (!c2 || !c2.matches(new Date('2026-04-20T12:15:00'))) { console.warn('[scheduler] cron */15 FAIL at :15'); f++; }
  if (c2 && c2.matches(new Date('2026-04-20T12:17:00'))) { console.warn('[scheduler] cron */15 should NOT match :17'); f++; }
  const c3 = parseCron('0 17 * * 5'); // Friday 5pm
  if (!c3 || !c3.matches(new Date('2026-04-24T17:00:00'))) { console.warn('[scheduler] cron Friday FAIL'); f++; } // 2026-04-24 is Friday
  if (c3 && c3.matches(new Date('2026-04-20T17:00:00'))) { console.warn('[scheduler] cron Friday should NOT match Monday'); f++; }
  // invalid
  if (parseCron('garbage')) { console.warn('[scheduler] garbage cron should fail'); f++; }
  if (parseCron('* * * *')) { console.warn('[scheduler] 4-field cron should fail'); f++; }

  // where matching
  if (!matchesWhere('level < 15 and charging == false', { level: 10, charging: false })) { console.warn('[scheduler] where match FAIL'); f++; }
  if (matchesWhere('level < 15', { level: 20 })) { console.warn('[scheduler] where < should fail on 20'); f++; }
  if (!matchesWhere('', { anything: true })) { console.warn('[scheduler] empty where should pass'); f++; }

  if (f === 0) console.log('[skill-scheduler] all 10 sanity tests pass');
  else console.warn('[skill-scheduler]', f, 'sanity tests failed');
}
