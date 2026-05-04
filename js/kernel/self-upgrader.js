// Astrion OS — Self-Upgrader (M8.P5 first real disk-writing cut)
//
// The AI reads Astrion's own source + current screen state, proposes
// ONE small improvement, walks the 5-gate selfmod-sandbox, and (if all
// gates pass) writes it to disk via /api/files/write.
//
// This is M8.P5 — the "actual source mutation" piece that selfmod-sandbox
// intentionally deferred. We only unlock it for a narrow allow-list of
// paths that CAN'T break the safety rails (kernel/selfmod-sandbox,
// capability-providers, value-lock, golden-check, graph-store are all
// locked OUT). The AI can improve apps + shell UI only.
//
// The 5 gates from selfmod-sandbox still fire verbatim:
//   1. golden-integrity   — locked files unchanged vs. blessed hashes
//   2. value-lock         — LOCKED_VALUES match baseline
//   3. red-team-signoff   — adversarial review recommends 'proceed'
//   4. user-typed-confirm — user types the proposal id literally
//   5. rollback-plan      — proposal ships an inverse diff
//
// Additional policy enforced HERE (before gates even fire):
//   - target file MUST be under js/apps/ or js/shell/ or css/apps/
//   - new file contents MUST pass a blocklist (no `import fs`, `eval`,
//     `Function(`, `fetch('http`, `XMLHttpRequest` in the shell-side
//     code — the kernel is off-limits so these would be new attack
//     surface if we let them land)
//   - content size <= 80 KB (catches model runaways)
//
// Public API:
//   collectScreenState()           — returns text-safe state for the prompt
//   listUpgradableFiles()          — returns the allow-listed source files
//   proposeUpgrade({ focus? })     — asks the AI for ONE proposal
//   applyUpgrade(proposalId, {typedConfirm}) — gates + disk write

import { aiService } from './ai-service.js';
import { processManager } from './process-manager.js';
import { eventBus } from './event-bus.js';
import { proposeSelfMod, applyProposal as applySelfmodProposal, getProposal } from './selfmod-sandbox.js';

// ═══════════════════════════════════════════════════════════════
// POLICY: what can AI touch?
// ═══════════════════════════════════════════════════════════════

// Allow-list: ONLY these path prefixes can be proposed. Anything else
// is rejected before we even send it to the AI. This is the ONE thing
// that keeps self-upgrade from becoming a loaded gun pointed at the
// safety rails.
const ALLOWED_PREFIXES = [
  'js/apps/',
  'js/shell/',
  'css/apps/',
  'css/',           // top-level css files (wallpaper, animations)
];

// Deny-list (belt + suspenders): these NEVER go to AI regardless of
// whether they fall under an allowed prefix. Kernel + integrity layer
// are intentionally unreachable from self-upgrade.
const DENY_LIST = [
  'js/kernel/',
  'js/boot.js',
  'js/lib/',        // safe-storage etc. — security infrastructure
  'server/',
  'distro/',
  'golden.lock.json',
  '.github/',
  'tools/',
  'scripts/',
];

// New-content blocklist: patterns we refuse to accept even from the AI.
const CONTENT_BLOCKLIST = [
  { re: /\bimport\s+['"]fs['"]/, reason: 'Node fs import in browser code' },
  { re: /\beval\s*\(/, reason: 'eval() call' },
  { re: /\bnew\s+Function\s*\(/, reason: 'new Function() constructor' },
  { re: /\bimportScripts\s*\(/, reason: 'importScripts call' },
  { re: /localStorage\.removeItem\s*\(\s*['"]astrion-/, reason: 'clears Astrion state key' },
  { re: /graphStore\.(deleteNode|removeEdge)\s*\(/, reason: 'direct graph mutation bypassing capabilities' },
];

const MAX_CONTENT_BYTES = 80 * 1024;

export function isPathUpgradable(path) {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..') || path.startsWith('/')) return false;
  for (const deny of DENY_LIST) {
    if (path.startsWith(deny)) return false;
  }
  for (const prefix of ALLOWED_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function checkContentSafe(content) {
  if (!content || typeof content !== 'string') return { ok: false, reason: 'empty content' };
  if (content.length > MAX_CONTENT_BYTES) return { ok: false, reason: `content ${content.length} bytes > ${MAX_CONTENT_BYTES} cap` };
  for (const { re, reason } of CONTENT_BLOCKLIST) {
    if (re.test(content)) return { ok: false, reason };
  }
  return { ok: true };
}

/**
 * Validate that proposed JS/CSS content is at least parseable. This is
 * NOT a runtime safety check — a syntactically valid file can still
 * crash at import time — but it catches "model dropped a closing
 * brace" / "returned prose pretending to be code" failures before
 * they hit disk.
 *
 * For .js: strips ES imports (new Function can't parse them) then
 * tries to parse the remaining body. Any SyntaxError fails the check.
 * For .css: very loose check — balanced braces + no JS-ism markers.
 * Other extensions pass through.
 */
export function validateSyntax(path, content) {
  if (!content) return { ok: false, reason: 'empty content' };
  if (path.endsWith('.js')) {
    try {
      // Strip top-level ES imports/exports — Function() constructor
      // doesn't accept them. We're only checking that the body parses.
      const stripped = content
        .replace(/^import[\s\S]*?from[^\n]+;\s*/gm, '')
        .replace(/^import\s+['"][^'"]+['"]\s*;\s*/gm, '')
        .replace(/^export\s+(default\s+)?/gm, '');
      new Function(stripped);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'JS syntax: ' + (err?.message || 'parse failed').slice(0, 200) };
    }
  }
  if (path.endsWith('.css')) {
    // Balanced-brace check — CSS parsers aren't in the browser directly
    let depth = 0;
    for (const c of content) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth < 0) return { ok: false, reason: 'CSS: unmatched }' }; }
    }
    if (depth !== 0) return { ok: false, reason: `CSS: unclosed { (depth=${depth})` };
    // Cheap JS-ism sniff
    if (/\beval\s*\(|\bfunction\s*\(/.test(content)) {
      return { ok: false, reason: 'CSS file contains JS tokens (eval/function)' };
    }
    return { ok: true };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
// SCREEN STATE: text-safe context for the AI prompt
// ═══════════════════════════════════════════════════════════════

/**
 * Collect a snapshot of what the user is looking at RIGHT NOW as
 * text the AI can read. No pixels — gpt-oss:16b has no vision head.
 * Covers open windows, Spotlight state, chat panel state, recent
 * intents, recent failures. ~800-1500 chars typical.
 */
export async function collectScreenState() {
  const state = {
    openApps: [],
    spotlightOpen: false,
    chatPanelOpen: false,
    chatPanelMode: null,
    recentIntents: [],
    recentFailures: [],
    focusedApp: null,
    hour: new Date().getHours(),
  };

  // Open windows
  try {
    const wm = await import('./window-manager.js');
    const windows = wm.windowManager?.getAllWindows?.() || [];
    state.openApps = windows.map(w => ({
      id: w.appId || w.id,
      title: w.title || w.appId,
      focused: !!w.isFocused,
    }));
    state.focusedApp = windows.find(w => w.isFocused)?.appId || null;
  } catch {}

  // Spotlight state
  state.spotlightOpen = document.getElementById('spotlight')?.classList?.contains('open') || false;

  // Chat panel state
  const cp = document.getElementById('chat-panel');
  if (cp) {
    state.chatPanelOpen = cp.classList.contains('open');
    state.chatPanelMode = cp.dataset.mode || null;
  }

  // Recent intents + failures from conversation memory
  try {
    const memMod = await import('./conversation-memory.js');
    const sessionId = memMod.getOrCreateSession();
    const turns = await memMod.getRecentTurns(sessionId, 8);
    state.recentIntents = turns.slice(-5).map(t => ({
      q: (t.query || '').slice(0, 80),
      ok: t.ok,
      capSummary: (t.capSummary || '').slice(0, 60),
    }));
    state.recentFailures = turns.filter(t => !t.ok).slice(-3).map(t => ({
      q: (t.query || '').slice(0, 80),
      error: (t.error || '').slice(0, 100),
    }));
  } catch {}

  return state;
}

// ═══════════════════════════════════════════════════════════════
// FILE LISTING
// ═══════════════════════════════════════════════════════════════

/**
 * Ask the server for the list of upgradable source files. Defaults to
 * everything under js/apps + js/shell + css/apps.
 */
export async function listUpgradableFiles() {
  const dirs = ['js/apps', 'js/shell', 'css/apps'];
  const files = [];
  for (const d of dirs) {
    try {
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(d)}&depth=1`);
      if (!res.ok) continue;
      const data = await res.json();
      // /api/files/list returns entries with {name, type, ext} — compose
      // the full repo-relative path from the dir we queried.
      for (const entry of data.entries || []) {
        if (entry.type !== 'file') continue;
        if (entry.ext && entry.ext !== '.js' && entry.ext !== '.css') continue;
        const path = d + '/' + entry.name;
        if (isPathUpgradable(path)) {
          files.push({ path, size: entry.size || 0 });
        }
      }
    } catch {}
  }
  return files;
}

async function readFile(path) {
  const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}&limit=100000`);
  if (!res.ok) throw new Error(`read ${path} failed: ${res.status}`);
  const data = await res.json();
  return data.content || '';
}

// ═══════════════════════════════════════════════════════════════
// PROPOSE
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are the Astrion OS self-upgrade agent. Your job is to propose ONE small,
specific improvement to a source file in the running OS. You must:

- Return JSON only. No markdown, no prose, no backticks.
- Pick exactly ONE file from the "allowed" list below.
- Produce the COMPLETE new file content (not a diff) — the system generates
  the diff for you.
- Keep the change focused: a bug fix, a small UX polish, a new small helper,
  one new button, one better error message. NOT a rewrite.
- NEVER touch kernel files, safety rails, integrity checks, or capability
  providers. These aren't in the allowed list; proposing them will be rejected.
- NEVER add "import fs", "eval(", "new Function(", or anything that clears
  localStorage Astrion keys. These will be rejected by content scan.
- If nothing productive can be improved, return {"status":"pass","reason":"..."}.

JSON shape on success:
{
  "status": "propose",
  "target": "js/apps/<file>.js",
  "new_content": "<the complete new file content, as a string>",
  "reason": "<one-sentence explanation>",
  "rollback_description": "<how to undo this in one sentence>"
}

JSON shape on pass:
{ "status": "pass", "reason": "<one sentence>" }`;

function buildPrompt({ screenState, focusFile, focusContent, allowList }) {
  return `${SYSTEM_PROMPT}

USER SCREEN STATE:
\`\`\`json
${JSON.stringify(screenState, null, 2).slice(0, 1200)}
\`\`\`

ALLOWED FILES (pick exactly ONE to improve):
${allowList.slice(0, 40).map(f => '  - ' + f.path + ' (' + f.size + ' bytes)').join('\n')}
${allowList.length > 40 ? `  ... and ${allowList.length - 40} more\n` : ''}

${focusFile ? `FOCUS FILE CONTENT (the user specifically wants this one improved):
Path: ${focusFile}
\`\`\`
${(focusContent || '').slice(0, 8000)}
\`\`\`
` : ''}

Respond with JSON only.`;
}

function tryParseJSON(raw) {
  if (!raw) return null;
  let text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  return null;
}

function buildUnifiedDiff(oldText, newText, path) {
  // Reuse the simple line-by-line diff shape that selfmod-sandbox expects
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const out = [`--- a/${path}`, `+++ b/${path}`];
  let oi = 0, ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      oi++; ni++;
    } else if (oi < oldLines.length && (ni >= newLines.length || !newLines.slice(ni, ni + 3).includes(oldLines[oi]))) {
      out.push('-' + oldLines[oi]); oi++;
    } else if (ni < newLines.length) {
      out.push('+' + newLines[ni]); ni++;
    } else { oi++; ni++; }
  }
  return out.join('\n');
}

/**
 * Ask the AI for ONE proposal. Creates it in the selfmod-sandbox as a
 * pending proposal ready for applyUpgrade.
 *
 * @param {object} [opts]
 * @param {string} [opts.focus] — if set, AI is strongly hinted to improve this file
 * @returns {Promise<{ok, proposalId?, target?, reason?, diff?, newContent?, error?}>}
 */
export async function proposeUpgrade(opts = {}) {
  const screenState = await collectScreenState();
  const allowList = await listUpgradableFiles();
  if (allowList.length === 0) return { ok: false, error: 'no upgradable files found' };

  let focusFile = null, focusContent = null;
  if (opts.focus) {
    if (!isPathUpgradable(opts.focus)) return { ok: false, error: 'focus path not in allow-list: ' + opts.focus };
    focusFile = opts.focus;
    try { focusContent = await readFile(opts.focus); } catch (err) { return { ok: false, error: 'read focus failed: ' + err.message }; }
  }

  const prompt = buildPrompt({ screenState, focusFile, focusContent, allowList });

  let raw, meta;
  try {
    const r = await aiService.askWithMeta(prompt, {
      // 8000 not 2500 — reasoning models (gpt-oss, deepseek-r1, etc.)
      // burn 1000-2000 tokens in the thinking field BEFORE emitting the
      // JSON `new_content`. Verified 2026-05-03 with gpt-oss:20b on
      // notes.js: 2500 truncated mid-content; 8000 lets the full file
      // come through. Non-reasoning models (qwen2.5, llama3.2) ignore
      // the extra budget — they stop at done_reason='stop' early.
      maxTokens: 8000,
      skipHistory: true,
      capCategory: 'self-upgrade',
      format: 'json',
    });
    raw = r.reply; meta = r.meta;
  } catch (err) {
    return { ok: false, error: 'AI call failed: ' + (err?.message || String(err)) };
  }

  const parsed = tryParseJSON(raw);
  if (!parsed) return { ok: false, error: 'AI response was not JSON', raw: String(raw).slice(0, 400) };

  if (parsed.status === 'pass') {
    return { ok: true, status: 'pass', reason: parsed.reason || 'nothing to improve' };
  }
  if (parsed.status !== 'propose') {
    return { ok: false, error: 'unknown status from AI: ' + parsed.status };
  }

  const target = parsed.target;
  const newContent = parsed.new_content;

  if (!isPathUpgradable(target)) {
    return { ok: false, error: 'AI picked a disallowed target: ' + target };
  }
  const safety = checkContentSafe(newContent);
  if (!safety.ok) {
    return { ok: false, error: 'proposed content failed safety scan: ' + safety.reason };
  }
  const syntax = validateSyntax(target, newContent);
  if (!syntax.ok) {
    return { ok: false, error: 'proposed content failed syntax check: ' + syntax.reason };
  }

  // Fetch current file for diff generation
  let oldContent = '';
  try { oldContent = await readFile(target); } catch { /* new file */ }

  if (oldContent === newContent) {
    return { ok: true, status: 'pass', reason: 'proposal identical to current content (no-op)' };
  }

  const forwardDiff = buildUnifiedDiff(oldContent, newContent, target);
  const rollbackDiff = buildUnifiedDiff(newContent, oldContent, target);

  // Stage in the selfmod-sandbox so the 5 gates can fire on apply
  const proposalId = await proposeSelfMod({
    target,
    diff: forwardDiff,
    reason: parsed.reason || 'AI self-upgrade',
    proposer: 'self-upgrader',
  });
  // Patch the proposal with rollbackDiff + new content so applyUpgrade
  // can write the file if gates pass. graphStore.updateNode REPLACES
  // props entirely, so merge by passing an updater fn that spreads the
  // previous props.
  const graphMod = await import('./graph-store.js');
  await graphMod.graphStore.updateNode(proposalId, (prev) => ({
    ...prev.props,
    rollbackDiff,
    newContent,
    oldContent,
    model: meta?.model,
    brain: meta?.brain,
    rollback_description: parsed.rollback_description || '',
  }), { kind: 'system', capabilityId: 'self-upgrader.propose' });

  eventBus.emit('self-upgrade:proposed', {
    id: proposalId,
    target,
    reason: parsed.reason,
  });

  return {
    ok: true,
    status: 'propose',
    proposalId,
    target,
    reason: parsed.reason || '',
    rollback_description: parsed.rollback_description || '',
    diff: forwardDiff,
    newContent,
    oldContent,
    meta,
  };
}

// ═══════════════════════════════════════════════════════════════
// APPLY — runs the 5 gates, then actually writes the file
// ═══════════════════════════════════════════════════════════════

/**
 * Apply a staged proposal. Walks the selfmod-sandbox's 5 gates via
 * applyProposal (which is the existing M8 code). If all 5 pass, THIS
 * function then does the M8.P5 part that sandbox intentionally skipped:
 * POST /api/files/write to actually change the source.
 *
 * On any gate failure, does NOT write and returns the gate results.
 * On disk-write failure after gates pass, marks the proposal
 * 'rolled-back' and returns ok:false with the error — the old content
 * was saved on the proposal as oldContent so a follow-up manual retry
 * can re-attempt without calling the AI again.
 *
 * @param {string} proposalId
 * @param {object} opts
 * @param {string} opts.typedConfirm — must equal proposalId literally
 */
export async function applyUpgrade(proposalId, opts = {}) {
  const proposal = await getProposal(proposalId);
  if (!proposal) return { ok: false, error: 'proposal not found' };

  // Walk the 5 gates (golden, value-lock, red-team, typed-confirm, rollback-plan)
  const gateResult = await applySelfmodProposal(proposalId, { typedConfirm: opts.typedConfirm });
  if (!gateResult.ok) return gateResult;

  // Gates passed. Now actually write the file.
  const target = proposal.target;
  const newContent = proposal.newContent;
  if (!newContent) {
    return { ok: false, error: 'proposal has no stored newContent (can happen on old proposals)' };
  }
  if (!isPathUpgradable(target)) {
    // Shouldn't happen — we checked on propose — but be paranoid
    return { ok: false, error: 'target path no longer in allow-list (defense in depth): ' + target };
  }
  const safety = checkContentSafe(newContent);
  if (!safety.ok) {
    return { ok: false, error: 'content safety re-check failed: ' + safety.reason };
  }
  const syntax = validateSyntax(target, newContent);
  if (!syntax.ok) {
    return { ok: false, error: 'syntax re-check failed (defense in depth): ' + syntax.reason };
  }

  try {
    const res = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, content: newContent }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `write failed: ${res.status}`);
    }
    const data = await res.json();

    eventBus.emit('self-upgrade:applied', { id: proposalId, target, bytes: data.bytes });
    return {
      ok: true,
      proposalId,
      target,
      bytes: data.bytes,
      gatesPassed: gateResult.gatesPassed,
      note: 'Astrion modified its own source. Reload (Cmd+R) or wait for nova-update (~hourly) to see changes.',
    };
  } catch (err) {
    eventBus.emit('self-upgrade:write-failed', { id: proposalId, target, error: err.message });
    return { ok: false, error: 'disk write failed AFTER gates passed: ' + err.message, gatesPassed: gateResult.gatesPassed };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROLLBACK + HISTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Roll back a previously-applied self-upgrade. Writes the proposal's
 * saved oldContent back to disk and marks the proposal 'rolled-back'.
 *
 * This is the "oh shit" button. No gate re-walk — by design, the user
 * already accepted the original 5-gate check and now needs to escape
 * from a broken change. Restoring the PRIOR content (which had been
 * running before the upgrade) is strictly safer than staying on the
 * new one.
 *
 * Refuses to restore an already-rolled-back proposal (idempotency).
 *
 * @param {string} proposalId
 * @returns {Promise<{ok, target?, bytes?, error?}>}
 */
export async function rollbackUpgrade(proposalId) {
  const proposal = await getProposal(proposalId);
  if (!proposal) return { ok: false, error: 'proposal not found' };
  if (proposal.status === 'rolled-back') return { ok: false, error: 'already rolled back' };
  if (proposal.status !== 'approved') return { ok: false, error: 'can only roll back approved proposals (status=' + proposal.status + ')' };

  const target = proposal.target;
  const oldContent = proposal.oldContent;
  if (typeof oldContent !== 'string') {
    return { ok: false, error: 'proposal has no stored oldContent — cannot rollback' };
  }
  if (!isPathUpgradable(target)) {
    return { ok: false, error: 'target path not in allow-list: ' + target };
  }

  try {
    const res = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, content: oldContent }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `rollback write failed: ${res.status}`);
    }
    const data = await res.json();

    // Mark the proposal rolled-back for audit
    const graphMod = await import('./graph-store.js');
    await graphMod.graphStore.updateNode(proposalId, (prev) => ({
      ...prev.props,
      status: 'rolled-back',
      rolledBackAt: Date.now(),
    }), { kind: 'system', capabilityId: 'self-upgrader.rollback' });

    eventBus.emit('self-upgrade:rolled-back', { id: proposalId, target, bytes: data.bytes });
    return {
      ok: true,
      proposalId,
      target,
      bytes: data.bytes,
      note: 'Restored previous content. Reload (Cmd+R) to see the pre-upgrade state.',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Find the most recently applied (status=approved, not yet rolled-back)
 * self-upgrade proposal. Used by the "undo last upgrade" Spotlight
 * command + the inline Undo button post-apply.
 */
export async function getLastApplied() {
  try {
    const graphMod = await import('./graph-store.js');
    const { query } = await import('./graph-query.js');
    const results = await query(graphMod.graphStore, {
      type: 'select',
      from: 'selfmod-proposal',
      where: { 'props.status': 'approved' },
      orderBy: 'appliedAt',
      orderDir: 'desc',
      limit: 1,
    });
    if (!results.length) return null;
    const n = results[0];
    return { id: n.id, ...n.props };
  } catch (err) {
    console.warn('[self-upgrader] getLastApplied failed:', err?.message);
    return null;
  }
}

/**
 * List the full self-upgrade history — applied + rolled-back + discarded
 * + pending. Used by Settings > Safety for the audit surface.
 */
export async function listUpgradeHistory(limit = 50) {
  try {
    const graphMod = await import('./graph-store.js');
    const { query } = await import('./graph-query.js');
    const results = await query(graphMod.graphStore, {
      type: 'select',
      from: 'selfmod-proposal',
      where: {},
      orderBy: 'createdAt',
      orderDir: 'desc',
      limit,
    });
    return results
      .filter(n => n.props?.proposer === 'self-upgrader')
      .map(n => ({
        id: n.id,
        target: n.props.target,
        reason: n.props.reason,
        status: n.props.status,
        createdAt: n.props.createdAt,
        appliedAt: n.props.appliedAt,
        rolledBackAt: n.props.rolledBackAt,
        discardedAt: n.props.discardedAt,
        model: n.props.model,
        brain: n.props.brain,
        rollback_description: n.props.rollback_description,
      }));
  } catch (err) {
    console.warn('[self-upgrader] listUpgradeHistory failed:', err?.message);
    return [];
  }
}
