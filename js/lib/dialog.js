// Astrion OS — Custom Dialog (replaces alert/prompt)
// alert() and prompt() are blocked in WebKitGTK (lesson #16).
// These functions show inline modal dialogs instead.

export function showAlert(message, container) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
    overlay.innerHTML = `
      <div style="background:#1e1e2e;border:1px solid rgba(255,255,255,0.1);padding:24px;border-radius:16px;max-width:360px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,0.5);">
        <div style="color:white;font-size:14px;line-height:1.6;margin-bottom:16px;font-family:var(--font,system-ui);">${message}</div>
        <button style="padding:8px 28px;border-radius:10px;border:none;background:var(--accent,#007aff);color:white;font-size:13px;font-weight:600;cursor:pointer;">OK</button>
      </div>`;
    (container || document.body).appendChild(overlay);
    overlay.querySelector('button').addEventListener('click', () => { overlay.remove(); resolve(); });
    overlay.querySelector('button').focus();
  });
}

export function showPrompt(message, defaultValue, container) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
    overlay.innerHTML = `
      <div style="background:#1e1e2e;border:1px solid rgba(255,255,255,0.1);padding:24px;border-radius:16px;max-width:360px;box-shadow:0 16px 40px rgba(0,0,0,0.5);">
        <div style="color:white;font-size:14px;line-height:1.6;margin-bottom:12px;font-family:var(--font,system-ui);">${message}</div>
        <input type="text" value="${defaultValue || ''}" style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:white;font-size:14px;outline:none;margin-bottom:14px;font-family:var(--font,system-ui);">
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="dlg-cancel" style="padding:8px 20px;border-radius:10px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:13px;cursor:pointer;">Cancel</button>
          <button class="dlg-ok" style="padding:8px 20px;border-radius:10px;border:none;background:var(--accent,#007aff);color:white;font-size:13px;font-weight:600;cursor:pointer;">OK</button>
        </div>
      </div>`;
    (container || document.body).appendChild(overlay);
    const input = overlay.querySelector('input');
    input.focus();
    input.select();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') overlay.querySelector('.dlg-ok').click(); if (e.key === 'Escape') overlay.querySelector('.dlg-cancel').click(); });
    overlay.querySelector('.dlg-ok').addEventListener('click', () => { overlay.remove(); resolve(input.value); });
    overlay.querySelector('.dlg-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
  });
}

// Yes/No replacement for native confirm(). Resolves to true (OK) or false (Cancel).
// `destructive` styles the OK button red — use for delete confirmations.
export function showConfirm(message, container, destructive = false) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
    const okColor = destructive ? '#ff3b30' : 'var(--accent,#007aff)';
    overlay.innerHTML = `
      <div style="background:#1e1e2e;border:1px solid rgba(255,255,255,0.1);padding:24px;border-radius:16px;max-width:360px;box-shadow:0 16px 40px rgba(0,0,0,0.5);">
        <div style="color:white;font-size:14px;line-height:1.6;margin-bottom:18px;font-family:var(--font,system-ui);">${message}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="dlg-cancel" style="padding:8px 20px;border-radius:10px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:13px;cursor:pointer;">Cancel</button>
          <button class="dlg-ok" style="padding:8px 20px;border-radius:10px;border:none;background:${okColor};color:white;font-size:13px;font-weight:600;cursor:pointer;">${destructive ? 'Delete' : 'OK'}</button>
        </div>
      </div>`;
    (container || document.body).appendChild(overlay);
    const okBtn = overlay.querySelector('.dlg-ok');
    okBtn.focus();
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') okBtn.click();
      if (e.key === 'Escape') overlay.querySelector('.dlg-cancel').click();
    });
    okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.querySelector('.dlg-cancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
  });
}
