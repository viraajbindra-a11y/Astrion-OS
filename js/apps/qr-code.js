// Astrion OS — QR Code Generator
import { processManager } from '../kernel/process-manager.js';
export function registerQrCode() {
  processManager.register('qr-code', { name: 'QR Code', icon: '\uD83D\uDCF2', singleInstance: true, width: 400, height: 460,
    launch: (el) => {
      function render(text) {
        el.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:20px;gap:16px;">
          <div style="font-size:16px;font-weight:600;">QR Code Generator</div>
          <input type="text" id="qr-input" value="${text||''}" placeholder="Enter text or URL..." style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box;">
          <div id="qr-display" style="background:white;padding:16px;border-radius:12px;display:flex;align-items:center;justify-content:center;min-height:200px;min-width:200px;">
            ${text ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}" alt="QR Code" style="width:200px;height:200px;">` : '<div style="color:#999;font-size:13px;">Enter text above</div>'}
          </div>
          <button id="qr-gen" style="padding:10px 24px;border-radius:10px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);">Generate</button>
          <div style="font-size:10px;color:rgba(255,255,255,0.3);">Powered by goqr.me API</div>
        </div>`;
        el.querySelector('#qr-gen').onclick=()=>render(el.querySelector('#qr-input').value);
        el.querySelector('#qr-input').onkeydown=(e)=>{if(e.key==='Enter')render(el.querySelector('#qr-input').value);};
      }
      render('');
    }
  });
}
