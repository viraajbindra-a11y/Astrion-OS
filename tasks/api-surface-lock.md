# API Surface Lock

**Locked: 2026-05-09**

## What this is

A tripwire against scope creep on three internal API surfaces:

- **Capability provider IDs** — 41 IDs registered in `js/kernel/capability-providers.js`
- **Browser IPC channels** — 47 `ipcMain.handle(...)` channels in `distro/astrion-browser/main.js`
- **Skill-registry public exports** — 11 named exports from `js/kernel/skill-registry.js`

The canonical sets live in `js/kernel/api-surface.lock.js`. The v03
verification suite imports them and fails if the live surface diverges.
Comments alone rot. A test that fails forces a real conversation.

## Why now

The 2026-05-09 strategic review flagged scope creep as a real risk:

> 76 apps is too many; minigames dilute brand. AI-as-feature-in-every-app
> is scope explosion, scope pollution, hallucination surface.

The same logic applies internally. Every new capability ID, IPC channel,
and exported function is:

- A permanent commitment (other code starts to depend on it)
- A hallucination surface (the AI will invent calls that "should" exist)
- A maintenance cost (every entry needs tests, error handling, docs)

The toys split addresses the user-facing version. This lock addresses
the internal version.

## What it doesn't do

- It doesn't freeze behaviour. Existing capabilities can be improved,
  bug-fixed, refactored — the test only cares about the *names*.
- It doesn't freeze internals. Helper functions, private state, and
  implementation details inside the locked files can change freely.
- It doesn't freeze module imports. Adding a new module elsewhere is
  fine; the lock is about specific named surfaces.
- It doesn't block evolution. Adding a new entry is a one-line change
  to the lock file. The point is to make that change *visible*, not
  to prevent it.

## How to add a new entry

1. **Justify it.** Is there an existing capability/channel that already
   does this? Could the work be a skill (separate registry) instead of
   a new IPC? If you can't articulate why this can't be done with what
   exists, don't add it.
2. **Add the entry to the live code** as you normally would.
3. **Update `js/kernel/api-surface.lock.js`** — add the new ID/channel/
   export name to the appropriate `Set`.
4. **Update `LOCK_DATE`** to today.
5. **Run v03.** It should pass.
6. **Commit.** The diff in the lock file is the audit trail.

If your reviewer pushes back, the diff is right there for them to read.

## How to remove an entry

1. Remove the live code (the `registerCapability(...)` call, the
   `ipcMain.handle(...)` line, the `export` keyword).
2. Remove the corresponding entry from `api-surface.lock.js`.
3. Update `LOCK_DATE`.
4. Verify nothing else in the repo still references the removed name
   (grep for it).
5. Commit.

## What if the test is failing because of legitimate work?

Update the lock file. That's literally what it's for. The test isn't
trying to stop you — it's trying to stop you from doing it
*accidentally*.

## Companion files

- `js/kernel/api-surface.lock.js` — the locked sets
- `test/v03-verification.html` (section 19) — the enforcement
- Header banners in `capability-api.js`, `capability-providers.js`,
  `skill-registry.js`, `distro/astrion-browser/main.js` — the visible
  warning at the top of each protected file
