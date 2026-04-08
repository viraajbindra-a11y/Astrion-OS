// Astrion OS — Markdown Editor with Preview
import { processManager } from '../kernel/process-manager.js';
export function registerMarkdown() {
  processManager.register('markdown', { name: 'Markdown', icon: '\uD83D\uDCDD', singleInstance: false, width: 800, height: 520,
    launch: (el) => {
      el.innerHTML=`<div style="display:flex;height:100%;font-family:var(--font);">
        <div style="flex:1;display:flex;flex-direction:column;border-right:1px solid rgba(255,255,255,0.06);">
          <div style="padding:6px 12px;font-size:11px;color:rgba(255,255,255,0.4);border-bottom:1px solid rgba(255,255,255,0.06);">EDIT</div>
          <textarea id="md-src" style="flex:1;padding:12px;background:#1a1a22;color:#c9d1d9;border:none;font-family:'JetBrains Mono',monospace;font-size:13px;resize:none;outline:none;line-height:1.7;" placeholder="# Write Markdown here..."># Hello Markdown\n\nThis is **bold** and *italic*.\n\n- List item 1\n- List item 2\n\n\`\`\`\ncode block\n\`\`\`\n\n> Blockquote\n\n[Link](https://example.com)</textarea>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;">
          <div style="padding:6px 12px;font-size:11px;color:rgba(255,255,255,0.4);border-bottom:1px solid rgba(255,255,255,0.06);">PREVIEW</div>
          <div id="md-preview" style="flex:1;padding:12px;background:#1e1e28;color:#e0e0e0;overflow-y:auto;font-size:14px;line-height:1.7;"></div>
        </div>
      </div>`;
      const src=el.querySelector('#md-src'),preview=el.querySelector('#md-preview');
      function renderMd(md){return md
        .replace(/^### (.+)$/gm,'<h3 style="font-size:16px;font-weight:600;margin:12px 0 6px;">$1</h3>')
        .replace(/^## (.+)$/gm,'<h2 style="font-size:20px;font-weight:600;margin:14px 0 8px;">$1</h2>')
        .replace(/^# (.+)$/gm,'<h1 style="font-size:26px;font-weight:700;margin:16px 0 10px;">$1</h1>')
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,'<em>$1</em>')
        .replace(/`([^`]+)`/g,'<code style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;font-family:monospace;">$1</code>')
        .replace(/^> (.+)$/gm,'<blockquote style="border-left:3px solid var(--accent);padding-left:12px;color:rgba(255,255,255,0.6);margin:8px 0;">$1</blockquote>')
        .replace(/^- (.+)$/gm,'<div style="padding-left:16px;">\u2022 $1</div>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" style="color:var(--accent);">$1</a>')
        .replace(/\n/g,'<br>');}
      function update(){preview.innerHTML=renderMd(src.value);}
      src.addEventListener('input',update);
      update();
    }
  });
}
