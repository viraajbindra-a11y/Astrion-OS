// NOVA OS — App Installer
// Manages installing, uninstalling, and running third-party apps.
// Installed apps are stored in localStorage and loaded on boot.

import { processManager } from './process-manager.js';
import { windowManager } from './window-manager.js';
import { notifications } from './notifications.js';

const STORAGE_KEY = 'nova-installed-apps';

// Registry of installable apps with their code
const appRegistry = {
  'pomodoro': {
    name: 'Pomodoro Timer',
    icon: '\u23F2',
    category: 'Productivity',
    dev: 'Astrion Labs',
    desc: 'Focus timer using the Pomodoro technique. 25 min work, 5 min break.',
    color: 'linear-gradient(135deg, #e53935, #b71c1c)',
    rating: 4.8,
    price: 'Free',
    code: function(container) {
      let time = 25 * 60, running = false, mode = 'work', interval;
      function render() {
        const m = Math.floor(time / 60).toString().padStart(2, '0');
        const s = (time % 60).toString().padStart(2, '0');
        container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:${mode === 'work' ? '#1a1a2e' : '#1b3a1b'};color:white;font-family:var(--font);">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.4);margin-bottom:8px;">${mode === 'work' ? 'Focus Time' : 'Break Time'}</div>
          <div style="font-size:72px;font-weight:200;font-variant-numeric:tabular-nums;margin-bottom:24px;">${m}:${s}</div>
          <div style="display:flex;gap:12px;">
            <button onclick="this.closest('div').querySelector('[data-reset]').click()" style="background:rgba(255,255,255,0.1);border:none;color:white;padding:10px 24px;border-radius:10px;font-size:14px;cursor:pointer;">Reset</button>
            <button onclick="this.closest('div').querySelector('[data-toggle]').click()" style="background:${running ? '#e53935' : '#28c840'};border:none;color:white;padding:10px 32px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">${running ? 'Pause' : 'Start'}</button>
          </div>
          <button data-toggle style="display:none"></button>
          <button data-reset style="display:none"></button>
        </div>`;
        container.querySelector('[data-toggle]').addEventListener('click', () => {
          running = !running;
          if (running) { interval = setInterval(() => { time--; if (time <= 0) { running = false; clearInterval(interval); mode = mode === 'work' ? 'break' : 'work'; time = mode === 'work' ? 25 * 60 : 5 * 60; } render(); }, 1000); }
          else clearInterval(interval);
          render();
        });
        container.querySelector('[data-reset]').addEventListener('click', () => { running = false; clearInterval(interval); mode = 'work'; time = 25 * 60; render(); });
      }
      render();
    }
  },
  'calculator-sci': {
    name: 'Scientific Calculator',
    icon: '\uD83E\uDDEE',
    category: 'Utilities',
    dev: 'MathTools',
    desc: 'Advanced calculator with scientific functions, trigonometry, and constants.',
    color: 'linear-gradient(135deg, #37474f, #263238)',
    rating: 4.7,
    price: 'Free',
    code: function(container) {
      let display = '0', expr = '';
      function render() {
        container.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;background:#1a1a1a;font-family:var(--font);">
          <div style="padding:16px 20px;text-align:right;">
            <div style="font-size:14px;color:rgba(255,255,255,0.4);min-height:20px;">${expr}</div>
            <div style="font-size:36px;font-weight:300;color:white;overflow:hidden;">${display}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;flex:1;" id="sci-btns"></div>
        </div>`;
        const btns = ['sin','cos','tan','π','e','x²','√','log','ln','(','7','8','9','÷',')',
          '4','5','6','×','%','1','2','3','-','!','0','.','=','+','C'];
        const grid = container.querySelector('#sci-btns');
        btns.forEach(b => {
          const btn = document.createElement('button');
          btn.textContent = b;
          btn.style.cssText = `background:${b === '=' ? '#ff9500' : b === 'C' ? '#333' : ['sin','cos','tan','π','e','x²','√','log','ln','(',')','+','-','×','÷','%','!'].includes(b) ? '#2a2a2a' : '#3a3a3a'};border:none;color:white;font-size:16px;cursor:pointer;font-family:var(--font);`;
          btn.addEventListener('click', () => {
            if (b === 'C') { display = '0'; expr = ''; }
            else if (b === '=') { try { const e = expr.replace(/×/g,'*').replace(/÷/g,'/').replace(/π/g,'Math.PI').replace(/e(?!\w)/g,'Math.E').replace(/sin/g,'Math.sin').replace(/cos/g,'Math.cos').replace(/tan/g,'Math.tan').replace(/log/g,'Math.log10').replace(/ln/g,'Math.log').replace(/√(\d+)/g,'Math.sqrt($1)').replace(/(\d+)²/g,'($1)**2'); display = String(eval(e)); } catch(er) { display = 'Error'; } }
            else if (b === 'x²') { expr += '²'; display = expr; }
            else if (b === '√') { expr += '√'; display = expr; }
            else { if (display === '0' && !isNaN(b)) { expr = b; } else { expr += b; } display = expr; }
            render();
          });
          grid.appendChild(btn);
        });
      }
      render();
    }
  },
  'whiteboard': {
    name: 'Whiteboard',
    icon: '\uD83D\uDCDD',
    category: 'Productivity',
    dev: 'Creative Labs',
    desc: 'Infinite canvas whiteboard for brainstorming and sketching ideas.',
    color: 'linear-gradient(135deg, #1565c0, #0d47a1)',
    rating: 4.6,
    price: 'Free',
    code: function(container) {
      container.innerHTML = `<div style="height:100%;position:relative;background:white;">
        <canvas id="wb-canvas" style="width:100%;height:100%;cursor:crosshair;"></canvas>
        <div style="position:absolute;top:8px;left:8px;display:flex;gap:4px;">
          ${['#000','#e53935','#1e88e5','#43a047','#ff9800','#9c27b0'].map(c => `<div data-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === '#000' ? 'white' : 'transparent'};"></div>`).join('')}
          <div data-color="eraser" style="width:28px;height:28px;border-radius:50%;background:white;cursor:pointer;border:2px solid #ccc;font-size:12px;display:flex;align-items:center;justify-content:center;">⌫</div>
        </div>
      </div>`;
      const canvas = container.querySelector('#wb-canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = canvas.offsetWidth * 2; canvas.height = canvas.offsetHeight * 2;
      ctx.scale(2, 2); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      let drawing = false, color = '#000', lx, ly;
      canvas.addEventListener('pointerdown', (e) => { drawing = true; const r = canvas.getBoundingClientRect(); lx = e.clientX - r.left; ly = e.clientY - r.top; });
      canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.strokeStyle = color === 'eraser' ? 'white' : color; ctx.lineWidth = color === 'eraser' ? 20 : 3; ctx.stroke(); lx = x; ly = y; });
      canvas.addEventListener('pointerup', () => drawing = false);
      container.querySelectorAll('[data-color]').forEach(el => {
        el.addEventListener('click', () => { color = el.dataset.color; container.querySelectorAll('[data-color]').forEach(e => e.style.borderColor = 'transparent'); el.style.borderColor = color === 'eraser' ? '#ccc' : 'white'; });
      });
    }
  },
  'markdown-viewer': {
    name: 'Markdown Preview',
    icon: '\uD83D\uDCCB',
    category: 'Developer Tools',
    dev: 'DevForge',
    desc: 'Write Markdown on the left, see live rendered preview on the right.',
    color: 'linear-gradient(135deg, #455a64, #263238)',
    rating: 4.5,
    price: 'Free',
    code: function(container) {
      container.innerHTML = `<div style="display:flex;height:100%;font-family:var(--font);">
        <textarea id="md-input" style="flex:1;background:#1e1e1e;color:#e0e0e0;border:none;padding:16px;font-size:14px;font-family:var(--mono);resize:none;outline:none;border-right:1px solid rgba(255,255,255,0.1);" placeholder="# Write Markdown here\n\nType **bold**, *italic*, \`code\`..."># Hello World\n\nThis is **Astrion OS** Markdown Preview.\n\n- Item 1\n- Item 2\n- Item 3\n\n\`\`\`js\nconsole.log('Hello!');\n\`\`\`</textarea>
        <div id="md-output" style="flex:1;padding:16px;overflow-y:auto;background:#fff;color:#333;font-size:14px;line-height:1.6;"></div>
      </div>`;
      const input = container.querySelector('#md-input'), output = container.querySelector('#md-output');
      function renderMd(text) {
        return text
          .replace(/^### (.*$)/gm, '<h3 style="margin:12px 0 6px;">$1</h3>')
          .replace(/^## (.*$)/gm, '<h2 style="margin:16px 0 8px;">$1</h2>')
          .replace(/^# (.*$)/gm, '<h1 style="margin:20px 0 10px;">$1</h1>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:13px;">$1</code>')
          .replace(/^- (.*$)/gm, '<li style="margin:4px 0;">$1</li>')
          .replace(/\n/g, '<br>');
      }
      function update() { output.innerHTML = renderMd(input.value); }
      input.addEventListener('input', update);
      update();
    }
  },
  'system-monitor': {
    name: 'System Monitor',
    icon: '\uD83D\uDCCA',
    category: 'Utilities',
    dev: 'Astrion Team',
    desc: 'Monitor CPU, memory, and running processes in real-time.',
    color: 'linear-gradient(135deg, #2e7d32, #1b5e20)',
    rating: 4.4,
    price: 'Free',
    code: function(container) {
      function render() {
        const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : Math.round(30 + Math.random() * 20);
        const cpu = Math.round(5 + Math.random() * 30);
        container.innerHTML = `<div style="height:100%;background:#111;color:white;font-family:var(--font);padding:16px;overflow-y:auto;">
          <div style="font-size:16px;font-weight:600;margin-bottom:16px;">System Monitor</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
            <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;">
              <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">CPU</div>
              <div style="font-size:28px;font-weight:600;color:#4fc3f7;">${cpu}%</div>
              <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:8px;"><div style="height:100%;width:${cpu}%;background:#4fc3f7;border-radius:2px;"></div></div>
            </div>
            <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;">
              <div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;">Memory</div>
              <div style="font-size:28px;font-weight:600;color:#66bb6a;">${mem} MB</div>
              <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin-top:8px;"><div style="height:100%;width:${Math.min(100, mem)}%;background:#66bb6a;border-radius:2px;"></div></div>
            </div>
          </div>
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Running Processes</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.3);display:flex;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="flex:2;">Process</span><span style="flex:1;text-align:right;">CPU</span><span style="flex:1;text-align:right;">Memory</span>
          </div>
          <div style="font-size:13px;">
            <div style="display:flex;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="flex:2;">Astrion Kernel</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(1+Math.random()*3).toFixed(1)}%</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(8+Math.random()*5).toFixed(0)} MB</span></div>
            <div style="display:flex;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="flex:2;">Window Manager</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(0.5+Math.random()*2).toFixed(1)}%</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(3+Math.random()*4).toFixed(0)} MB</span></div>
            <div style="display:flex;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="flex:2;">AI Service</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(0.2+Math.random()*1).toFixed(1)}%</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(5+Math.random()*3).toFixed(0)} MB</span></div>
            <div style="display:flex;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);"><span style="flex:2;">File System</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(0.1+Math.random()*0.5).toFixed(1)}%</span><span style="flex:1;text-align:right;color:rgba(255,255,255,0.5);">${(2+Math.random()*2).toFixed(0)} MB</span></div>
          </div>
        </div>`;
      }
      render();
      const timer = setInterval(render, 2000);
      // Cleanup when window closes (container removed from DOM)
      const observer = new MutationObserver(() => { if (!document.contains(container)) { clearInterval(timer); observer.disconnect(); } });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  },
};

class AppInstaller {
  constructor() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch {}
    this.installed = new Set(saved);
  }

  getRegistry() {
    return appRegistry;
  }

  isInstalled(appId) {
    return this.installed.has(appId);
  }

  install(appId) {
    return new Promise((resolve) => {
      const app = appRegistry[appId];
      if (!app) { resolve(false); return; }

      // Register the app in the process manager
      processManager.register(appId, {
        name: app.name,
        icon: app.icon,
        singleInstance: true,
        width: 500,
        height: 400,
        launch: (contentEl) => {
          app.code(contentEl);
        }
      });

      this.installed.add(appId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.installed]));

      notifications.show({
        title: `${app.name} Installed`,
        body: 'Open it from Search or App Grid.',
        icon: app.icon,
        duration: 3000,
      });

      resolve(true);
    });
  }

  uninstall(appId) {
    this.installed.delete(appId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.installed]));
  }

  // Load all previously installed apps on boot
  loadInstalled() {
    for (const appId of this.installed) {
      const app = appRegistry[appId];
      if (app) {
        processManager.register(appId, {
          name: app.name,
          icon: app.icon,
          singleInstance: true,
          width: 500,
          height: 400,
          launch: (contentEl) => {
            app.code(contentEl);
          }
        });
      }
    }
  }
}

export const appInstaller = new AppInstaller();
