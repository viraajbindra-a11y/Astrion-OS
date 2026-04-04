// NOVA OS — Finder App

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

  container.innerHTML = `
    <div class="finder">
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
          <span class="finder-sidebar-icon">\uD83D\uDCBB</span> NOVA HD
        </div>
      </div>
      <div class="finder-main">
        <div class="finder-toolbar">
          <button class="finder-nav-btn" id="finder-back-${instanceId}" disabled>\u25C0</button>
          <button class="finder-nav-btn" id="finder-forward-${instanceId}" disabled>\u25B6</button>
          <span class="finder-path" id="finder-path-${instanceId}">${currentPath}</span>
          <input type="text" class="finder-search" id="finder-search-${instanceId}" placeholder="Search...">
        </div>
        <div class="finder-files ${viewMode === 'list' ? 'list-view' : ''}" id="finder-files-${instanceId}"></div>
        <div class="finder-statusbar" id="finder-status-${instanceId}">0 items</div>
      </div>
    </div>
  `;

  const filesContainer = container.querySelector(`#finder-files-${instanceId}`);
  const pathEl = container.querySelector(`#finder-path-${instanceId}`);
  const statusEl = container.querySelector(`#finder-status-${instanceId}`);
  const backBtn = container.querySelector(`#finder-back-${instanceId}`);
  const forwardBtn = container.querySelector(`#finder-forward-${instanceId}`);
  const searchInput = container.querySelector(`#finder-search-${instanceId}`);

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
    const windowId = instanceId;
    const folderName = currentPath === '/' ? 'NOVA HD' : fileSystem.getFileName(currentPath);
    windowManager.setTitle(windowId, folderName);
  }

  function renderFiles(files) {
    if (files.length === 0) {
      filesContainer.innerHTML = '<div class="finder-empty">This folder is empty</div>';
      return;
    }

    filesContainer.innerHTML = '';
    files.forEach(file => {
      const name = fileSystem.getFileName(file.path);
      const icon = fileSystem.getFileIcon(file);

      const el = document.createElement('div');
      el.className = 'finder-file';
      el.innerHTML = `
        <div class="finder-file-icon">${icon}</div>
        <div class="finder-file-name">${name}</div>
      `;

      el.addEventListener('click', (e) => {
        if (!e.metaKey && !e.ctrlKey) {
          filesContainer.querySelectorAll('.finder-file').forEach(f => f.classList.remove('selected'));
        }
        el.classList.toggle('selected');
      });

      el.addEventListener('dblclick', () => {
        if (file.type === 'folder') {
          navigateTo(file.path);
        } else {
          processManager.launch('text-editor', { filePath: file.path, title: name });
        }
      });

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

      // Right-click context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e.clientX, e.clientY, file, name);
      });

      filesContainer.appendChild(el);
    });
  }

  function showFileContextMenu(x, y, file, name) {
    // Remove existing menu
    document.querySelectorAll('.finder-context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'finder-context-menu';
    menu.style.cssText = `position:fixed;left:${Math.min(x, window.innerWidth - 200)}px;top:${Math.min(y, window.innerHeight - 200)}px;background:rgba(38,38,42,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px;min-width:180px;z-index:99999;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-size:13px;`;

    const items = [
      { label: 'Open', action: () => {
        if (file.type === 'folder') navigateTo(file.path);
        else processManager.launch('text-editor', { filePath: file.path, title: name });
      }},
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
        if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|js|html|css|json|py|ts|xml|csv|sh|yaml|yml)$/i)) {
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
