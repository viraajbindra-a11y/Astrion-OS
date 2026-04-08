// Astrion OS — Whiteboard (infinite canvas)
import { processManager } from '../kernel/process-manager.js';
export function registerWhiteboard() {
  processManager.register('whiteboard', { name: 'Whiteboard', icon: '\uD83D\uDCDD', singleInstance: false, width: 800, height: 560,
    launch: (el) => {
      el.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;background:#ffffff;">
        <div style="padding:6px 10px;background:#f0f0f0;display:flex;gap:6px;align-items:center;">
          <input type="color" id="wb-color" value="#000000" style="width:30px;height:26px;border:none;cursor:pointer;">
          <input type="range" id="wb-size" min="1" max="20" value="3" style="width:80px;">
          <button id="wb-eraser" style="padding:4px 10px;border-radius:4px;border:1px solid #ccc;background:white;font-size:11px;cursor:pointer;">Eraser</button>
          <button id="wb-clear" style="padding:4px 10px;border-radius:4px;border:1px solid #ccc;background:white;font-size:11px;cursor:pointer;">Clear</button>
          <div style="flex:1;"></div>
          <button id="wb-save" style="padding:4px 10px;border-radius:4px;border:none;background:#007aff;color:white;font-size:11px;cursor:pointer;">Save</button>
        </div>
        <canvas id="wb-canvas" style="flex:1;cursor:crosshair;"></canvas>
      </div>`;
      const canvas = el.querySelector('#wb-canvas');
      const ctx = canvas.getContext('2d');
      const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
      resize(); window.addEventListener('resize', resize);
      let drawing = false, color = '#000000', size = 3, eraser = false;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      canvas.addEventListener('pointerdown', (e) => { drawing = true; ctx.beginPath(); ctx.moveTo(e.offsetX, e.offsetY); });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.strokeStyle = eraser ? '#ffffff' : color;
        ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke();
      });
      canvas.addEventListener('pointerup', () => { drawing = false; });
      el.querySelector('#wb-color').addEventListener('input', (e) => { color = e.target.value; eraser = false; });
      el.querySelector('#wb-size').addEventListener('input', (e) => { size = parseInt(e.target.value); });
      el.querySelector('#wb-eraser').addEventListener('click', () => { eraser = !eraser; el.querySelector('#wb-eraser').style.background = eraser ? '#ddd' : 'white'; });
      el.querySelector('#wb-clear').addEventListener('click', () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
      el.querySelector('#wb-save').addEventListener('click', () => { const a = document.createElement('a'); a.download = 'whiteboard.png'; a.href = canvas.toDataURL(); a.click(); });
    }
  });
}
