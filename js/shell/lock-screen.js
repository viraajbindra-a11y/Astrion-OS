// NOVA OS — Lock Screen & Shutdown/Restart

export function initLockScreen() {
  // Cmd+L or Ctrl+L to lock
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      lockScreen();
    }
  });
}

export function lockScreen() {
  const existing = document.getElementById('lock-overlay');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'lock-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99998;
    background:#2e2e5e;
    background-image:
      radial-gradient(ellipse at 20% 50%, rgba(160,80,240,0.55) 0%, transparent 55%),
      radial-gradient(ellipse at 80% 20%, rgba(60,140,255,0.5) 0%, transparent 50%),
      radial-gradient(ellipse at 60% 85%, rgba(220,60,160,0.4) 0%, transparent 50%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    animation:fadeIn 0.4s ease;
  `;

  const now = new Date();
  const userName = localStorage.getItem('nova-username') || 'User';

  overlay.innerHTML = `
    <div style="font-size:64px;font-weight:600;margin-bottom:4px;">${now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true})}</div>
    <div style="font-size:17px;color:rgba(255,255,255,0.6);margin-bottom:40px;">${now.toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'})}</div>
    <div style="margin-bottom:12px;">
      <svg width="64" height="64" viewBox="0 0 80 80" fill="none">
        <circle cx="40" cy="40" r="38" fill="rgba(255,255,255,0.15)"/>
        <circle cx="40" cy="32" r="12" fill="rgba(255,255,255,0.6)"/>
        <ellipse cx="40" cy="60" rx="20" ry="14" fill="rgba(255,255,255,0.6)"/>
      </svg>
    </div>
    <div style="font-size:17px;font-weight:500;margin-bottom:14px;">${userName}</div>
    <input type="password" id="lock-password" placeholder="Enter Password" style="
      width:200px;padding:8px 14px;background:rgba(255,255,255,0.12);
      border:1px solid rgba(255,255,255,0.2);border-radius:20px;
      color:white;font-size:14px;font-family:var(--font);outline:none;text-align:center;
    " autofocus>
    <div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,0.3);">Press Enter to unlock</div>
  `;

  document.body.appendChild(overlay);

  const input = overlay.querySelector('#lock-password');
  input.focus();

  // Update time
  const timer = setInterval(() => {
    const el = document.getElementById('lock-overlay');
    if (!el) { clearInterval(timer); return; }
    const n = new Date();
    el.querySelector('div').textContent = n.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true});
  }, 1000);

  // Unlock on Enter or click
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlock(overlay, timer);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) input.focus();
  });
}

function unlock(overlay, timer) {
  clearInterval(timer);
  overlay.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  overlay.style.opacity = '0';
  overlay.style.transform = 'scale(1.05)';
  setTimeout(() => overlay.remove(), 400);
}

export function showShutdownDialog() {
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    animation:fadeIn 0.2s ease;
  `;
  dialog.innerHTML = `
    <div style="background:rgba(40,40,44,0.95);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:24px 32px;text-align:center;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="font-size:16px;font-weight:600;margin-bottom:8px;">Shut Down</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:20px;">Are you sure you want to shut down your computer?</div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button id="sd-cancel" style="background:rgba(255,255,255,0.1);border:none;color:white;padding:8px 20px;border-radius:8px;font-size:13px;font-family:var(--font);cursor:pointer;">Cancel</button>
        <button id="sd-restart" style="background:rgba(255,255,255,0.1);border:none;color:white;padding:8px 20px;border-radius:8px;font-size:13px;font-family:var(--font);cursor:pointer;">Restart</button>
        <button id="sd-shutdown" style="background:var(--accent);border:none;color:white;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;">Shut Down</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  dialog.querySelector('#sd-cancel').addEventListener('click', () => dialog.remove());
  dialog.querySelector('#sd-restart').addEventListener('click', () => {
    dialog.remove();
    doShutdown('Restarting...');
  });
  dialog.querySelector('#sd-shutdown').addEventListener('click', () => {
    dialog.remove();
    doShutdown('Shutting Down...');
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
}

function doShutdown(message) {
  const screen = document.createElement('div');
  screen.style.cssText = `position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeIn 0.5s ease;`;
  screen.innerHTML = `
    <svg width="60" height="60" viewBox="0 0 80 80" fill="none" style="margin-bottom:16px;opacity:0.6;">
      <circle cx="40" cy="40" r="36" stroke="white" stroke-width="2"/>
      <path d="M28 40 L40 28 L52 40 L40 52 Z" fill="white"/>
      <circle cx="40" cy="40" r="6" fill="white"/>
    </svg>
    <div style="font-size:16px;color:rgba(255,255,255,0.6);">${message}</div>
  `;
  document.body.appendChild(screen);

  setTimeout(() => {
    if (message.includes('Restart')) {
      location.reload();
    } else {
      screen.innerHTML = `<div style="font-size:14px;color:rgba(255,255,255,0.3);">NOVA OS has shut down.<br><br>Close this tab or click to restart.</div>`;
      screen.addEventListener('click', () => location.reload());
    }
  }, 2000);
}
