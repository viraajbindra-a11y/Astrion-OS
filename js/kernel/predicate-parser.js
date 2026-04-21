// Astrion OS — Predicate Parser (M7.P2.d)
//
// Real recursive-descent parser for skill `when:` clauses and event
// `where:` clauses. Replaces the regex shim in skill-scheduler.js
// (lesson #144 generalised: hand-rolled parsers beat regex chains
// for any DSL with >5 operators).
//
// Grammar:
//   expr        = orExpr
//   orExpr      = andExpr  ( 'or'  andExpr  )*
//   andExpr     = notExpr  ( 'and' notExpr  )*
//   notExpr     = 'not' notExpr | atom
//   atom        = '(' expr ')' | comparison | bareIdent
//   comparison  = path op value
//   path        = IDENT ( '.' IDENT )*
//   bareIdent   = path                    (truthy check on the value)
//   op          = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'contains'
//   value       = STRING | NUMBER | BOOLEAN | NULL | path
//
// Examples that should parse:
//   level < 15
//   level < 15 and charging == false
//   level < 15 or status == 'critical'
//   not (level >= 80 and charging == true)
//   tags contains 'work' and priority >= 3
//   user.role == 'admin' and entry.size in [1,2,3]
//   foo.bar.baz                                (truthy access)
//
// Returns: a `{ ok, predicate?, error? }` object from `compile(text)`.
// `predicate(payload) → boolean`. Compilation is deterministic and
// cheap; callers can cache by the source string.

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'contains', 'true', 'false', 'null']);

// ─── Tokenizer ───
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(' || c === ')' || c === '[' || c === ']' || c === ',') {
      tokens.push({ kind: c, value: c });
      i++;
      continue;
    }
    if (c === '=' && src[i + 1] === '=') { tokens.push({ kind: 'op', value: '==' }); i += 2; continue; }
    if (c === '!' && src[i + 1] === '=') { tokens.push({ kind: 'op', value: '!=' }); i += 2; continue; }
    if (c === '<') {
      if (src[i + 1] === '=') { tokens.push({ kind: 'op', value: '<=' }); i += 2; }
      else { tokens.push({ kind: 'op', value: '<' }); i++; }
      continue;
    }
    if (c === '>') {
      if (src[i + 1] === '=') { tokens.push({ kind: 'op', value: '>=' }); i += 2; }
      else { tokens.push({ kind: 'op', value: '>' }); i++; }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          const next = src[j + 1];
          str += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          j += 2;
        } else {
          str += src[j];
          j++;
        }
      }
      if (j >= n) throw new Error('unterminated string at index ' + i);
      tokens.push({ kind: 'string', value: str });
      i = j + 1;
      continue;
    }
    // Number (incl. negative, decimal, exponent)
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[0-9.eE+\-]/.test(src[j])) {
        // Stop at '+'/'-' that isn't part of an exponent
        if ((src[j] === '+' || src[j] === '-') && src[j - 1] !== 'e' && src[j - 1] !== 'E') break;
        j++;
      }
      const slice = src.slice(i, j);
      const num = parseFloat(slice);
      if (!isFinite(num)) throw new Error('bad number: ' + slice);
      tokens.push({ kind: 'number', value: num });
      i = j;
      continue;
    }
    // Identifier or keyword (path segments separated by . handled in parser)
    if (/[a-zA-Z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[a-zA-Z0-9_$.]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === 'and' || lower === 'or' || lower === 'not' || lower === 'in' || lower === 'contains') {
        tokens.push({ kind: 'op', value: lower });
      } else if (lower === 'true' || lower === 'false') {
        tokens.push({ kind: 'bool', value: lower === 'true' });
      } else if (lower === 'null') {
        tokens.push({ kind: 'null', value: null });
      } else {
        tokens.push({ kind: 'ident', value: word });
      }
      i = j;
      continue;
    }
    throw new Error('unexpected character ' + JSON.stringify(c) + ' at index ' + i);
  }
  return tokens;
}

// ─── Parser ───
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];
  const expect = (kind, value) => {
    const t = tokens[pos];
    if (!t || t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error('expected ' + (value !== undefined ? value : kind) + ' at token ' + pos);
    }
    pos++;
    return t;
  };

  function parseExpr() { return parseOr(); }

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().kind === 'op' && peek().value === 'or') {
      eat();
      const right = parseAnd();
      left = { node: 'or', left, right };
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    while (peek() && peek().kind === 'op' && peek().value === 'and') {
      eat();
      const right = parseNot();
      left = { node: 'and', left, right };
    }
    return left;
  }

  function parseNot() {
    if (peek() && peek().kind === 'op' && peek().value === 'not') {
      eat();
      return { node: 'not', child: parseNot() };
    }
    return parseAtom();
  }

  function parseAtom() {
    const t = peek();
    if (!t) throw new Error('unexpected end of input');
    if (t.kind === '(') {
      eat();
      const inner = parseExpr();
      expect(')');
      return inner;
    }
    if (t.kind === 'ident') {
      const path = parsePath();
      const next = peek();
      if (!next || next.kind !== 'op' || ['and', 'or', 'not'].includes(next.value)) {
        // Bare identifier — truthy check on the value
        return { node: 'truthy', path };
      }
      const op = eat().value;
      const value = parseValue();
      return { node: 'cmp', path, op, value };
    }
    throw new Error('unexpected token ' + JSON.stringify(t));
  }

  function parsePath() {
    const first = expect('ident').value;
    // Segments may be embedded in the ident (the tokenizer keeps "user.role" as one ident)
    return first.split('.');
  }

  function parseValue() {
    const t = peek();
    if (!t) throw new Error('unexpected end of input (value)');
    if (t.kind === 'string') { eat(); return { kind: 'literal', value: t.value }; }
    if (t.kind === 'number') { eat(); return { kind: 'literal', value: t.value }; }
    if (t.kind === 'bool')   { eat(); return { kind: 'literal', value: t.value }; }
    if (t.kind === 'null')   { eat(); return { kind: 'literal', value: null }; }
    if (t.kind === '[') {
      eat();
      const items = [];
      while (peek() && peek().kind !== ']') {
        items.push(parseValue());
        if (peek() && peek().kind === ',') eat();
      }
      expect(']');
      return { kind: 'array', items };
    }
    if (t.kind === 'ident') {
      // value can also be a path reference
      const path = parsePath();
      return { kind: 'path', path };
    }
    throw new Error('expected value, got ' + JSON.stringify(t));
  }

  const ast = parseExpr();
  if (pos < tokens.length) throw new Error('trailing tokens at ' + pos + ': ' + JSON.stringify(tokens.slice(pos)));
  return ast;
}

// ─── Evaluator ───
function getPath(payload, path) {
  let cur = payload;
  for (const seg of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function resolveValue(v, payload) {
  if (v.kind === 'literal') return v.value;
  if (v.kind === 'path') return getPath(payload, v.path);
  if (v.kind === 'array') return v.items.map(it => resolveValue(it, payload));
  return undefined;
}

function evalNode(ast, payload) {
  switch (ast.node) {
    case 'or':  return evalNode(ast.left, payload) || evalNode(ast.right, payload);
    case 'and': return evalNode(ast.left, payload) && evalNode(ast.right, payload);
    case 'not': return !evalNode(ast.child, payload);
    case 'truthy': {
      const v = getPath(payload, ast.path);
      return !!v;
    }
    case 'cmp': {
      const lhs = getPath(payload, ast.path);
      const rhs = resolveValue(ast.value, payload);
      switch (ast.op) {
        case '==': return looseEqual(lhs, rhs);
        case '!=': return !looseEqual(lhs, rhs);
        case '<':  return Number(lhs) <  Number(rhs);
        case '<=': return Number(lhs) <= Number(rhs);
        case '>':  return Number(lhs) >  Number(rhs);
        case '>=': return Number(lhs) >= Number(rhs);
        case 'in': {
          if (!Array.isArray(rhs)) return false;
          return rhs.some(x => looseEqual(lhs, x));
        }
        case 'contains': {
          if (Array.isArray(lhs)) return lhs.some(x => looseEqual(x, rhs));
          if (typeof lhs === 'string') return lhs.includes(String(rhs));
          if (lhs && typeof lhs === 'object') return Object.prototype.hasOwnProperty.call(lhs, rhs);
          return false;
        }
      }
      return false;
    }
  }
  return false;
}

function looseEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  // number-vs-string-of-number coercion (match the regex shim's behavior)
  const na = Number(a), nb = Number(b);
  if (isFinite(na) && isFinite(nb)) return na === nb;
  return false;
}

// ─── Public API ───

/**
 * Compile a predicate text into a `(payload) → boolean` function.
 * Returns { ok: true, predicate } on success or { ok: false, error } on
 * parse/tokenize failure. Empty / whitespace-only input compiles to a
 * predicate that always returns true (matches the previous shim).
 */
export function compile(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: true, predicate: () => true };
  try {
    const tokens = tokenize(trimmed);
    const ast = parse(tokens);
    return { ok: true, predicate: (payload) => {
      try { return !!evalNode(ast, payload || {}); }
      catch { return false; }
    } };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Convenience for callers that just want the boolean answer.
 * Bad predicate text returns false (matches the regex shim's behavior).
 */
export function matches(text, payload) {
  const c = compile(text);
  if (!c.ok) return false;
  return c.predicate(payload);
}

// ─── Inline sanity tests ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  let fails = 0;
  const t = (label, expr, payload, expected) => {
    const got = matches(expr, payload);
    if (got !== expected) {
      console.warn('[predicate-parser] FAIL', label, '|', expr, '→', got, 'expected', expected);
      fails++;
    }
  };
  // Empty / whitespace
  t('empty',  '',           { x: 1 }, true);
  t('spaces', '   ',        { x: 1 }, true);
  // Simple comparisons
  t('lt',     'level < 15', { level: 10 }, true);
  t('lt-fail','level < 15', { level: 20 }, false);
  t('eq-num', 'n == 5',     { n: 5 },      true);
  t('eq-str', 'k == "hi"',  { k: 'hi' },   true);
  t('neq',    'k != "hi"',  { k: 'bye' },  true);
  t('gte',    'p >= 3',     { p: 3 },      true);
  // and / or
  t('and',    'a == 1 and b == 2', { a: 1, b: 2 }, true);
  t('and-f',  'a == 1 and b == 2', { a: 1, b: 9 }, false);
  t('or',     'a == 1 or b == 2',  { a: 9, b: 2 }, true);
  t('or-ff',  'a == 1 or b == 2',  { a: 9, b: 9 }, false);
  // not
  t('not',    'not (a == 1)',      { a: 2 }, true);
  t('not-f',  'not (a == 1)',      { a: 1 }, false);
  // Parens for precedence
  t('parens', '(a == 1 or b == 2) and c == 3', { a: 1, b: 0, c: 3 }, true);
  t('parens-f','(a == 1 or b == 2) and c == 3', { a: 1, b: 0, c: 4 }, false);
  // in / contains
  t('in',     'role in ["admin","root"]', { role: 'admin' }, true);
  t('in-f',   'role in ["admin","root"]', { role: 'guest' }, false);
  t('cont-arr','tags contains "work"',    { tags: ['work', 'home'] }, true);
  t('cont-str','msg contains "hello"',    { msg: 'say hello' },       true);
  // Nested path
  t('path',   'user.role == "admin"',     { user: { role: 'admin' } }, true);
  t('path-f', 'user.role == "admin"',     { user: { role: 'guest' } }, false);
  // Truthy
  t('truthy', 'x',                         { x: 'yes' }, true);
  t('truthy-0','x',                        { x: 0 },     false);
  // Error cases — bad predicate returns false, doesn't throw
  t('bad-syntax','a < <',                  { a: 1 }, false);
  // Regression for the original use case
  t('battery','level < 15 and charging == false', { level: 10, charging: false }, true);
  t('battery-f','level < 15',              { level: 20 }, false);

  if (fails === 0) console.log('[predicate-parser] all 26 sanity tests pass');
  else console.warn('[predicate-parser] ' + fails + ' sanity failures');
}
