// Astrion OS — Hypergraph Storage (M2.P1)
//
// IndexedDB-backed store for the hypergraph — everything in Astrion
// (notes, todos, reminders, contacts, receipts, etc.) is a node.
// Edges are typed, directed relationships. Every mutation is logged
// in the same atomic transaction as the node/edge write, which sets up
// M5 rewind for free.
//
// What this file IS (M2 Day 1):
//   - IndexedDB schema: nodes + edges + mutations + snapshots (4 stores)
//   - Core mutation API: createNode, updateNode, deleteNode, addEdge, removeEdge
//   - Core read API: getNode, getNodesByType, getEdge, etc.
//   - Content hashing on every write (SHA-256 over canonical type+props)
//   - Copy-on-write via provenance.parentVersions chain
//   - LRU cache (1000 entries max)
//   - Event emissions fired from tx.oncomplete (never from request.onsuccess)
//   - Inline sanity tests at localhost, on a separate test DB
//
// What this file is NOT (Days 2-6):
//   - Query language / executor (Day 2 -> graph-query.js)
//   - Migration from localStorage (Day 3 -> graph-migration.js)
//   - Legacy compat shim for the 52 existing apps (Day 3)
//   - Wiring Notes/Todo/Reminders to read from graph (Day 4)
//   - Rewind / snapshot implementations (Day 5; schema stubs exist)
//
// CRITICAL: hash BEFORE opening the transaction. `crypto.subtle.digest`
// is async, and `await`ing inside a txn callback auto-commits the txn
// before your data actually lands. Build all records in plain JS first,
// THEN open the txn and only use synchronous IDB calls inside.

import { eventBus as defaultEventBus } from './event-bus.js';

// ---------- constants ----------

const DB_NAME_DEFAULT = 'astrion-graph';
const DB_VERSION = 1;

const STORES = {
  NODES: 'nodes',
  EDGES: 'edges',
  MUTATIONS: 'mutations',
  SNAPSHOTS: 'snapshots',
};

const EVENTS = {
  NODE_CREATED: 'graph:node:created',
  NODE_UPDATED: 'graph:node:updated',
  NODE_DELETED: 'graph:node:deleted',
  EDGE_ADDED: 'graph:edge:added',
  EDGE_REMOVED: 'graph:edge:removed',
};

const CACHE_MAX = 1000;
const MAX_PARENT_VERSIONS = 50;
const DEFAULT_TYPE_QUERY_LIMIT = 500;

// ---------- top-level helpers ----------

// v4 UUID. Uses crypto.randomUUID if available, falls back for older WKWebView.
function _uuid(prefix) {
  let u;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    u = crypto.randomUUID();
  } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    // RFC 4122 v4 bits
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
    u = `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
  } else {
    u = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
  return prefix ? `${prefix}-${u}` : u;
}

// Recursive deterministic stringify with sorted object keys. Arrays preserve
// order; primitives pass through. Never trust raw JSON.stringify for hashing.
function _canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(_canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + _canonicalize(value[k]));
  return '{' + parts.join(',') + '}';
}

// sha256("node:v1\u001f" + type + "\u001f" + canonicalize(props)) -> hex
async function _hashContent(type, props) {
  const input = `node:v1\u001f${type}\u001f${_canonicalize(props ?? {})}`;
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function _cloneDeep(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

// Meta whitelist. Prevents sloppy/malicious callers from injecting arbitrary
// fields into node metadata. Only these make it onto createdBy.
function _sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return { kind: 'user' };
  const out = { kind: 'user' };
  if (meta.createdBy && typeof meta.createdBy === 'object') {
    if (['user', 'ai', 'system'].includes(meta.createdBy.kind)) {
      out.kind = meta.createdBy.kind;
    }
    if (['s1', 's2'].includes(meta.createdBy.brain)) {
      out.brain = meta.createdBy.brain;
    }
  }
  if (typeof meta.intentId === 'string') out.intentId = meta.intentId;
  if (typeof meta.capabilityId === 'string') out.capabilityId = meta.capabilityId;
  return out;
}

function _edgeKeyString(from, kind, to) {
  return `${from}|${kind}|${to}`;
}

// Wrap an IDBRequest in a Promise. ONLY use this for reads outside a txn;
// inside a txn, use the request directly so you stay in the same txn context.
function _req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// ---------- GraphStore class ----------

class GraphStore {
  constructor(opts = {}) {
    this.dbName = opts.dbName || DB_NAME_DEFAULT;
    this.eventBus = opts.eventBus || defaultEventBus;
    this.emitEvents = opts.emitEvents !== false;
    this.db = null;
    this.initPromise = null;
    this.cache = new Map(); // id -> node (LRU via insertion order)
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // nodes store
        if (!db.objectStoreNames.contains(STORES.NODES)) {
          const nodes = db.createObjectStore(STORES.NODES, { keyPath: 'id' });
          nodes.createIndex('type', 'type', { unique: false });
          nodes.createIndex('updatedAt', 'updatedAt', { unique: false });
          nodes.createIndex('contentHash', 'contentHash', { unique: false });
        }
        // edges store (compound key)
        if (!db.objectStoreNames.contains(STORES.EDGES)) {
          const edges = db.createObjectStore(STORES.EDGES, { keyPath: ['from', 'kind', 'to'] });
          edges.createIndex('from', 'from', { unique: false });
          edges.createIndex('to', 'to', { unique: false });
          edges.createIndex('kind', 'kind', { unique: false });
          edges.createIndex('from_kind', ['from', 'kind'], { unique: false });
        }
        // mutations store
        if (!db.objectStoreNames.contains(STORES.MUTATIONS)) {
          const muts = db.createObjectStore(STORES.MUTATIONS, { keyPath: 'id' });
          muts.createIndex('timestamp', 'timestamp', { unique: false });
          muts.createIndex('nodeId', 'nodeId', { unique: false });
          muts.createIndex('intentId', 'intentId', { unique: false });
        }
        // snapshots store (schema stub; real impl is Day 5)
        if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
          const snaps = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: 'id' });
          snaps.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        // if another tab upgrades us, close cleanly so they can proceed
        this.db.onversionchange = () => {
          try { this.db.close(); } catch (_) {}
          this.db = null;
        };
        resolve();
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        // another open connection is blocking the upgrade; warn but don't reject
        // (most commonly hit in dev when hot-reloading)
        console.warn(`[graph-store] open blocked on ${this.dbName}`);
      };
    });
    return this.initPromise;
  }

  // ---------- cache ----------

  _cacheGet(id) {
    if (!this.cache.has(id)) return undefined;
    const v = this.cache.get(id);
    // reorder to MRU
    this.cache.delete(id);
    this.cache.set(id, v);
    return v;
  }

  _cacheSet(id, node) {
    if (this.cache.has(id)) this.cache.delete(id);
    this.cache.set(id, node);
    if (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  _cacheInvalidate(id) {
    this.cache.delete(id);
  }

  // ---------- emission helpers ----------

  _emit(name, payload) {
    if (!this.emitEvents) return;
    try {
      this.eventBus.emit(name, payload);
    } catch (err) {
      // never let a subscriber crash the store
      console.warn(`[graph-store] subscriber threw on ${name}:`, err);
    }
  }

  _assertReady() {
    if (!this.db) throw new Error('graphStore.init() not called');
  }

  // ---------- mutation API ----------

  async createNode(type, props = {}, meta = {}) {
    this._assertReady();
    if (typeof type !== 'string' || !type) {
      throw new Error('createNode: type is required');
    }
    const now = Date.now();
    const contentHash = await _hashContent(type, props);
    const createdBy = _sanitizeMeta(meta);
    const node = {
      id: _uuid('n'),
      type,
      props: _cloneDeep(props),
      version: 1,
      contentHash,
      createdAt: now,
      updatedAt: now,
      createdBy,
      provenance: { parentVersions: [] },
    };
    const mutation = {
      id: _uuid('m'),
      timestamp: now,
      type: 'create_node',
      nodeId: node.id,
      before: null,
      after: _cloneDeep(node),
    };
    if (createdBy.intentId) mutation.intentId = createdBy.intentId;
    if (createdBy.capabilityId) mutation.capabilityId = createdBy.capabilityId;

    await this._runTxn([STORES.NODES, STORES.MUTATIONS], 'readwrite', (tx) => {
      tx.objectStore(STORES.NODES).add(node);
      tx.objectStore(STORES.MUTATIONS).add(mutation);
    });

    this._cacheSet(node.id, _cloneDeep(node));
    this._emit(EVENTS.NODE_CREATED, { node: _cloneDeep(node), mutation: _cloneDeep(mutation) });
    return _cloneDeep(node);
  }

  async updateNode(id, propsOrUpdater, meta = {}) {
    this._assertReady();
    // fetch current
    const prev = await this._getNodeRaw(id);
    if (!prev) throw new Error(`updateNode: node ${id} not found`);
    const nextProps = (typeof propsOrUpdater === 'function')
      ? propsOrUpdater(_cloneDeep(prev))
      : propsOrUpdater;
    if (!nextProps || typeof nextProps !== 'object') {
      throw new Error('updateNode: updater must return an object');
    }
    const now = Date.now();
    const nextHash = await _hashContent(prev.type, nextProps);

    // no-op optimization: if hash is unchanged, skip the write entirely
    if (nextHash === prev.contentHash) {
      return _cloneDeep(prev);
    }

    const parentVersions = Array.isArray(prev.provenance?.parentVersions)
      ? prev.provenance.parentVersions.slice()
      : [];
    parentVersions.push(prev.contentHash);
    if (parentVersions.length > MAX_PARENT_VERSIONS) {
      parentVersions.splice(0, parentVersions.length - MAX_PARENT_VERSIONS);
    }

    const updatedMeta = _sanitizeMeta(meta);
    const next = {
      ...prev,
      props: _cloneDeep(nextProps),
      version: prev.version + 1,
      contentHash: nextHash,
      updatedAt: now,
      createdBy: { ...prev.createdBy, ...(updatedMeta.brain ? { brain: updatedMeta.brain } : {}) },
      provenance: { parentVersions },
    };
    const mutation = {
      id: _uuid('m'),
      timestamp: now,
      type: 'update_node',
      nodeId: id,
      before: _cloneDeep(prev),
      after: _cloneDeep(next),
    };
    if (updatedMeta.intentId) mutation.intentId = updatedMeta.intentId;
    if (updatedMeta.capabilityId) mutation.capabilityId = updatedMeta.capabilityId;

    this._cacheInvalidate(id);
    await this._runTxn([STORES.NODES, STORES.MUTATIONS], 'readwrite', (tx) => {
      tx.objectStore(STORES.NODES).put(next);
      tx.objectStore(STORES.MUTATIONS).add(mutation);
    });

    this._cacheSet(id, _cloneDeep(next));
    this._emit(EVENTS.NODE_UPDATED, {
      node: _cloneDeep(next),
      previous: _cloneDeep(prev),
      mutation: _cloneDeep(mutation),
    });
    return _cloneDeep(next);
  }

  async deleteNode(id, meta = {}) {
    this._assertReady();
    const prev = await this._getNodeRaw(id);
    if (!prev) return; // idempotent

    // pre-walk edges in a readonly query (TOCTOU window is acceptable for M2.P1;
    // Day 5 can revisit with a single readwrite txn if this becomes a real issue)
    const outgoing = await this.getEdgesFrom(id);
    const incoming = await this.getEdgesTo(id);

    const now = Date.now();
    const sanitized = _sanitizeMeta(meta);

    const edgeMutations = [];
    const edgeEventPayloads = [];
    for (const e of [...outgoing, ...incoming]) {
      const mut = {
        id: _uuid('m'),
        timestamp: now,
        type: 'remove_edge',
        edgeKey: _edgeKeyString(e.from, e.kind, e.to),
        before: _cloneDeep(e),
        after: null,
      };
      if (sanitized.intentId) mut.intentId = sanitized.intentId;
      if (sanitized.capabilityId) mut.capabilityId = sanitized.capabilityId;
      edgeMutations.push(mut);
      edgeEventPayloads.push({ edgeKey: mut.edgeKey, previous: _cloneDeep(e), mutation: _cloneDeep(mut) });
    }

    const nodeMutation = {
      id: _uuid('m'),
      timestamp: now,
      type: 'delete_node',
      nodeId: id,
      before: _cloneDeep(prev),
      after: null,
    };
    if (sanitized.intentId) nodeMutation.intentId = sanitized.intentId;
    if (sanitized.capabilityId) nodeMutation.capabilityId = sanitized.capabilityId;

    this._cacheInvalidate(id);
    await this._runTxn([STORES.NODES, STORES.EDGES, STORES.MUTATIONS], 'readwrite', (tx) => {
      // cascade edges
      for (const e of [...outgoing, ...incoming]) {
        tx.objectStore(STORES.EDGES).delete([e.from, e.kind, e.to]);
      }
      // delete node
      tx.objectStore(STORES.NODES).delete(id);
      // write all mutation records
      const mutStore = tx.objectStore(STORES.MUTATIONS);
      for (const m of edgeMutations) mutStore.add(m);
      mutStore.add(nodeMutation);
    });

    // emit edge events first, node event last (causal order)
    for (const p of edgeEventPayloads) this._emit(EVENTS.EDGE_REMOVED, p);
    this._emit(EVENTS.NODE_DELETED, {
      nodeId: id,
      previous: _cloneDeep(prev),
      mutation: _cloneDeep(nodeMutation),
    });
  }

  async addEdge(from, kind, to, props = {}, meta = {}) {
    this._assertReady();
    if (!from || !kind || !to) throw new Error('addEdge: from, kind, to are required');
    const now = Date.now();
    const sanitized = _sanitizeMeta(meta);
    const edge = {
      from, kind, to,
      props: _cloneDeep(props),
      createdAt: now,
      createdBy: sanitized,
    };
    const mutation = {
      id: _uuid('m'),
      timestamp: now,
      type: 'add_edge',
      edgeKey: _edgeKeyString(from, kind, to),
      before: null,
      after: _cloneDeep(edge),
    };
    if (sanitized.intentId) mutation.intentId = sanitized.intentId;
    if (sanitized.capabilityId) mutation.capabilityId = sanitized.capabilityId;

    await this._runTxn([STORES.EDGES, STORES.MUTATIONS], 'readwrite', (tx) => {
      // `put` upserts — duplicate adds overwrite the existing edge (updates props)
      tx.objectStore(STORES.EDGES).put(edge);
      tx.objectStore(STORES.MUTATIONS).add(mutation);
    });

    this._emit(EVENTS.EDGE_ADDED, { edge: _cloneDeep(edge), mutation: _cloneDeep(mutation) });
    return _cloneDeep(edge);
  }

  async removeEdge(from, kind, to, meta = {}) {
    this._assertReady();
    const prev = await this._runTxn([STORES.EDGES], 'readonly', (tx) => {
      return tx.objectStore(STORES.EDGES).get([from, kind, to]);
    }, true);
    if (!prev) return; // idempotent

    const now = Date.now();
    const sanitized = _sanitizeMeta(meta);
    const mutation = {
      id: _uuid('m'),
      timestamp: now,
      type: 'remove_edge',
      edgeKey: _edgeKeyString(from, kind, to),
      before: _cloneDeep(prev),
      after: null,
    };
    if (sanitized.intentId) mutation.intentId = sanitized.intentId;
    if (sanitized.capabilityId) mutation.capabilityId = sanitized.capabilityId;

    await this._runTxn([STORES.EDGES, STORES.MUTATIONS], 'readwrite', (tx) => {
      tx.objectStore(STORES.EDGES).delete([from, kind, to]);
      tx.objectStore(STORES.MUTATIONS).add(mutation);
    });

    this._emit(EVENTS.EDGE_REMOVED, {
      edgeKey: mutation.edgeKey,
      previous: _cloneDeep(prev),
      mutation: _cloneDeep(mutation),
    });
  }

  // ---------- read API ----------

  async getNode(id) {
    this._assertReady();
    const cached = this._cacheGet(id);
    if (cached) return _cloneDeep(cached);
    const node = await this._getNodeRaw(id);
    if (node) this._cacheSet(id, _cloneDeep(node));
    return node ? _cloneDeep(node) : null;
  }

  async _getNodeRaw(id) {
    const tx = this.db.transaction(STORES.NODES, 'readonly');
    const store = tx.objectStore(STORES.NODES);
    const result = await _req(store.get(id));
    return result || null;
  }

  async getNodeByContentHash(hash) {
    this._assertReady();
    const tx = this.db.transaction(STORES.NODES, 'readonly');
    const idx = tx.objectStore(STORES.NODES).index('contentHash');
    const result = await _req(idx.get(hash));
    return result ? _cloneDeep(result) : null;
  }

  async getNodesByType(type, { limit = DEFAULT_TYPE_QUERY_LIMIT } = {}) {
    this._assertReady();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = this.db.transaction(STORES.NODES, 'readonly');
      const idx = tx.objectStore(STORES.NODES).index('type');
      const req = idx.openCursor(IDBKeyRange.only(type));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur && out.length < limit) {
          out.push(_cloneDeep(cur.value));
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getEdge(from, kind, to) {
    this._assertReady();
    const tx = this.db.transaction(STORES.EDGES, 'readonly');
    const result = await _req(tx.objectStore(STORES.EDGES).get([from, kind, to]));
    return result ? _cloneDeep(result) : null;
  }

  async getEdgesFrom(from, { kind } = {}) {
    this._assertReady();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = this.db.transaction(STORES.EDGES, 'readonly');
      const idx = tx.objectStore(STORES.EDGES).index('from');
      const req = idx.openCursor(IDBKeyRange.only(from));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          if (!kind || cur.value.kind === kind) out.push(_cloneDeep(cur.value));
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getEdgesTo(to, { kind } = {}) {
    this._assertReady();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = this.db.transaction(STORES.EDGES, 'readonly');
      const idx = tx.objectStore(STORES.EDGES).index('to');
      const req = idx.openCursor(IDBKeyRange.only(to));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          if (!kind || cur.value.kind === kind) out.push(_cloneDeep(cur.value));
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getMutation(id) {
    this._assertReady();
    const tx = this.db.transaction(STORES.MUTATIONS, 'readonly');
    const result = await _req(tx.objectStore(STORES.MUTATIONS).get(id));
    return result ? _cloneDeep(result) : null;
  }

  async getMutationsSince(timestamp, opts = {}) {
    this._assertReady();
    // By default `since` is EXCLUSIVE — mutations AT `timestamp` are skipped.
    // Callers filtering by a tag that could collide on same-millisecond
    // (e.g. branch merges) should pass { inclusive: true }. Lesson #137.
    const exclusive = opts.inclusive !== true;
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = this.db.transaction(STORES.MUTATIONS, 'readonly');
      const idx = tx.objectStore(STORES.MUTATIONS).index('timestamp');
      const req = idx.openCursor(IDBKeyRange.lowerBound(timestamp, exclusive));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          out.push(_cloneDeep(cur.value));
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- rewind + snapshots (M2.P5) ----------
  //
  // rewindMutation(id) applies the inverse of a single mutation.
  // rewindTo(timestamp) walks all mutations after the timestamp in reverse
  //   order and rewinds each (best-effort, logs failures but doesn't abort).
  // snapshot(label?) records the current max-mutation-timestamp as a
  //   checkpoint and returns a snapshot id.
  // restoreSnapshot(id) rewinds everything after the snapshot's checkpoint.
  //
  // NOTES:
  // - Rewinds generate NEW mutations (e.g., rewinding a create_node
  //   writes a delete_node mutation). This means the mutation log keeps
  //   growing; you can rewind a rewind to get back to the original state.
  // - Rewinding `update_node` reverts to the `before` props but creates
  //   a new version (version counter advances). Provenance chain grows.
  // - Rewinding `delete_node` restores the node with its ORIGINAL id via
  //   the low-level `_restoreNode` helper. Cascaded edge removals are
  //   SEPARATE mutations — callers using rewindTo get them for free.
  // - Best-effort: if one mutation fails to rewind (e.g., the node was
  //   deleted by another path), the others still proceed. Errors are
  //   collected in the return value.

  // Low-level helper: re-create a node with its ORIGINAL id and full fields.
  // Used by rewindMutation when reverting a delete_node. Emits
  // `graph:node:created` with a `restored: true` flag so subscribers can
  // distinguish normal creates from rewinds.
  async _restoreNode(nodeRecord, meta = {}) {
    this._assertReady();
    if (!nodeRecord || !nodeRecord.id) throw new Error('_restoreNode: invalid node record');
    const now = Date.now();
    const sanitized = _sanitizeMeta(meta);
    const node = _cloneDeep(nodeRecord);
    node.updatedAt = now;
    // provenance chain carries forward
    const mutation = {
      id: _uuid('m'),
      timestamp: now,
      type: 'create_node',
      nodeId: node.id,
      before: null,
      after: _cloneDeep(node),
      restoredFrom: nodeRecord.contentHash,
    };
    if (sanitized.intentId) mutation.intentId = sanitized.intentId;
    if (sanitized.capabilityId) mutation.capabilityId = sanitized.capabilityId;

    await this._runTxn([STORES.NODES, STORES.MUTATIONS], 'readwrite', (tx) => {
      tx.objectStore(STORES.NODES).put(node); // put (upsert) not add, in case caller races
      tx.objectStore(STORES.MUTATIONS).add(mutation);
    });

    this._cacheSet(node.id, _cloneDeep(node));
    this._emit(EVENTS.NODE_CREATED, {
      node: _cloneDeep(node),
      mutation: _cloneDeep(mutation),
      restored: true,
    });
    return _cloneDeep(node);
  }

  async rewindMutation(mutationId, meta = {}) {
    this._assertReady();
    const mut = await this.getMutation(mutationId);
    if (!mut) throw new Error(`rewindMutation: mutation ${mutationId} not found`);

    const rewindMeta = { ..._sanitizeMeta(meta), capabilityId: 'graph.rewind' };

    switch (mut.type) {
      case 'create_node': {
        // the node exists (we just created it) — delete it
        const existing = await this._getNodeRaw(mut.nodeId);
        if (!existing) return { ok: true, noop: true };
        await this.deleteNode(mut.nodeId, rewindMeta);
        return { ok: true };
      }
      case 'update_node': {
        // revert to `before.props`; the version counter advances
        if (!mut.before) return { ok: false, reason: 'no before snapshot' };
        const existing = await this._getNodeRaw(mut.nodeId);
        if (!existing) return { ok: false, reason: 'node missing' };
        await this.updateNode(mut.nodeId, mut.before.props, rewindMeta);
        return { ok: true };
      }
      case 'delete_node': {
        // restore the node with its original id; edges come back via
        // separate edge-mutation rewinds (rewindTo handles that for you)
        if (!mut.before) return { ok: false, reason: 'no before snapshot' };
        const existing = await this._getNodeRaw(mut.nodeId);
        if (existing) return { ok: true, noop: true };
        await this._restoreNode(mut.before, rewindMeta);
        return { ok: true };
      }
      case 'add_edge': {
        if (!mut.after) return { ok: false, reason: 'no after snapshot' };
        const { from, kind, to } = mut.after;
        await this.removeEdge(from, kind, to, rewindMeta);
        return { ok: true };
      }
      case 'remove_edge': {
        if (!mut.before) return { ok: false, reason: 'no before snapshot' };
        const { from, kind, to, props } = mut.before;
        await this.addEdge(from, kind, to, props || {}, rewindMeta);
        return { ok: true };
      }
      default:
        return { ok: false, reason: `unknown mutation type: ${mut.type}` };
    }
  }

  async rewindTo(timestamp, meta = {}) {
    this._assertReady();
    if (typeof timestamp !== 'number') throw new Error('rewindTo: timestamp must be a number');
    const mutations = await this.getMutationsSince(timestamp);
    // reverse chronological order so cascaded changes undo in the correct order
    mutations.sort((a, b) => b.timestamp - a.timestamp);
    const results = { rewound: 0, skipped: 0, errors: [] };
    for (const mut of mutations) {
      try {
        const r = await this.rewindMutation(mut.id, meta);
        if (r.ok && !r.noop) results.rewound++;
        else if (r.noop) results.skipped++;
        else {
          results.skipped++;
          results.errors.push([mut.id, r.reason]);
        }
      } catch (err) {
        results.errors.push([mut.id, err.message]);
      }
    }
    return results;
  }

  async snapshot(label) {
    this._assertReady();
    // grab latest mutation timestamp as the checkpoint
    const allSince = await this.getMutationsSince(0);
    const latest = allSince.length ? allSince[allSince.length - 1].timestamp : 0;
    const snap = {
      id: _uuid('s'),
      timestamp: Date.now(),
      label: typeof label === 'string' ? label : undefined,
      upTo: latest,
    };
    await this._runTxn([STORES.SNAPSHOTS], 'readwrite', (tx) => {
      tx.objectStore(STORES.SNAPSHOTS).add(snap);
    });
    return _cloneDeep(snap);
  }

  async getSnapshot(id) {
    this._assertReady();
    const tx = this.db.transaction(STORES.SNAPSHOTS, 'readonly');
    const result = await _req(tx.objectStore(STORES.SNAPSHOTS).get(id));
    return result ? _cloneDeep(result) : null;
  }

  async listSnapshots() {
    this._assertReady();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = this.db.transaction(STORES.SNAPSHOTS, 'readonly');
      const req = tx.objectStore(STORES.SNAPSHOTS).openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          out.push(_cloneDeep(cur.value));
          cur.continue();
        } else {
          out.sort((a, b) => b.timestamp - a.timestamp);
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async restoreSnapshot(snapshotId, meta = {}) {
    this._assertReady();
    const snap = await this.getSnapshot(snapshotId);
    if (!snap) throw new Error(`restoreSnapshot: snapshot ${snapshotId} not found`);
    return this.rewindTo(snap.upTo, meta);
  }

  // ---------- internals ----------

  // Run an IDB transaction. `work` is a SYNCHRONOUS callback that receives
  // the tx and queues all its requests; never await inside it. The returned
  // promise resolves on tx.oncomplete (durability guarantee) and rejects
  // on tx.onerror OR tx.onabort.
  //
  // If `returnWorkResult` is true, resolve with the awaited IDBRequest
  // result from `work()` — used for small read-then-something helpers.
  _runTxn(stores, mode, work, returnWorkResult = false) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this.db.transaction(stores, mode);
      } catch (err) {
        reject(err);
        return;
      }
      let workResult;
      try {
        workResult = work(tx);
      } catch (err) {
        try { tx.abort(); } catch (_) {}
        reject(err);
        return;
      }
      tx.oncomplete = () => {
        if (returnWorkResult && workResult && typeof workResult === 'object' && 'result' in workResult) {
          resolve(workResult.result);
        } else {
          resolve();
        }
      };
      tx.onerror = () => reject(tx.error || new Error('graph-store: txn error'));
      tx.onabort = () => reject(tx.error || new Error('graph-store: txn aborted'));
    });
  }

  _close() {
    if (this.db) {
      try { this.db.close(); } catch (_) {}
      this.db = null;
    }
    this.initPromise = null;
    this.cache.clear();
  }
}

// ---------- singleton export ----------

export const graphStore = new GraphStore();
export { GraphStore, EVENTS as GRAPH_EVENTS };

// ---------- inline sanity tests (localhost only) ----------
//
// Runs on a dedicated `astrion-graph-test` DB with its own local EventBus
// so it never pollutes production data or the global event bus.
// Wrapped in top-level .catch so hot-reload races never crash boot.

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  (async () => {
    const TEST_DB = 'astrion-graph-test';
    // minimal local eventBus stand-in (same shape as real one)
    const localBus = (() => {
      const listeners = {};
      return {
        on(ev, cb) {
          if (!listeners[ev]) listeners[ev] = [];
          listeners[ev].push(cb);
          return () => { listeners[ev] = (listeners[ev] || []).filter(x => x !== cb); };
        },
        off() {},
        emit(ev, data) { (listeners[ev] || []).forEach(cb => cb(data)); },
        once(ev, cb) { const u = this.on(ev, (d) => { u(); cb(d); }); return u; },
      };
    })();

    // ensure clean start
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(TEST_DB);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });

    const store = new GraphStore({ dbName: TEST_DB, eventBus: localBus });
    await store.init();

    let failures = 0;
    const fail = (msg, ...extras) => {
      failures++;
      console.warn('[graph-store]', msg, ...extras);
    };

    // 1. init is idempotent
    try {
      const p1 = store.init();
      const p2 = store.init();
      await Promise.all([p1, p2]);
    } catch (err) {
      fail('test 1: init idempotency threw', err);
    }

    // 2. createNode round-trip
    let createdA;
    try {
      createdA = await store.createNode('note', { title: 'hello', body: 'world' });
      if (!createdA.id || !createdA.id.startsWith('n-')) fail('test 2: bad id', createdA.id);
      if (createdA.version !== 1) fail('test 2: version should be 1');
      if (!/^[0-9a-f]{64}$/.test(createdA.contentHash)) fail('test 2: bad contentHash');
      if (createdA.createdAt !== createdA.updatedAt) fail('test 2: createdAt !== updatedAt');
      const fetched = await store.getNode(createdA.id);
      if (!fetched || fetched.props.title !== 'hello') fail('test 2: roundtrip failed');
    } catch (err) {
      fail('test 2: threw', err);
    }

    // 3. createNode does NOT dedup on identical content
    try {
      const a = await store.createNode('note', { title: 'dup', body: 'x' });
      const b = await store.createNode('note', { title: 'dup', body: 'x' });
      if (a.id === b.id) fail('test 3: createNode deduped (should not)');
      if (a.contentHash !== b.contentHash) fail('test 3: identical content produced different hashes');
      const byHash = await store.getNodeByContentHash(a.contentHash);
      if (!byHash) fail('test 3: getNodeByContentHash returned null');
    } catch (err) {
      fail('test 3: threw', err);
    }

    // 4. updateNode bumps version + chains provenance
    try {
      const n = await store.createNode('note', { title: 'v1' });
      const originalHash = n.contentHash;
      await new Promise(r => setTimeout(r, 2)); // ensure updatedAt > createdAt
      const updated = await store.updateNode(n.id, { title: 'v2' });
      if (updated.version !== 2) fail('test 4: version should be 2', updated.version);
      if (updated.provenance.parentVersions.length !== 1) fail('test 4: parentVersions length');
      if (updated.provenance.parentVersions[0] !== originalHash) fail('test 4: parent hash mismatch');
      if (updated.updatedAt <= n.createdAt) fail('test 4: updatedAt not newer');
    } catch (err) {
      fail('test 4: threw', err);
    }

    // 5. updateNode with function updater
    try {
      const n = await store.createNode('counter', { count: 0 });
      const inc = await store.updateNode(n.id, (prev) => ({ count: (prev.props.count || 0) + 1 }));
      if (inc.props.count !== 1) fail('test 5: function updater failed');
    } catch (err) {
      fail('test 5: threw', err);
    }

    // 6. updateNode on missing id throws
    try {
      let threw = false;
      try {
        await store.updateNode('n-does-not-exist', { x: 1 });
      } catch (_) { threw = true; }
      if (!threw) fail('test 6: missing updateNode did not throw');
    } catch (err) {
      fail('test 6: threw outer', err);
    }

    // 7. deleteNode cascades edges both directions
    try {
      const A = await store.createNode('note', { title: 'A' });
      const B = await store.createNode('note', { title: 'B' });
      const C = await store.createNode('note', { title: 'C' });
      await store.addEdge(A.id, 'references', B.id);
      await store.addEdge(C.id, 'mentions', A.id);
      await store.deleteNode(A.id);
      if (await store.getNode(A.id)) fail('test 7: A not deleted');
      if (await store.getEdge(A.id, 'references', B.id)) fail('test 7: outgoing edge not cascaded');
      if (await store.getEdge(C.id, 'mentions', A.id)) fail('test 7: incoming edge not cascaded');
      if (!(await store.getNode(B.id))) fail('test 7: B collateral damage');
      if (!(await store.getNode(C.id))) fail('test 7: C collateral damage');
    } catch (err) {
      fail('test 7: threw', err);
    }

    // 8. addEdge + getEdgesFrom / getEdgesTo
    try {
      const A = await store.createNode('tag', { name: 'a' });
      const B = await store.createNode('tag', { name: 'b' });
      await store.addEdge(A.id, 'tag', B.id);
      const outFromA = await store.getEdgesFrom(A.id);
      const inToB = await store.getEdgesTo(B.id);
      const outFromB = await store.getEdgesFrom(B.id);
      if (outFromA.length !== 1 || outFromA[0].to !== B.id) fail('test 8: getEdgesFrom wrong');
      if (inToB.length !== 1 || inToB[0].from !== A.id) fail('test 8: getEdgesTo wrong');
      if (outFromB.length !== 0) fail('test 8: B should have no outgoing');
    } catch (err) {
      fail('test 8: threw', err);
    }

    // 9. removeEdge
    try {
      const A = await store.createNode('x', {});
      const B = await store.createNode('x', {});
      await store.addEdge(A.id, 'rel', B.id);
      await store.removeEdge(A.id, 'rel', B.id);
      const gone = await store.getEdge(A.id, 'rel', B.id);
      if (gone) fail('test 9: edge still present after removeEdge');
    } catch (err) {
      fail('test 9: threw', err);
    }

    // 10. LRU cache hit + invalidation
    try {
      const n = await store.createNode('cached', { v: 1 });
      // first get populates cache
      await store.getNode(n.id);
      // break the DB transaction API
      const origTxn = store.db.transaction.bind(store.db);
      store.db.transaction = () => { throw new Error('blocked'); };
      const hit = await store.getNode(n.id);
      if (!hit || hit.props.v !== 1) fail('test 10: cache did not serve');
      // restore and update (which invalidates)
      store.db.transaction = origTxn;
      await store.updateNode(n.id, { v: 2 });
      const fresh = await store.getNode(n.id);
      if (!fresh || fresh.props.v !== 2) fail('test 10: cache not invalidated');
    } catch (err) {
      fail('test 10: threw', err);
    }

    // 11. Event emissions fire AFTER commit (getNode inside handler must succeed)
    try {
      let nodeIdWhenFired = null;
      let fetchedInHandler = null;
      const unsub = localBus.on('graph:node:created', async (payload) => {
        nodeIdWhenFired = payload.node.id;
        fetchedInHandler = await store.getNode(payload.node.id);
      });
      const n = await store.createNode('emit-test', { x: 1 });
      // handler is async but event emission is sync; allow microtask drain
      await new Promise(r => setTimeout(r, 10));
      unsub();
      if (nodeIdWhenFired !== n.id) fail('test 11: handler did not fire');
      if (!fetchedInHandler) fail('test 11: getNode inside handler returned null (emit before commit!)');
    } catch (err) {
      fail('test 11: threw', err);
    }

    // 12. getMutationsSince ordering
    try {
      const t0 = Date.now();
      await new Promise(r => setTimeout(r, 2));
      const m1 = await store.createNode('seq', { i: 1 });
      await new Promise(r => setTimeout(r, 2));
      const m2 = await store.createNode('seq', { i: 2 });
      await new Promise(r => setTimeout(r, 2));
      const m3 = await store.createNode('seq', { i: 3 });
      const muts = await store.getMutationsSince(t0);
      const seqMuts = muts.filter(m => m.type === 'create_node' && [m1.id, m2.id, m3.id].includes(m.nodeId));
      if (seqMuts.length !== 3) fail('test 12: wrong count', seqMuts.length);
      for (let i = 1; i < seqMuts.length; i++) {
        if (seqMuts[i].timestamp < seqMuts[i-1].timestamp) fail('test 12: out of order');
      }
    } catch (err) {
      fail('test 12: threw', err);
    }

    // 13. rewindMutation undoes a create (node gone afterward)
    try {
      const n = await store.createNode('rewindable', { x: 1 });
      // find the create mutation
      const muts = await store.getMutationsSince(0);
      const createMut = muts.reverse().find(m => m.type === 'create_node' && m.nodeId === n.id);
      if (!createMut) { fail('test 13: create mutation not found'); }
      else {
        const r = await store.rewindMutation(createMut.id);
        if (!r.ok) fail('test 13: rewind not ok', r);
        const after = await store.getNode(n.id);
        if (after) fail('test 13: node still exists after rewind');
      }
    } catch (err) {
      fail('test 13: threw', err);
    }

    // 14. rewindMutation reverts an update (props match previous state)
    try {
      const n = await store.createNode('rewindupdate', { v: 1 });
      const updated = await store.updateNode(n.id, { v: 2 });
      const muts = await store.getMutationsSince(0);
      const updateMut = muts.reverse().find(m => m.type === 'update_node' && m.nodeId === n.id);
      if (!updateMut) { fail('test 14: update mutation not found'); }
      else {
        const r = await store.rewindMutation(updateMut.id);
        if (!r.ok) fail('test 14: rewind not ok', r);
        const after = await store.getNode(n.id);
        if (!after || after.props.v !== 1) fail('test 14: props did not revert', after?.props);
      }
    } catch (err) {
      fail('test 14: threw', err);
    }

    // 15. rewindMutation restores a deleted node with the same id
    try {
      const n = await store.createNode('rewinddelete', { label: 'keeper' });
      const origId = n.id;
      await store.deleteNode(n.id);
      const muts = await store.getMutationsSince(0);
      const delMut = muts.reverse().find(m => m.type === 'delete_node' && m.nodeId === origId);
      if (!delMut) { fail('test 15: delete mutation not found'); }
      else {
        const r = await store.rewindMutation(delMut.id);
        if (!r.ok) fail('test 15: rewind not ok', r);
        const after = await store.getNode(origId);
        if (!after || after.props.label !== 'keeper') fail('test 15: node not restored', after);
        if (after.id !== origId) fail('test 15: id changed on restore');
      }
    } catch (err) {
      fail('test 15: threw', err);
    }

    // 16. rewindTo walks mutations in reverse chronological order
    try {
      const checkpoint = Date.now();
      await new Promise(r => setTimeout(r, 2));
      const a = await store.createNode('batchrewind', { i: 1 });
      await new Promise(r => setTimeout(r, 2));
      const b = await store.createNode('batchrewind', { i: 2 });
      await new Promise(r => setTimeout(r, 2));
      const c = await store.createNode('batchrewind', { i: 3 });
      const result = await store.rewindTo(checkpoint);
      if (result.rewound < 3) fail('test 16: rewound count wrong', result);
      for (const id of [a.id, b.id, c.id]) {
        const still = await store.getNode(id);
        if (still) fail('test 16: node still there after rewind', id);
      }
    } catch (err) {
      fail('test 16: threw', err);
    }

    // 17. snapshot + restoreSnapshot round trip
    try {
      const preSnapshot = await store.createNode('snaptest', { state: 'before' });
      const snap = await store.snapshot('before-changes');
      await store.updateNode(preSnapshot.id, { state: 'after' });
      const mid = await store.getNode(preSnapshot.id);
      if (mid.props.state !== 'after') fail('test 17: update did not apply');
      await store.restoreSnapshot(snap.id);
      const restored = await store.getNode(preSnapshot.id);
      if (!restored || restored.props.state !== 'before') fail('test 17: snapshot did not restore', restored);
      const snapshots = await store.listSnapshots();
      if (!snapshots.find(s => s.id === snap.id)) fail('test 17: snapshot missing from list');
    } catch (err) {
      fail('test 17: threw', err);
    }

    const TOTAL = 17;
    if (failures === 0) {
      console.log(`[graph-store] all ${TOTAL} sanity tests pass`);
    } else {
      console.warn(`[graph-store] ${failures}/${TOTAL} sanity tests FAILED`);
    }

    // teardown
    store._close();
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(TEST_DB);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  })().catch(err => console.warn('[graph-store] sanity tests crashed', err));
}
