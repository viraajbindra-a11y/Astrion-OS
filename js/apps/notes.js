// Astrion OS — Notes App (graph-backed as of M2.P4)

import { processManager } from '../kernel/process-manager.js';
import { aiService } from '../kernel/ai-service.js';
import { graphStore } from '../kernel/graph-store.js';
import { query as graphQuery } from '../kernel/graph-query.js';
import { eventBus } from '../kernel/event-bus.js';

export function registerNotes() {
  processManager.register('notes', {
    name: 'Notes',
    icon: '\uD83D\uDCDD',
    iconClass: 'dock-icon-notes',
    singleInstance: true,
    width: 750,
    height: 500,
    launch: (contentEl, instanceId) => {
      initNotes(contentEl, instanceId);
    }
  });
}

// Welcome notes seeded on first launch if the graph has no notes yet.
const WELCOME_NOTES = [
  {
    title: 'Welcome to Notes',
    content: 'Welcome to Astrion Notes!\n\nThis is your personal note-taking app with AI superpowers.\n\nClick the AI button in the toolbar to enhance your writing.',
  },
  {
    title: 'Shopping List',
    content: 'Groceries:\n- Milk\n- Eggs\n- Bread\n- Coffee\n- Apples',
  },
];

async function loadNotes() {
  // Sorted newest first by updatedAt; props.date is preserved from migration
  // but updatedAt is the source of truth going forward.
  return graphQuery(graphStore, {
    type: 'select',
    from: 'note',
    orderBy: { field: 'updatedAt', dir: 'desc' },
    limit: 1000,
  });
}

async function initNotes(container, instanceId) {
  let notes = await loadNotes();
  let activeNoteId = null;

  // Seed welcome notes once if the graph is empty (first launch, post-migration).
  if (notes.length === 0) {
    for (const w of WELCOME_NOTES) {
      await graphStore.createNode('note', {
        title: w.title,
        content: w.content,
        date: new Date().toISOString(),
      }, { createdBy: { kind: 'system' } });
    }
    notes = await loadNotes();
  }

  container.innerHTML = `
    <div class="notes-app">
      <div class="notes-sidebar">
        <div class="notes-sidebar-header">
          <span class="notes-sidebar-title">Notes</span>
          <button class="notes-new-btn" title="New Note">+</button>
        </div>
        <input type="text" class="notes-search" placeholder="Search notes...">
        <div class="notes-list" id="notes-list-${instanceId}"></div>
      </div>
      <div class="notes-editor" id="notes-editor-${instanceId}">
        <div class="notes-empty">Select a note or create a new one</div>
      </div>
    </div>
  `;

  const listEl = container.querySelector(`#notes-list-${instanceId}`);
  const editorEl = container.querySelector(`#notes-editor-${instanceId}`);
  const searchInput = container.querySelector('.notes-search');
  const newBtn = container.querySelector('.notes-new-btn');
  let currentFilter = '';

  // New note
  newBtn.addEventListener('click', async () => {
    const created = await graphStore.createNode('note', {
      title: 'New Note',
      content: '',
      date: new Date().toISOString(),
    });
    notes.unshift(created);
    selectNote(created.id);
    renderList(currentFilter);
  });

  // Search (client-side filter over the cached list)
  searchInput.addEventListener('input', () => {
    currentFilter = searchInput.value.trim().toLowerCase();
    renderList(currentFilter);
  });

  // Keep the list fresh when other contexts mutate notes (e.g., intent kernel
  // creates a note via capability providers). Cheap: refetch the whole list.
  const unsubCreated = eventBus.on('graph:node:created', async (p) => {
    if (p?.node?.type !== 'note') return;
    notes = await loadNotes();
    renderList(currentFilter);
  });
  const unsubDeleted = eventBus.on('graph:node:deleted', async (p) => {
    // We don't know the type from the payload directly; cheap refetch.
    notes = await loadNotes();
    if (activeNoteId && !notes.find(n => n.id === activeNoteId)) {
      activeNoteId = null;
      editorEl.innerHTML = '<div class="notes-empty">Select a note or create a new one</div>';
    }
    renderList(currentFilter);
  });
  // Clean up subscribers when the app window is closed.
  const appWindow = container.closest('.window');
  if (appWindow) {
    const obs = new MutationObserver(() => {
      if (!document.body.contains(appWindow)) {
        unsubCreated();
        unsubDeleted();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function renderList(filter = '') {
    const filtered = filter
      ? notes.filter(n =>
          (n.props.title || '').toLowerCase().includes(filter) ||
          (n.props.content || '').toLowerCase().includes(filter))
      : notes;

    listEl.innerHTML = '';
    filtered.forEach(note => {
      const el = document.createElement('div');
      el.className = `notes-list-item${note.id === activeNoteId ? ' active' : ''}`;
      const content = note.props.content || '';
      const preview = content.split('\n')[0].substring(0, 60) || 'Empty note';
      const dateStr = note.props.date || new Date(note.updatedAt).toISOString();
      const date = new Date(dateStr).toLocaleDateString();
      el.innerHTML = `
        <div class="notes-list-item-title">${escapeHtml(note.props.title || 'Untitled')}</div>
        <div class="notes-list-item-preview">${escapeHtml(preview)}</div>
        <div class="notes-list-item-date">${date}</div>
      `;
      el.addEventListener('click', () => {
        selectNote(note.id);
        renderList(filter);
      });
      listEl.appendChild(el);
    });
  }

  function selectNote(id) {
    activeNoteId = id;
    const note = notes.find(n => n.id === id);
    if (!note) return;
    const content = note.props.content || '';
    const dateStr = note.props.date || new Date(note.updatedAt).toISOString();

    editorEl.innerHTML = `
      <div class="notes-editor-toolbar">
        <button class="notes-toolbar-btn" data-action="bold" title="Bold"><b>B</b></button>
        <button class="notes-toolbar-btn" data-action="italic" title="Italic"><i>I</i></button>
        <button class="notes-toolbar-btn" data-action="list" title="List">\u2022</button>
        <div class="notes-toolbar-separator"></div>
        <button class="notes-toolbar-btn" data-action="delete" title="Delete Note">\uD83D\uDDD1</button>
        <button class="notes-toolbar-btn notes-toolbar-ai" data-action="ai" title="AI Assist">\u2728 AI</button>
      </div>
      <textarea class="notes-textarea" placeholder="Start writing...">${content}</textarea>
      <div class="notes-statusbar">
        <span>${content.length} characters</span>
        <span>Last edited: ${new Date(dateStr).toLocaleString()}</span>
      </div>
    `;

    const textarea = editorEl.querySelector('.notes-textarea');

    // Auto-save on typing (debounced). Each save = one graphStore.updateNode.
    let saveTimer;
    textarea.addEventListener('input', () => {
      const newContent = textarea.value;
      const newTitle = newContent.split('\n')[0].substring(0, 50) || 'Untitled';
      const newDate = new Date().toISOString();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const updated = await graphStore.updateNode(id, {
            title: newTitle,
            content: newContent,
            date: newDate,
          });
          // patch local cache
          const idx = notes.findIndex(n => n.id === id);
          if (idx >= 0) notes[idx] = updated;
          renderList(currentFilter);
        } catch (err) {
          console.warn('[notes] save failed', err);
        }
      }, 500);
    });

    textarea.focus();

    // Toolbar buttons
    editorEl.querySelector('.notes-editor-toolbar').addEventListener('click', async (e) => {
      const action = e.target.closest('.notes-toolbar-btn')?.dataset.action;
      if (!action) return;

      if (action === 'bold') {
        wrapSelection(textarea, '**', '**');
      } else if (action === 'italic') {
        wrapSelection(textarea, '_', '_');
      } else if (action === 'list') {
        insertAtCursor(textarea, '\n- ');
      } else if (action === 'delete') {
        if (confirm('Delete this note?')) {
          try {
            await graphStore.deleteNode(id);
          } catch (err) {
            console.warn('[notes] delete failed', err);
            return;
          }
          notes = notes.filter(n => n.id !== id);
          activeNoteId = null;
          editorEl.innerHTML = '<div class="notes-empty">Select a note or create a new one</div>';
          renderList(currentFilter);
        }
      } else if (action === 'ai') {
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        const text = selected || textarea.value;
        if (!text.trim()) return;

        const aiBtn = editorEl.querySelector('[data-action="ai"]');
        aiBtn.textContent = '\u23F3 Thinking...';
        aiBtn.style.pointerEvents = 'none';

        const prompt = selected
          ? `Improve this text, make it clearer and more polished. Return only the improved text:\n\n${text}`
          : `Summarize and improve this note. Return a cleaner version:\n\n${text}`;

        const result = await aiService.ask(prompt);

        if (selected) {
          textarea.setRangeText(result, textarea.selectionStart, textarea.selectionEnd, 'end');
        } else {
          textarea.value = result;
        }
        const newContent = textarea.value;
        const newTitle = newContent.split('\n')[0].substring(0, 50) || 'Untitled';
        const newDate = new Date().toISOString();
        try {
          const updated = await graphStore.updateNode(id, {
            title: newTitle,
            content: newContent,
            date: newDate,
          });
          const idx = notes.findIndex(n => n.id === id);
          if (idx >= 0) notes[idx] = updated;
          renderList(currentFilter);
        } catch (err) {
          console.warn('[notes] ai save failed', err);
        }

        aiBtn.textContent = '\u2728 AI';
        aiBtn.style.pointerEvents = '';
      }
    });
  }

  function wrapSelection(textarea, before, after) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    textarea.value = text.substring(0, start) + before + text.substring(start, end) + after + text.substring(end);
    textarea.selectionStart = start + before.length;
    textarea.selectionEnd = end + before.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
  }

  function insertAtCursor(textarea, text) {
    const pos = textarea.selectionStart;
    textarea.value = textarea.value.substring(0, pos) + text + textarea.value.substring(pos);
    textarea.selectionStart = textarea.selectionEnd = pos + text.length;
    textarea.focus();
    textarea.dispatchEvent(new Event('input'));
  }

  // Init
  renderList();
  if (notes.length > 0) selectNote(notes[0].id);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
