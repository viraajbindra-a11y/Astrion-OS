// Astrion OS — AI Art Generator
// Type a prompt, get generative art. Uses word analysis to pick colors,
// shapes, and patterns — then renders unique procedural art on canvas.
// When Astrion AI is connected, also generates a poem/description.

import { processManager } from '../kernel/process-manager.js';
import { aiService } from '../kernel/ai-service.js';

export function registerAiArt() {
  processManager.register('ai-art', {
    name: 'AI Art',
    icon: '\uD83C\uDFA8',
    iconClass: 'dock-icon-ai-art',
    singleInstance: true,
    width: 700,
    height: 560,
    launch: (contentEl) => initAiArt(contentEl),
  });
}

// ── Word → visual mapping ──
const PALETTES = {
  // Nature
  ocean:   ['#0077b6','#00b4d8','#90e0ef','#caf0f8','#023e8a'],
  sunset:  ['#ff6b35','#f7c59f','#ff006e','#fb5607','#ffbe0b'],
  forest:  ['#2d6a4f','#40916c','#52b788','#74c69d','#b7e4c7'],
  night:   ['#0d1b2a','#1b263b','#415a77','#778da9','#e0e1dd'],
  fire:    ['#d00000','#dc2f02','#e85d04','#f48c06','#ffba08'],
  ice:     ['#caf0f8','#ade8f4','#90e0ef','#48cae4','#0096c7'],
  space:   ['#0b0c10','#1f2833','#c5c6c7','#66fcf1','#45a29e'],
  garden:  ['#606c38','#283618','#fefae0','#dda15e','#bc6c25'],
  rain:    ['#264653','#2a9d8f','#e9c46a','#f4a261','#e76f51'],
  snow:    ['#e8e8e8','#d4d4d4','#bfbfbf','#f0f0f0','#ffffff'],
  // Moods
  happy:   ['#ffbe0b','#fb5607','#ff006e','#8338ec','#3a86ff'],
  sad:     ['#264653','#2a4858','#3d5a80','#98c1d9','#e0e1dd'],
  angry:   ['#d00000','#370617','#6a040f','#9d0208','#e85d04'],
  calm:    ['#606c38','#94d2bd','#e9d8a6','#dda15e','#b7e4c7'],
  love:    ['#ff0a54','#ff477e','#ff7096','#ff85a1','#fbb1bd'],
  dark:    ['#0b090a','#161a1d','#660708','#a4161a','#ba181b'],
  bright:  ['#ffbe0b','#fb5607','#ff006e','#8338ec','#3a86ff'],
  dream:   ['#7209b7','#560bad','#480ca8','#3a0ca3','#3f37c9'],
  // Objects
  city:    ['#212529','#343a40','#495057','#6c757d','#adb5bd'],
  music:   ['#7400b8','#6930c3','#5e60ce','#5390d9','#4ea8de'],
  flower:  ['#ff0a54','#ff477e','#ff85a1','#fbb1bd','#f9bec7'],
  mountain:['#4a4e69','#22223b','#9a8c98','#c9ada7','#f2e9e4'],
  water:   ['#03045e','#0077b6','#00b4d8','#90e0ef','#caf0f8'],
  star:    ['#ffd60a','#ffc300','#ffbe0b','#e8e8e4','#0b0c10'],
  // Abstract
  abstract:['#ff006e','#8338ec','#3a86ff','#ffbe0b','#fb5607'],
  chaos:   ['#d00000','#ffba08','#3a86ff','#8338ec','#ff006e'],
  zen:     ['#e9ecef','#dee2e6','#ced4da','#adb5bd','#6c757d'],
  neon:    ['#ff00ff','#00ffff','#ffff00','#ff0080','#80ff00'],
  pastel:  ['#ffadad','#ffd6a5','#fdffb6','#caffbf','#a0c4ff'],
  retro:   ['#264653','#2a9d8f','#e9c46a','#f4a261','#e76f51'],
  cyber:   ['#0d1117','#00ff41','#39ff14','#00ffff','#ff00ff'],
};

const SHAPES = {
  // Words that trigger specific shape patterns
  circle: ['sun','moon','eye','ball','bubble','planet','world','globe','dot'],
  triangle: ['mountain','peak','arrow','point','pyramid','tree','pine'],
  line: ['rain','road','path','river','stream','lightning','beam','ray'],
  wave: ['ocean','sea','water','wave','sound','music','flow','wind'],
  square: ['city','building','block','box','pixel','grid','wall','brick'],
  star: ['star','sparkle','magic','light','shine','glow','twinkle','diamond'],
  spiral: ['galaxy','vortex','tornado','spiral','whirl','spin','cosmos'],
  scatter: ['snow','rain','dust','sand','confetti','particle','spray','mist'],
};

function getColorsForPrompt(prompt) {
  const words = prompt.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (PALETTES[word]) return PALETTES[word];
  }
  // Try partial matches
  for (const word of words) {
    for (const [key, palette] of Object.entries(PALETTES)) {
      if (key.includes(word) || word.includes(key)) return palette;
    }
  }
  // Hash-based fallback — deterministic colors from the prompt string
  const hash = prompt.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const palettes = Object.values(PALETTES);
  return palettes[Math.abs(hash) % palettes.length];
}

function getShapeType(prompt) {
  const words = prompt.toLowerCase().split(/\s+/);
  for (const [shape, triggers] of Object.entries(SHAPES)) {
    for (const word of words) {
      if (triggers.includes(word)) return shape;
    }
  }
  // Deterministic fallback
  const hash = prompt.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const types = Object.keys(SHAPES);
  return types[Math.abs(hash) % types.length];
}

// Seeded random for reproducible art from same prompt
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateArt(ctx, w, h, prompt) {
  const colors = getColorsForPrompt(prompt);
  const shape = getShapeType(prompt);
  const seed = prompt.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const rand = seededRandom(Math.abs(seed));

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, w * rand(), h);
  bg.addColorStop(0, colors[0]);
  bg.addColorStop(1, colors[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Layer 1: large shapes
  const count1 = 5 + Math.floor(rand() * 10);
  for (let i = 0; i < count1; i++) {
    ctx.save();
    ctx.globalAlpha = 0.1 + rand() * 0.3;
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const x = rand() * w, y = rand() * h;
    const size = 50 + rand() * 200;

    if (shape === 'circle' || shape === 'spiral') {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x - size * 0.8, y + size * 0.6);
      ctx.lineTo(x + size * 0.8, y + size * 0.6);
      ctx.closePath();
      ctx.fill();
    } else if (shape === 'square') {
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    } else if (shape === 'star') {
      drawStar(ctx, x, y, 5, size, size / 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Layer 2: detail shapes
  const count2 = 20 + Math.floor(rand() * 40);
  for (let i = 0; i < count2; i++) {
    ctx.save();
    ctx.globalAlpha = 0.15 + rand() * 0.5;
    const color = colors[Math.floor(rand() * colors.length)];
    const x = rand() * w, y = rand() * h;
    const size = 5 + rand() * 40;

    if (shape === 'scatter' || shape === 'star') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size / 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'line') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 200, y + rand() * 150);
      ctx.stroke();
    } else if (shape === 'wave') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + rand() * 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let wx = 0; wx < w; wx += 5) {
        ctx.lineTo(wx, y + Math.sin(wx * 0.02 + i) * (20 + rand() * 30));
      }
      ctx.stroke();
    } else if (shape === 'spiral') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + rand() * 2;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.1) {
        const r = a * (3 + rand() * 5);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
  }

  // Layer 3: glow/highlights
  const count3 = 8 + Math.floor(rand() * 15);
  for (let i = 0; i < count3; i++) {
    const x = rand() * w, y = rand() * h;
    const r = 20 + rand() * 60;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[Math.floor(rand() * colors.length)];
    grad.addColorStop(0, c + '80');
    grad.addColorStop(1, c + '00');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Layer 4: noise texture
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (rand() - 0.5) * 15;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawStar(ctx, cx, cy, points, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI / points) - Math.PI / 2;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function initAiArt(container) {
  let currentPrompt = '';
  let aiDescription = '';
  let isGenerating = false;

  container.innerHTML = `
    <style>
      .aiart-app { display:flex; flex-direction:column; height:100%; background:#0e0e12; color:white; font-family:var(--font); }
      .aiart-top { display:flex; gap:10px; padding:12px; border-bottom:1px solid rgba(255,255,255,0.06); align-items:center; }
      .aiart-input {
        flex:1; padding:10px 16px; border-radius:12px;
        border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.06);
        color:white; font-size:14px; font-family:var(--font); outline:none;
      }
      .aiart-input:focus { border-color:var(--accent); }
      .aiart-input::placeholder { color:rgba(255,255,255,0.3); }
      .aiart-gen-btn {
        padding:10px 24px; border-radius:12px; border:none;
        background:linear-gradient(135deg, #7209b7, #3a0ca3);
        color:white; font-size:13px; font-weight:600; cursor:pointer;
        font-family:var(--font); transition:filter 0.15s; white-space:nowrap;
      }
      .aiart-gen-btn:hover { filter:brightness(1.2); }
      .aiart-gen-btn:disabled { opacity:0.5; cursor:default; }
      .aiart-canvas-wrap {
        flex:1; display:flex; align-items:center; justify-content:center;
        background:#111; position:relative; overflow:hidden;
      }
      .aiart-canvas { border-radius:0; }
      .aiart-placeholder {
        text-align:center; color:rgba(255,255,255,0.2); padding:40px;
      }
      .aiart-placeholder-icon { font-size:64px; margin-bottom:12px; }
      .aiart-bottom {
        padding:10px 16px; border-top:1px solid rgba(255,255,255,0.06);
        display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.2);
      }
      .aiart-desc {
        flex:1; font-size:12px; color:rgba(255,255,255,0.5);
        font-style:italic; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      }
      .aiart-btn {
        padding:6px 14px; border-radius:8px; border:none;
        background:rgba(255,255,255,0.08); color:white; font-size:12px;
        cursor:pointer; font-family:var(--font); transition:all 0.15s;
      }
      .aiart-btn:hover { background:rgba(255,255,255,0.12); }
      .aiart-suggestions { display:flex; gap:6px; padding:0 12px 10px; flex-wrap:wrap; }
      .aiart-suggestion {
        padding:5px 12px; border-radius:16px; border:1px solid rgba(255,255,255,0.08);
        background:rgba(255,255,255,0.03); color:rgba(255,255,255,0.5);
        font-size:11px; cursor:pointer; font-family:var(--font); transition:all 0.15s;
      }
      .aiart-suggestion:hover { background:rgba(255,255,255,0.08); color:white; }
    </style>

    <div class="aiart-app">
      <div class="aiart-top">
        <input class="aiart-input" id="aiart-prompt" placeholder="Describe your art... (e.g. ocean sunset, neon city, dream forest)" autocomplete="off">
        <button class="aiart-gen-btn" id="aiart-generate">\u2728 Generate</button>
      </div>
      <div class="aiart-suggestions" id="aiart-suggestions">
        ${['ocean sunset', 'neon city', 'dream forest', 'space galaxy', 'fire chaos', 'zen garden', 'cyber rain', 'love flowers', 'mountain night', 'happy stars'].map(s =>
          `<div class="aiart-suggestion" data-prompt="${s}">${s}</div>`
        ).join('')}
      </div>
      <div class="aiart-canvas-wrap" id="aiart-wrap">
        <div class="aiart-placeholder" id="aiart-placeholder">
          <div class="aiart-placeholder-icon">\uD83C\uDFA8</div>
          <div style="font-size:16px; margin-bottom:6px;">AI Art Generator</div>
          <div style="font-size:12px;">Type a prompt and hit Generate</div>
        </div>
        <canvas class="aiart-canvas" id="aiart-canvas" style="display:none;"></canvas>
      </div>
      <div class="aiart-bottom">
        <div class="aiart-desc" id="aiart-desc">Ready to create</div>
        <button class="aiart-btn" id="aiart-save">\uD83D\uDCBE Save PNG</button>
        <button class="aiart-btn" id="aiart-remix">\uD83C\uDFB2 Remix</button>
        <button class="aiart-btn" id="aiart-wallpaper">\uD83D\uDDBC Set Wallpaper</button>
      </div>
    </div>
  `;

  const promptInput = container.querySelector('#aiart-prompt');
  const genBtn = container.querySelector('#aiart-generate');
  const canvas = container.querySelector('#aiart-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = container.querySelector('#aiart-placeholder');
  const descEl = container.querySelector('#aiart-desc');
  const wrap = container.querySelector('#aiart-wrap');

  // Resize canvas
  function resize() {
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
  }
  resize();
  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(wrap);

  // Suggestions
  container.querySelectorAll('.aiart-suggestion').forEach(el => {
    el.addEventListener('click', () => {
      promptInput.value = el.dataset.prompt;
      generate();
    });
  });

  // Generate
  genBtn.addEventListener('click', generate);
  promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') generate(); });

  async function generate() {
    const prompt = promptInput.value.trim();
    if (!prompt || isGenerating) return;

    isGenerating = true;
    genBtn.disabled = true;
    genBtn.textContent = '\u23F3 Creating...';
    descEl.textContent = 'Generating art...';
    currentPrompt = prompt;

    // Animate generation (brief delay for dramatic effect)
    await new Promise(r => setTimeout(r, 300));

    resize();
    placeholder.style.display = 'none';
    canvas.style.display = 'block';

    // Generate the art
    generateArt(ctx, canvas.width, canvas.height, prompt);

    // Try to get AI description (non-blocking)
    descEl.textContent = `"${prompt}" — ${getShapeType(prompt)} pattern, ${getColorsForPrompt(prompt).length} colors`;

    tryAiDescription(prompt);

    genBtn.textContent = '\u2728 Generate';
    genBtn.disabled = false;
    isGenerating = false;
  }

  async function tryAiDescription(prompt) {
    try {
      const desc = await aiService.ask(
        `You are a poetic art critic. In ONE short sentence (under 15 words), describe an abstract artwork inspired by "${prompt}". Be evocative and brief. No quotes.`,
        { maxTokens: 50, skipHistory: true }
      );
      if (desc && desc.length > 5) {
        descEl.textContent = desc;
        aiDescription = desc;
      }
    } catch {
      // AI not available — no problem, keep the algorithmic description
    }
  }

  // Remix — same prompt, different seed (append random suffix)
  container.querySelector('#aiart-remix').addEventListener('click', () => {
    if (!currentPrompt) return;
    promptInput.value = currentPrompt;
    // Add a tiny invisible variation to change the seed
    const original = currentPrompt;
    currentPrompt = original + ' ' + Math.random().toString(36).slice(2, 5);
    resize();
    generateArt(ctx, canvas.width, canvas.height, currentPrompt);
    currentPrompt = original; // restore for display
    promptInput.value = original;
    descEl.textContent = `"${original}" — remixed`;
  });

  // Save
  container.querySelector('#aiart-save').addEventListener('click', () => {
    if (!currentPrompt) return;
    const a = document.createElement('a');
    a.download = `astrion-art-${currentPrompt.replace(/\s+/g, '-').slice(0, 30)}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  // Set as wallpaper
  container.querySelector('#aiart-wallpaper').addEventListener('click', () => {
    if (!currentPrompt) return;
    const dataUrl = canvas.toDataURL('image/png');
    document.getElementById('desktop').style.backgroundImage = `url(${dataUrl})`;
    document.getElementById('desktop').style.backgroundSize = 'cover';
    localStorage.setItem('nova-wallpaper-custom', dataUrl);
    descEl.textContent = 'Set as wallpaper!';
  });

  // Cleanup
  const obs = new MutationObserver(() => {
    if (!container.isConnected) { resizeObs.disconnect(); obs.disconnect(); }
  });
  if (container.parentElement) obs.observe(container.parentElement, { childList: true, subtree: true });
}
