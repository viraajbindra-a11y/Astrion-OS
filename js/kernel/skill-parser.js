// Astrion OS — Skill parser (M7.P2a)
//
// Parses a .skill file (see docs/skill-language.md) into a plain JS
// object. The format is indented-YAML-flavored with 5 top-level
// keywords: goal, trigger, when, do, constraints.
//
// Design:
//   - Hand-rolled (no YAML lib dep). The grammar is small enough that
//     200 lines of tokenize-then-walk beats pulling in js-yaml.
//   - Tolerant on whitespace, strict on structure. If a line doesn't
//     match any rule, the parser throws with line number + message —
//     never silently drops content.
//   - Strings are unquoted by default (to end-of-line). Double-quoted
//     strings survive leading/trailing whitespace and preserve any
//     inner whitespace. Single quotes are NOT special.
//   - Multi-line strings use the YAML `|` block scalar: content is
//     every subsequent line indented more than the key.
//
// Output shape:
//   {
//     goal: string,
//     trigger: Array<{ phrase?: string, cron?: string, event?: string, where?: string }>,
//     when: Array<string>,         // empty array if no `when:` block
//     do: string,                  // trimmed
//     constraints: { level, budget_tokens, reversibility }   // filled with defaults
//   }
//
// The parser does NOT validate semantics (e.g., cron syntax, level
// values) — that's the skill-registry's job at load time.

const KEYWORDS = new Set(['goal', 'trigger', 'when', 'do', 'constraints']);
const MAGIC_RE = /^\s*#\s*astrion-skill\s+v(\d+)/i;
const DEFAULT_CONSTRAINTS = { level: 'L1', budget_tokens: 200, reversibility: 'BOUNDED' };

function stripInlineComment(line) {
  // A '#' preceded by whitespace (or at start) is the start of a comment.
  // '#' inside a quoted string is literal — so check for an opening '"'
  // before the '#' position and bail if we're inside quotes.
  let i = 0, inStr = false;
  while (i < line.length) {
    const c = line[i];
    if (c === '"') inStr = !inStr;
    else if (c === '#' && !inStr && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i).trimEnd();
    }
    i++;
  }
  return line;
}

function unquote(s) {
  if (!s) return s;
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  return s;
}

function indentOf(line) {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

export function parseSkill(text) {
  if (typeof text !== 'string') throw new Error('parseSkill: expected string input');
  const rawLines = text.split(/\r?\n/);
  const result = { goal: null, trigger: [], when: [], do: null, constraints: { ...DEFAULT_CONSTRAINTS } };
  let version = 1;
  const magic = rawLines.find(l => MAGIC_RE.test(l));
  if (magic) version = parseInt(magic.match(MAGIC_RE)[1], 10);
  if (version > 1) throw new Error(`parseSkill: skill version ${version} newer than parser v1`);

  // Strip full-line comments + trailing comments, but keep indentation intact.
  const lines = rawLines.map(raw => {
    const noc = stripInlineComment(raw);
    // treat now-empty lines as empty (whitespace only)
    return noc.trimEnd();
  });

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const ind = indentOf(line);
    if (ind !== 0) throw new Error(`parseSkill: unexpected indent at line ${i + 1}: "${line}"`);
    const m = line.match(/^([a-z_]+)\s*:\s*(.*)$/);
    if (!m) throw new Error(`parseSkill: expected "key:" at line ${i + 1}: "${line}"`);
    const [, key, rest] = m;
    if (!KEYWORDS.has(key)) throw new Error(`parseSkill: unknown top-level keyword "${key}" at line ${i + 1}`);

    if (key === 'goal') {
      if (!rest) throw new Error(`parseSkill: goal requires a value at line ${i + 1}`);
      result.goal = unquote(rest);
      i++;
    } else if (key === 'do') {
      if (rest === '|' || rest === '>') {
        // Multi-line block scalar. Consume every subsequent line with indent > 0.
        const buf = [];
        i++;
        while (i < lines.length) {
          const bl = lines[i];
          if (!bl.trim()) { buf.push(''); i++; continue; }
          if (indentOf(bl) === 0) break;
          buf.push(bl.replace(/^\s{1,4}/, '')); // strip up to 4 leading spaces of block indent
          i++;
        }
        // Trim leading/trailing blank lines
        while (buf.length && !buf[0].trim()) buf.shift();
        while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
        result.do = buf.join('\n');
      } else {
        if (!rest) throw new Error(`parseSkill: do requires a value at line ${i + 1}`);
        result.do = unquote(rest);
        i++;
      }
    } else if (key === 'trigger' || key === 'when') {
      if (rest) throw new Error(`parseSkill: ${key} expects a list starting on the next line, not inline (line ${i + 1})`);
      i++;
      const items = [];
      while (i < lines.length) {
        const bl = lines[i];
        if (!bl.trim()) { i++; continue; }
        if (indentOf(bl) === 0) break;
        const entryMatch = bl.match(/^\s+-\s*(.*)$/);
        if (!entryMatch) throw new Error(`parseSkill: expected "- ..." list entry at line ${i + 1}: "${bl}"`);
        const firstLine = entryMatch[1];
        i++;
        if (key === 'when') {
          items.push(unquote(firstLine));
          continue;
        }
        // trigger list entries are objects. firstLine might be "phrase: ..." or
        // just "phrase: ..." with a nested "where: ..." on the next line.
        const obj = {};
        const parseObjLine = (s) => {
          const om = s.match(/^([a-z_]+)\s*:\s*(.*)$/);
          if (!om) throw new Error(`parseSkill: expected "<field>: value" at line ${i}: "${s}"`);
          obj[om[1]] = unquote(om[2]);
        };
        parseObjLine(firstLine);
        // consume continuation lines that are MORE indented than the "-"
        const dashIndent = indentOf(bl);
        while (i < lines.length) {
          const sub = lines[i];
          if (!sub.trim()) { i++; continue; }
          if (indentOf(sub) <= dashIndent) break;
          parseObjLine(sub.trimStart());
          i++;
        }
        items.push(obj);
      }
      result[key] = items;
    } else if (key === 'constraints') {
      if (rest) throw new Error(`parseSkill: constraints expects an indented block, not inline (line ${i + 1})`);
      i++;
      while (i < lines.length) {
        const bl = lines[i];
        if (!bl.trim()) { i++; continue; }
        if (indentOf(bl) === 0) break;
        const cm = bl.match(/^\s+([a-z_]+)\s*:\s*(.*)$/);
        if (!cm) throw new Error(`parseSkill: expected "<field>: value" in constraints at line ${i + 1}: "${bl}"`);
        const [, ck, cv] = cm;
        const val = unquote(cv);
        if (ck === 'budget_tokens') {
          const n = parseInt(val, 10);
          if (!isFinite(n) || n <= 0) throw new Error(`parseSkill: budget_tokens must be a positive integer at line ${i + 1}`);
          result.constraints.budget_tokens = n;
        } else {
          result.constraints[ck] = val;
        }
        i++;
      }
    }
  }

  // Required keywords
  if (!result.goal) throw new Error('parseSkill: `goal` is required');
  if (!result.do) throw new Error('parseSkill: `do` is required');
  if (!result.trigger.length) throw new Error('parseSkill: `trigger` is required (at least one entry)');
  return { version, ...result };
}

// ─── Sanity tests (localhost only) ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const cases = [
    {
      name: 'minimal',
      src: `goal: do a thing
trigger:
  - phrase: "thing"
do: |
  Do the thing.`,
      expect: (r) => r.goal === 'do a thing' && r.trigger[0].phrase === 'thing' && r.do === 'Do the thing.' && r.constraints.level === 'L1',
    },
    {
      name: 'with magic header',
      src: `# astrion-skill v1
goal: x
trigger:
  - phrase: "x"
do: x`,
      expect: (r) => r.version === 1 && r.goal === 'x',
    },
    {
      name: 'multiple triggers + when',
      src: `goal: multi
trigger:
  - phrase: "go"
  - cron: "0 9 * * *"
  - event: "battery:changed"
    where: "level < 15"
when:
  - "pred one"
  - "pred two"
do: |
  multi-line
  content here`,
      expect: (r) => r.trigger.length === 3 && r.trigger[2].event === 'battery:changed' && r.trigger[2].where === 'level < 15' && r.when.length === 2 && r.do.includes('multi-line'),
    },
    {
      name: 'constraints',
      src: `goal: x
trigger:
  - phrase: "x"
do: x
constraints:
  level: L2
  budget_tokens: 400
  reversibility: FREE`,
      expect: (r) => r.constraints.level === 'L2' && r.constraints.budget_tokens === 400 && r.constraints.reversibility === 'FREE',
    },
    {
      name: 'full-line comment ignored',
      src: `# a comment
goal: x  # trailing comment
trigger:
  - phrase: "x"
do: x`,
      expect: (r) => r.goal === 'x',
    },
    {
      name: 'missing goal throws',
      src: `trigger:
  - phrase: "x"
do: x`,
      expect: null, shouldThrow: true,
    },
    {
      name: 'missing do throws',
      src: `goal: x
trigger:
  - phrase: "x"`,
      expect: null, shouldThrow: true,
    },
    {
      name: 'unknown keyword throws',
      src: `goal: x
bogus: y
trigger:
  - phrase: "x"
do: x`,
      expect: null, shouldThrow: true,
    },
    {
      name: 'newer version throws',
      src: `# astrion-skill v7
goal: x
trigger:
  - phrase: "x"
do: x`,
      expect: null, shouldThrow: true,
    },
  ];
  let f = 0;
  for (const c of cases) {
    try {
      const r = parseSkill(c.src);
      if (c.shouldThrow) { console.warn('[skill-parser] should have thrown:', c.name); f++; }
      else if (!c.expect(r)) { console.warn('[skill-parser] assert FAIL:', c.name, r); f++; }
    } catch (e) {
      if (!c.shouldThrow) { console.warn('[skill-parser] unexpected throw:', c.name, e.message); f++; }
    }
  }
  if (f === 0) console.log('[skill-parser] all', cases.length, 'sanity tests pass');
  else console.warn('[skill-parser]', f, 'sanity tests failed');
}
