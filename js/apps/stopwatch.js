// Astrion OS — Stopwatch
import { processManager } from '../kernel/process-manager.js';
export function registerStopwatch() {
  processManager.register('stopwatch', { name: 'Stopwatch', icon: '\u23F1\uFE0F', singleInstance: true, width: 360, height: 420,
    launch: (el) => {
      let ms = 0, running = false, interval = null, laps = [];
      function fmt(t) { const m = Math.floor(t/60000), s = Math.floor((t%60000)/1000), c = Math.floor((t%1000)/10); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`; }
      function render() {
        el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:24px;">
          <div style="font-size:56px;font-weight:200;font-variant-numeric:tabular-nums;margin:20px 0;">${fmt(ms)}</div>
          <div style="display:flex;gap:12px;margin-bottom:20px;">
            <button id="sw-toggle" style="width:64px;height:64px;border-radius:50%;border:none;background:${running?'#ff3b30':'#34c759'};color:white;font-size:14px;cursor:pointer;font-weight:600;font-family:var(--font);">${running?'Stop':'Start'}</button>
            <button id="sw-lap" style="width:64px;height:64px;border-radius:50%;border:none;background:rgba(255,255,255,0.08);color:white;font-size:12px;cursor:pointer;font-family:var(--font);">${ms>0&&!running?'Reset':'Lap'}</button>
          </div>
          <div style="flex:1;width:100%;overflow-y:auto;">${laps.map((l,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;"><span style="color:rgba(255,255,255,0.5);">Lap ${laps.length-i}</span><span>${fmt(l)}</span></div>`).join('')}</div>
        </div>`;
        el.querySelector('#sw-toggle').onclick = () => { if(running){clearInterval(interval);running=false;}else{const start=Date.now()-ms;interval=setInterval(()=>{ms=Date.now()-start;el.querySelector('[style*="font-size:56px"]').textContent=fmt(ms);},10);running=true;}render();};
        el.querySelector('#sw-lap').onclick = () => { if(running){laps.unshift(ms);}else if(ms>0){ms=0;laps=[];}render();};
      }
      render();
    }
  });
}
