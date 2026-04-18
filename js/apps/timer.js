// Astrion OS — Timer
import { processManager } from '../kernel/process-manager.js';
import { notifications } from '../kernel/notifications.js';
import { sounds } from '../kernel/sound.js';
export function registerTimer() {
  processManager.register('timer-app', { name: 'Timer', icon: '\u23F2\uFE0F', singleInstance: true, width: 360, height: 400,
    launch: (el) => {
      let totalSec = 300, remaining = 300, running = false, interval = null;
      function fmt(s) { const m = Math.floor(s/60), sec = s%60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; }
      function render() {
        const pct = totalSec > 0 ? remaining / totalSec : 0;
        el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:24px;">
          <div style="position:relative;width:180px;height:180px;margin-bottom:20px;">
            <svg width="180" height="180" viewBox="0 0 180 180" style="transform:rotate(-90deg);"><circle cx="90" cy="90" r="80" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/><circle cx="90" cy="90" r="80" fill="none" stroke="${remaining<=10?'#ff3b30':'var(--accent)'}" stroke-width="8" stroke-dasharray="${2*Math.PI*80}" stroke-dashoffset="${2*Math.PI*80*(1-pct)}" stroke-linecap="round"/></svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:200;font-variant-numeric:tabular-nums;">${fmt(remaining)}</div>
          </div>
          ${!running && remaining === totalSec ? `<div style="display:flex;gap:8px;margin-bottom:16px;">${[1,2,3,5,10,15,25,30].map(m=>`<button class="tm-pre" data-m="${m}" style="padding:6px 10px;border-radius:8px;border:none;background:${totalSec===m*60?'var(--accent)':'rgba(255,255,255,0.06)'};color:white;font-size:11px;cursor:pointer;font-family:var(--font);">${m}m</button>`).join('')}</div>` : ''}
          <div style="display:flex;gap:12px;">
            <button id="tm-toggle" style="padding:12px 28px;border-radius:12px;border:none;background:${running?'#ff3b30':'var(--accent)'};color:white;font-size:14px;font-weight:600;cursor:pointer;font-family:var(--font);">${running?'Pause':'Start'}</button>
            <button id="tm-reset" style="padding:12px 20px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:rgba(255,255,255,0.6);font-size:14px;cursor:pointer;font-family:var(--font);">Reset</button>
          </div>
        </div>`;
        el.querySelectorAll('.tm-pre').forEach(b=>b.onclick=()=>{totalSec=parseInt(b.dataset.m)*60;remaining=totalSec;render();});
        el.querySelector('#tm-toggle').onclick=()=>{if(running){clearInterval(interval);running=false;}else{interval=setInterval(()=>{remaining--;if(remaining<=0){clearInterval(interval);running=false;sounds.notification();notifications.show({title:'Timer done!',body:`${Math.round(totalSec/60)} minute timer finished.`,icon:'\u23F2\uFE0F'});remaining=0;}render();},1000);running=true;}render();};
        el.querySelector('#tm-reset').onclick=()=>{clearInterval(interval);running=false;remaining=totalSec;render();};
      }
      render();
      // Cleanup on window close — prevents timer leak
      const _obs = new MutationObserver(() => {
        if (!el.isConnected) { clearInterval(interval); _obs.disconnect(); }
      });
      if (el.parentElement) _obs.observe(el.parentElement, { childList: true, subtree: true });
    }
  });
}
