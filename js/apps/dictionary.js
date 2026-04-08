// Astrion OS — Dictionary
import { processManager } from '../kernel/process-manager.js';
export function registerDictionary() {
  processManager.register('dictionary', { name: 'Dictionary', icon: '\uD83D\uDCD6', singleInstance: true, width: 550, height: 480,
    launch: (el) => {
      el.innerHTML=`<div style="display:flex;flex-direction:column;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:20px;gap:16px;">
        <div style="font-size:16px;font-weight:600;">Dictionary</div>
        <input type="text" id="dict-input" placeholder="Look up a word..." autofocus style="padding:12px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:15px;font-family:var(--font);outline:none;">
        <div id="dict-result" style="flex:1;overflow-y:auto;color:rgba(255,255,255,0.6);font-size:13px;line-height:1.7;">Type a word and press Enter</div>
      </div>`;
      const input=el.querySelector('#dict-input'),result=el.querySelector('#dict-result');
      input.onkeydown=async(e)=>{if(e.key!=='Enter')return;const w=input.value.trim();if(!w)return;
        result.innerHTML='<div style="color:rgba(255,255,255,0.4);">Looking up...</div>';
        try{const r=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
          if(!r.ok){result.innerHTML=`<div style="font-size:18px;margin-bottom:8px;">\uD83E\uDD14</div><div>No definition found for "<strong>${w}</strong>"</div>`;return;}
          const data=await r.json();const entry=data[0];
          result.innerHTML=`<div style="font-size:24px;font-weight:600;color:white;margin-bottom:4px;">${entry.word}</div>
            ${entry.phonetic?`<div style="font-size:14px;color:var(--accent);margin-bottom:12px;">${entry.phonetic}</div>`:''}
            ${entry.meanings.map(m=>`<div style="margin-bottom:16px;">
              <div style="font-size:12px;font-weight:600;color:#ff9500;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${m.partOfSpeech}</div>
              ${m.definitions.slice(0,3).map((d,i)=>`<div style="margin-bottom:8px;"><span style="color:rgba(255,255,255,0.3);">${i+1}.</span> ${d.definition}${d.example?`<div style="color:rgba(255,255,255,0.4);font-style:italic;margin-top:2px;">"${d.example}"</div>`:''}</div>`).join('')}
            </div>`).join('')}`;
        }catch{result.innerHTML='<div>Could not look up word. Check your internet connection.</div>';}
      };
    }
  });
}
