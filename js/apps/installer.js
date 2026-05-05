// NOVA OS — Graphical Installer
// Launches nova-install in a terminal — the actual install logic is in bash
// because partitioning / mkfs / grub-install need root shell tools.

import { processManager } from '../kernel/process-manager.js';
import { notifications } from '../kernel/notifications.js';

export function registerInstaller() {
  processManager.register('installer', {
    name: 'Install Astrion OS',
    icon: '\uD83D\uDCBF',
    singleInstance: true,
    width: 560,
    height: 520,
    launch: (contentEl) => initInstaller(contentEl),
  });
}

function initInstaller(container) {
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100%; font-family:var(--font); color:white; background:linear-gradient(180deg, rgba(20,20,40,0.6), rgba(10,10,20,0.8)); padding:40px; box-sizing:border-box; text-align:center;">

      <div style="font-size:72px; margin-bottom:12px;">\uD83D\uDCBF</div>
      <h1 style="font-size:24px; font-weight:700; margin:0 0 6px 0;">Install Astrion OS</h1>
      <p style="font-size:13px; color:rgba(255,255,255,0.55); margin:0 0 28px 0;">
        Put Astrion OS permanently on your computer.
      </p>

      <div style="flex:1; text-align:left; background:rgba(255,255,255,0.04); border-radius:12px; padding:20px 24px; font-size:12px; line-height:1.7; color:rgba(255,255,255,0.75);">
        <div style="font-weight:600; color:white; margin-bottom:10px;">Before you start:</div>
        <div>\u2022 <strong style="color:white;">Back up your data</strong> \u2014 the target disk will be erased</div>
        <div>\u2022 Make sure your laptop is <strong style="color:white;">plugged in</strong></div>
        <div>\u2022 You'll need at least <strong style="color:white;">20 GB</strong> of disk space</div>
        <div>\u2022 The install takes <strong style="color:white;">5\u201310 minutes</strong></div>

        <div style="font-weight:600; color:white; margin:18px 0 10px 0;">How it works:</div>
        <div>1. Pick a disk to install to</div>
        <div>2. Create a user account + password</div>
        <div>3. Astrion copies itself, sets up GRUB, reboots</div>
        <div>4. Remove the USB drive and you're in!</div>
      </div>

      <div style="display:flex; gap:10px; margin-top:24px;">
        <button id="install-cancel" style="flex:1; padding:12px; background:rgba(255,255,255,0.08); border:none; color:white; border-radius:10px; font-size:13px; font-family:var(--font); cursor:pointer;">Not Now</button>
        <button id="install-start" style="flex:2; padding:12px; background:var(--accent); border:none; color:white; border-radius:10px; font-size:13px; font-weight:600; font-family:var(--font); cursor:pointer;">Install Astrion OS</button>
      </div>

      <div style="margin-top:16px; font-size:10px; color:rgba(255,255,255,0.35);">
        Installer runs in a Terminal so you can see every step.
      </div>
    </div>
  `;

  container.querySelector('#install-cancel').addEventListener('click', () => {
    const winId = Object.keys(Object.fromEntries(window.__nova_wm__?.windows || new Map())).find(() => true);
    // Close by finding our window
    const w = document.querySelector('.window[data-window-id]:has(#install-start)');
    if (w) w.querySelector('.win-btn.close')?.click();
  });

  container.querySelector('#install-start').addEventListener('click', async () => {
    // Launch Terminal and run the installer
    processManager.launch('terminal', { initialCommand: 'sudo nova-install' });
    notifications.show({
      title: 'Installer launched',
      body: 'Follow the instructions in the Terminal window.',
      icon: '\uD83D\uDCBF',
      duration: 4000,
    });
  });
}
