// Astrion OS — safe math evaluator (no Function/eval, no DOM access).
//
// Tiny recursive-descent parser for + - * / ^ ** ( ) plus pi and e.
// Originally lived in ai-service.js; promoted to a shared lib so
// spotlight.js can replace its `Function('"use strict"; return ...')`
// pattern with the same hardened path. Audit: 2026-04-12 → fixed in
// ai-service same week, spotlight closed 2026-05-02.
//
// Throws on:
//   - unknown identifiers (sqrt, sin, Math.constructor, etc.)
//   - any character outside the allowlist
//   - mismatched parens / trailing tokens / empty input
//
// Supports: scientific notation (1e6, 1.5e-3), pi/PI, e/E, right-assoc
// exponent (2^3^2 = 512), unary +/-, and ** as a synonym for ^.

export function safeMathEval(expr) {
  if (typeof expr !== 'string') throw new Error('safeMathEval: input must be a string');
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let n = '';
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        n += expr[i++];
      }
      // Scientific notation: 1e6, 1.5e-3, 2E+10. Only consume the e/E
      // suffix if it's followed by [optional + or -] then at least one
      // digit — otherwise leave the e/E for the operator parser.
      if (i < expr.length && (expr[i] === 'e' || expr[i] === 'E')) {
        let look = i + 1;
        if (look < expr.length && (expr[look] === '+' || expr[look] === '-')) look++;
        if (look < expr.length && expr[look] >= '0' && expr[look] <= '9') {
          n += expr[i++];
          if (expr[i] === '+' || expr[i] === '-') n += expr[i++];
          while (i < expr.length && expr[i] >= '0' && expr[i] <= '9') n += expr[i++];
        }
      }
      const v = parseFloat(n);
      if (!isFinite(v)) throw new Error('safeMathEval: bad number ' + n);
      tokens.push({ t: 'num', v });
    } else if (ch === '*' && expr[i + 1] === '*') {
      tokens.push({ t: 'op', v: '^' });
      i += 2;
    } else if ('+-*/()^%'.indexOf(ch) >= 0) {
      tokens.push({ t: 'op', v: ch });
      i++;
    } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      // Named constants only: pi / e / PI / E. Anything else (sqrt, sin,
      // Math, constructor, ...) throws — that's the security gate.
      let name = '';
      while (i < expr.length && ((expr[i] >= 'a' && expr[i] <= 'z') || (expr[i] >= 'A' && expr[i] <= 'Z'))) {
        name += expr[i++];
      }
      const low = name.toLowerCase();
      if (low === 'pi') tokens.push({ t: 'num', v: Math.PI });
      else if (low === 'e') tokens.push({ t: 'num', v: Math.E });
      else throw new Error('safeMathEval: bad identifier ' + name);
    } else {
      throw new Error('safeMathEval: bad char ' + ch);
    }
  }
  let p = 0;
  function expect(v) {
    if (!tokens[p] || tokens[p].v !== v) throw new Error('safeMathEval: expected ' + v);
    p++;
  }
  function parseExpr() {
    let left = parseTerm();
    while (tokens[p] && (tokens[p].v === '+' || tokens[p].v === '-')) {
      const op = tokens[p++].v;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parsePower();
    while (tokens[p] && (tokens[p].v === '*' || tokens[p].v === '/' || tokens[p].v === '%')) {
      const op = tokens[p++].v;
      const right = parsePower();
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
    return left;
  }
  // Right-associative exponent: 2^3^2 = 2^(3^2) = 512
  function parsePower() {
    const left = parseFactor();
    if (tokens[p] && tokens[p].v === '^') {
      p++;
      const right = parsePower();
      return Math.pow(left, right);
    }
    return left;
  }
  function parseFactor() {
    const tok = tokens[p];
    if (!tok) throw new Error('safeMathEval: unexpected end');
    if (tok.v === '(') { p++; const v = parseExpr(); expect(')'); return v; }
    if (tok.v === '-') { p++; return -parsePower(); }
    if (tok.v === '+') { p++; return  parsePower(); }
    if (tok.t === 'num') { p++; return tok.v; }
    throw new Error('safeMathEval: bad token ' + JSON.stringify(tok));
  }
  const result = parseExpr();
  if (p !== tokens.length) throw new Error('safeMathEval: trailing tokens');
  return result;
}

// Sanity tests on localhost — runs once at import time.
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const cases = [
    ['1 + 2', 3],
    ['2 * 3', 6],
    ['10 - 4', 6],
    ['8 / 2', 4],
    ['5 % 3', 2],
    ['2 ^ 3', 8],
    ['2 ** 10', 1024],
    ['(1 + 2) * 3', 9],
    ['-5', -5],
    ['+5', 5],
    ['2 ^ 3 ^ 2', 512],          // right-assoc
    ['1e6', 1000000],
    ['1.5e-3', 0.0015],
    ['pi', Math.PI],
    ['e', Math.E],
    ['(1+2)^3', 27],
  ];
  let pass = 0, fail = 0;
  for (const [expr, expect] of cases) {
    try {
      const got = safeMathEval(expr);
      if (Math.abs(got - expect) < 1e-9) pass++;
      else { fail++; console.warn('[safe-math] FAIL', expr, '→', got, 'expected', expect); }
    } catch (err) {
      fail++; console.warn('[safe-math] THREW', expr, err.message);
    }
  }
  // Hostile inputs — must throw, not return:
  const hostile = [
    'Math.constructor("alert(1)")()',
    'sqrt(16)',         // not supported — must throw
    'sin(0)',           // not supported — must throw
    'window',           // pure identifier
    'eval("1+1")',
    '";alert(1);//',
  ];
  for (const expr of hostile) {
    try { safeMathEval(expr); fail++; console.warn('[safe-math] HOSTILE NOT REJECTED:', expr); }
    catch { pass++; }
  }
  if (fail === 0) console.log(`[safe-math] all ${pass} sanity tests pass`);
  else console.warn(`[safe-math] ${pass}/${pass+fail} pass; ${fail} fail`);
}
