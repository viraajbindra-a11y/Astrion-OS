// Astrion OS — Animate Studio
// Character animation app. Upload an image, pick a motion, watch it animate.
// Closest thing to Viggle AI that runs locally in a browser.

import { processManager } from '../kernel/process-manager.js';

export function registerAnimate() {
  processManager.register('animate', {
    name: 'Animate',
    icon: '\uD83C\uDFAC',
    iconClass: 'dock-icon-animate',
    singleInstance: true,
    width: 850,
    height: 580,
    launch: (contentEl) => initAnimate(contentEl),
  });
}

// ── Pre-built motion presets (keyframe sequences) ──
const MOTIONS = {
  dance: {
    name: 'Dance', icon: '\uD83D\uDD7A', duration: 2000,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.1,  x: -15, y: -20, r: -8, sx: 1.05, sy: 0.95 },
      { t: 0.2,  x: 15, y: -10, r: 8, sx: 0.95, sy: 1.05 },
      { t: 0.3,  x: -10, y: -25, r: -12, sx: 1.08, sy: 0.92 },
      { t: 0.4,  x: 10, y: -5, r: 10, sx: 0.92, sy: 1.08 },
      { t: 0.5,  x: -20, y: -15, r: -6, sx: 1.03, sy: 0.97 },
      { t: 0.6,  x: 20, y: -20, r: 6, sx: 0.97, sy: 1.03 },
      { t: 0.7,  x: -8, y: -30, r: -15, sx: 1.1, sy: 0.9 },
      { t: 0.8,  x: 12, y: -8, r: 12, sx: 0.9, sy: 1.1 },
      { t: 0.9,  x: -5, y: -12, r: -4, sx: 1.02, sy: 0.98 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  bounce: {
    name: 'Bounce', icon: '\u26BD', duration: 1200,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.15, x: 0, y: 10, r: 0, sx: 1.1, sy: 0.85 },
      { t: 0.3,  x: 0, y: -80, r: 0, sx: 0.9, sy: 1.15 },
      { t: 0.5,  x: 0, y: -120, r: 5, sx: 1, sy: 1 },
      { t: 0.7,  x: 0, y: -40, r: -3, sx: 1, sy: 1 },
      { t: 0.85, x: 0, y: 10, r: 0, sx: 1.12, sy: 0.82 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  wave: {
    name: 'Wave', icon: '\uD83D\uDC4B', duration: 1800,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.15, x: -5, y: -5, r: -15, sx: 1, sy: 1 },
      { t: 0.3,  x: 5, y: -5, r: 15, sx: 1, sy: 1 },
      { t: 0.45, x: -5, y: -5, r: -15, sx: 1, sy: 1 },
      { t: 0.6,  x: 5, y: -5, r: 15, sx: 1, sy: 1 },
      { t: 0.75, x: -3, y: -3, r: -8, sx: 1, sy: 1 },
      { t: 0.9,  x: 2, y: -2, r: 5, sx: 1, sy: 1 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  spin: {
    name: 'Spin', icon: '\uD83C\uDF00', duration: 1000,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.25, x: 0, y: -10, r: 90, sx: 0.8, sy: 1 },
      { t: 0.5,  x: 0, y: -15, r: 180, sx: 0.6, sy: 1 },
      { t: 0.75, x: 0, y: -10, r: 270, sx: 0.8, sy: 1 },
      { t: 1.0,  x: 0, y: 0, r: 360, sx: 1, sy: 1 },
    ],
  },
  walk: {
    name: 'Walk', icon: '\uD83D\uDEB6', duration: 2000,
    keyframes: [
      { t: 0,    x: -100, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.1,  x: -80, y: -8, r: -3, sx: 1, sy: 1.02 },
      { t: 0.2,  x: -60, y: 0, r: 2, sx: 1, sy: 0.98 },
      { t: 0.3,  x: -40, y: -8, r: -3, sx: 1, sy: 1.02 },
      { t: 0.4,  x: -20, y: 0, r: 2, sx: 1, sy: 0.98 },
      { t: 0.5,  x: 0, y: -8, r: -3, sx: 1, sy: 1.02 },
      { t: 0.6,  x: 20, y: 0, r: 2, sx: 1, sy: 0.98 },
      { t: 0.7,  x: 40, y: -8, r: -3, sx: 1, sy: 1.02 },
      { t: 0.8,  x: 60, y: 0, r: 2, sx: 1, sy: 0.98 },
      { t: 0.9,  x: 80, y: -8, r: -3, sx: 1, sy: 1.02 },
      { t: 1.0,  x: 100, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  shake: {
    name: 'Shake', icon: '\uD83D\uDE31', duration: 800,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.1,  x: -12, y: 0, r: -3, sx: 1, sy: 1 },
      { t: 0.2,  x: 12, y: 0, r: 3, sx: 1, sy: 1 },
      { t: 0.3,  x: -10, y: 0, r: -2, sx: 1, sy: 1 },
      { t: 0.4,  x: 10, y: 0, r: 2, sx: 1, sy: 1 },
      { t: 0.5,  x: -8, y: 0, r: -2, sx: 1, sy: 1 },
      { t: 0.6,  x: 8, y: 0, r: 2, sx: 1, sy: 1 },
      { t: 0.7,  x: -4, y: 0, r: -1, sx: 1, sy: 1 },
      { t: 0.8,  x: 4, y: 0, r: 1, sx: 1, sy: 1 },
      { t: 0.9,  x: -2, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  float: {
    name: 'Float', icon: '\uD83E\uDDD8', duration: 3000,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.25, x: 5, y: -20, r: 3, sx: 1.02, sy: 1.02 },
      { t: 0.5,  x: -3, y: -35, r: -2, sx: 1.03, sy: 1.03 },
      { t: 0.75, x: 5, y: -20, r: 3, sx: 1.02, sy: 1.02 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  flip: {
    name: 'Backflip', icon: '\uD83E\uDD38', duration: 1200,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.15, x: 0, y: 10, r: 0, sx: 1.05, sy: 0.9 },
      { t: 0.3,  x: 0, y: -60, r: -90, sx: 0.9, sy: 1.1 },
      { t: 0.5,  x: 0, y: -100, r: -180, sx: 0.85, sy: 1 },
      { t: 0.7,  x: 0, y: -60, r: -270, sx: 0.9, sy: 1.1 },
      { t: 0.85, x: 0, y: 10, r: -350, sx: 1.1, sy: 0.85 },
      { t: 1.0,  x: 0, y: 0, r: -360, sx: 1, sy: 1 },
    ],
  },
  shrink: {
    name: 'Shrink & Grow', icon: '\uD83D\uDD2E', duration: 1500,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.3,  x: 0, y: 30, r: 10, sx: 0.3, sy: 0.3 },
      { t: 0.5,  x: 0, y: 40, r: -5, sx: 0.1, sy: 0.1 },
      { t: 0.7,  x: 0, y: 20, r: 5, sx: 0.5, sy: 0.5 },
      { t: 0.85, x: 0, y: -10, r: -3, sx: 1.15, sy: 1.15 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
  jelly: {
    name: 'Jelly', icon: '\uD83C\uDF6C', duration: 1200,
    keyframes: [
      { t: 0,    x: 0, y: 0, r: 0, sx: 1, sy: 1 },
      { t: 0.1,  x: 0, y: 5, r: 0, sx: 1.25, sy: 0.75 },
      { t: 0.25, x: 0, y: -10, r: 0, sx: 0.75, sy: 1.25 },
      { t: 0.4,  x: 0, y: 3, r: 0, sx: 1.15, sy: 0.85 },
      { t: 0.55, x: 0, y: -5, r: 0, sx: 0.85, sy: 1.15 },
      { t: 0.7,  x: 0, y: 2, r: 0, sx: 1.08, sy: 0.92 },
      { t: 0.85, x: 0, y: -2, r: 0, sx: 0.95, sy: 1.05 },
      { t: 1.0,  x: 0, y: 0, r: 0, sx: 1, sy: 1 },
    ],
  },
};

// ── Built-in characters (simple SVG stick figures) ──
const CHARACTERS = [
  { name: 'Stick Person', svg: `<svg viewBox="0 0 100 160" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><circle cx="50" cy="20" r="15"/><line x1="50" y1="35" x2="50" y2="90"/><line x1="50" y1="55" x2="25" y2="75"/><line x1="50" y1="55" x2="75" y2="75"/><line x1="50" y1="90" x2="30" y2="130"/><line x1="50" y1="90" x2="70" y2="130"/></svg>` },
  { name: 'Robot', svg: `<svg viewBox="0 0 100 140" fill="none" stroke="white" stroke-width="2.5"><rect x="25" y="10" width="50" height="40" rx="8"/><circle cx="38" cy="30" r="5" fill="#007aff"/><circle cx="62" cy="30" r="5" fill="#007aff"/><line x1="50" y1="0" x2="50" y2="10"/><circle cx="50" cy="0" r="4" fill="#007aff"/><rect x="20" y="55" width="60" height="50" rx="6"/><rect x="10" y="60" width="10" height="30" rx="4"/><rect x="80" y="60" width="10" height="30" rx="4"/><rect x="30" y="110" width="15" height="25" rx="4"/><rect x="55" y="110" width="15" height="25" rx="4"/></svg>` },
  { name: 'Cat', svg: `<svg viewBox="0 0 100 120" fill="none" stroke="white" stroke-width="2.5"><ellipse cx="50" cy="45" rx="30" ry="25"/><polygon points="25,25 20,5 35,20"/><polygon points="75,25 80,5 65,20"/><circle cx="40" cy="40" r="3" fill="#34c759"/><circle cx="60" cy="40" r="3" fill="#34c759"/><ellipse cx="50" cy="50" rx="4" ry="2" fill="#ff6b6b"/><path d="M30 55 Q50 70 70 55"/><ellipse cx="50" cy="85" rx="25" ry="20"/><path d="M75 85 Q90 80 95 95" stroke-width="3"/></svg>` },
  { name: 'Star', svg: `<svg viewBox="0 0 100 100" fill="#ffd60a" stroke="#ffd60a"><polygon points="50,5 61,35 95,35 68,57 79,90 50,70 21,90 32,57 5,35 39,35"/></svg>` },
  { name: 'Ghost', svg: `<svg viewBox="0 0 100 130" fill="white" stroke="none"><path d="M20 70 Q20 20 50 20 Q80 20 80 70 L80 120 L70 105 L60 120 L50 105 L40 120 L30 105 L20 120 Z"/><circle cx="38" cy="55" r="6" fill="#1a1a22"/><circle cx="62" cy="55" r="6" fill="#1a1a22"/><ellipse cx="50" cy="75" rx="8" ry="5" fill="#1a1a22"/></svg>` },
];

function initAnimate(container) {
  let currentImg = null; // HTMLImageElement or null
  let currentMotion = 'dance';
  let isPlaying = false;
  let animFrame = null;
  let startTime = 0;
  let loop = true;
  let speed = 1;
  let bgColor = '#1a1a22';

  container.innerHTML = `
    <style>
      .anim-app { display:flex; height:100%; background:#0e0e12; color:white; font-family:var(--font); }
      .anim-sidebar { width:220px; border-right:1px solid rgba(255,255,255,0.06); overflow-y:auto; flex-shrink:0; display:flex; flex-direction:column; }
      .anim-sidebar-section { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); }
      .anim-sidebar-label { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,0.3); margin-bottom:8px; }
      .anim-motion-btn {
        display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:8px;
        background:transparent; border:1px solid transparent; color:rgba(255,255,255,0.7);
        font-size:12px; cursor:pointer; font-family:var(--font); width:100%; text-align:left;
        transition:all 0.15s; margin-bottom:2px;
      }
      .anim-motion-btn:hover { background:rgba(255,255,255,0.06); }
      .anim-motion-btn.active { background:rgba(0,122,255,0.15); border-color:rgba(0,122,255,0.3); color:white; }
      .anim-motion-icon { font-size:18px; }
      .anim-char-btn {
        width:50px; height:50px; border-radius:10px; border:2px solid transparent;
        background:rgba(255,255,255,0.04); cursor:pointer; padding:4px;
        transition:all 0.15s; display:flex; align-items:center; justify-content:center;
      }
      .anim-char-btn:hover { background:rgba(255,255,255,0.08); }
      .anim-char-btn.active { border-color:var(--accent); background:rgba(0,122,255,0.1); }
      .anim-char-btn svg { width:100%; height:100%; }
      .anim-main { flex:1; display:flex; flex-direction:column; }
      .anim-canvas-wrap {
        flex:1; display:flex; align-items:center; justify-content:center;
        background:#1a1a22; position:relative; overflow:hidden;
      }
      .anim-canvas { border-radius:0; }
      .anim-controls {
        padding:10px 16px; border-top:1px solid rgba(255,255,255,0.06);
        display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.2);
      }
      .anim-ctrl-btn {
        background:rgba(255,255,255,0.08); border:none; color:white;
        padding:8px 16px; border-radius:8px; font-size:13px; cursor:pointer;
        font-family:var(--font); font-weight:500; transition:all 0.15s;
      }
      .anim-ctrl-btn:hover { background:rgba(255,255,255,0.12); }
      .anim-ctrl-btn.primary { background:var(--accent); }
      .anim-ctrl-btn.primary:hover { filter:brightness(1.15); }
      .anim-speed { display:flex; align-items:center; gap:6px; font-size:11px; color:rgba(255,255,255,0.5); }
      .anim-speed input { width:80px; accent-color:var(--accent); }
      .anim-upload-area {
        width:100%; padding:20px; border:2px dashed rgba(255,255,255,0.1);
        border-radius:10px; text-align:center; cursor:pointer;
        color:rgba(255,255,255,0.4); font-size:12px; transition:all 0.15s;
      }
      .anim-upload-area:hover { border-color:var(--accent); color:rgba(255,255,255,0.6); }
    </style>
    <div class="anim-app">
      <div class="anim-sidebar">
        <div class="anim-sidebar-section">
          <div class="anim-sidebar-label">Character</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;" id="anim-chars"></div>
          <div class="anim-upload-area" id="anim-upload">
            \uD83D\uDCE4 Upload Image<br><span style="font-size:10px;opacity:0.6;">or drag & drop</span>
          </div>
          <input type="file" id="anim-file" accept="image/*" style="display:none;">
        </div>
        <div class="anim-sidebar-section" style="flex:1; overflow-y:auto;">
          <div class="anim-sidebar-label">Motion</div>
          <div id="anim-motions"></div>
        </div>
        <div class="anim-sidebar-section">
          <div class="anim-sidebar-label">Background</div>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            ${['#1a1a22','#000000','#ffffff','#007aff','#34c759','#ff2d55','#ff9500','#5856d6'].map(c =>
              `<div class="anim-bg-dot" data-bg="${c}" style="width:22px;height:22px;border-radius:6px;background:${c};cursor:pointer;border:2px solid ${c === '#1a1a22' ? 'var(--accent)' : 'transparent'};transition:border-color 0.15s;"></div>`
            ).join('')}
          </div>
        </div>
      </div>
      <div class="anim-main">
        <div class="anim-canvas-wrap">
          <canvas class="anim-canvas" id="anim-canvas" width="500" height="400"></canvas>
        </div>
        <div class="anim-controls">
          <button class="anim-ctrl-btn primary" id="anim-play">\u25B6 Play</button>
          <button class="anim-ctrl-btn" id="anim-loop">\uD83D\uDD01 Loop: ON</button>
          <div class="anim-speed">
            Speed:
            <input type="range" min="0.25" max="3" step="0.25" value="1" id="anim-speed">
            <span id="anim-speed-label">1x</span>
          </div>
          <div style="flex:1;"></div>
          <button class="anim-ctrl-btn" id="anim-export">\uD83D\uDCE5 Export GIF</button>
        </div>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#anim-canvas');
  const ctx = canvas.getContext('2d');
  const playBtn = container.querySelector('#anim-play');
  const loopBtn = container.querySelector('#anim-loop');
  const speedSlider = container.querySelector('#anim-speed');
  const speedLabel = container.querySelector('#anim-speed-label');
  const fileInput = container.querySelector('#anim-file');
  const uploadArea = container.querySelector('#anim-upload');

  // Resize canvas to container
  function resizeCanvas() {
    const wrap = container.querySelector('.anim-canvas-wrap');
    if (!wrap) return;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    if (!isPlaying) drawFrame(0);
  }
  resizeCanvas();
  const resizeObs = new ResizeObserver(resizeCanvas);
  resizeObs.observe(container.querySelector('.anim-canvas-wrap'));

  // ── Render characters ──
  const charsEl = container.querySelector('#anim-chars');
  CHARACTERS.forEach((char, i) => {
    const btn = document.createElement('div');
    btn.className = 'anim-char-btn' + (i === 0 ? ' active' : '');
    btn.innerHTML = char.svg;
    btn.title = char.name;
    btn.addEventListener('click', () => {
      charsEl.querySelectorAll('.anim-char-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSvgAsImage(char.svg);
    });
    charsEl.appendChild(btn);
  });

  // Load first character
  loadSvgAsImage(CHARACTERS[0].svg);

  function loadSvgAsImage(svgStr) {
    const img = new Image();
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    img.onload = () => { currentImg = img; if (!isPlaying) drawFrame(0); };
    img.src = URL.createObjectURL(blob);
  }

  // ── Upload image ──
  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--accent)'; });
  uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault(); uploadArea.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImageFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
  });

  function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        currentImg = img;
        charsEl.querySelectorAll('.anim-char-btn').forEach(b => b.classList.remove('active'));
        if (!isPlaying) drawFrame(0);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ── Render motions ──
  const motionsEl = container.querySelector('#anim-motions');
  Object.entries(MOTIONS).forEach(([key, m]) => {
    const btn = document.createElement('button');
    btn.className = 'anim-motion-btn' + (key === currentMotion ? ' active' : '');
    btn.innerHTML = `<span class="anim-motion-icon">${m.icon}</span> ${m.name}`;
    btn.addEventListener('click', () => {
      currentMotion = key;
      motionsEl.querySelectorAll('.anim-motion-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (!isPlaying) drawFrame(0);
    });
    motionsEl.appendChild(btn);
  });

  // ── Background color ──
  container.querySelectorAll('.anim-bg-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      bgColor = dot.dataset.bg;
      container.querySelectorAll('.anim-bg-dot').forEach(d => d.style.borderColor = 'transparent');
      dot.style.borderColor = 'var(--accent)';
      if (!isPlaying) drawFrame(0);
    });
  });

  // ── Interpolate keyframes ──
  function interpolate(t, keyframes) {
    // Find the two keyframes that bracket t
    let a = keyframes[0], b = keyframes[keyframes.length - 1];
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (t >= keyframes[i].t && t <= keyframes[i + 1].t) {
        a = keyframes[i]; b = keyframes[i + 1]; break;
      }
    }
    if (a === b) return a;
    const p = (t - a.t) / (b.t - a.t);
    // Ease in-out
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    return {
      x: a.x + (b.x - a.x) * ease,
      y: a.y + (b.y - a.y) * ease,
      r: a.r + (b.r - a.r) * ease,
      sx: a.sx + (b.sx - a.sx) * ease,
      sy: a.sy + (b.sy - a.sy) * ease,
    };
  }

  // ── Draw a single frame ──
  function drawFrame(t) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (!currentImg) return;

    const motion = MOTIONS[currentMotion];
    const frame = interpolate(Math.min(1, Math.max(0, t)), motion.keyframes);

    // Draw character centered with animation transforms
    const imgW = Math.min(200, w * 0.35);
    const imgH = imgW * (currentImg.height / currentImg.width);
    const cx = w / 2 + frame.x;
    const cy = h / 2 + frame.y;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(frame.r * Math.PI / 180);
    ctx.scale(frame.sx, frame.sy);

    // Shadow for depth
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;

    ctx.drawImage(currentImg, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    // Progress bar
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, h - 3, w, 3);
    ctx.fillStyle = 'var(--accent, #007aff)';
    ctx.fillRect(0, h - 3, w * t, 3);
  }

  // ── Animation loop ──
  function play() {
    isPlaying = true;
    startTime = performance.now();
    playBtn.textContent = '\u23F8 Pause';

    function tick() {
      if (!isPlaying) return;
      const motion = MOTIONS[currentMotion];
      const elapsed = (performance.now() - startTime) * speed;
      let t = elapsed / motion.duration;

      if (t >= 1) {
        if (loop) {
          startTime = performance.now();
          t = 0;
        } else {
          t = 1;
          stop();
        }
      }

      drawFrame(t);
      if (isPlaying) animFrame = requestAnimationFrame(tick);
    }
    tick();
  }

  function stop() {
    isPlaying = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    playBtn.textContent = '\u25B6 Play';
  }

  // ── Controls ──
  playBtn.addEventListener('click', () => { isPlaying ? stop() : play(); });

  loopBtn.addEventListener('click', () => {
    loop = !loop;
    loopBtn.textContent = `\uD83D\uDD01 Loop: ${loop ? 'ON' : 'OFF'}`;
  });

  speedSlider.addEventListener('input', () => {
    speed = parseFloat(speedSlider.value);
    speedLabel.textContent = speed + 'x';
  });

  // ── Export as GIF (frame capture → download) ──
  container.querySelector('#anim-export').addEventListener('click', () => {
    // Simple approach: capture frames as PNGs, zip them as an animated sequence
    // For a real GIF we'd need gif.js library. Instead, export as WebM or PNG sequence.
    // Let's do a simple approach: capture the current frame as PNG
    const link = document.createElement('a');
    // Render a full animation as a series of frames
    const motion = MOTIONS[currentMotion];
    const frames = 30;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 400; tempCanvas.height = 300;
    const tempCtx = tempCanvas.getContext('2d');

    // Just export current frame as PNG for now
    drawFrame(0.5); // draw mid-animation
    link.download = `astrion-animate-${currentMotion}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // ── Cleanup ──
  const obs = new MutationObserver(() => {
    if (!container.isConnected) {
      stop();
      resizeObs.disconnect();
      obs.disconnect();
    }
  });
  if (container.parentElement) obs.observe(container.parentElement, { childList: true, subtree: true });

  // Draw initial frame
  drawFrame(0);
}
