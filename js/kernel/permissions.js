// NOVA OS — App Permission System
// Apps call permissions.request(appId, 'camera') and get a system-style prompt
// before they can use sensitive APIs. Decisions are remembered in localStorage.

const STORAGE_KEY = 'nova-permissions';

const PERMISSION_META = {
  camera:       { label: 'Camera',              icon: '\uD83D\uDCF7', desc: 'take photos and record video' },
  microphone:   { label: 'Microphone',          icon: '\uD83C\uDFA4', desc: 'record audio from your microphone' },
  location:     { label: 'Location',            icon: '\uD83D\uDCCD', desc: 'access your approximate location' },
  notifications:{ label: 'Notifications',       icon: '\uD83D\uDD14', desc: 'send you notifications' },
  clipboard:    { label: 'Clipboard',           icon: '\uD83D\uDCCB', desc: 'read and write your clipboard' },
  files:        { label: 'All Files',           icon: '\uD83D\uDCC1', desc: 'read any file in your Astrion file system' },
  network:      { label: 'Network',             icon: '\uD83C\uDF10', desc: 'make network requests to any site' },
  contacts:     { label: 'Contacts',            icon: '\uD83D\uDC65', desc: 'access your contacts' },
  calendar:     { label: 'Calendar',            icon: '\uD83D\uDCC5', desc: 'read and modify your calendar' },
  screen:       { label: 'Screen Recording',    icon: '\uD83D\uDDA5\uFE0F', desc: 'capture your screen' },
};

class PermissionManager {
  constructor() {
    this.grants = this._load();
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.grants));
  }

  /** Check current permission state without prompting. Returns 'granted', 'denied', or 'prompt'. */
  check(appId, permission) {
    return this.grants[`${appId}:${permission}`] || 'prompt';
  }

  /** Request a permission. Shows a system prompt if decision hasn't been made. */
  async request(appId, permission, appName) {
    const key = `${appId}:${permission}`;
    const existing = this.grants[key];
    if (existing === 'granted') return true;
    if (existing === 'denied') return false;

    // Prompt user
    const granted = await this._showPrompt(appId, permission, appName);
    this.grants[key] = granted ? 'granted' : 'denied';
    this._save();
    return granted;
  }

  /** Revoke a permission (e.g., from Settings > Privacy). */
  revoke(appId, permission) {
    delete this.grants[`${appId}:${permission}`];
    this._save();
  }

  /** List all current grants. */
  list() {
    return Object.entries(this.grants).map(([key, state]) => {
      const [appId, permission] = key.split(':');
      return { appId, permission, state };
    });
  }

  _showPrompt(appId, permission, appName) {
    return new Promise(resolve => {
      const meta = PERMISSION_META[permission] || { label: permission, icon: '\uD83D\uDD12', desc: `use ${permission}` };

      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        backdrop-filter: blur(4px); z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        animation: fadeIn 0.2s ease; font-family: var(--font);
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: rgba(38, 38, 44, 0.96);
        backdrop-filter: blur(30px);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 14px;
        width: 320px; padding: 22px;
        color: white; text-align: center;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      `;

      dialog.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 12px;">${meta.icon}</div>
        <div style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">
          Allow "${appName || appId}" to use ${meta.label}?
        </div>
        <div style="font-size: 12px; color: rgba(255,255,255,0.55); margin-bottom: 20px; line-height: 1.5;">
          This app wants to ${meta.desc}.
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="perm-deny" style="flex: 1; padding: 10px; background: rgba(255,255,255,0.08); border: none; color: white; border-radius: 8px; font-size: 13px; font-family: var(--font); cursor: pointer;">Don't Allow</button>
          <button id="perm-allow" style="flex: 1; padding: 10px; background: var(--accent); border: none; color: white; border-radius: 8px; font-size: 13px; font-weight: 500; font-family: var(--font); cursor: pointer;">Allow</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      dialog.querySelector('#perm-allow').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
      dialog.querySelector('#perm-deny').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
    });
  }
}

export const permissions = new PermissionManager();
export { PERMISSION_META };
