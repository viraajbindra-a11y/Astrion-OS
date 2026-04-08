// NOVA OS — Spotlight (AI Command Palette)

import { eventBus } from '../kernel/event-bus.js';
import { processManager } from '../kernel/process-manager.js';
import { fileSystem } from '../kernel/file-system.js';
import { aiService } from '../kernel/ai-service.js';

let isOpen = false;

export function initSpotlight() {
  const spotlight = document.getElementById('spotlight');
  const input = document.getElementById('spotlight-input');
  const results = document.getElementById('spotlight-results');

  // Cmd+Space or Ctrl+Space
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
      e.preventDefault();
      toggle();
    }
    if (e.key === 'Escape' && isOpen) {
      close();
    }
  });

  eventBus.on('spotlight:toggle', toggle);

  // Click backdrop to close
  spotlight.querySelector('.spotlight-backdrop').addEventListener('click', close);

  // Input handling
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      results.innerHTML = '';
      return;
    }
    debounceTimer = setTimeout(() => handleQuery(query), 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = input.value.trim();
      if (query) handleSubmit(query);
    }
  });

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function open() {
    spotlight.classList.remove('hidden');
    input.value = '';
    results.innerHTML = '';
    input.focus();
    isOpen = true;
  }

  function close() {
    spotlight.classList.add('hidden');
    isOpen = false;
    input.value = '';
    results.innerHTML = '';
  }

  async function handleQuery(query) {
    const lower = query.toLowerCase();
    let html = '';

    // Search apps
    const apps = processManager.getAllApps();
    const matchedApps = apps.filter(a =>
      a.name.toLowerCase().includes(lower) || a.id.includes(lower)
    );

    if (matchedApps.length > 0) {
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">Applications</div>`;
      matchedApps.forEach(app => {
        html += `<div class="spotlight-result-item" data-action="launch" data-app="${app.id}">
          <div class="spotlight-result-icon">${app.icon}</div>
          <div class="spotlight-result-text">
            <div class="spotlight-result-title">${app.name}</div>
            <div class="spotlight-result-subtitle">Application</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    // Search files
    const files = await fileSystem.search(query);
    if (files.length > 0) {
      html += `<div class="spotlight-result-group">
        <div class="spotlight-result-label">Files</div>`;
      files.slice(0, 5).forEach(file => {
        const icon = fileSystem.getFileIcon(file);
        const name = fileSystem.getFileName(file.path);
        html += `<div class="spotlight-result-item" data-action="open-file" data-path="${file.path}" data-type="${file.type}">
          <div class="spotlight-result-icon">${icon}</div>
          <div class="spotlight-result-text">
            <div class="spotlight-result-title">${name}</div>
            <div class="spotlight-result-subtitle">${file.path}</div>
          </div>
        </div>`;
      });
      html += `</div>`;
    }

    // Always show AI option
    html += `<div class="spotlight-result-group">
      <div class="spotlight-result-label">NOVA AI</div>
      <div class="spotlight-result-item" data-action="ask-ai">
        <div class="spotlight-result-icon" style="background:linear-gradient(135deg,#007aff,#5856d6);border-radius:50%;color:white;font-size:14px;font-weight:bold;">N</div>
        <div class="spotlight-result-text">
          <div class="spotlight-result-title">Ask NOVA: "${query.substring(0, 50)}"</div>
          <div class="spotlight-result-subtitle">Press Enter to ask AI</div>
        </div>
      </div>
    </div>`;

    results.innerHTML = html;

    // Click handlers for results
    results.querySelectorAll('.spotlight-result-item').forEach(item => {
      item.addEventListener('click', () => {
        handleResultClick(item, query);
      });
    });
  }

  async function handleSubmit(query) {
    // Check for app launch commands
    const lower = query.toLowerCase();
    const appCommands = {
      'open terminal': 'terminal',
      'open notes': 'notes',
      'open finder': 'finder',
      'open calculator': 'calculator',
      'open settings': 'settings',
      'open text editor': 'text-editor',
      'open editor': 'text-editor',
      'open browser': 'browser',
      'open music': 'music',
      'open calendar': 'calendar',
      'open draw': 'draw',
      'open app store': 'appstore',
      'open store': 'appstore',
      'open photos': 'photos',
      'open weather': 'weather',
      'open clock': 'clock',
      'open reminders': 'reminders',
      'open activity monitor': 'activity-monitor',
      'open monitor': 'activity-monitor',
      'open vault': 'vault',
      'open passwords': 'vault',
      'open password manager': 'vault',
      'record screen': 'screen-recorder',
      'screen recorder': 'screen-recorder',
      'open screen recorder': 'screen-recorder',
      'open trash': 'trash',
      'empty trash': 'trash',
      'install nova': 'installer',
      'install nova os': 'installer',
      'installer': 'installer',
      'open sticky notes': 'sticky-notes',
      'open stickies': 'sticky-notes',
      'open contacts': 'contacts',
      'open maps': 'maps',
      'open map': 'maps',
      'directions': 'maps',
    };

    for (const [cmd, appId] of Object.entries(appCommands)) {
      if (lower.includes(cmd) || lower === cmd) {
        processManager.launch(appId);
        close();
        return;
      }
    }

    // Ask AI
    results.innerHTML = `<div class="spotlight-loading">Thinking...</div>`;
    const response = await aiService.ask(query);

    // Check if AI response mentions opening an app
    const lowerResp = response.toLowerCase();
    if (lowerResp.includes('opening')) {
      for (const [cmd, appId] of Object.entries(appCommands)) {
        const appName = cmd.replace('open ', '');
        if (lowerResp.includes(appName)) {
          processManager.launch(appId);
          close();
          return;
        }
      }
    }

    results.innerHTML = `<div class="spotlight-ai-response">${escapeHtml(response)}</div>`;
  }

  function handleResultClick(item, query) {
    const action = item.dataset.action;

    if (action === 'launch') {
      processManager.launch(item.dataset.app);
      close();
    } else if (action === 'open-file') {
      if (item.dataset.type === 'folder') {
        processManager.launch('finder', { openPath: item.dataset.path });
      } else {
        processManager.launch('text-editor', {
          filePath: item.dataset.path,
          title: fileSystem.getFileName(item.dataset.path)
        });
      }
      close();
    } else if (action === 'ask-ai') {
      handleSubmit(query);
    }
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
