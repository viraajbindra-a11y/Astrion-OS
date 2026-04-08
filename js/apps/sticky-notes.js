// Astrion OS — Sticky Notes
// Floating Post-it notes. Each note persists in localStorage.

import { processManager } from '../kernel/process-manager.js';

const NOTES_KEY = 'nova-sticky-notes';

export function registerStickyNotes() {
  processManager.register('sticky-notes', {
    name: 'Sticky Notes',
    icon: '\uD83D\uDDC2\uFE0F',
    singleInstance: true,
    width: 700,
    height: 500,
    launch: (contentEl) => initStickyNotes(contentEl),
  });
}

function getNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; }
  catch { return []; }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function initStickyNotes(container) {
  let notes = getNotes();
  if (notes.length === 0) {
    notes.push({ id: Date.now(), text: 'Welcome to Sticky Notes!\nClick + to add more.', color: '#ffd60a', x: 20, y: 20 });
    saveNotes(notes);
  }

  function render() {
    const colors = ['#ffd60a', '#ff6b6b', '#5ac8fa', '#34c759', '#ff9500', '#bf5af2'];

    container.innerHTML = `
      <div style="position:relative; height:100%; background:#2a2a34; overflow:auto;">
        <div style="position:absolute; top:10px; right:10px; z-index:10;">
          <button id="sn-add" style="width:36px; height:36px; border-radius:50%; border:none; background:var(--accent); color:white; font-size:20px; cursor:pointer; font-weight:300;">+</button>
        </div>
        <div id="sn-board" style="position:relative; min-height:100%; padding:10px;">
          ${notes.map((n, i) => `
            <div class="sn-note" data-idx="${i}" style="
              position:absolute; left:${n.x}px; top:${n.y}px;
              width:200px; min-height:160px;
              background:${n.color}; color:#1a1a1a;
              border-radius:4px; padding:0;
              box-shadow:2px 2px 10px rgba(0,0,0,0.3);
              display:flex; flex-direction:column;
              font-family:var(--font);
              cursor:grab;
            ">
              <div class="sn-header" style="display:flex; justify-content:flex-end; padding:4px 6px; opacity:0.5;">
                <button class="sn-delete" data-idx="${i}" style="background:none; border:none; color:#1a1a1a; cursor:pointer; font-size:14px; opacity:0.6;">\u00D7</button>
              </div>
              <textarea class="sn-text" data-idx="${i}" style="
                flex:1; border:none; background:transparent; color:#1a1a1a;
                font-size:13px; font-family:'Inter',sans-serif; padding:0 12px 12px;
                resize:none; outline:none; line-height:1.5;
              ">${esc(n.text)}</textarea>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Add note
    container.querySelector('#sn-add').addEventListener('click', () => {
      const color = colors[notes.length % colors.length];
      notes.push({
        id: Date.now(),
        text: '',
        color,
        x: 30 + (notes.length % 4) * 220,
        y: 30 + Math.floor(notes.length / 4) * 180,
      });
      saveNotes(notes);
      render();
    });

    // Delete notes
    container.querySelectorAll('.sn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        notes.splice(parseInt(btn.dataset.idx), 1);
        saveNotes(notes);
        render();
      });
    });

    // Edit text
    container.querySelectorAll('.sn-text').forEach(ta => {
      ta.addEventListener('input', () => {
        notes[parseInt(ta.dataset.idx)].text = ta.value;
        saveNotes(notes);
      });
    });

    // Drag notes
    container.querySelectorAll('.sn-note').forEach(el => {
      let dragging = false, ox = 0, oy = 0;
      const header = el.querySelector('.sn-header');
      header.addEventListener('pointerdown', (e) => {
        dragging = true;
        ox = e.clientX - el.offsetLeft;
        oy = e.clientY - el.offsetTop;
        el.style.cursor = 'grabbing';
        el.style.zIndex = '100';
        header.setPointerCapture(e.pointerId);
      });
      header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        el.style.left = (e.clientX - ox) + 'px';
        el.style.top = (e.clientY - oy) + 'px';
      });
      header.addEventListener('pointerup', () => {
        if (dragging) {
          dragging = false;
          el.style.cursor = 'grab';
          el.style.zIndex = '';
          const idx = parseInt(el.dataset.idx);
          notes[idx].x = parseInt(el.style.left);
          notes[idx].y = parseInt(el.style.top);
          saveNotes(notes);
        }
      });
    });
  }

  render();
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
