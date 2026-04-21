// Astrion OS — AI Writing Assistant
// Write with AI help. Rewrite, expand, shorten, fix grammar, change tone.
// Works with Astrion AI when connected. Shows templates/suggestions without AI.

import { processManager } from '../kernel/process-manager.js';
import { aiService } from '../kernel/ai-service.js';

export function registerAiWriter() {
  processManager.register('ai-writer', {
    name: 'AI Writer',
    icon: '\u270D\uFE0F',
    iconClass: 'dock-icon-ai-writer',
    singleInstance: true,
    width: 750,
    height: 520,
    launch: (contentEl) => initAiWriter(contentEl),
  });
}

const ACTIONS = [
  { id: 'rewrite', icon: '\uD83D\uDD04', name: 'Rewrite', prompt: 'Rewrite this text to be clearer and more concise. Keep the same meaning. Return ONLY the rewritten text, nothing else:\n\n' },
  { id: 'expand', icon: '\uD83D\uDCC8', name: 'Expand', prompt: 'Expand this text with more detail and examples. Make it about 2-3x longer. Return ONLY the expanded text:\n\n' },
  { id: 'shorten', icon: '\u2702\uFE0F', name: 'Shorten', prompt: 'Shorten this text to about half the length while keeping the key points. Return ONLY the shortened text:\n\n' },
  { id: 'grammar', icon: '\u2705', name: 'Fix Grammar', prompt: 'Fix all grammar, spelling, and punctuation errors in this text. Return ONLY the corrected text:\n\n' },
  { id: 'formal', icon: '\uD83D\uDC54', name: 'Make Formal', prompt: 'Rewrite this text in a formal, professional tone. Return ONLY the rewritten text:\n\n' },
  { id: 'casual', icon: '\uD83D\uDE0E', name: 'Make Casual', prompt: 'Rewrite this text in a casual, friendly tone. Return ONLY the rewritten text:\n\n' },
  { id: 'bullet', icon: '\uD83D\uDCCB', name: 'To Bullets', prompt: 'Convert this text into a clear bulleted list. Return ONLY the bullet points:\n\n' },
  { id: 'email', icon: '\uD83D\uDCE7', name: 'As Email', prompt: 'Rewrite this as a professional email with subject line, greeting, body, and sign-off. Return ONLY the email:\n\n' },
  { id: 'explain', icon: '\uD83E\uDDE0', name: 'Explain Simply', prompt: 'Explain this in simple terms that a 10-year-old could understand. Return ONLY the simplified explanation:\n\n' },
  { id: 'translate', icon: '\uD83C\uDF10', name: 'To Spanish', prompt: 'Translate this text to Spanish. Return ONLY the translation:\n\n' },
];

const TEMPLATES = [
  { name: 'Email Reply', text: 'Hi [Name],\n\nThank you for reaching out. I wanted to follow up on [topic].\n\n[Your message here]\n\nBest regards,\n[Your name]' },
  { name: 'Blog Post', text: '# [Title]\n\n## Introduction\n[Hook the reader with a compelling opening]\n\n## Main Point\n[Explain your key argument]\n\n## Supporting Evidence\n[Provide examples, data, or stories]\n\n## Conclusion\n[Summarize and call to action]' },
  { name: 'Social Post', text: '[Attention-grabbing first line]\n\n[2-3 sentences of value]\n\n[Call to action] \uD83D\uDC47\n\n#hashtag1 #hashtag2 #hashtag3' },
  { name: 'Meeting Notes', text: '## Meeting: [Title]\n**Date:** [Date]\n**Attendees:** [Names]\n\n### Discussed\n- \n- \n\n### Action Items\n- [ ] [Person]: [Task] by [Date]\n- [ ] \n\n### Next Steps\n- ' },
  { name: 'Bug Report', text: '## Bug: [Short description]\n\n**Steps to reproduce:**\n1. \n2. \n3. \n\n**Expected:** [What should happen]\n**Actual:** [What actually happens]\n\n**Environment:** [OS, browser, version]\n**Severity:** [Low/Medium/High/Critical]' },
];

function initAiWriter(container) {
  let isProcessing = false;
  let history = []; // undo stack

  container.innerHTML = `
    <style>
      .aiw { display:flex; height:100%; background:#0e0e12; color:white; font-family:var(--font); }
      .aiw-sidebar { width:200px; border-right:1px solid rgba(255,255,255,0.06); overflow-y:auto; flex-shrink:0; display:flex; flex-direction:column; }
      .aiw-section { padding:10px; border-bottom:1px solid rgba(255,255,255,0.04); }
      .aiw-label { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,0.3); margin-bottom:6px; }
      .aiw-action {
        display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:8px;
        background:none; border:none; color:rgba(255,255,255,0.7); font-size:12px;
        cursor:pointer; font-family:var(--font); width:100%; text-align:left;
        transition:all 0.15s; margin-bottom:1px;
      }
      .aiw-action:hover { background:rgba(255,255,255,0.06); color:white; }
      .aiw-action:disabled { opacity:0.4; cursor:default; }
      .aiw-action .aiw-ai-icon { font-size:16px; }
      .aiw-template {
        padding:6px 10px; border-radius:6px; background:rgba(255,255,255,0.03);
        border:1px solid rgba(255,255,255,0.06); font-size:11px;
        color:rgba(255,255,255,0.5); cursor:pointer; margin-bottom:4px;
        transition:all 0.15s;
      }
      .aiw-template:hover { background:rgba(255,255,255,0.06); color:white; }
      .aiw-main { flex:1; display:flex; flex-direction:column; }
      .aiw-toolbar {
        display:flex; align-items:center; gap:8px; padding:8px 12px;
        border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(0,0,0,0.2);
      }
      .aiw-tb-btn {
        padding:5px 12px; border-radius:6px; border:none;
        background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.7);
        font-size:11px; cursor:pointer; font-family:var(--font); transition:all 0.15s;
      }
      .aiw-tb-btn:hover { background:rgba(255,255,255,0.1); color:white; }
      .aiw-editor {
        flex:1; padding:20px; font-size:14px; line-height:1.8; color:rgba(255,255,255,0.9);
        background:transparent; border:none; resize:none; outline:none;
        font-family:var(--font); overflow-y:auto;
      }
      .aiw-editor::placeholder { color:rgba(255,255,255,0.2); }
      .aiw-status {
        padding:6px 12px; border-top:1px solid rgba(255,255,255,0.06);
        font-size:11px; color:rgba(255,255,255,0.3); display:flex;
        justify-content:space-between; background:rgba(0,0,0,0.2);
      }
      .aiw-loading {
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        background:rgba(0,0,0,0.8); padding:16px 28px; border-radius:12px;
        font-size:13px; color:rgba(255,255,255,0.7); display:none;
      }
    </style>
    <div class="aiw">
      <div class="aiw-sidebar">
        <div class="aiw-section">
          <div class="aiw-label">\u2728 AI Actions</div>
          ${ACTIONS.map(a => `<button class="aiw-action" data-action="${a.id}" title="${a.name}"><span class="aiw-ai-icon">${a.icon}</span> ${a.name}</button>`).join('')}
        </div>
        <div class="aiw-section" style="flex:1; overflow-y:auto;">
          <div class="aiw-label">Templates</div>
          ${TEMPLATES.map((t, i) => `<div class="aiw-template" data-idx="${i}">${t.name}</div>`).join('')}
        </div>
      </div>
      <div class="aiw-main" style="position:relative;">
        <div class="aiw-toolbar">
          <button class="aiw-tb-btn" id="aiw-undo">\u21A9 Undo</button>
          <button class="aiw-tb-btn" id="aiw-clear">\uD83D\uDDD1 Clear</button>
          <button class="aiw-tb-btn" id="aiw-copy">\uD83D\uDCCB Copy All</button>
          <div style="flex:1;"></div>
          <span id="aiw-wordcount" style="font-size:10px; color:rgba(255,255,255,0.3);">0 words</span>
        </div>
        <textarea class="aiw-editor" id="aiw-editor" placeholder="Start writing here...\n\nSelect text and use an AI action from the sidebar, or write freely and apply transformations to the whole document."></textarea>
        <div class="aiw-status">
          <span id="aiw-status">Ready — select text or write, then use an AI action</span>
          <span id="aiw-ai-status"></span>
        </div>
        <div class="aiw-loading" id="aiw-loading">\u2728 AI is writing...</div>
      </div>
    </div>
  `;

  const editor = container.querySelector('#aiw-editor');
  const statusEl = container.querySelector('#aiw-status');
  const aiStatusEl = container.querySelector('#aiw-ai-status');
  const loadingEl = container.querySelector('#aiw-loading');
  const wordcountEl = container.querySelector('#aiw-wordcount');

  // Draft auto-save — restore on open, debounced save on every keystroke
  const DRAFT_KEY = 'astrion-aiwriter-draft';
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      editor.value = draft;
    }
  } catch {}
  let saveTimer = null;
  const saveDraft = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, editor.value);
        // Subtle status flash so users know their work is safe
        if (statusEl) {
          const prev = statusEl.textContent;
          statusEl.textContent = 'Draft saved';
          statusEl.style.opacity = '0.5';
          setTimeout(() => {
            statusEl.style.opacity = '';
            // Only revert if we haven't been overwritten by an action result
            if (statusEl.textContent === 'Draft saved') {
              statusEl.textContent = prev.startsWith('Draft saved') ? 'Ready — select text or write, then use an AI action' : prev;
            }
          }, 1200);
        }
      } catch {}
    }, 500);
  };

  // Word count + auto-save on every input
  editor.addEventListener('input', () => {
    const words = editor.value.trim() ? editor.value.trim().split(/\s+/).length : 0;
    wordcountEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;
    saveDraft();
  });
  // Fire one initial word count for restored drafts
  if (editor.value) editor.dispatchEvent(new Event('input'));

  // Check AI status
  checkAiStatus();
  async function checkAiStatus() {
    try {
      const test = await aiService.ask('say ok', { maxTokens: 5, skipHistory: true });
      if (test) aiStatusEl.textContent = '\uD83D\uDFE2 AI Connected';
      else throw new Error();
    } catch {
      aiStatusEl.textContent = '\uD83D\uDD34 AI Offline — actions disabled';
      container.querySelectorAll('.aiw-action').forEach(b => b.disabled = true);
    }
  }

  // AI Actions
  container.querySelectorAll('.aiw-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (isProcessing) return;
      const actionId = btn.dataset.action;
      const action = ACTIONS.find(a => a.id === actionId);
      if (!action) return;

      // Get text — selected text or all
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const text = start !== end ? editor.value.substring(start, end) : editor.value;
      if (!text.trim()) { statusEl.textContent = 'Nothing to process — write or select text first'; return; }

      isProcessing = true;
      loadingEl.style.display = 'block';
      statusEl.textContent = `Running: ${action.name}...`;

      // Save to history for undo
      history.push(editor.value);
      if (history.length > 30) history.shift();

      try {
        const result = await aiService.ask(action.prompt + text, { maxTokens: 2000, skipHistory: true });
        if (result) {
          if (start !== end) {
            // Replace selection
            editor.value = editor.value.substring(0, start) + result + editor.value.substring(end);
          } else {
            // Replace all
            editor.value = result;
          }
          editor.dispatchEvent(new Event('input'));
          statusEl.textContent = `\u2705 ${action.name} complete`;
        } else {
          statusEl.textContent = '\u274C AI returned empty response';
        }
      } catch (err) {
        statusEl.textContent = `\u274C Error: ${err.message || 'AI unavailable'}`;
      }

      loadingEl.style.display = 'none';
      isProcessing = false;
    });
  });

  // Templates
  container.querySelectorAll('.aiw-template').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      const template = TEMPLATES[idx];
      if (template) {
        history.push(editor.value);
        editor.value = template.text;
        editor.dispatchEvent(new Event('input'));
        statusEl.textContent = `Template loaded: ${template.name}`;
      }
    });
  });

  // Toolbar
  container.querySelector('#aiw-undo').addEventListener('click', () => {
    if (history.length > 0) {
      editor.value = history.pop();
      editor.dispatchEvent(new Event('input'));
      statusEl.textContent = 'Undone';
    }
  });

  container.querySelector('#aiw-clear').addEventListener('click', async () => {
    if (!editor.value) return;
    // Require confirmation when clearing non-trivial content. Uses the
    // custom dialog (native confirm() is blocked in WebKitGTK).
    if (editor.value.length > 30) {
      const { showConfirm } = await import('../lib/dialog.js');
      const ok = await showConfirm('Clear all text? Your draft will be lost.', container, true);
      if (!ok) return;
    }
    history.push(editor.value);
    editor.value = '';
    editor.dispatchEvent(new Event('input'));
    statusEl.textContent = 'Cleared';
  });

  container.querySelector('#aiw-copy').addEventListener('click', async () => {
    if (editor.value) {
      try { await navigator.clipboard.writeText(editor.value); } catch {}
      statusEl.textContent = 'Copied to clipboard';
    }
  });

  // Flush pending draft save + clean up timer on window close.
  // The input-handler debounces writes by 500ms; without this flush the
  // last keystrokes in that window would be lost.
  const _obs = new MutationObserver(() => {
    if (!container.isConnected) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        try { localStorage.setItem(DRAFT_KEY, editor.value); } catch {}
      }
      _obs.disconnect();
    }
  });
  if (container.parentElement) _obs.observe(container.parentElement, { childList: true, subtree: true });
}
