// NOVA OS — Virtual File System (IndexedDB-backed)

class NovaFileSystem {
  constructor() {
    this.db = null;
    this.STORE = 'files';
  }

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('nova-fs', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE, { keyPath: 'path' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        this._seedDefaults().then(resolve);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async _seedDefaults() {
    const existing = await this.readDir('/');
    if (existing.length > 0) return;

    const defaults = [
      { path: '/Desktop', type: 'folder', created: Date.now(), modified: Date.now() },
      { path: '/Documents', type: 'folder', created: Date.now(), modified: Date.now() },
      { path: '/Downloads', type: 'folder', created: Date.now(), modified: Date.now() },
      { path: '/Pictures', type: 'folder', created: Date.now(), modified: Date.now() },
      { path: '/Music', type: 'folder', created: Date.now(), modified: Date.now() },
      { path: '/Desktop/Welcome.txt', type: 'file', content: 'Welcome to Astrion OS!\n\nThis is your new AI-native operating system.\nPress Cmd+Space to open Search and ask Astrion anything.\n\nHave fun exploring!', created: Date.now(), modified: Date.now() },
      { path: '/Documents/Notes.txt', type: 'file', content: 'My first note in Astrion OS.\n\nTODO:\n- Explore the file system\n- Try the AI assistant\n- Customize settings', created: Date.now(), modified: Date.now() },
      { path: '/Documents/Ideas.txt', type: 'file', content: 'Project ideas:\n\n1. Build a website\n2. Make a game\n3. Learn a new language', created: Date.now(), modified: Date.now() },
      { path: '/Pictures/readme.txt', type: 'file', content: 'Drop your images here!', created: Date.now(), modified: Date.now() },
    ];

    const tx = this.db.transaction(this.STORE, 'readwrite');
    const store = tx.objectStore(this.STORE);
    for (const item of defaults) {
      store.put(item);
    }
    return new Promise(resolve => { tx.oncomplete = resolve; });
  }

  async readDir(dirPath) {
    const all = await this._getAll();
    const normalized = dirPath === '/' ? '' : dirPath;
    return all.filter(f => {
      if (f.path === dirPath) return false;
      const parent = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
      return parent === (normalized || '/');
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }

  async readFile(path) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async writeFile(path, content) {
    const existing = await this.readFile(path);
    const entry = {
      path,
      type: 'file',
      content,
      created: existing?.created || Date.now(),
      modified: Date.now()
    };
    return this._put(entry);
  }

  async createFolder(path) {
    const entry = {
      path,
      type: 'folder',
      created: Date.now(),
      modified: Date.now()
    };
    return this._put(entry);
  }

  async delete(path) {
    // Delete the item and all children
    const all = await this._getAll();
    const toDelete = all.filter(f => f.path === path || f.path.startsWith(path + '/'));
    const tx = this.db.transaction(this.STORE, 'readwrite');
    const store = tx.objectStore(this.STORE);
    for (const item of toDelete) {
      store.delete(item.path);
    }
    return new Promise(resolve => { tx.oncomplete = resolve; });
  }

  async rename(oldPath, newPath) {
    // 2026-05-11: was vulnerable to silent data loss when newPath
    // already existed. delete + put in the same tx is atomic against
    // the delete-then-put-fails scenario (audit's stated concern),
    // but it doesn't protect against the COLLISION case: renaming
    // /a/b onto an existing /c/b silently overwrote the existing
    // /c/b entry because IDBObjectStore.put is upsert by primary key.
    // Now we pre-check for collisions and source existence; rename
    // becomes a no-op-with-error on either failure instead of partial
    // success or silent overwrite. Callers (finder, desktop, trash)
    // can surface the error to the user.
    if (typeof oldPath !== 'string' || typeof newPath !== 'string') {
      throw new Error('rename: oldPath and newPath must be strings');
    }
    if (oldPath === newPath) return; // no-op, not an error

    const all = await this._getAll();
    const toRename = all.filter(f => f.path === oldPath || f.path.startsWith(oldPath + '/'));
    if (toRename.length === 0) {
      throw new Error(`rename: source not found: ${oldPath}`);
    }

    // Collision check: build the set of new paths this rename WOULD
    // produce, then verify none of them already exist (except the
    // ones we're about to remove ourselves — i.e., paths within the
    // source subtree, which the put-after-delete will recreate).
    const sourcePaths = new Set(toRename.map(f => f.path));
    const newPaths = toRename.map(f => ({
      from: f.path,
      to: f.path.replace(oldPath, newPath),
    }));
    const existingByPath = new Map(all.map(f => [f.path, f]));
    for (const { to } of newPaths) {
      if (existingByPath.has(to) && !sourcePaths.has(to)) {
        throw new Error(`rename: destination already exists: ${to}`);
      }
    }

    const tx = this.db.transaction(this.STORE, 'readwrite');
    const store = tx.objectStore(this.STORE);
    for (const item of toRename) {
      store.delete(item.path);
      item.path = item.path.replace(oldPath, newPath);
      item.modified = Date.now();
      store.put(item);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Rename transaction aborted'));
    });
  }

  async search(query) {
    const all = await this._getAll();
    const lower = query.toLowerCase();
    return all.filter(f => {
      const name = f.path.split('/').pop().toLowerCase();
      return name.includes(lower) || (f.content && f.content.toLowerCase().includes(lower));
    });
  }

  async exists(path) {
    const file = await this.readFile(path);
    return file !== null;
  }

  getFileName(path) {
    return path.split('/').pop();
  }

  getParentPath(path) {
    const parent = path.substring(0, path.lastIndexOf('/'));
    return parent || '/';
  }

  getExtension(path) {
    const name = this.getFileName(path);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(dot + 1).toLowerCase() : '';
  }

  getFileIcon(entry) {
    if (entry.type === 'folder') return '\uD83D\uDCC1';
    const ext = this.getExtension(entry.path);
    const icons = {
      txt: '\uD83D\uDCC4', md: '\uD83D\uDCC4', doc: '\uD83D\uDCC4',
      js: '\uD83D\uDFE8', html: '\uD83C\uDF10', css: '\uD83C\uDFA8',
      json: '\uD83D\uDCCB', py: '\uD83D\uDC0D',
      jpg: '\uD83D\uDDBC\uFE0F', png: '\uD83D\uDDBC\uFE0F', gif: '\uD83D\uDDBC\uFE0F',
      mp3: '\uD83C\uDFB5', wav: '\uD83C\uDFB5',
      mp4: '\uD83C\uDFAC', mov: '\uD83C\uDFAC',
      zip: '\uD83D\uDCE6', pdf: '\uD83D\uDCC5',
    };
    return icons[ext] || '\uD83D\uDCC4';
  }

  async _getAll() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async _put(entry) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(entry);
      tx.oncomplete = () => resolve(entry);
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const fileSystem = new NovaFileSystem();
