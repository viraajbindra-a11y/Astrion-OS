# Astrion Skill Language v0.1 (M7.P1)

A skill is a named, shareable, declarative intent. The user types
`organize downloads` in Spotlight and Astrion runs the skill instead
of asking the planner to figure out the query from scratch every time.

The language has **5 top-level keywords**, intentionally:

| keyword       | required | what it says |
|---------------|----------|--------------|
| `goal`        | yes      | one-line description in plain English |
| `trigger`     | yes      | how the skill gets invoked (phrase / cron / event) |
| `when`        | no       | predicate(s) that must hold for the skill to actually run |
| `do`          | yes      | the planner prompt — what to do when triggered |
| `constraints` | no       | level / budget / reversibility caps (default: L1, 200, BOUNDED) |

Anything else is rejected by the validator. The 5-keyword cap is
load-bearing: every keyword maps to one primitive in the M1 kernel,
and the language stays small enough that a 12-year-old can read a
skill file and predict what it does.

---

## File layout

Skill files are plain text with a YAML-flavored indented structure.
File extension: `.skill` (parser is permissive on `.skill.yaml` /
`.skill.txt` for editor convenience). Encoding: UTF-8.

The TOP-LEVEL is a flat key:value mapping. Nested values are either
a string, a string list, or a small object with named fields.

```
goal: short one-line description
trigger:
  - phrase: "the words a user types in Spotlight"
  - phrase: "an alternate phrasing"
when:
  - "human-readable predicate"
do: |
  Multi-line natural-language directive that goes to the planner.
  Reference user data with @path/to/resource. Reference earlier
  steps' output with $name when the directive is multi-step.
constraints:
  level: L1            # L0 / L1 / L2 / L3 — max capability tier this skill may use
  budget_tokens: 200   # max planner tokens per invocation
  reversibility: BOUNDED  # FREE / BOUNDED / NONE — abort if the planner
                          # produces a step looser than this
```

A minimal skill needs only `goal`, `trigger`, and `do`:

```
goal: Show the morning weather
trigger:
  - phrase: "morning weather"
do: |
  Open the Weather app for the user's current location.
```

---

## Keywords

### `goal` (required, single string)

One line, plain English, what the skill achieves from the USER's
perspective. Not implementation details — what they get.

```
goal: Organize my Downloads folder by file type
```

### `trigger` (required, list)

Each entry says HOW the skill can fire. Three trigger types in v0.1:

```
trigger:
  - phrase: "organize downloads"        # user types in Spotlight
  - phrase: "clean up downloads"        # alternate phrasing (any may match)
  - cron: "0 9 * * *"                   # 9 AM daily (standard cron)
  - event: "files.created"              # subscribe to an event-bus event
    where: "path starts with /Downloads"
```

A skill with no `phrase` triggers won't appear in Spotlight; it only
fires from `cron` or `event` triggers.

### `when` (optional, list)

Predicates evaluated AT TRIGGER TIME. If any returns falsy, the skill
doesn't run. Predicates are plain English the planner can evaluate
against the context bundle.

```
when:
  - "There are more than 5 files in /Downloads"
  - "The current time is between 8 AM and 10 PM"
```

Predicates execute as L0 (read-only) — they cannot mutate state.

### `do` (required, single multi-line string)

The natural-language directive sent to the planner. Multi-line is
encouraged; the planner reads the whole thing as ONE prompt.

```
do: |
  Walk /Downloads. For each file, move it to /Downloads/<extension>/
  preserving the original name. Skip files already inside a subfolder.
  Notify the user with a count of moved files when done.
```

Reference resources by VFS path with a leading `/` (`/Downloads`,
`/Documents/notes.md`). Reference earlier-step output with `$name`
when the planner reasons multi-step.

### `constraints` (optional, object)

Caps on what the skill is allowed to do. Defaults are conservative.

```
constraints:
  level: L2              # default L1
  budget_tokens: 500     # default 200
  reversibility: BOUNDED # default BOUNDED — FREE allows anything
                         # reversible-bounded; NONE allows even
                         # point-of-no-return ops
```

Level cap rejects ANY step the planner produces that exceeds it. The
M5.P2 interceptor enforces this — a skill marked `level: L1` cannot
trigger a real-data delete even if the planner suggests one.

---

## Skill metadata (header comments)

A skill file may begin with a `# astrion-skill v1` magic line. The
parser uses this to detect format version. Future versions may add
keywords; the magic line lets the parser refuse skills it doesn't
understand.

```
# astrion-skill v1
goal: …
trigger:
  - …
do: |
  …
```

---

## Marketplace metadata (M7.P4 forward)

Future fields the marketplace will read but the runtime ignores:

```
author: Naren Bharath
license: MIT
homepage: https://example.com/organize-downloads-skill
```

These don't change runtime behavior; they're documentation surface for
the marketplace listing.

---

## Inversion table — what could go wrong

| risk | mitigation |
|------|------------|
| User installs a malicious skill that escalates | All skills start L0; promotion to L1+ requires explicit user unlock per the M1 capability tiers |
| A skill's `do` prompt injects a system instruction | The planner runs in its own prompt context; the skill's `do` is one user-message-equivalent — same as a typed query, no privilege boost |
| Constraints get loosened over time as users want more | The constraints field is in the SKILL FILE; loosening it edits the file, which is auditable and reversible (M5 substrate) |
| Cron/event triggers fire unexpectedly during sleep | Triggers respect the existing system rate-limits; cron uses the same launchd-style scheduler the auto-push job uses |
| Marketplace floods with low-quality skills | M7.P4 ratings + red-team auto-review on every upload + L0 default |

---

## Versioning

The language is v0.1. Future changes will be signaled by the magic
line (e.g. `# astrion-skill v2`). Parsers must accept lower or equal
versions; emit a warning + skip on higher.

Breaking changes (renaming `do` to `steps`, etc.) bump the major. New
keyword additions bump the minor and old skills continue to parse.
