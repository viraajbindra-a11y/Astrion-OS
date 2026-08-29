// Guard test for /api/ai/ollama-create (server/index.js).
//
// A Modelfile is executable configuration handed to the local Ollama daemon,
// and the create endpoint passes whatever arrives in the request body. FROM is
// the only directive in it that names something to RUN, so it is the one that
// must not be allowed to point at an arbitrary path or host - otherwise any
// page that can reach this server can aim the daemon wherever it likes.
//
// The guard is four lines of regex in index.js. This file is the reason anyone
// can believe it: it pins the ACCEPT cases, so a future tightening cannot
// silently break real Modelfiles, and the REJECT cases, so a future loosening
// cannot silently open it up.
//
// The regex is duplicated here rather than imported ON PURPOSE. index.js
// starts a listening server the moment it is imported, and a test that has to
// boot a server to check a regex is a test nobody runs. The cost of the
// duplication is that both copies must change together - which is what the
// last line of this comment is for, and what a flipping row will tell you.
//
//   node server/tests/ollama-create-guard.test.mjs

function check(modelfile) {
  const from = /^\s*FROM\s+(\S+)/im.exec(modelfile);
  if (!from) return 'no FROM line';
  if (!/^[a-z0-9._-]+(:[a-z0-9._-]+)?$/i.test(from[1])) return 'rejected: ' + from[1];
  return 'ACCEPT ' + from[1];
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
console.log(bad ? `\n${bad} FAILURE(S)` : '\nall 12 correct');
process.exit(bad ? 1 : 0);
