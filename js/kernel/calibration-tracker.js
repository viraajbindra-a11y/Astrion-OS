// Astrion OS — Calibration Tracker (M3 Dual-Process Runtime, Phase 3)
//
// Records which brain (S1 local vs S2 cloud) handled each query, whether
// it succeeded, and the capability category. Over time, builds accuracy
// stats per category so the router can auto-escalate categories where S1
// accuracy drops below a threshold.
//
// Design:
//   - Each record is a `calibration-sample` graph node with props:
//     { brain, capCategory, ok, query, ts, responseTimeMs }
//   - Accuracy is computed by querying the graph for recent samples per
//     category and brain, then dividing successes by total.
//   - The router (future M3.P1) calls `shouldEscalate(category)` to
//     decide whether to skip S1 for a given category.
//   - Users can thumbs-up/down a response, which writes an explicit
//     feedback sample. Automatic samples come from the executor.
//
// Non-goals:
//   - No network calls. All data is local in the hypergraph.
//   - No cross-session persistence beyond the graph (which already
//     persists in IndexedDB via graph-store).
//   - No model swapping yet — that's M3.P2 (budget manager).

import { graphStore } from './graph-store.js';
import { query as graphQuery } from './graph-query.js';

const ESCALATION_THRESHOLD = 0.70; // Escalate to S2 if S1 accuracy < 70%
const MIN_SAMPLES_FOR_ESCALATION = 5; // Need at least this many samples
const SAMPLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Record a calibration sample ───

/**
 * Record a single calibration sample. Called by the intent executor after
 * every planner call and by the user feedback UI (thumbs up/down).
 *
 * @param {object} sample
 * @param {string} sample.brain - 's1' | 's2' | 'offline'
 * @param {string} sample.capCategory - capability category (e.g. 'files', 'notes', 'ai', 'app')
 * @param {boolean} sample.ok - did the action succeed?
 * @param {string} [sample.query] - the user's original query (for debugging)
 * @param {number} [sample.responseTimeMs] - how long the AI call took
 * @param {boolean} [sample.userFeedback] - true if this is explicit user feedback
 * @returns {Promise<object|null>} the created graph node, or null on error
 */
export async function recordSample(sample) {
  if (!sample || !sample.brain || !sample.capCategory) return null;
  try {
    return await graphStore.createNode('calibration-sample', {
      brain: sample.brain,
      capCategory: sample.capCategory,
      ok: !!sample.ok,
      query: sample.query || '',
      responseTimeMs: sample.responseTimeMs || 0,
      userFeedback: !!sample.userFeedback,
      ts: Date.now(),
    }, {
      createdBy: { kind: 'system', capabilityId: 'calibration.recordSample' },
    });
  } catch (err) {
    console.warn('[calibration-tracker] recordSample failed:', err?.message);
    return null;
  }
}

// ─── Query accuracy stats ───

/**
 * Get accuracy stats for a given brain + category within the sample window.
 * Returns { total, successes, accuracy, avgResponseMs }.
 */
export async function getAccuracy(brain, capCategory) {
  const cutoff = Date.now() - SAMPLE_WINDOW_MS;
  try {
    const samples = await graphQuery(graphStore, {
      type: 'select',
      from: 'calibration-sample',
      where: {
        'props.brain': brain,
        'props.capCategory': capCategory,
        'props.ts': { gt: cutoff },
      },
      limit: 200,
    });

    if (!samples || samples.length === 0) {
      return { total: 0, successes: 0, accuracy: 1.0, avgResponseMs: 0 };
    }

    const successes = samples.filter(s => s.props.ok).length;
    const total = samples.length;
    const accuracy = total > 0 ? successes / total : 1.0;
    const avgResponseMs = total > 0
      ? samples.reduce((sum, s) => sum + (s.props.responseTimeMs || 0), 0) / total
      : 0;

    return { total, successes, accuracy: Math.round(accuracy * 100) / 100, avgResponseMs: Math.round(avgResponseMs) };
  } catch (err) {
    console.warn('[calibration-tracker] getAccuracy failed:', err?.message);
    return { total: 0, successes: 0, accuracy: 1.0, avgResponseMs: 0 };
  }
}

/**
 * Get accuracy stats for ALL categories for a given brain.
 * Returns { [category]: { total, successes, accuracy, avgResponseMs } }.
 */
export async function getAllAccuracy(brain) {
  const cutoff = Date.now() - SAMPLE_WINDOW_MS;
  try {
    const samples = await graphQuery(graphStore, {
      type: 'select',
      from: 'calibration-sample',
      where: {
        'props.brain': brain,
        'props.ts': { gt: cutoff },
      },
      limit: 1000,
    });

    const byCategory = {};
    for (const s of samples) {
      const cat = s.props.capCategory;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, successes: 0, totalMs: 0 };
      byCategory[cat].total++;
      if (s.props.ok) byCategory[cat].successes++;
      byCategory[cat].totalMs += s.props.responseTimeMs || 0;
    }

    const result = {};
    for (const [cat, stats] of Object.entries(byCategory)) {
      result[cat] = {
        total: stats.total,
        successes: stats.successes,
        accuracy: Math.round((stats.successes / stats.total) * 100) / 100,
        avgResponseMs: Math.round(stats.totalMs / stats.total),
      };
    }
    return result;
  } catch (err) {
    console.warn('[calibration-tracker] getAllAccuracy failed:', err?.message);
    return {};
  }
}

// ─── Escalation decision ───

/**
 * Should the given capability category be escalated from S1 to S2?
 * Returns true if S1 accuracy for this category is below the threshold
 * AND we have enough samples to be confident.
 */
export async function shouldEscalate(capCategory) {
  const stats = await getAccuracy('s1', capCategory);
  if (stats.total < MIN_SAMPLES_FOR_ESCALATION) return false;
  return stats.accuracy < ESCALATION_THRESHOLD;
}

/**
 * Get a flat list of all categories currently flagged for escalation.
 * The router calls this at startup and caches the list.
 */
export async function getEscalatedCategories() {
  const allStats = await getAllAccuracy('s1');
  const escalated = [];
  for (const [cat, stats] of Object.entries(allStats)) {
    if (stats.total >= MIN_SAMPLES_FOR_ESCALATION && stats.accuracy < ESCALATION_THRESHOLD) {
      escalated.push({ category: cat, accuracy: stats.accuracy, samples: stats.total });
    }
  }
  return escalated;
}

// ─── Capability category extraction ───

/**
 * Extract a calibration category from a capability ID.
 * 'files.createFolder' → 'files'
 * 'ai.ask' → 'ai'
 * 'notes.create' → 'notes'
 */
export function capCategory(capId) {
  if (!capId || typeof capId !== 'string') return 'unknown';
  const dot = capId.indexOf('.');
  return dot > 0 ? capId.slice(0, dot) : capId;
}

// ─── Init (no-op for now, pull-based like conversation-memory) ───

export function initCalibrationTracker() {
  console.log('[calibration-tracker] initialized');
}
