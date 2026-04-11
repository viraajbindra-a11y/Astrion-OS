# Astrion Hypergraph — M2 Design Doc

**Status:** Active. Targeting 1-week implementation sprint starting 2026-04-11.

**Why this milestone:** The Intent Kernel (M1) writes data to a mess of `localStorage` keys (`nova-notes`, `nova-todos`, `nova-reminders`, etc.) — one namespace per app, no cross-linking, no query language, no versioning. Every future milestone needs a unified, queryable, versionable store:

- **M3 Calibration tracker** needs to record "did this work?" per intent category. Needs queries.
- **M4 Verifiable code generation** needs provenance chains per artifact. Needs graph edges.
- **M5 Reversibility** needs versioning + snapshots. Needs copy-on-write.
- **M6 Socratic loop** needs to surface relationships ("these 3 notes link to your delete target"). Needs graph traversal.
- **M7 Skill marketplace** needs to share nodes between users. Needs content addressing.

Building the hypergraph ONCE and letting M3-M7 ride on top is 10× cheaper than bolting these features onto localStorage one at a time.

---

## The shape

Everything in Astrion becomes one of three things: a **node**, an **edge**, or a **mutation**.

### Node

A piece of user data — a note, a todo, a file, a contact, an app instance, a capability receipt, anything. Every node has:

```ts
interface Node {
  id: string;           // "n-<uuid>" — content-independent identity
  type: string;         // "note" | "todo" | "file" | "event" | "receipt" | ...
  props: object;        // type-specific fields (title, body, done, etc.)
  version: number;      // monotonically increasing per mutation
  contentHash: string;  // sha256 of (type + props) — used for dedup/diff
  createdAt: number;    // epoch ms
  updatedAt: number;    // epoch ms of last mutation
  createdBy: {
    kind: 'user' | 'ai' | 'system';
    brain?: 's1' | 's2';       // for AI-created nodes (M3)
    intentId?: string;         // for nodes created via Intent Kernel (M1)
    capabilityId?: string;     // which capability created it (M1)
  };
  provenance?: {
    parentVersions: string[];  // content hashes of previous versions
    receiptId?: string;        // M4 receipt reference
  };
}
```

### Edge

A relationship between two nodes. Edges are directed and typed.

```ts
interface Edge {
  from: string;         // source node id
  to: string;           // target node id
  kind: string;         // "contains" | "references" | "tagged" | "parent" | "derived_from" | "mentions"
  props?: object;       // optional edge metadata
  createdAt: number;
  createdBy: { ... };   // same shape as Node.createdBy
}
```

The `(from, kind, to)` tuple is the edge's primary key. Multiple edges of different kinds can connect the same two nodes.

### Mutation

Every change to the graph creates a mutation record. This is how we get versioning, rewind, and audit trails.

```ts
interface Mutation {
  id: string;           // "m-<uuid>"
  timestamp: number;
  type: 'create_node' | 'update_node' | 'delete_node' | 'add_edge' | 'remove_edge';
  nodeId?: string;
  edgeKey?: string;     // "<from>|<kind>|<to>"
  before?: object;      // snapshot of what existed before (for rewind)
  after?: object;       // snapshot of what exists now
  capabilityId?: string;
  intentId?: string;
  reverseHandle: string; // id of the inverse mutation (for M5 rewind)
}
```

---

## Storage layer

Target: **IndexedDB** (browser-native, no deps, handles gigabytes). Schema:

### Object stores

| Store | Key | Indexes |
|---|---|---|
| `nodes` | `id` | `type`, `updatedAt`, `contentHash` |
| `edges` | `(from, kind, to)` compound | `from`, `to`, `kind` |
| `mutations` | `id` | `timestamp`, `nodeId`, `intentId` |
| `snapshots` | `id` | `timestamp` — for fast rewind to checkpoints |

### In-memory cache

An LRU cache of the 1000 most recently accessed nodes. Invalidated on mutation. Keeps hot queries fast.

### Content addressing

Before writing a node, we compute `contentHash = sha256(type + JSON.stringify(props))`. If a node with the same contentHash already exists, we reuse it instead of creating a duplicate. This gives us free dedup across notes with identical content, photos with identical bytes, etc.

### Copy-on-write

On `update_node`, we:
1. Save the old version's contentHash in `provenance.parentVersions`
2. Write a `mutation` record with `before` + `after` snapshots
3. Write the new node (same id, new version, new contentHash)

The old version is still addressable via the mutation log — we never delete history. M5 rewind becomes "walk back the mutations and reverse them."

---

## Query language

### Structured form

```ts
interface Query {
  type: 'select' | 'traverse';
  from?: string;              // node type or edge kind
  where?: QueryFilter;        // { field: value } or { field: { op: value } }
  orderBy?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;
  startNode?: string;         // for traverse
  traverse?: {                // for traverse
    direction: 'out' | 'in' | 'both';
    kinds?: string[];
    depth?: number;
  };
}
```

### Examples

Find all notes modified this week:
```js
graph.query({
  type: 'select',
  from: 'note',
  where: { updatedAt: { gt: Date.now() - 7*24*3600*1000 } },
  orderBy: { field: 'updatedAt', dir: 'desc' },
  limit: 50,
})
```

All nodes that reference a specific note:
```js
graph.query({
  type: 'traverse',
  startNode: 'n-abc',
  traverse: { direction: 'in', kinds: ['references', 'mentions'], depth: 2 },
})
```

### Natural-language translator (optional for M2)

A thin wrapper around the parser + S2 that translates English queries into the structured form. This is how Spotlight can accept "show me last week's notes about school" — it goes parser → intent → NL-to-query → graph. Not required for M2 ship but useful for M3+.

---

## Backward compatibility layer

The existing 52 apps all read/write their own `localStorage` keys. We can't rewrite them all at once. Solution: **a read-through compatibility shim.**

- `graph.getLegacy(key)` reads from the graph first, falls back to localStorage
- `graph.setLegacy(key, value)` writes to localStorage AND mirrors into the graph as a typed node
- Migration script runs once on first boot after M2 ships: walks all known localStorage keys, converts each into typed nodes, sets a `migrated: true` flag

This lets the Intent Kernel + new M3+ code use the graph exclusively, while old apps keep working unchanged. Over time we migrate each app's storage access to use the graph directly.

---

## Event emissions

Every mutation emits an event on the existing `eventBus`:

| Event | When | Payload |
|---|---|---|
| `graph:node:created` | After create_node | `{ node, mutation }` |
| `graph:node:updated` | After update_node | `{ node, previous, mutation }` |
| `graph:node:deleted` | After delete_node | `{ nodeId, previous, mutation }` |
| `graph:edge:added` | After add_edge | `{ edge, mutation }` |
| `graph:edge:removed` | After remove_edge | `{ edgeKey, previous, mutation }` |

This lets any UI react to changes live. Notes app can subscribe to `graph:node:created` where `node.type === 'note'` and auto-refresh.

---

## Implementation plan

### Day 1: Design + Core Primitives

- Write this doc ✅
- `js/kernel/graph-store.js` — IndexedDB wrapper with the 4 object stores
- `js/kernel/graph-store.js` — `createNode`, `updateNode`, `deleteNode`, `addEdge`, `removeEdge` with proper versioning, content hashing, and mutation recording
- `js/kernel/graph-store.js` — LRU cache + event emission
- Sanity tests at import time in localhost

### Day 2: Query Language

- `js/kernel/graph-query.js` — structured query executor
- Select queries (type + where + orderBy + limit)
- Traverse queries (startNode + direction + depth)
- Helper functions for common patterns
- Sanity tests

### Day 3: Migration + Backward Compat

- `js/kernel/graph-migration.js` — one-shot migrator from localStorage keys to graph nodes
- Compat shim: `graph.getLegacy()` / `setLegacy()` for apps that haven't been updated
- Run migrator on boot for existing users
- Provenance: every migrated node gets `createdBy: { kind: 'system', reason: 'localStorage-migration' }`

### Day 4: Wire First Consumers

- Update `notes.create` capability (from M1) to write to the graph instead of localStorage
- Update Notes.js app to read from the graph
- Verify: the M1 demo still works — `"make a note called shopping with items apples bread milk"` creates a graph node and Notes shows it
- Same for todos, reminders

### Day 5: Rewind + Snapshots

- `graph.rewind(mutationId)` — undo a single mutation
- `graph.rewindTo(timestamp)` — undo everything after a given timestamp
- `graph.snapshot()` / `graph.restoreSnapshot(id)` — fast checkpoints for M5
- UI: Spotlight gets a "rewind last intent" affordance

### Day 6: Polish + Commit

- Final test pass
- Document lessons
- Update PLAN.md M2 checklist
- Push
- Trigger fresh ISO build

---

## What this sets up for free

| Milestone | How M2 helps |
|---|---|
| **M3 Dual-brain** | Calibration tracker stores per-intent accuracy as nodes + edges. Queryable "which brain handles math best?" |
| **M4 Verifiable code** | Every generated artifact gets a provenance node linked to its spec, tests, prompt chain, model version |
| **M5 Reversibility** | ALREADY DONE as part of M2 (mutations + rewind). Just needs UI polish. |
| **M6 Socratic loop** | Red-team can query "what else depends on this node?" before approving a delete |
| **M7 Marketplace** | Shared skills are graph subtrees that users can import |

**M2 isn't just a storage upgrade. It's the foundation that makes M3-M7 implementable without architectural pain.**

---

## Risks + inversions

| Will break | Inverted fix |
|---|---|
| IndexedDB too slow for 10k+ nodes | LRU cache + batch writes + debounced flushes |
| Migration corrupts existing user data | Keep localStorage as a read-only backup for 30 days after migration |
| Legacy apps write to localStorage bypassing the graph | Compat shim intercepts common keys; newly-created data goes through shim automatically |
| Content hashing is slow on large blobs | Only hash `type + props`, not binary content — keep photos/videos as content-addressed blob refs |
| Graph query language is too limited | Start with structured queries only; add NL-to-query translator in M3 via S2 |
| Versioning explodes storage | Old versions compressed; mutations older than 90 days compacted into keyframes |
| Users hate "everything is a graph" | UI lies — Finder-view still looks like files + folders, it's just a lens over the graph |
