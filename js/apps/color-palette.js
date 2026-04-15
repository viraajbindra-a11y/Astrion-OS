// ASTRION OS — Color Palette Generator
import { processManager } from '../kernel/process-manager.js';

export function registerColorPalette() {
  processManager.register('color-palette', {
    name: 'Color Palette',
    icon: '🎨',
    singleInstance: true,
    width: 440,
    height: 500,
    launch: (el) => initColorPalette(el)
  });
}

function initColorPalette(container) {
  let palette = [];
  let savedPalettes = [];
  let harmony = 'random';
  try { savedPalettes = JSON.parse(localStorage.getItem('nova-palettes')) || []; } catch {}

  function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) { r = g = b = l; } else {
      const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q-p)*6*t; if (t < 1/2) return q; if (t < 2/3) return p + (q-p)*(2/3-t)*6; return p; };
      const q = l < 0.5 ? l*(1+s) : l+s-l*s;
      const p = 2*l-q;
      r = hue2rgb(p, q, h+1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h-1/3);
    }
    return '#' + [r,g,b].map(x => Math.round(x*255).toString(16).padStart(2,'0')).join('');
  }

  function generate() {
    const baseHue = Math.floor(Math.random() * 360);
    const baseSat = 60 + Math.random() * 30;
    const baseLit = 40 + Math.random() * 20;

    if (harmony === 'complementary') {
      palette = [
        { h: baseHue, s: baseSat, l: baseLit },
        { h: baseHue, s: baseSat - 10, l: baseLit + 20 },
        { h: (baseHue + 180) % 360, s: baseSat, l: baseLit },
        { h: (baseHue + 180) % 360, s: baseSat - 10, l: baseLit + 20 },
        { h: baseHue, s: baseSat - 20, l: baseLit + 35 },
      ];
    } else if (harmony === 'analogous') {
      palette = [-30, -15, 0, 15, 30].map((offset, i) => ({
        h: (baseHue + offset + 360) % 360,
        s: baseSat - i * 3,
        l: baseLit + (i - 2) * 5,
      }));
    } else if (harmony === 'triadic') {
      palette = [0, 120, 240, 0, 120].map((offset, i) => ({
        h: (baseHue + offset) % 360,
        s: baseSat - (i > 2 ? 15 : 0),
        l: baseLit + (i > 2 ? 20 : 0),
      }));
    } else if (harmony === 'monochrome') {
      palette = [20, 35, 50, 65, 80].map(l => ({
        h: baseHue, s: baseSat, l,
      }));
    } else {
      // Random
      palette = Array.from({ length: 5 }, () => ({
        h: Math.floor(Math.random() * 360),
        s: 50 + Math.random() * 40,
        l: 35 + Math.random() * 35,
      }));
    }

    palette = palette.map(c => ({ ...c, hex: hslToHex(c.h, c.s, c.l) }));
    render();
  }

  function savePalette() {
    savedPalettes.unshift(palette.map(c => c.hex));
    if (savedPalettes.length > 10) savedPalettes.pop();
    try { localStorage.setItem('nova-palettes', JSON.stringify(savedPalettes)); } catch {}
    render();
  }

  function render() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    const harmonies = ['random', 'complementary', 'analogous', 'triadic', 'monochrome'];

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:#1a1a2e;color:white;font-family:var(--font,system-ui);padding:14px;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:14px;font-weight:600;">🎨 Color Palette</div>
          <div style="display:flex;gap:4px;">
            <button class="cp-save" style="padding:5px 12px;border-radius:8px;border:none;background:rgba(255,255,255,0.06);color:white;font-size:11px;cursor:pointer;">💾 Save</button>
            <button class="cp-gen" style="padding:5px 12px;border-radius:8px;border:none;background:${accent};color:white;font-size:11px;cursor:pointer;">🎲 Generate</button>
          </div>
        </div>

        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${harmonies.map(h => `<button class="cp-harmony" data-h="${h}" style="
            padding:4px 10px;border-radius:6px;border:none;font-size:10px;cursor:pointer;
            background:${h === harmony ? accent : 'rgba(255,255,255,0.06)'};color:white;
          ">${h[0].toUpperCase() + h.slice(1)}</button>`).join('')}
        </div>

        <div style="display:flex;gap:6px;flex:1;min-height:0;">
          ${palette.map(c => `
            <div class="cp-color" data-hex="${c.hex}" style="
              flex:1;border-radius:12px;background:${c.hex};cursor:pointer;position:relative;
              display:flex;align-items:flex-end;justify-content:center;padding-bottom:10px;
              transition:transform 0.15s;min-height:140px;
            ">
              <div style="background:rgba(0,0,0,0.5);padding:3px 8px;border-radius:6px;font-size:10px;font-weight:600;">${c.hex.toUpperCase()}</div>
            </div>
          `).join('')}
        </div>

        ${savedPalettes.length > 0 ? `
          <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;">Saved Palettes</div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:100px;overflow-y:auto;">
            ${savedPalettes.slice(0, 5).map((p, i) => `
              <div class="cp-saved" data-idx="${i}" style="display:flex;gap:2px;cursor:pointer;border-radius:6px;overflow:hidden;height:24px;">
                ${p.map(hex => `<div style="flex:1;background:${hex};"></div>`).join('')}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    container.querySelector('.cp-gen').addEventListener('click', generate);
    container.querySelector('.cp-save').addEventListener('click', savePalette);
    container.querySelectorAll('.cp-harmony').forEach(el => {
      el.addEventListener('click', () => { harmony = el.dataset.h; generate(); });
    });
    container.querySelectorAll('.cp-color').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(el.dataset.hex).catch(() => {});
        el.querySelector('div').textContent = 'Copied!';
        setTimeout(() => { el.querySelector('div').textContent = el.dataset.hex.toUpperCase(); }, 800);
      });
      el.addEventListener('mouseenter', () => el.style.transform = 'scaleY(1.05)');
      el.addEventListener('mouseleave', () => el.style.transform = 'scaleY(1)');
    });
    container.querySelectorAll('.cp-saved').forEach(el => {
      el.addEventListener('click', () => {
        const p = savedPalettes[+el.dataset.idx];
        palette = p.map(hex => ({ hex, h: 0, s: 0, l: 0 }));
        render();
      });
    });
  }

  generate();
}
