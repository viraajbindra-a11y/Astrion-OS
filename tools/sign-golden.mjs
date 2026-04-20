#!/usr/bin/env node
// Astrion OS — Golden file signer (M8.P1)
//
// Computes SHA-256 of every safety-critical file and writes
// /golden.lock.json. Run after intentional changes to any golden file
// — the boot-time check refuses to start cleanly if the on-disk
// hash doesn't match the lockfile.
//
// Usage:
//   node tools/sign-golden.mjs            # write golden.lock.json
//   node tools/sign-golden.mjs --check    # exit 0 if matches, 1 if drift
//
// The list below names every file the M8 self-modifier MUST NOT touch.
// New safety primitives go in this list at landing time, not after.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = resolve(REPO, 'golden.lock.json');

// Golden file list. Every entry is a path relative to repo root. Files
// that don't exist yet (e.g., M8.P2 will add 'js/kernel/value-lock.js')
// are placeholders — they're listed so the lock has a slot for them
// once they land.
const GOLDEN = [
  'js/kernel/capability-api.js',
  'js/kernel/operation-interceptor.js',
  'js/kernel/red-team.js',
  'js/kernel/rubber-stamp-tracker.js',
  'js/kernel/chaos-injector.js',
  'js/kernel/branch-manager.js',
  'js/kernel/intent-executor.js',
  'js/kernel/budget-manager.js',
  'js/kernel/socratic-prompter.js',
  'js/kernel/skill-parser.js',
  'js/kernel/skill-registry.js',
  'js/kernel/golden-check.js',
  'js/kernel/value-lock.js',
  'js/kernel/selfmod-sandbox.js',
  'js/kernel/drift-detector.js',
  'test/v03-verification.html',
];

async function sha256(path) {
  const buf = await readFile(resolve(REPO, path));
  return createHash('sha256').update(buf).digest('hex');
}

async function buildLock() {
  const out = { version: 1, generated_at: new Date().toISOString(), files: {} };
  for (const path of GOLDEN) {
    try {
      out.files[path] = await sha256(path);
    } catch (err) {
      out.files[path] = null; // placeholder for files not yet on disk
      console.warn(`[sign-golden] missing: ${path} — placeholder null hash`);
    }
  }
  return out;
}

async function main() {
  const check = process.argv.includes('--check');
  const fresh = await buildLock();
  if (check) {
    let existing;
    try { existing = JSON.parse(await readFile(LOCK_PATH, 'utf8')); }
    catch { console.error('[sign-golden] no lockfile to check against'); process.exit(1); }
    let drift = 0;
    for (const path of GOLDEN) {
      if (fresh.files[path] !== existing.files[path]) {
        console.error(`[sign-golden] DRIFT: ${path}`);
        console.error(`  on-disk: ${fresh.files[path]}`);
        console.error(`  locked:  ${existing.files[path]}`);
        drift++;
      }
    }
    if (drift) { console.error(`[sign-golden] ${drift} file(s) drifted from lock`); process.exit(1); }
    console.log(`[sign-golden] all ${GOLDEN.length} golden files match lock`);
    return;
  }
  await writeFile(LOCK_PATH, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
  console.log(`[sign-golden] wrote ${LOCK_PATH} (${GOLDEN.length} files)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
