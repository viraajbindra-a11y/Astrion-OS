// Astrion OS — render-md.js
//
// Lightweight markdown → HTML renderer. The Astrion AI replies in
// markdown by default (### headers, **bold**, *italic*, `code`,
// code fences, bullet lists, numbered lists, blockquotes). Rendering
// it as raw text means audit-style replies look like raw source.
// Rendering it as HTML makes replies actually scannable.
//
// Security model: every input is HTML-escaped FIRST so attacker-
// controlled text can't inject tags. We then re-introduce a fixed
// set of supported markdown patterns by replacing the escaped
// markers with our own safe HTML. No raw HTML passes through.
//
// Supported:
//   #/##/###/####/##### headings
//   **bold** *italic* `inline code`
//   ```fenced code blocks```
//   - / * unordered lists
//   1. ordered lists
//   > blockquotes
//   [text](url) links (same-origin or http(s) only)
//   horizontal rules: ---
//   Paragraph breaks via blank lines
//
// NOT supported (intentionally narrow):
//   raw HTML, tables, footnotes, definition lists, images
//   The renderer drops/escapes these. Users who want a richer view
//   can copy the raw markdown from the bubble.

import { escapeHtml } from './safe-html.js';

function renderInline(text) {
  // Operates on already-escaped text. Patterns regex-replace the
  // escaped markers with safe HTML. Order matters: code spans must
  // tokenize first so their internals aren't subject to bold/italic
  // rewrite.
  const codeSpans = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = codeSpans.push(code) - 1;
    return `CODESPAN${i}`;
  });

  // Bold (**) before italic (*) so ** doesn't get half-eaten.
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  // Links — only http(s) URLs, never javascript: or data:.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Restore code spans last with monospace styling.
  text = text.replace(/CODESPAN(\d+)/g, (_, i) => {
    return `<code class="md-code">${codeSpans[parseInt(i, 10)]}</code>`;
  });
  return text;
}

export function renderMarkdown(input) {
  if (!input || typeof input !== 'string') return '';
  // Escape everything first — this is the security contract.
  const safe = escapeHtml(input);

  const lines = safe.split('\n');
  const out = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBuf = [];
  let listType = null;     // 'ul' | 'ol' | null
  let inBlockquote = false;

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const closeBlockquote = () => {
    if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Fenced code blocks — toggle on ``` lines, accumulate content.
    if (/^```/.test(raw.trim())) {
      if (!inFence) {
        closeList(); closeBlockquote();
        inFence = true;
        fenceLang = raw.trim().slice(3);
        fenceBuf = [];
      } else {
        out.push(`<pre class="md-pre"><code class="md-code-block${fenceLang ? ' md-lang-' + fenceLang.replace(/[^a-z0-9]/gi, '') : ''}">${fenceBuf.join('\n')}</code></pre>`);
        inFence = false;
        fenceLang = '';
        fenceBuf = [];
      }
      continue;
    }
    if (inFence) { fenceBuf.push(raw); continue; }

    const line = raw;
    const trimmed = line.trim();

    if (trimmed === '') {
      closeList(); closeBlockquote();
      out.push('');
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      closeList(); closeBlockquote();
      out.push('<hr class="md-hr">');
      continue;
    }

    // Headings
    const h = /^(#{1,5})\s+(.*)$/.exec(trimmed);
    if (h) {
      closeList(); closeBlockquote();
      const level = h[1].length;
      out.push(`<h${level} class="md-h md-h${level}">${renderInline(h[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    if (/^&gt;\s?/.test(trimmed)) {
      closeList();
      if (!inBlockquote) { out.push('<blockquote class="md-bq">'); inBlockquote = true; }
      out.push(`<p>${renderInline(trimmed.replace(/^&gt;\s?/, ''))}</p>`);
      continue;
    } else if (inBlockquote) {
      closeBlockquote();
    }

    // Unordered list
    const ul = /^[\-\*]\s+(.*)$/.exec(trimmed);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul class="md-ul">'); listType = 'ul'; }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }
    // Ordered list
    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol class="md-ol">'); listType = 'ol'; }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    // Paragraph
    closeList(); closeBlockquote();
    out.push(`<p class="md-p">${renderInline(trimmed)}</p>`);
  }

  // Close any open structures
  closeList(); closeBlockquote();
  if (inFence && fenceBuf.length) {
    // Unterminated fence — treat as plain pre so we don't lose content.
    out.push(`<pre class="md-pre"><code class="md-code-block">${fenceBuf.join('\n')}</code></pre>`);
  }
  return out.join('\n');
}

// Default styles for the markdown classes. Surface this so callers
// can inject it once per app rather than copy-pasting across files.
export const MARKDOWN_STYLES = `
  .md-h { font-weight: 600; line-height: 1.3; margin: 8px 0 4px; }
  .md-h1 { font-size: 1.4em; }
  .md-h2 { font-size: 1.25em; }
  .md-h3 { font-size: 1.12em; }
  .md-h4 { font-size: 1.05em; }
  .md-h5 { font-size: 1em; opacity: 0.85; }
  .md-p { margin: 4px 0; line-height: 1.5; }
  .md-ul, .md-ol { margin: 4px 0 4px 20px; padding-left: 4px; }
  .md-ul { list-style: disc; }
  .md-ol { list-style: decimal; }
  .md-ul li, .md-ol li { margin: 2px 0; }
  .md-code {
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.92em;
  }
  .md-pre {
    background: rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.06);
    padding: 8px 10px;
    border-radius: 6px;
    margin: 6px 0;
    overflow: auto;
    max-height: 300px;
  }
  .md-code-block {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.88em;
    line-height: 1.5;
    color: rgba(255,255,255,0.9);
    background: transparent;
    padding: 0;
  }
  .md-bq {
    border-left: 3px solid rgba(255,255,255,0.2);
    padding: 4px 12px;
    margin: 6px 0;
    color: rgba(255,255,255,0.7);
    font-style: italic;
  }
  .md-hr {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.1);
    margin: 10px 0;
  }
  .md-p a, .md-h a, .md-ul a, .md-ol a {
    color: var(--accent, #58a6ff);
    text-decoration: none;
  }
  .md-p a:hover, .md-h a:hover, .md-ul a:hover, .md-ol a:hover {
    text-decoration: underline;
  }
`;
