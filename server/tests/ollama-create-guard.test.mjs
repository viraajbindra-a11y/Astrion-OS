// Guard test for /api/ai/ollama-create (server/index.js).
//
// A Modelfile is executable configuration handed to the local Ollama daemon,
// and the create endpoint passes whatever arrives in the request body. FROM is
// the only directive in it that names something to RUN, so it is the one that
// must not be allowed to point at an arbitrary path or host - otherwise any
// page that can reach this server can aim the daemon wherever it likes.
//
// This file pins the ACCEPT cases, so a future tightening cannot silently
// break real Modelfiles, and the REJECT cases, so a future loosening cannot
// silently open it up.
//
// It imports the guard the server actually runs (server/modelfile-guard.js).
// The first version of this test carried its own COPY of the regex, because
// importing index.js starts a listening server. That copy was the hole: loosen
// the regex in index.js and this test kept passing its own. The guard now
// lives in a side-effect-free module that both sides import, and the last
// section below proves it -- it reads index.js and refuses to pass if the
// endpoint has grown a private FROM regex again or stopped calling the
// shared function.
//
//   node server/tests/ollama-create-guard.test.mjs

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { checkModelfile } from '../modelfile-guard.js';

const here = dirname(fileURLToPath(import.meta.url));

function check(modelfile) {
  const r = checkModelfile(modelfile);
  return r.ok ? 'ACCEPT ' + r.from : 'rejected: ' + r.error;
}
const cases = [
  ['FROM qwen3:8b\nSYSTEM "hi"',                'accept'],
  ['from qwen3:1.7b',                            'accept'],
  ['  FROM qwen3\nPARAMETER temperature 0.7',    'accept'],
  ['SYSTEM "x"\nFROM qwen3:14b',                 'accept'],
  ['SYSTEM "no from line here"',                 'reject'],
  ['FROM /etc/passwd',                           'reject'],
  ['FROM ./local/file.gguf',                     'reject'],
  ['FROM https://evil.example/x.gguf',           'reject'],
  ['FROM ~/models/x.gguf',                       'reject'],
  ['FROM ../../../secret',                       'reject'],
  ['FROM qwen3:8b;rm -rf /',                     'reject'],
  ['FROM host.docker.internal:11434/x',          'reject'],
];
let bad = 0;
for (const [mf, want] of cases) {
  const got = check(mf);
  const isAccept = got.startsWith('ACCEPT');
  const ok = (want === 'accept') === isAccept;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  want ${want.padEnd(6)}  ${JSON.stringify(mf.split('\n')[0]).padEnd(42)} -> ${got}`);
}

// ---- is the server running THIS guard? -----------------------------------
// index.js cannot be imported here (it listens on import), so the wiring is
// checked textually: the create endpoint must call checkModelfile and must
// not contain a FROM regex of its own. Either drift turns this test back into
// a test of a copy.
const indexSrc = readFileSync(join(here, '..', 'index.js'), 'utf8');
const endpointStart = indexSrc.indexOf("app.post('/api/ai/ollama-create'");
const endpoint = endpointStart >= 0 ? indexSrc.slice(endpointStart, endpointStart + 4000) : '';
const wired = [
  [endpointStart >= 0, "index.js defines app.post('/api/ai/ollama-create')"],
  [/import\s*\{[^}]*\bcheckModelfile\b[^}]*\}\s*from\s*'\.\/modelfile-guard\.js'/.test(indexSrc),
    'index.js imports checkModelfile from ./modelfile-guard.js'],
  [/checkModelfile\s*\(\s*modelfile\s*\)/.test(endpoint),
    'the create endpoint calls checkModelfile(modelfile)'],
  [!/FROM\\s\+|\[a-z0-9\._-\]\+/.test(endpoint),
    'the create endpoint has no private FROM regex (would be a copy again)'],
];
for (const [ok, what] of wired) {
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  wiring: ${what}`);
}

console.log(bad ? `\n${bad} FAILURE(S)` : `\nall ${cases.length} cases correct; server and test share one guard`);
process.exit(bad ? 1 : 0);
