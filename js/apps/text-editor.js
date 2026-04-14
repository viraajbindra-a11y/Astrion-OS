// NOVA OS — Text Editor App with Syntax Highlighting

import { processManager } from '../kernel/process-manager.js';
import { fileSystem } from '../kernel/file-system.js';
import { windowManager } from '../kernel/window-manager.js';

export function registerTextEditor() {
  processManager.register('text-editor', {
    name: 'Text Editor',
    icon: '\uD83D\uDCBB',
    iconClass: 'dock-icon-texteditor',
    singleInstance: false,
    width: 700,
    height: 480,
    launch: (contentEl, instanceId, options) => {
      initTextEditor(contentEl, instanceId, options);
    }
  });
}

// Syntax highlighter — lightweight tokenizer for JS/HTML/CSS/Python/JSON
function highlightCode(code, language) {
  if (!language || language === 'Plain Text') return escapeHtml(code);

  const escaped = escapeHtml(code);

  switch (language) {
    case 'JavaScript':
    case 'TypeScript':
      return highlightJS(escaped);
    case 'HTML':
      return highlightHTML(escaped);
    case 'CSS':
      return highlightCSS(escaped);
    case 'Python':
      return highlightPython(escaped);
    case 'JSON':
      return highlightJSON(escaped);
    default:
      return escaped;
  }
}

function highlightJS(code) {
  // Order matters: comments first, then strings, then keywords
  return code
    // Multi-line comments
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')
    // Single-line comments
    .replace(/(\/\/[^\n]*)/g, '<span class="hl-comment">$1</span>')
    // Template literals (backtick strings)
    .replace(/(`[^`]*`)/g, '<span class="hl-string">$1</span>')
    // Strings (double/single quotes)
    .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|&apos;[^&]*?&apos;)/g, '<span class="hl-string">$1</span>')
    .replace(/((?:^|[^\\])(?:&quot;|&#x27;|&#39;)(?:(?!(?:&quot;|&#x27;|&#39;))[\s\S])*?(?:&quot;|&#x27;|&#39;))/g, '<span class="hl-string">$1</span>')
    // Numbers
    .replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/gi, '<span class="hl-number">$1</span>')
    // Keywords
    .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|void|delete|yield|static|super|get|set|true|false|null|undefined|NaN|Infinity)\b/g,
      '<span class="hl-keyword">$1</span>')
    // Built-in types/globals
    .replace(/\b(console|Math|Date|JSON|Array|Object|String|Number|Boolean|Promise|Map|Set|RegExp|Error|Symbol|parseInt|parseFloat|setTimeout|setInterval|fetch|document|window|require|module|exports)\b/g,
      '<span class="hl-builtin">$1</span>')
    // Function calls
    .replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, '<span class="hl-function">$1</span>')
    // Arrow functions
    .replace(/(=&gt;)/g, '<span class="hl-keyword">$1</span>');
}

function highlightHTML(code) {
  return code
    // Comments
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="hl-comment">$1</span>')
    // Tags
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="hl-tag">$2</span>')
    .replace(/(\/?)(&gt;)/g, '$1<span class="hl-punctuation">$2</span>')
    // Attributes
    .replace(/\s([\w-]+)(?==)/g, ' <span class="hl-attribute">$1</span>')
    // Attribute values
    .replace(/(=)(&quot;[^&]*?&quot;)/g, '$1<span class="hl-attr-value">$2</span>')
    // Strings
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="hl-string">$1</span>');
}

function highlightCSS(code) {
  return code
    // Comments
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')
    // Selectors (before { )
    .replace(/^([^{}\n]+?)(?=\s*\{)/gm, '<span class="hl-selector">$1</span>')
    // Properties
    .replace(/([\w-]+)\s*:/g, '<span class="hl-css-property">$1</span>:')
    // Values (strings)
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="hl-string">$1</span>')
    // Numbers with units
    .replace(/\b(\d+\.?\d*)(px|em|rem|%|vh|vw|s|ms|deg|fr|ch|ex|vmin|vmax)?\b/g,
      '<span class="hl-number">$1$2</span>')
    // Colors
    .replace(/(#[0-9a-fA-F]{3,8})\b/g, '<span class="hl-number">$1</span>')
    // Important
    .replace(/(!important)/g, '<span class="hl-keyword">$1</span>')
    // At-rules
    .replace(/(@[\w-]+)/g, '<span class="hl-keyword">$1</span>');
}

function highlightPython(code) {
  return code
    // Comments
    .replace(/(#[^\n]*)/g, '<span class="hl-comment">$1</span>')
    // Triple-quoted strings
    .replace(/(&#39;&#39;&#39;[\s\S]*?&#39;&#39;&#39;|&quot;&quot;&quot;[\s\S]*?&quot;&quot;&quot;)/g,
      '<span class="hl-string">$1</span>')
    // Strings
    .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="hl-string">$1</span>')
    // Numbers
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>')
    // Keywords
    .replace(/\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|raise|with|yield|lambda|and|or|not|in|is|pass|break|continue|True|False|None|self|global|nonlocal|async|await|print)\b/g,
      '<span class="hl-keyword">$1</span>')
    // Builtins
    .replace(/\b(int|str|float|list|dict|set|tuple|bool|len|range|enumerate|zip|map|filter|type|super|isinstance|print|input|open|sorted|reversed|any|all|min|max|sum|abs|round)\b/g,
      '<span class="hl-builtin">$1</span>')
    // Decorators
    .replace(/(@[\w.]+)/g, '<span class="hl-decorator">$1</span>')
    // Function calls
    .replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="hl-function">$1</span>');
}

function highlightJSON(code) {
  return code
    // Property keys
    .replace(/(&quot;[^&]*?&quot;)\s*:/g, '<span class="hl-property">$1</span>:')
    // String values
    .replace(/(:\s*)(&quot;[^&]*?&quot;)/g, '$1<span class="hl-string">$2</span>')
    // Numbers
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>')
    // Booleans and null
    .replace(/\b(true|false|null)\b/g, '<span class="hl-keyword">$1</span>');
}

async function initTextEditor(container, instanceId, options = {}) {
  let filePath = options.filePath || null;
  let content = '';
  let modified = false;

  if (filePath) {
    const file = await fileSystem.readFile(filePath);
    if (file) content = file.content || '';
  }

  const fileName = filePath ? fileSystem.getFileName(filePath) : 'Untitled';
  const language = getLanguage(fileName);
  const shouldHighlight = language !== 'Plain Text';

  container.innerHTML = `
    <div class="texteditor-app">
      <div class="texteditor-toolbar">
        <button class="texteditor-toolbar-btn" data-action="new" title="New File">New</button>
        <button class="texteditor-toolbar-btn" data-action="save" title="Save (Cmd+S)">Save</button>
        <button class="texteditor-toolbar-btn" data-action="save-as" title="Save As">Save As</button>
        <div class="texteditor-toolbar-separator"></div>
        <button class="texteditor-toolbar-btn" data-action="undo" title="Undo">Undo</button>
        <button class="texteditor-toolbar-btn" data-action="redo" title="Redo">Redo</button>
        <div class="texteditor-toolbar-separator"></div>
        <button class="texteditor-toolbar-btn" data-action="find" title="Find">Find</button>
        <button class="texteditor-toolbar-btn" data-action="replace" title="Replace">Replace</button>
        <span class="texteditor-filename" id="editor-filename-${instanceId}">${fileName}${modified ? ' \u2022' : ''}</span>
      </div>
      <div class="texteditor-body">
        <div class="texteditor-line-numbers" id="editor-lines-${instanceId}">
          <div class="texteditor-line-number">1</div>
        </div>
        <div class="texteditor-editor-wrap">
          <pre class="texteditor-highlight" id="editor-highlight-${instanceId}" aria-hidden="true">${shouldHighlight ? highlightCode(content, language) : escapeHtml(content)}</pre>
          <textarea class="texteditor-textarea ${shouldHighlight ? 'highlighting' : ''}" id="editor-textarea-${instanceId}" placeholder="Start typing..." spellcheck="false" aria-label="Code editor">${escapeHtml(content)}</textarea>
        </div>
      </div>
      <div class="texteditor-statusbar">
        <div class="texteditor-statusbar-left">
          <span id="editor-cursor-${instanceId}">Ln 1, Col 1</span>
          <span id="editor-words-${instanceId}">${content.trim() ? content.trim().split(/\s+/).length : 0} words</span>
          <span id="editor-chars-${instanceId}">${content.length} chars</span>
        </div>
        <div class="texteditor-statusbar-right">
          <span id="editor-lang-${instanceId}">${language}</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  `;

  const textarea = container.querySelector(`#editor-textarea-${instanceId}`);
  const highlightEl = container.querySelector(`#editor-highlight-${instanceId}`);
  const lineNumbers = container.querySelector(`#editor-lines-${instanceId}`);
  const cursorInfo = container.querySelector(`#editor-cursor-${instanceId}`);
  const wordCount = container.querySelector(`#editor-words-${instanceId}`);
  const charCount = container.querySelector(`#editor-chars-${instanceId}`);
  const fileNameEl = container.querySelector(`#editor-filename-${instanceId}`);
  const langEl = container.querySelector(`#editor-lang-${instanceId}`);

  let currentLanguage = language;

  updateLineNumbers();

  // Text input with highlight sync
  textarea.addEventListener('input', () => {
    modified = true;
    fileNameEl.textContent = (filePath ? fileSystem.getFileName(filePath) : 'Untitled') + ' \u2022';
    updateLineNumbers();
    updateHighlight();
    const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
    wordCount.textContent = `${words} words`;
    charCount.textContent = `${textarea.value.length} chars`;
  });

  // Cursor position
  textarea.addEventListener('click', updateCursor);
  textarea.addEventListener('keyup', updateCursor);

  // Scroll sync — keep highlight and line numbers in sync
  textarea.addEventListener('scroll', () => {
    lineNumbers.scrollTop = textarea.scrollTop;
    highlightEl.scrollTop = textarea.scrollTop;
    highlightEl.scrollLeft = textarea.scrollLeft;
  });

  // Tab key + auto-indent + bracket matching
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        // Outdent
        const start = textarea.selectionStart;
        const lineStart = textarea.value.lastIndexOf('\n', start - 1) + 1;
        const line = textarea.value.substring(lineStart, start);
        const match = line.match(/^( {1,4}|\t)/);
        if (match) {
          textarea.value = textarea.value.substring(0, lineStart) + textarea.value.substring(lineStart + match[0].length);
          textarea.selectionStart = textarea.selectionEnd = start - match[0].length;
          textarea.dispatchEvent(new Event('input'));
        }
      } else {
        const start = textarea.selectionStart;
        textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(textarea.selectionEnd);
        textarea.selectionStart = textarea.selectionEnd = start + 4;
        textarea.dispatchEvent(new Event('input'));
      }
    }

    // Auto-close brackets
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
    if (pairs[e.key]) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.substring(start, end);
      if (selected.length > 0) {
        // Wrap selection
        e.preventDefault();
        textarea.value = textarea.value.substring(0, start) + e.key + selected + pairs[e.key] + textarea.value.substring(end);
        textarea.selectionStart = start + 1;
        textarea.selectionEnd = end + 1;
        textarea.dispatchEvent(new Event('input'));
      } else if (['"', "'", '`'].includes(e.key)) {
        // Only auto-close if next char is not alphanumeric
        const nextChar = textarea.value[start] || '';
        if (!/\w/.test(nextChar)) {
          e.preventDefault();
          textarea.value = textarea.value.substring(0, start) + e.key + pairs[e.key] + textarea.value.substring(start);
          textarea.selectionStart = textarea.selectionEnd = start + 1;
          textarea.dispatchEvent(new Event('input'));
        }
      } else {
        e.preventDefault();
        textarea.value = textarea.value.substring(0, start) + e.key + pairs[e.key] + textarea.value.substring(start);
        textarea.selectionStart = textarea.selectionEnd = start + 1;
        textarea.dispatchEvent(new Event('input'));
      }
    }

    // Auto-indent on Enter
    if (e.key === 'Enter') {
      const start = textarea.selectionStart;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(textarea.selectionEnd);
      const currentLine = before.split('\n').pop();
      const indent = currentLine.match(/^\s*/)[0];
      const lastChar = before.trimEnd().slice(-1);
      const nextChar = after.trimStart()[0] || '';

      // Extra indent after { [ (
      let newIndent = indent;
      if (['{', '[', '('].includes(lastChar)) {
        newIndent = indent + '    ';
        // If matching close bracket is next, split across lines
        const closers = { '{': '}', '[': ']', '(': ')' };
        if (nextChar === closers[lastChar]) {
          e.preventDefault();
          const insertion = '\n' + newIndent + '\n' + indent;
          textarea.value = before + insertion + after;
          textarea.selectionStart = textarea.selectionEnd = start + 1 + newIndent.length;
          textarea.dispatchEvent(new Event('input'));
          return;
        }
      }

      e.preventDefault();
      textarea.value = before + '\n' + newIndent + after;
      textarea.selectionStart = textarea.selectionEnd = start + 1 + newIndent.length;
      textarea.dispatchEvent(new Event('input'));
    }

    // Cmd+S / Ctrl+S to save
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }

    // Cmd+D to duplicate line
    if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const val = textarea.value;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = val.indexOf('\n', start);
      const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);
      textarea.value = val.substring(0, (lineEnd === -1 ? val.length : lineEnd)) + '\n' + line + val.substring(lineEnd === -1 ? val.length : lineEnd);
      textarea.selectionStart = textarea.selectionEnd = start + line.length + 1;
      textarea.dispatchEvent(new Event('input'));
    }

    // Cmd+/ to toggle comment
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const val = textarea.value;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = val.indexOf('\n', start);
      const line = val.substring(lineStart, lineEnd === -1 ? val.length : lineEnd);

      const commentPrefix = currentLanguage === 'Python' ? '# ' : '// ';
      const isCommented = line.trimStart().startsWith(commentPrefix.trim());

      let newLine;
      if (isCommented) {
        newLine = line.replace(new RegExp(`^(\\s*)${commentPrefix.replace('/', '\\/')}`), '$1');
      } else {
        const indentMatch = line.match(/^(\s*)/);
        newLine = (indentMatch ? indentMatch[0] : '') + commentPrefix + line.trimStart();
      }

      textarea.value = val.substring(0, lineStart) + newLine + val.substring(lineEnd === -1 ? val.length : lineEnd);
      textarea.selectionStart = textarea.selectionEnd = lineStart + newLine.length;
      textarea.dispatchEvent(new Event('input'));
    }
  });

  // Toolbar
  container.querySelector('.texteditor-toolbar').addEventListener('click', (e) => {
    const action = e.target.closest('.texteditor-toolbar-btn')?.dataset.action;
    if (!action) return;

    switch (action) {
      case 'new':
        processManager.launch('text-editor', { title: 'Untitled' });
        break;
      case 'save':
        saveFile();
        break;
      case 'save-as':
        saveFileAs();
        break;
      case 'undo':
        document.execCommand('undo');
        break;
      case 'redo':
        document.execCommand('redo');
        break;
      case 'find':
        toggleFindBar();
        break;
      case 'replace':
        toggleFindBar(true);
        break;
      case '_old_replace':
        // Legacy replace — kept for reference
        const findStr = prompt('Find:');
        if (findStr) {
          const replaceStr = prompt('Replace with:');
          if (replaceStr !== null) {
            const idx = textarea.value.indexOf(findStr, textarea.selectionStart);
            if (idx >= 0) {
              textarea.value = textarea.value.substring(0, idx) + replaceStr + textarea.value.substring(idx + findStr.length);
              textarea.selectionStart = textarea.selectionEnd = idx + replaceStr.length;
              textarea.dispatchEvent(new Event('input'));
            }
          }
        }
        break;
    }
  });

  function updateLineNumbers() {
    const lines = textarea.value.split('\n').length;
    lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) =>
      `<div class="texteditor-line-number">${i + 1}</div>`
    ).join('');
  }

  function updateHighlight() {
    if (currentLanguage !== 'Plain Text') {
      highlightEl.innerHTML = highlightCode(textarea.value, currentLanguage) + '\n';
    }
  }

  function updateCursor() {
    const text = textarea.value.substring(0, textarea.selectionStart);
    const lines = text.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    cursorInfo.textContent = `Ln ${line}, Col ${col}`;
  }

  async function saveFile() {
    if (!filePath) {
      saveFileAs();
      return;
    }
    await fileSystem.writeFile(filePath, textarea.value);
    modified = false;
    fileNameEl.textContent = fileSystem.getFileName(filePath);
  }

  async function saveFileAs() {
    const name = prompt('Save as:', filePath ? fileSystem.getFileName(filePath) : 'untitled.txt');
    if (!name) return;
    const dir = filePath ? fileSystem.getParentPath(filePath) : '/Documents';
    filePath = `${dir}/${name}`;
    await fileSystem.writeFile(filePath, textarea.value);
    modified = false;
    fileNameEl.textContent = name;
    windowManager.setTitle(instanceId, name);

    // Update language detection
    currentLanguage = getLanguage(name);
    langEl.textContent = currentLanguage;
    if (currentLanguage !== 'Plain Text') {
      textarea.classList.add('highlighting');
      updateHighlight();
    } else {
      textarea.classList.remove('highlighting');
    }
  }

  // ─── Inline Find Bar (Ctrl+F) ───
  let findBarEl = null;
  let findMatchIdx = -1;

  function toggleFindBar() {
    if (findBarEl) {
      findBarEl.remove();
      findBarEl = null;
      textarea.focus();
      return;
    }
    findBarEl = document.createElement('div');
    findBarEl.style.cssText = `
      display:flex; gap:6px; align-items:center; padding:6px 10px;
      background:rgba(30,30,36,0.95); border-bottom:1px solid rgba(255,255,255,0.08);
      font-size:12px;
    `;
    findBarEl.innerHTML = `
      <input type="text" placeholder="Find..." style="
        flex:1; padding:5px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1);
        background:rgba(255,255,255,0.06); color:white; font-size:12px; font-family:var(--font); outline:none; min-width:120px;
      " class="te-find-input">
      <span class="te-find-count" style="color:rgba(255,255,255,0.4); font-size:10px; min-width:40px;">0/0</span>
      <button class="te-find-prev" style="background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:14px;padding:2px 6px;" title="Previous">\u25B2</button>
      <button class="te-find-next" style="background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:14px;padding:2px 6px;" title="Next">\u25BC</button>
      <button class="te-find-close" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:14px;padding:2px 6px;" title="Close">\u2715</button>
    `;

    // Insert at top of the editor container
    container.querySelector('.texteditor-editor').parentElement.insertBefore(
      findBarEl, container.querySelector('.texteditor-editor')
    );

    const findInput = findBarEl.querySelector('.te-find-input');
    const countEl = findBarEl.querySelector('.te-find-count');
    findInput.focus();

    const doFind = (dir = 1) => {
      const q = findInput.value;
      if (!q) { countEl.textContent = '0/0'; return; }

      const text = textarea.value;
      const matches = [];
      let pos = 0;
      while ((pos = text.indexOf(q, pos)) !== -1) { matches.push(pos); pos += q.length; }
      if (matches.length === 0) { countEl.textContent = '0/0'; return; }

      const cursor = textarea.selectionEnd;
      if (dir === 1) {
        findMatchIdx = matches.findIndex(m => m >= cursor);
        if (findMatchIdx === -1) findMatchIdx = 0;
      } else {
        findMatchIdx = 0;
        for (let i = matches.length - 1; i >= 0; i--) {
          if (matches[i] < textarea.selectionStart) { findMatchIdx = i; break; }
        }
      }

      textarea.setSelectionRange(matches[findMatchIdx], matches[findMatchIdx] + q.length);
      textarea.focus();
      countEl.textContent = `${findMatchIdx + 1}/${matches.length}`;
    };

    findInput.addEventListener('input', () => doFind(1));
    findInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); doFind(ev.shiftKey ? -1 : 1); }
      if (ev.key === 'Escape') { ev.preventDefault(); toggleFindBar(); }
    });
    findBarEl.querySelector('.te-find-next').addEventListener('click', () => doFind(1));
    findBarEl.querySelector('.te-find-prev').addEventListener('click', () => doFind(-1));
    findBarEl.querySelector('.te-find-close').addEventListener('click', () => toggleFindBar());
  }

  // Ctrl+F opens find bar
  container.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      e.stopPropagation();
      toggleFindBar();
    }
  });

  textarea.focus();
}

function getLanguage(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const langs = {
    js: 'JavaScript', ts: 'TypeScript', py: 'Python', html: 'HTML',
    css: 'CSS', json: 'JSON', md: 'Markdown', txt: 'Plain Text',
    swift: 'Swift', java: 'Java', c: 'C', cpp: 'C++', rs: 'Rust',
    sh: 'Shell', bash: 'Shell', yml: 'YAML', yaml: 'YAML', xml: 'HTML',
    jsx: 'JavaScript', tsx: 'TypeScript', vue: 'HTML', svelte: 'HTML',
  };
  return langs[ext] || 'Plain Text';
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
