// Astrion OS — Password Generator
import { processManager } from '../kernel/process-manager.js';
export function registerPasswordGen() {
  processManager.register('password-gen', { name: 'Password Gen', icon: '\uD83D\uDD11', singleInstance: true, width: 420, height: 400,
    launch: (el) => {
      let len=20,upper=true,lower=true,digits=true,symbols=true;
      function gen(){let c='';if(lower)c+='abcdefghijkmnpqrstuvwxyz';if(upper)c+='ABCDEFGHJKLMNPQRSTUVWXYZ';if(digits)c+='23456789';if(symbols)c+='!@#$%^&*-_=+?';if(!c)c='abcdefghijklmnopqrstuvwxyz';const b=crypto.getRandomValues(new Uint8Array(len));let r='';for(const x of b)r+=c[x%c.length];return r;}
      function render(){const pw=gen();const strength=len>=16&&upper&&lower&&digits&&symbols?'Strong':len>=12?'Good':'Weak';const sColor=strength==='Strong'?'#34c759':strength==='Good'?'#ff9500':'#ff3b30';
        el.innerHTML=`<div style="display:flex;flex-direction:column;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:20px;gap:16px;">
          <div style="font-size:16px;font-weight:600;text-align:center;">Password Generator</div>
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-family:monospace;font-size:18px;word-break:break-all;line-height:1.6;margin-bottom:8px;">${pw}</div>
            <div style="font-size:11px;color:${sColor};font-weight:600;">${strength}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="pg-copy" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:13px;cursor:pointer;font-family:var(--font);font-weight:500;">Copy</button>
            <button id="pg-regen" style="flex:1;padding:10px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:13px;cursor:pointer;font-family:var(--font);">Regenerate</button>
          </div>
          <div><div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;">Length: ${len}</div><input type="range" id="pg-len" min="8" max="64" value="${len}" style="width:100%;"></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${[['upper','A-Z',upper],['lower','a-z',lower],['digits','0-9',digits],['symbols','!@#',symbols]].map(([k,l,v])=>
              `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" class="pg-opt" data-k="${k}" ${v?'checked':''} style="accent-color:var(--accent);">${l}</label>`
            ).join('')}
          </div>
        </div>`;
        el.querySelector('#pg-copy').onclick=()=>{navigator.clipboard.writeText(pw);el.querySelector('#pg-copy').textContent='Copied!';setTimeout(render,1000);};
        el.querySelector('#pg-regen').onclick=render;
        el.querySelector('#pg-len').oninput=(e)=>{len=parseInt(e.target.value);render();};
        el.querySelectorAll('.pg-opt').forEach(cb=>cb.onchange=(e)=>{const k=e.target.dataset.k;if(k==='upper')upper=e.target.checked;if(k==='lower')lower=e.target.checked;if(k==='digits')digits=e.target.checked;if(k==='symbols')symbols=e.target.checked;render();});
      }render();
    }
  });
}
