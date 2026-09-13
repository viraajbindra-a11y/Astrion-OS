// The FROM guard for /api/ai/ollama-create. One copy, imported by
// server/index.js (the server) and server/tests/ollama-create-guard.test.mjs
// (the test).
//
// It used to be four lines of regex inside index.js with a second copy inside
// the test, "duplicated on purpose" because importing index.js starts a
// listening server. The cost of that duplication was the whole point of the
// test: loosen the regex in index.js and the test keeps passing its own copy.
// A page that can reach the server could then aim the Ollama daemon at an
// arbitrary path or URL and nothing would go red. Now there is nothing to
// keep in sync -- this module has no side effects, so the test imports the
// same function the server runs.
//
// A Modelfile is executable configuration for the local Ollama daemon, and the
// create endpoint hands it whatever arrives in the body. FROM is the only
// directive that names something to RUN, so it is the one worth pinning:
// refuse anything whose base is not a plain registry tag.

export const FROM_LINE = /^\s*FROM\s+(\S+)/im;
export const PLAIN_TAG = /^[a-z0-9._-]+(:[a-z0-9._-]+)?$/i;

/**
 * @param {string} modelfile
 * @returns {{ ok: true, from: string } | { ok: false, error: string }}
 */
export function checkModelfile(modelfile) {
  const from = FROM_LINE.exec(modelfile);
  if (!from) {
    return { ok: false, error: 'modelfile must start with a FROM line' };
  }
  if (!PLAIN_TAG.test(from[1])) {
    return { ok: false, error: 'FROM must be a plain model tag, not a path or a URL: ' + from[1] };
  }
  return { ok: true, from: from[1] };
}
