// Astrion OS — Capability Provider API (M1.P2)
//
// The typed capability layer that sits between the Intent Kernel and
// the actual work. Every capability declares:
//
//   - level          → 0 (observe), 1 (sandbox), 2 (real), 3 (self-mod)
//   - reversibility  → 'free' | 'bounded' | 'permanent'
//   - blastRadius    → 'none' | 'file' | 'directory' | 'account' | 'external'
//   - cost estimate  → { timeMs, irreversibilityTokens }
//
// This lets the planner reason about safety, cost, and reversibility
// BEFORE executing. It's the fix for audit hole #2 (the "terminal.run is
// one tool" lie).
//
// Addresses: docs/architecture/capability-api.md
//
// Example:
//   const cap = getCapability('notes.create');
//   const cost = cap.estimateCost({ name: 'shopping' });
//   if (cost.irreversibilityTokens > userBudget) { askUser(); return; }
//   const result = await cap.execute({ name: 'shopping', items: ['apples'] });
//   // result = { ok: true, output: {...}, provenance: {...} }

import { eventBus } from './event-bus.js';

// ═══════════════════════════════════════════════════════════════
// CAPABILITY LEVELS
// ═══════════════════════════════════════════════════════════════

export const LEVEL = {
  OBSERVE:  0, // read-only, always safe (file.read, search)
  SANDBOX:  1, // scratch space, no real data (sandbox file ops)
  REAL:     2, // touches user data (file.edit, app.launch, terminal.spawn)
  SELF_MOD: 3, // touches Astrion's own code (M8 only)
};

export const REVERSIBILITY = {
  FREE:      'free',      // trivially undoable (move to trash, mute)
  BOUNDED:   'bounded',   // undoable within a window (file delete → trash)
  PERMANENT: 'permanent', // cannot be undone (send email, git push)
};

export const BLAST_RADIUS = {
  NONE:      'none',
  FILE:      'file',
  DIRECTORY: 'directory',
  ACCOUNT:   'account',
  EXTERNAL:  'external',
};

// ═══════════════════════════════════════════════════════════════
// CAPABILITY REGISTRY
// ═══════════════════════════════════════════════════════════════

const registry = new Map();

/**
 * Register a capability. Called by capability providers at startup.
 * @param {Capability} cap
 */
export function registerCapability(cap) {
  if (!cap.id || !cap.execute) {
    throw new Error('Capability must have id + execute');
  }
  // Warn on duplicate registration (audit bug #7 — prevents silent override)
  if (registry.has(cap.id)) {
    console.warn(`[capability-api] overwriting existing capability: ${cap.id}`);
  }
  // Fill in defaults
  cap.level = cap.level ?? LEVEL.REAL;
  cap.reversibility = cap.reversibility ?? REVERSIBILITY.BOUNDED;
  cap.blastRadius = cap.blastRadius ?? BLAST_RADIUS.FILE;
  cap.estimateCost = cap.estimateCost || (() => ({ timeMs: 100, irreversibilityTokens: 1 }));
  cap.validate = cap.validate || (() => ({ ok: true, errors: [] }));
  registry.set(cap.id, cap);
}

/**
 * Look up a capability by id.
 */
export function getCapability(id) {
  return registry.get(id);
}

/**
 * List all registered capabilities — useful for the "what can the AI do?"
 * cheat sheet.
 */
export function listCapabilities() {
  return [...registry.values()];
}

/**
 * Return capabilities matching a verb + target combo. Used by the
 * intent → capability mapper below.
 */
export function findCapabilities(verb, target) {
  const results = [];
  for (const cap of registry.values()) {
    if (cap.verb === verb && (cap.target === target || cap.target === '*')) {
      results.push(cap);
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// INTENT → CAPABILITY MAPPING
// ═══════════════════════════════════════════════════════════════

/**
 * Given a parsed intent, return the capability that should handle it.
 * Returns null if no capability matches.
 * @param {Intent} intent
 * @returns {Capability | null}
 */
export function resolveCapability(intent) {
  if (!intent) return null;
  // First try exact verb + target match
  const exact = findCapabilities(intent.verb, intent.target);
  if (exact.length > 0) return exact[0];
  // Then verb with wildcard target
  const wildcardTarget = findCapabilities(intent.verb, '*');
  if (wildcardTarget.length > 0) return wildcardTarget[0];
  return null;
}

// ═══════════════════════════════════════════════════════════════
// RECEIPT / PROVENANCE
// ═══════════════════════════════════════════════════════════════

/**
 * Build the standard receipt object that every capability returns in
 * its `provenance` field. Feeds the M4 verifiable-computation layer.
 */
export function buildReceipt(cap, args, startMs, output, reversalHandle) {
  return {
    capabilityId: cap.id,
    verb: cap.verb,
    target: cap.target,
    args: safeClone(args),
    timestamp: Date.now(),
    durationMs: Date.now() - startMs,
    level: cap.level,
    reversibility: cap.reversibility,
    reversalHandle: reversalHandle || null,
    astrionVersion: 'M1.P2',
  };
}

function safeClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return { _error: 'unserializable' };
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPABILITY EXECUTION HELPER
// ═══════════════════════════════════════════════════════════════

/**
 * Wrap a raw capability execution with standard timing, validation,
 * and event emission. Use this inside capability providers.
 *
 * Example provider usage:
 *   registerCapability({
 *     id: 'notes.create',
 *     verb: 'make',
 *     target: 'note',
 *     level: LEVEL.REAL,
 *     reversibility: REVERSIBILITY.BOUNDED,
 *     blastRadius: BLAST_RADIUS.NONE,
 *     summary: 'Create a new note',
 *     execute: async (args) => runCapability(this, args, async () => {
 *       const note = await createNote(args.name, args.items);
 *       return { note };
 *     }),
 *   });
 */
export async function runCapability(cap, args, innerFn) {
  const startMs = Date.now();
  eventBus.emit('capability:start', { id: cap.id, args });
  try {
    // Validation
    const validation = cap.validate(args);
    if (!validation.ok) {
      const error = `Invalid args: ${validation.errors.join(', ')}`;
      eventBus.emit('capability:error', { id: cap.id, error });
      return {
        ok: false,
        error,
        provenance: buildReceipt(cap, args, startMs, null, null),
      };
    }

    // Execute
    const output = await innerFn();

    // Success
    const result = {
      ok: true,
      output,
      provenance: buildReceipt(cap, args, startMs, output, output?._reversalHandle),
    };
    eventBus.emit('capability:success', {
      id: cap.id,
      durationMs: Date.now() - startMs,
    });
    return result;
  } catch (err) {
    const error = err?.message || String(err);
    eventBus.emit('capability:error', { id: cap.id, error });
    return {
      ok: false,
      error,
      provenance: buildReceipt(cap, args, startMs, null, null),
    };
  }
}

/**
 * @typedef {object} Capability
 * @property {string} id - e.g. "notes.create"
 * @property {string} verb - canonical verb it handles ("make", "find", ...)
 * @property {string} target - canonical target ("note", "file", "*" for any)
 * @property {number} level - LEVEL.OBSERVE | SANDBOX | REAL | SELF_MOD
 * @property {string} reversibility - REVERSIBILITY.*
 * @property {string} blastRadius - BLAST_RADIUS.*
 * @property {string} summary - human-readable one-liner
 * @property {(args: object) => { ok: boolean, errors: string[] }} [validate]
 * @property {(args: object) => { timeMs: number, irreversibilityTokens: number }} [estimateCost]
 * @property {(args: object) => Promise<CapabilityResult>} execute
 */
