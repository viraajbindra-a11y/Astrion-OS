// NOVA OS — Desktop (icons, wallpaper, right-click menu, drag & drop)

import { processManager } from '../kernel/process-manager.js';
import { fileSystem } from '../kernel/file-system.js';
import { eventBus } from '../kernel/event-bus.js';

export function initDesktop() {
  loadDesktopIcons();
  setupContextMenu();
  setupDesktopDragDrop();
}

async function loadDesktopIcons() {
  const container = document.getElementById('desktop-icons');
  const files = await fileSystem.readDir('/Desktop');

  container.innerHTML = '';

  files.forEach(file => {
    const name = fileSystem.getFileName(file.path);
    const icon = fileSystem.getFileIcon(file);

    const el = document.createElement('div');
    el.className = 'desktop-icon';
    el.innerHTML = `
      <div class="desktop-icon-img">${icon}</div>
      <div class="desktop-icon-label">${name}</div>
    `;

    el.addEventListener('click', (e) => {
      container.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
    });

    el.addEventListener('dblclick', () => {
      if (file.type === 'folder') {
        processManager.launch('finder', { openPath: file.path });
      } else {
        processManager.launch('text-editor', { filePath: file.path, title: name });
      }
    });

    // Drag desktop icons
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('nova/filepath', file.path);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    // Right-click context menu on desktop icons
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDesktopIconMenu(e, file, name);
    });

    container.appendChild(el);
  });
}

function setupContextMenu() {
  const menu = document.getElementById('context-menu');
  const menuItems = document.getElementById('context-menu-items');

  document.getElementById('desktop').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.window') || e.target.closest('#dock') || e.target.closest('#menubar')) return;
    e.preventDefault();

    menuItems.innerHTML = `
      <div class="context-menu-item" data-action="new-folder">\uD83D\uDCC1 New Folder</div>
      <div class="context-menu-item" data-action="new-file">\uD83D\uDCC4 New File</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="open-terminal">\uD83D\uDDA5 Open Terminal Here</div>
      <div class="context-menu-item" data-action="open-finder">\uD83D\uDCC2 Open in Finder</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="change-wallpaper">\uD83C\uDF05 Change Wallpaper</div>
      <div class="context-menu-item" data-action="tile-windows">\u2B1C Grid Tile Windows</div>
      <div class="context-menu-separator"></div>
      <div class="context-menu-item" data-action="refresh">\uD83D\uDD04 Refresh Desktop</div>
    `;

    menu.classList.remove('hidden');
    menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
  });

  document.addEventListener('click', () => {
    menu.classList.add('hidden');
  });

  menuItems.addEventListener('click', async (e) => {
    const action = e.target.closest('.context-menu-item')?.dataset.action;
    if (!action) return;

    if (action === 'new-folder') {
      const name = prompt('Folder name:');
      if (name) {
        await fileSystem.createFolder(`/Desktop/${name}`);
        loadDesktopIcons();
      }
    } else if (action === 'new-file') {
      const name = prompt('File name:');
      if (name) {
        await fileSystem.writeFile(`/Desktop/${name}`, '');
        loadDesktopIcons();
      }
    } else if (action === 'open-terminal') {
      processManager.launch('terminal', { cwd: '/Desktop' });
    } else if (action === 'open-finder') {
      processManager.launch('finder', { openPath: '/Desktop' });
    } else if (action === 'change-wallpaper') {
      processManager.launch('settings');
    } else if (action === 'tile-windows') {
      eventBus.emit('shortcut:tile-windows');
    } else if (action === 'refresh') {
      loadDesktopIcons();
    }
  });
}

function showDesktopIconMenu(e, file, name) {
  // Remove existing menus
  document.querySelectorAll('.desktop-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'desktop-context-menu';
  menu.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth - 200)}px;top:${Math.min(e.clientY, window.innerHeight - 200)}px;background:rgba(38,38,42,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px;min-width:180px;z-index:99999;box-shadow:0 10px 40px rgba(0,0,0,0.4);font-size:13px;`;

  const items = [
    { label: 'Open', action: () => {
      if (file.type === 'folder') processManager.launch('finder', { openPath: file.path });
      else processManager.launch('text-editor', { filePath: file.path, title: name });
    }},
    { separator: true },
    { label: 'Rename', action: async () => {
      const newName = prompt('Rename to:', name);
      if (newName && newName !== name) {
        const newPath = file.path.replace(name, newName);
        await fileSystem.rename(file.path, newPath);
        loadDesktopIcons();
      }
    }},
    { label: 'Duplicate', action: async () => {
      if (file.type === 'file') {
        const content = (await fileSystem.readFile(file.path))?.content || '';
        const copyName = name.replace(/(\.\w+)?$/, ' copy$1');
        await fileSystem.writeFile(`/Desktop/${copyName}`, content);
        loadDesktopIcons();
      }
    }},
    { separator: true },
    { label: 'Move to Trash', action: async () => {
      if (confirm(`Delete "${name}"?`)) {
        await fileSystem.delete(file.path);
        loadDesktopIcons();
      }
    }},
    { separator: true },
    { label: 'Get Info', action: () => {
      alert(`Name: ${name}\nPath: ${file.path}\nType: ${file.type}\nCreated: ${new Date(file.created).toLocaleString()}\nModified: ${new Date(file.modified).toLocaleString()}`);
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
    el.style.cssText = 'padding:6px 12px;border-radius:4px;cursor:pointer;color:white;';
    el.textContent = item.label;
    el.addEventListener('mouseenter', () => el.style.background = 'var(--accent)');
    el.addEventListener('mouseleave', () => el.style.background = 'transparent');
    el.addEventListener('click', () => { menu.remove(); item.action(); });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

function setupDesktopDragDrop() {
  const desktop = document.getElementById('desktop');

  // Allow dropping files from OS (external drag) onto the desktop
  desktop.addEventListener('dragover', (e) => {
    if (e.target.closest('.window') || e.target.closest('#dock') || e.target.closest('#menubar')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    desktop.classList.add('drag-over');
  });

  desktop.addEventListener('dragleave', (e) => {
    if (!desktop.contains(e.relatedTarget) || e.relatedTarget === null) {
      desktop.classList.remove('drag-over');
    }
  });

  desktop.addEventListener('drop', async (e) => {
    if (e.target.closest('.window') || e.target.closest('#dock')) return;
    e.preventDefault();
    desktop.classList.remove('drag-over');

    // Handle internal file drags (from Finder)
    const novaFilePath = e.dataTransfer.getData('nova/filepath');
    if (novaFilePath) {
      const fileName = fileSystem.getFileName(novaFilePath);
      const destPath = `/Desktop/${fileName}`;
      if (novaFilePath !== destPath) {
        await fileSystem.rename(novaFilePath, destPath);
        loadDesktopIcons();
        eventBus.emit('fs:changed', '/Desktop');
      }
      return;
    }

    // Handle external files (dragged from OS)
    if (e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        const reader = new FileReader();
        reader.onload = async () => {
          const content = reader.result;
          await fileSystem.writeFile(`/Desktop/${file.name}`, content);
          loadDesktopIcons();
        };
        if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|js|html|css|json|py|ts|xml|csv|sh|yaml|yml)$/i)) {
          reader.readAsText(file);
        } else {
          // Store binary files as base64 data URLs
          reader.readAsDataURL(file);
        }
      }
    }
  });
}

// Re-export for refreshing
export { loadDesktopIcons };
