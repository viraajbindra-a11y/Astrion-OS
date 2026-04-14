// Astrion OS — Finder App (v2 polish: arrow-key nav, Delete, range select, media previews)

import { fileSystem } from '../kernel/file-system.js';
import { processManager } from '../kernel/process-manager.js';
import { windowManager } from '../kernel/window-manager.js';

export function registerFinder() {
  processManager.register('finder', {
    name: 'Finder',
    icon: '\uD83D\uDCC2',
    iconClass: 'dock-icon-finder',
    singleInstance: false,
    width: 750,
    height: 480,
    launch: (contentEl, instanceId, options) => {
      initFinder(contentEl, instanceId, options.openPath || '/');
    }
  });
}

async function initFinder(container, instanceId, startPath) {
  let currentPath = startPath;
  let history = [startPath];
  let historyIndex = 0;
  let viewMode = 'grid'; // 'grid' or 'list'

  // v2: selection state — tracks the "cursor" for keyboard nav and
  // the anchor for shift-click range selection.
  let currentFiles = [];          // the files currently rendered
  let selectedIndices = new Set(); // set of indices (into currentFiles)
  let cursorIndex = -1;           // keyboard cursor / last-clicked

  container.innerHTML = `
    <div class="finder" tabindex="-1">
      <div class="finder-sidebar">
        <div class="finder-sidebar-section">Favorites</div>
        <div class="finder-sidebar-item active" data-path="/Desktop">
          <span class="finder-sidebar-icon">\uD83D\uDDA5\uFE0F</span> Desktop
        </div>
        <div class="finder-sidebar-item" data-path="/Documents">
          <span class="finder-sidebar-icon">\uD83D\uDCC4</span> Documents
        </div>
        <div class="finder-sidebar-item" data-path="/Downloads">
          <span class="finder-sidebar-icon">\u2B07\uFE0F</span> Downloads
        </div>
        <div class="finder-sidebar-item" data-path="/Pictures">
          <span class="finder-sidebar-icon">\uD83D\uDDBC\uFE0F</span> Pictures
        </div>
        <div class="finder-sidebar-item" data-path="/Music">
          <span class="finder-sidebar-icon">\uD83C\uDFB5</span> Music
        </div>
        <div class="finder-sidebar-section">Locations</div>
        <div class="finder-sidebar-item" data-path="/">
          <span class="finder-sidebar-icon">\uD83D\uDCBB</span> Astrion HD
        </div>
      </div>
      <div class="finder-main">
        <div class="finder-toolbar">
          <button class="finder-nav-btn" id="finder-back-${instanceId}" aria-label="Back" disabled>\u25C0</button>
          <button class="finder-nav-btn" id="finder-forward-${instanceId}" aria-label="Forward" disabled>\u25B6</button>
          <span class="finder-path" id="finder-path-${instanceId}">${currentPath}</span>
          <div class="finder-toolbar-right">
            <button class="finder-view-btn" id="finder-grid-${instanceId}" aria-label="Grid view" title="Grid view" style="opacity:1">&#9638;</button>
            <button class="finder-view-btn" id="finder-list-${instanceId}" aria-label="List view" title="List view" style="opacity:0.4">&#9776;</button>
            <input type="text" class="finder-search" id="finder-search-${instanceId}" placeholder="Search..." aria-label="Search files">
          </div>
        </div>
        <div class="finder-content-area">
          <div class="finder-files ${viewMode === 'list' ? 'list-view' : ''}" id="finder-files-${instanceId}" tabindex="0" role="listbox" aria-label="Files"></div>
          <div class="finder-preview" id="finder-preview-${instanceId}" style="display:none;"></div>
        </div>
        <div class="finder-statusbar" id="finder-status-${instanceId}">0 items</div>
      </div>
    </div>
  `;

  const finderRoot = container.querySelector('.finder');
  const filesContainer = container.querySelector(`#finder-files-${instanceId}`);
  const pathEl = container.querySelector(`#finder-path-${instanceId}`);
  const statusEl = container.querySelector(`#finder-status-${instanceId}`);
  const backBtn = container.querySelector(`#finder-back-${instanceId}`);
  const forwardBtn = container.querySelector(`#finder-forward-${instanceId}`);
  const searchInput = container.querySelector(`#finder-search-${instanceId}`);
  const previewPanel = container.querySelector(`#finder-preview-${instanceId}`);
  const gridBtn = container.querySelector(`#finder-grid-${instanceId}`);
  const listBtn = container.querySelector(`#finder-list-${instanceId}`);

  // View mode toggles
  gridBtn.addEventListener('click', () => {
    viewMode = 'grid';
    filesContainer.classList.remove('list-view');
    gridBtn.style.opacity = '1';
    listBtn.style.opacity = '0.4';
  });
  listBtn.addEventListener('click', () => {
    viewMode = 'list';
    filesContainer.classList.add('list-view');
    gridBtn.style.opacity = '0.4';
    listBtn.style.opacity = '1';
  });

  // Sidebar navigation
  container.querySelectorAll('.finder-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      container.querySelectorAll('.finder-sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      navigateTo(item.dataset.path);
    });
  });

  // Navigation
  backBtn.addEventListener('click', () => {
    if (historyIndex > 0) {
      historyIndex--;
      currentPath = history[historyIndex];
      loadFiles();
    }
  });

  forwardBtn.addEventListener('click', () => {
    if (historyIndex < history.length - 1) {
      historyIndex++;
      currentPath = history[historyIndex];
      loadFiles();
    }
  });

  // Search
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const query = searchInput.value.trim();
      if (!query) {
        loadFiles();
        return;
      }
      const results = await fileSystem.search(query);
      renderFiles(results);
      statusEl.textContent = `${results.length} results for "${query}"`;
    }, 300);
  });

  function navigateTo(path) {
    currentPath = path;
    history = history.slice(0, historyIndex + 1);
    history.push(path);
    historyIndex = history.length - 1;
    loadFiles();
  }

  async function loadFiles() {
    const files = await fileSystem.readDir(currentPath);
    currentFiles = files;
    selectedIndices = new Set();
    cursorIndex = -1;
    renderFiles(files);
    pathEl.textContent = currentPath;
    statusEl.textContent = `${files.length} item${files.length !== 1 ? 's' : ''}`;
    backBtn.disabled = historyIndex <= 0;
    forwardBtn.disabled = historyIndex >= history.length - 1;

    // Update sidebar active state
    container.querySelectorAll('.finder-sidebar-item').forEach(item => {
      item.classList.toggle('active', item.dataset.path === currentPath);
    });

    // Update window title
    const folderName = currentPath === '/' ? 'Astrion HD' : fileSystem.getFileName(currentPath);
    windowManager.setTitle(instanceId, folderName);

    // Give the files container focus so keyboard nav Just Works after navigation
    filesContainer.focus({ preventScroll: true });
  }

  function renderFiles(files) {
    // Re-cache files for keyboard nav even on search results
    currentFiles = files;

    if (files.length === 0) {
      filesContainer.innerHTML = '<div class="finder-empty">This folder is empty</div>';
      return;
    }

    filesContainer.innerHTML = '';
    files.forEach((file, idx) => {
      const name = fileSystem.getFileName(file.path);
      const icon = fileSystem.getFileIcon(file);

      const el = document.createElement('div');
      el.className = 'finder-file';
      el.dataset.filePath = file.path;
      el.dataset.index = String(idx);
      el.setAttribute('role', 'option');
      el.setAttribute('aria-label', `${file.type === 'folder' ? 'Folder' : 'File'}: ${name}`);
      el.tabIndex = 0;
      // Format file size
      const sizeStr = file.type === 'folder' ? '' : formatFileSize(file.size || 0);
      const modStr = file.modified ? timeAgo(file.modified) : '';
      el.innerHTML = `
        <div class="finder-file-icon">${icon}</div>
        <div class="finder-file-name">${escapeHtml(name)}</div>
        ${sizeStr || modStr ? `<div class="finder-file-meta" style="font-size:9px;color:rgba(255,255,255,0.3);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${[sizeStr, modStr].filter(Boolean).join(' · ')}</div>` : ''}
      `;

      el.addEventListener('click', (e) => {
        handleFileClick(idx, file, e);
      });

      el.addEventListener('dblclick', () => openFile(file, name));

      // Drag support — drag files to Desktop or other Finder windows
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('nova/filepath', file.path);
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));

      // Drop onto folders — move file into folder
      if (file.type === 'folder') {
        el.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drop-target');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
        el.addEventListener('drop', async (e) => {
          e.preventDefault();
          el.classList.remove('drop-target');
          const srcPath = e.dataTransfer.getData('nova/filepath');
          if (srcPath && srcPath !== file.path) {
            const srcName = fileSystem.getFileName(srcPath);
            const destPath = `${file.path}/${srcName}`;
            await fileSystem.rename(srcPath, destPath);
            loadFiles();
          }
        });
      }

      // Inline rename — double-click the filename text
      const nameEl = el.querySelector('.finder-file-name');
      if (nameEl) {
        nameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const input = document.createElement('input');
          input.type = 'text';
          input.value = name;
          input.style.cssText = 'width:100%;padding:2px 4px;background:rgba(255,255,255,0.1);border:1px solid var(--accent);border-radius:4px;color:white;font-size:12px;font-family:var(--font);outline:none;text-align:center;';
          nameEl.replaceWith(input);
          input.focus();
          input.select();

          const doRename = async () => {
            const newName = input.value.trim();
            if (newName && newName !== name) {
              const parentPath = file.path.split('/').slice(0, -1).join('/');
              const newPath = parentPath + '/' + newName;
              await fileSystem.rename(file.path, newPath);
              loadFiles();
            } else {
              const span = document.createElement('div');
              span.className = 'finder-file-name';
              span.textContent = name;
              input.replaceWith(span);
            }
          };
          input.addEventListener('keydown', (ke) => {
            ke.stopPropagation(); // don't leak to finder keydown handler
            if (ke.key === 'Enter') doRename();
            if (ke.key === 'Escape') { input.replaceWith(nameEl); }
          });
          input.addEventListener('blur', doRename);
        });
      }

      // Right-click context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e.clientX, e.clientY, file, name);
      });

      filesContainer.appendChild(el);
    });
  }

  // ---------- selection + keyboard nav (v2) ----------

  function handleFileClick(idx, file, e) {
    const additive = e.metaKey || e.ctrlKey;
    const rangeSelect = e.shiftKey && cursorIndex >= 0;

    if (rangeSelect) {
      // Shift-click: select range from cursorIndex to idx (inclusive)
      if (!additive) selectedIndices.clear();
      const lo = Math.min(cursorIndex, idx);
      const hi = Math.max(cursorIndex, idx);
      for (let i = lo; i <= hi; i++) selectedIndices.add(i);
    } else if (additive) {
      // Cmd/Ctrl-click: toggle this one
      if (selectedIndices.has(idx)) selectedIndices.delete(idx);
      else selectedIndices.add(idx);
      cursorIndex = idx;
    } else {
      // Plain click: select only this one
      selectedIndices = new Set([idx]);
      cursorIndex = idx;
    }
    applySelectionToDom();
    refreshPreview(file);
  }

  function applySelectionToDom() {
    const children = filesContainer.querySelectorAll('.finder-file');
    children.forEach((el) => {
      const i = Number(el.dataset.index);
      if (selectedIndices.has(i)) el.classList.add('selected');
      else el.classList.remove('selected');
      // Mark the cursor element so CSS can give it a distinct outline
      if (i === cursorIndex) el.classList.add('cursor');
      else el.classList.remove('cursor');
    });
  }

  function refreshPreview(file) {
    if (file && file.type === 'file' && selectedIndices.size === 1) {
      showPreview(file, fileSystem.getFileName(file.path));
    } else {
      hidePreview();
    }
  }

  function focusCursorIntoView() {
    const el = filesContainer.querySelector(`.finder-file[data-index="${cursorIndex}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function getColumnsPerRow() {
    // For grid view we need to know how many columns the layout is using
    // so up/down arrows jump the right distance. For list view it's 1.
    if (viewMode === 'list') return 1;
    const first = filesContainer.querySelector('.finder-file');
    if (!first) return 1;
    const containerW = filesContainer.clientWidth;
    const tileW = first.offsetWidth + 8; // tile + gap approximation
    return Math.max(1, Math.floor(containerW / tileW));
  }

  function moveCursor(delta, selectMode) {
    if (currentFiles.length === 0) return;
    const prev = cursorIndex;
    let next = cursorIndex < 0 ? 0 : cursorIndex + delta;
    next = Math.max(0, Math.min(currentFiles.length - 1, next));
    cursorIndex = next;
    if (selectMode === 'replace') {
      selectedIndices = new Set([next]);
    } else if (selectMode === 'extend' && prev >= 0) {
      // Shift + arrow extends selection from original anchor to new cursor
      const lo = Math.min(prev, next);
      const hi = Math.max(prev, next);
      selectedIndices = new Set();
      for (let i = lo; i <= hi; i++) selectedIndices.add(i);
    } else if (selectMode === 'none') {
      // Cmd-arrow — move cursor without changing selection
    }
    applySelectionToDom();
    focusCursorIntoView();
    const file = currentFiles[cursorIndex];
    if (file) refreshPreview(file);
  }

  function handleFinderKeyDown(e) {
    // If the user is typing in any input, never hijack the keys.
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }
    // If a context menu or dialog is open, also bail.
    if (document.querySelector('.finder-context-menu')) return;

    const key = e.key;

    if (key === 'ArrowRight') {
      e.preventDefault();
      moveCursor(viewMode === 'list' ? 1 : 1, e.shiftKey ? 'extend' : 'replace');
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      moveCursor(viewMode === 'list' ? -1 : -1, e.shiftKey ? 'extend' : 'replace');
    } else if (key === 'ArrowDown') {
      e.preventDefault();
      const step = getColumnsPerRow();
      moveCursor(step, e.shiftKey ? 'extend' : 'replace');
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      const step = getColumnsPerRow();
      moveCursor(-step, e.shiftKey ? 'extend' : 'replace');
    } else if (key === 'Home') {
      e.preventDefault();
      cursorIndex = 0;
      selectedIndices = new Set([0]);
      applySelectionToDom();
      focusCursorIntoView();
      if (currentFiles[0]) refreshPreview(currentFiles[0]);
    } else if (key === 'End') {
      e.preventDefault();
      const last = currentFiles.length - 1;
      cursorIndex = last;
      selectedIndices = new Set([last]);
      applySelectionToDom();
      focusCursorIntoView();
      if (currentFiles[last]) refreshPreview(currentFiles[last]);
    } else if (key === 'Enter') {
      if (cursorIndex < 0) return;
      e.preventDefault();
      const file = currentFiles[cursorIndex];
      if (file) openFile(file, fileSystem.getFileName(file.path));
    } else if (key === 'Delete' || key === 'Backspace') {
      if (selectedIndices.size === 0) return;
      e.preventDefault();
      deleteSelected();
    } else if ((key === 'a' || key === 'A') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      selectedIndices = new Set(currentFiles.map((_, i) => i));
      if (cursorIndex < 0) cursorIndex = 0;
      applySelectionToDom();
    } else if (key === 'Escape') {
      selectedIndices = new Set();
      cursorIndex = -1;
      applySelectionToDom();
      hidePreview();
    }
  }

  async function deleteSelected() {
    const toDelete = Array.from(selectedIndices)
      .sort((a, b) => b - a) // delete high indices first so lower indices don't shift
      .map(i => currentFiles[i])
      .filter(Boolean);
    if (toDelete.length === 0) return;
    const names = toDelete.map(f => fileSystem.getFileName(f.path));
    const msg = toDelete.length === 1
      ? `Delete "${names[0]}"?`
      : `Delete ${toDelete.length} items?\n\n${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`;
    if (!confirm(msg)) return;
    for (const f of toDelete) {
      try { await fileSystem.delete(f.path); } catch (err) { console.warn('[finder] delete failed', f.path, err); }
    }
    loadFiles();
  }

  function openFile(file, name) {
    if (file.type === 'folder') {
      navigateTo(file.path);
      return;
    }
    const ext = (fileSystem.getExtension(file.path) || '').toLowerCase();
    // Route common media types to their native apps
    if (['pdf'].includes(ext)) {
      processManager.launch('pdf-viewer', { filePath: file.path, title: name });
    } else if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
      processManager.launch('music', { filePath: file.path, title: name });
    } else if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
      processManager.launch('video-player', { filePath: file.path, title: name });
    } else if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) {
      processManager.launch('photos', { filePath: file.path, title: name });
    } else {
      processManager.launch('text-editor', { filePath: file.path, title: name });
    }
  }

  // Attach keyboard nav to both the files container and the whole finder root
  // so arrow keys work regardless of which child has focus.
  filesContainer.addEventListener('keydown', handleFinderKeyDown);
  finderRoot.addEventListener('keydown', (e) => {
    // Only delegate if the event wasn't handled by a child input
    if (e.defaultPrevented) return;
    handleFinderKeyDown(e);
  });

  function showFileContextMenu(x, y, file, name) {
    document.querySelectorAll('.finder-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'finder-context-menu';
    menu.style.cssText = `position:fixed;left:${Math.min(x, window.innerWidth - 200)}px;top:${Math.min(y, window.innerHeight - 200)}px;background:rgba(38,38,42,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px;min-width:180px;z-index:99999;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-size:13px;`;

    const items = [
      { label: 'Open', action: () => openFile(file, name) },
      { label: 'Open With...', disabled: true },
      { separator: true },
      { label: 'Rename', action: async () => {
        const newName = prompt('Rename to:', name);
        if (newName && newName !== name) {
          const newPath = file.path.replace(name, newName);
          await fileSystem.rename(file.path, newPath);
          loadFiles();
        }
      }},
      { label: 'Duplicate', action: async () => {
        if (file.type === 'file') {
          const content = (await fileSystem.readFile(file.path))?.content || '';
          await fileSystem.writeFile(file.path.replace(name, name.replace(/(\.\w+)?$/, ' copy$1')), content);
          loadFiles();
        }
      }},
      { separator: true },
      { label: 'Move to Trash', action: async () => {
        if (confirm(`Delete "${name}"?`)) {
          await fileSystem.delete(file.path);
          loadFiles();
        }
      }},
      { separator: true },
      { label: 'Open in Terminal', action: () => {
        // Open terminal at the file's parent directory (or the folder itself)
        const dir = file.type === 'folder' ? file.path : file.path.substring(0, file.path.lastIndexOf('/')) || '/';
        processManager.launch('terminal', { cwd: dir });
      }},
      { label: 'Copy Path', action: async () => {
        try { await navigator.clipboard.writeText(file.path); } catch {}
      }},
      { separator: true },
      { label: 'Get Info', action: () => {
        const info = `Name: ${name}\nPath: ${file.path}\nType: ${file.type}\nCreated: ${new Date(file.created).toLocaleString()}\nModified: ${new Date(file.modified).toLocaleString()}`;
        alert(info);
      }},
    ];

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:4px 8px;';
        menu.appendChild(sep);
        return;
      }
      const el = document.createElement('div');
      el.style.cssText = `padding:6px 12px;border-radius:4px;cursor:${item.disabled ? 'default' : 'pointer'};color:${item.disabled ? 'rgba(255,255,255,0.3)' : 'white'};`;
      el.textContent = item.label;
      if (!item.disabled) {
        el.addEventListener('mouseenter', () => el.style.background = 'var(--accent)');
        el.addEventListener('mouseleave', () => el.style.background = 'transparent');
        el.addEventListener('click', () => { menu.remove(); item.action(); });
      }
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
  }

  // File preview panel — v2: PDF, audio, video support in addition to text + images
  async function showPreview(file, name) {
    const data = await fileSystem.readFile(file.path);
    if (!data) return;

    const ext = (fileSystem.getExtension(file.path) || '').toLowerCase();
    let preview = '';
    const icon = fileSystem.getFileIcon(file);
    const modified = new Date(data.modified).toLocaleString();
    const contentLen = typeof data.content === 'string' ? data.content.length : 0;
    const size = contentLen ? `${contentLen.toLocaleString()} bytes` : '0 bytes';

    // Text preview
    if (['txt', 'md', 'js', 'html', 'css', 'json', 'py', 'ts', 'xml', 'csv', 'sh', 'yaml', 'yml', 'log'].includes(ext)) {
      const content = (data.content || '').substring(0, 500);
      preview = `<pre style="font-size:10px;color:rgba(255,255,255,0.6);white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:hidden;background:rgba(0,0,0,0.2);padding:8px;border-radius:6px;margin:8px 0;">${escapeHtml(content)}${contentLen > 500 ? '\n…' : ''}</pre>`;
    }
    // Image preview (data URL)
    else if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext) && typeof data.content === 'string' && data.content.startsWith('data:')) {
      preview = `<img src="${data.content}" alt="${escapeHtml(name)}" style="max-width:100%;max-height:220px;border-radius:6px;margin:8px 0;box-shadow:0 4px 20px rgba(0,0,0,0.3);">`;
    }
    // Audio preview (data URL)
    else if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) && typeof data.content === 'string' && data.content.startsWith('data:')) {
      preview = `<audio controls src="${data.content}" style="width:100%;margin:8px 0;"></audio><div style="font-size:10px;color:rgba(255,255,255,0.3);">Click to open in Music</div>`;
    }
    // Video preview (data URL)
    else if (['mp4', 'webm', 'mov', 'mkv', 'ogv'].includes(ext) && typeof data.content === 'string' && data.content.startsWith('data:')) {
      preview = `<video controls src="${data.content}" style="max-width:100%;max-height:220px;border-radius:6px;margin:8px 0;background:#000;"></video>`;
    }
    // PDF preview (data URL)
    else if (ext === 'pdf' && typeof data.content === 'string' && data.content.startsWith('data:')) {
      preview = `<embed src="${data.content}" type="application/pdf" style="width:100%;height:240px;border:none;border-radius:6px;margin:8px 0;background:#1a1a22;">`;
    }

    previewPanel.innerHTML = `
      <div style="text-align:center;padding:12px;">
        <div style="font-size:48px;margin-bottom:8px;">${icon}</div>
        <div style="font-weight:600;font-size:13px;color:white;word-break:break-word;">${escapeHtml(name)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;">${(ext || 'File').toUpperCase()} &middot; ${size}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px;">Modified: ${modified}</div>
        ${preview}
      </div>
    `;
    previewPanel.style.display = 'block';
  }

  function hidePreview() {
    previewPanel.style.display = 'none';
    previewPanel.innerHTML = '';
  }

  function escapeHtml(text) {
    return (text == null ? '' : String(text)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Drop files into the current directory (from Desktop or external)
  filesContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  filesContainer.addEventListener('drop', async (e) => {
    if (e.target.closest('.finder-file')) return; // handled by folder drop
    e.preventDefault();

    // Internal file move
    const srcPath = e.dataTransfer.getData('nova/filepath');
    if (srcPath) {
      const srcName = fileSystem.getFileName(srcPath);
      const destPath = currentPath === '/' ? `/${srcName}` : `${currentPath}/${srcName}`;
      if (srcPath !== destPath) {
        await fileSystem.rename(srcPath, destPath);
        loadFiles();
      }
      return;
    }

    // External file drop (from OS)
    if (e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        const reader = new FileReader();
        reader.onload = async () => {
          const destPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
          await fileSystem.writeFile(destPath, reader.result);
          loadFiles();
        };
        if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|js|html|css|json|py|ts|xml|csv|sh|yaml|yml|log)$/i)) {
          reader.readAsText(file);
        } else {
          reader.readAsDataURL(file);
        }
      }
    }
  });

  // Initial load
  loadFiles();
}
