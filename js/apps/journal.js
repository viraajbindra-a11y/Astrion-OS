// Astrion OS — Journal (daily diary)
import { processManager } from '../kernel/process-manager.js';
const KEY='nova-journal';
export function registerJournal() {
  processManager.register('journal', { name: 'Journal', icon: '\uD83D\uDCD3', singleInstance: true, width: 600, height: 500,
    launch: (el) => {
      function getEntries(){try{return JSON.parse(localStorage.getItem(KEY))||{};}catch{return {};}}
      function save(e){localStorage.setItem(KEY,JSON.stringify(e));}
      const today=new Date().toISOString().split('T')[0];
      let selectedDate=today;
      function render(){
        const entries=getEntries();const dates=Object.keys(entries).sort().reverse();
        el.innerHTML=`<div style="display:flex;height:100%;font-family:var(--font);color:white;background:#1a1a22;">
          <div style="width:200px;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;">
            <div style="padding:12px;font-size:14px;font-weight:600;">Journal</div>
            <button id="j-today" style="margin:0 10px 8px;padding:8px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:11px;cursor:pointer;font-family:var(--font);">Today</button>
            <div style="flex:1;overflow-y:auto;">${dates.map(d=>`<div class="j-date" data-d="${d}" style="padding:8px 14px;cursor:pointer;font-size:12px;background:${d===selectedDate?'rgba(0,122,255,0.15)':'transparent'};"><div style="font-weight:500;">${new Date(d+'T12:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div><div style="font-size:10px;color:rgba(255,255,255,0.4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(entries[d]||'').slice(0,40)}</div></div>`).join('')}</div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;padding:16px;">
            <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:8px;">${new Date(selectedDate+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div>
            <textarea id="j-text" style="flex:1;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;color:white;font-size:14px;font-family:var(--font);resize:none;outline:none;line-height:1.7;" placeholder="What's on your mind today?">${entries[selectedDate]||''}</textarea>
          </div>
        </div>`;
        el.querySelector('#j-today').onclick=()=>{selectedDate=today;render();};
        el.querySelectorAll('.j-date').forEach(d=>d.onclick=()=>{selectedDate=d.dataset.d;render();});
        el.querySelector('#j-text').oninput=(e)=>{const entries=getEntries();entries[selectedDate]=e.target.value;save(entries);};
        // Auto-create today if not exists
        if(!entries[today]){entries[today]='';save(entries);}
      }
      render();
    }
  });
}
