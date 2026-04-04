// NOVA OS — Setup Wizard (First Run Experience)
// Fullscreen, animated, multi-step onboarding

const wallpapers = [
  { id: 'gradient-purple', name: 'Aurora', colors: 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460, #533483)' },
  { id: 'gradient-blue', name: 'Ocean', colors: 'linear-gradient(135deg, #0c1445, #1a237e, #283593, #1565c0)' },
  { id: 'gradient-dark', name: 'Midnight', colors: 'linear-gradient(135deg, #0a0a0a, #1a1a1a, #2d2d2d, #1a1a1a)' },
  { id: 'gradient-sunset', name: 'Sunset', colors: 'linear-gradient(135deg, #1a0a2e, #4a1942, #7b2d5f, #b0413e)' },
  { id: 'gradient-forest', name: 'Forest', colors: 'linear-gradient(135deg, #0a1a0a, #1b3a1b, #2d5a2d, #1a3a2a)' },
  { id: 'gradient-space', name: 'Deep Space', colors: 'radial-gradient(ellipse at 30% 50%, #1a0533 0%, #0a0a1a 50%, #000000 100%)' },
];

const accents = [
  { color: '#007aff', name: 'Blue' },
  { color: '#5856d6', name: 'Purple' },
  { color: '#ff2d55', name: 'Pink' },
  { color: '#ff9500', name: 'Orange' },
  { color: '#28c840', name: 'Green' },
  { color: '#00bcd4', name: 'Teal' },
];

export function showSetupWizard() {
  return new Promise((resolve) => {
    if (localStorage.getItem('nova-setup-done')) {
      resolve();
      return;
    }

    let step = 0;
    const totalSteps = 6;
    let userName = '';
    let selectedWallpaper = 'gradient-purple';
    let selectedAccent = '#007aff';
    let selectedDockSize = 'medium';
    let aiEnabled = true;

    const wizard = document.createElement('div');
    wizard.id = 'setup-wizard';
    wizard.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;overflow:hidden;';

    document.body.appendChild(wizard);

    function render() {
      const progress = ((step + 1) / totalSteps) * 100;

      // Each step gets a unique background
      const stepBgs = [
        'radial-gradient(ellipse at 50% 40%, #1a1a4e 0%, #0a0a1e 70%)',
        'radial-gradient(ellipse at 30% 60%, #1a0a3e 0%, #0a0a1e 70%)',
        '',  // wallpaper step uses selected wallpaper
        'radial-gradient(ellipse at 70% 40%, #0a1a3e 0%, #0a0a1e 70%)',
        'radial-gradient(ellipse at 50% 50%, #1a1a2e 0%, #0a0a1e 70%)',
        'radial-gradient(ellipse at 50% 30%, #0a0a2e 0%, #000 70%)',
      ];

      let bg = step === 2 ? (wallpapers.find(w => w.id === selectedWallpaper)?.colors || stepBgs[0]) : stepBgs[step];

      wizard.innerHTML = `
        <div style="position:absolute;inset:0;background:${bg};transition:background 0.6s ease;"></div>
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:rgba(255,255,255,0.1);z-index:2;">
          <div style="height:100%;width:${progress}%;background:var(--accent);transition:width 0.4s ease;border-radius:0 2px 2px 0;"></div>
        </div>
        <div style="position:relative;z-index:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;">
          <div id="setup-content" style="max-width:560px;width:100%;animation:scaleIn 0.35s cubic-bezier(0.16,1,0.3,1);"></div>
          <div style="position:absolute;bottom:32px;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:16px;">
            ${step > 0 ? `<button id="setup-back" style="background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.6);padding:10px 24px;border-radius:10px;font-size:14px;font-family:var(--font);cursor:pointer;">Back</button>` : ''}
            <div style="display:flex;gap:6px;">
              ${Array.from({length: totalSteps}, (_, i) => `<div style="width:${i === step ? '24px' : '8px'};height:8px;border-radius:4px;background:${i === step ? 'var(--accent)' : i < step ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)'};transition:all 0.3s;"></div>`).join('')}
            </div>
            <button id="setup-next" style="background:var(--accent);border:none;color:white;padding:10px 32px;border-radius:10px;font-size:14px;font-weight:600;font-family:var(--font);cursor:pointer;min-width:120px;">${step === totalSteps - 1 ? 'Get Started' : 'Continue'}</button>
          </div>
        </div>
      `;

      const content = wizard.querySelector('#setup-content');
      renderStep(content);

      wizard.querySelector('#setup-next').addEventListener('click', next);
      const backBtn = wizard.querySelector('#setup-back');
      if (backBtn) backBtn.addEventListener('click', () => { step--; render(); });
    }

    function renderStep(el) {
      switch (step) {
        case 0: // Welcome
          el.innerHTML = `
            <div style="text-align:center;">
              <div style="margin-bottom:24px;">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style="filter:drop-shadow(0 0 20px rgba(0,122,255,0.4));">
                  <circle cx="40" cy="40" r="36" stroke="var(--accent)" stroke-width="2" opacity="0.8"/>
                  <path d="M28 40 L40 28 L52 40 L40 52 Z" fill="var(--accent)"/>
                  <circle cx="40" cy="40" r="6" fill="white"/>
                </svg>
              </div>
              <h1 style="font-size:36px;font-weight:700;margin-bottom:8px;letter-spacing:-0.5px;">Welcome to NOVA OS</h1>
              <p style="font-size:17px;color:rgba(255,255,255,0.5);margin-bottom:48px;">The AI-native operating system</p>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">
                <div style="background:rgba(255,255,255,0.05);border-radius:16px;padding:24px 12px;">
                  <div style="font-size:32px;margin-bottom:8px;">&#x2728;</div>
                  <div style="font-size:13px;font-weight:600;margin-bottom:4px;">AI Everywhere</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.4);">Built into every app</div>
                </div>
                <div style="background:rgba(255,255,255,0.05);border-radius:16px;padding:24px 12px;">
                  <div style="font-size:32px;margin-bottom:8px;">&#x1F4BB;</div>
                  <div style="font-size:13px;font-weight:600;margin-bottom:4px;">12+ Apps</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.4);">Everything you need</div>
                </div>
                <div style="background:rgba(255,255,255,0.05);border-radius:16px;padding:24px 12px;">
                  <div style="font-size:32px;margin-bottom:8px;">&#x1F6CD;&#xFE0F;</div>
                  <div style="font-size:13px;font-weight:600;margin-bottom:4px;">App Store</div>
                  <div style="font-size:11px;color:rgba(255,255,255,0.4);">AI skills & apps</div>
                </div>
              </div>
            </div>
          `;
          break;

        case 1: // Name
          el.innerHTML = `
            <div style="text-align:center;">
              <div style="font-size:56px;margin-bottom:16px;">&#x1F44B;</div>
              <h1 style="font-size:30px;font-weight:700;margin-bottom:8px;">What's your name?</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.45);margin-bottom:32px;">NOVA will use this to personalize your experience</p>
              <input type="text" id="setup-name" placeholder="Enter your name" value="${userName}"
                style="width:300px;padding:14px 20px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.12);border-radius:14px;color:white;font-size:18px;font-family:var(--font);outline:none;text-align:center;"
                autofocus>
              <div style="margin-top:12px;font-size:12px;color:rgba(255,255,255,0.3);">This shows on your lock screen and in the menubar</div>
            </div>
          `;
          const nameInput = el.querySelector('#setup-name');
          nameInput.addEventListener('focus', () => { nameInput.style.borderColor = 'var(--accent)'; });
          nameInput.addEventListener('blur', () => { nameInput.style.borderColor = 'rgba(255,255,255,0.12)'; });
          nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
          setTimeout(() => nameInput.focus(), 100);
          break;

        case 2: // Wallpaper
          el.innerHTML = `
            <div style="text-align:center;">
              <h1 style="font-size:30px;font-weight:700;margin-bottom:8px;">Choose your look</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.45);margin-bottom:28px;">Pick a wallpaper for your desktop</p>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                ${wallpapers.map(w => `
                  <div data-wp="${w.id}" style="aspect-ratio:16/10;border-radius:12px;background:${w.colors};cursor:pointer;border:3px solid ${w.id === selectedWallpaper ? 'var(--accent)' : 'transparent'};transition:border-color 0.2s,transform 0.15s;position:relative;overflow:hidden;"
                    onmouseenter="this.style.transform='scale(1.03)'" onmouseleave="this.style.transform='scale(1)'">
                    <div style="position:absolute;bottom:0;left:0;right:0;padding:6px 10px;background:linear-gradient(transparent,rgba(0,0,0,0.5));font-size:11px;color:rgba(255,255,255,0.8);text-align:left;">${w.name}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
          el.querySelectorAll('[data-wp]').forEach(opt => {
            opt.addEventListener('click', () => {
              selectedWallpaper = opt.dataset.wp;
              el.querySelectorAll('[data-wp]').forEach(e => e.style.borderColor = 'transparent');
              opt.style.borderColor = 'var(--accent)';
              // Live update background
              const wp = wallpapers.find(w => w.id === selectedWallpaper);
              if (wp) wizard.querySelector('div').style.background = wp.colors;
            });
          });
          break;

        case 3: // Accent color
          el.innerHTML = `
            <div style="text-align:center;">
              <h1 style="font-size:30px;font-weight:700;margin-bottom:8px;">Pick your color</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.45);margin-bottom:32px;">This accent color is used throughout NOVA OS</p>
              <div style="display:flex;justify-content:center;gap:16px;margin-bottom:36px;">
                ${accents.map(a => `
                  <div data-color="${a.color}" style="width:48px;height:48px;border-radius:50%;background:${a.color};cursor:pointer;border:4px solid ${a.color === selectedAccent ? 'white' : 'transparent'};transition:all 0.2s;box-shadow:0 4px 12px rgba(0,0,0,0.3);"
                    onmouseenter="this.style.transform='scale(1.15)'" onmouseleave="this.style.transform='scale(1)'"
                    title="${a.name}"></div>
                `).join('')}
              </div>
              <div style="display:flex;justify-content:center;gap:12px;">
                <div style="background:var(--accent);color:white;padding:10px 28px;border-radius:10px;font-size:14px;font-weight:600;">Button</div>
                <div style="background:rgba(255,255,255,0.06);border:2px solid var(--accent);color:var(--accent);padding:10px 28px;border-radius:10px;font-size:14px;font-weight:600;">Outline</div>
                <div style="background:rgba(255,255,255,0.06);color:var(--accent);padding:10px 28px;border-radius:10px;font-size:14px;">Link style</div>
              </div>
            </div>
          `;
          el.querySelectorAll('[data-color]').forEach(opt => {
            opt.addEventListener('click', () => {
              selectedAccent = opt.dataset.color;
              el.querySelectorAll('[data-color]').forEach(e => e.style.borderColor = 'transparent');
              opt.style.borderColor = 'white';
              document.documentElement.style.setProperty('--accent', selectedAccent);
              render(); // re-render to update preview buttons
            });
          });
          break;

        case 4: // Features tour
          el.innerHTML = `
            <div style="text-align:center;">
              <h1 style="font-size:30px;font-weight:700;margin-bottom:8px;">Quick tips</h1>
              <p style="font-size:15px;color:rgba(255,255,255,0.45);margin-bottom:28px;">Here's how to get the most out of NOVA OS</p>
              <div style="display:flex;flex-direction:column;gap:12px;text-align:left;">
                <div style="display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.05);border-radius:14px;padding:16px 20px;">
                  <div style="font-size:28px;width:44px;text-align:center;">&#x1F50D;</div>
                  <div>
                    <div style="font-size:14px;font-weight:600;">Spotlight AI</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:2px;">Press <kbd style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:11px;">Cmd+Space</kbd> to search, launch apps, or ask AI anything</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.05);border-radius:14px;padding:16px 20px;">
                  <div style="font-size:28px;width:44px;text-align:center;">&#x1F3AF;</div>
                  <div>
                    <div style="font-size:14px;font-weight:600;">Launchpad</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:2px;">Press <kbd style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:11px;">F4</kbd> to see all your apps in a grid</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.05);border-radius:14px;padding:16px 20px;">
                  <div style="font-size:28px;width:44px;text-align:center;">&#x1F4F6;</div>
                  <div>
                    <div style="font-size:14px;font-weight:600;">Control Center</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:2px;">Click the Wi-Fi or battery icon for quick settings</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.05);border-radius:14px;padding:16px 20px;">
                  <div style="font-size:28px;width:44px;text-align:center;">&#x1F5B1;&#xFE0F;</div>
                  <div>
                    <div style="font-size:14px;font-weight:600;">Window Snapping</div>
                    <div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:2px;">Drag windows to screen edges to snap them into place</div>
                  </div>
                </div>
              </div>
            </div>
          `;
          break;

        case 5: // Ready
          el.innerHTML = `
            <div style="text-align:center;">
              <div style="font-size:72px;margin-bottom:20px;animation:dockBounce 0.8s ease;">&#x1F680;</div>
              <h1 style="font-size:34px;font-weight:700;margin-bottom:8px;">You're all set${userName ? ', ' + userName : ''}!</h1>
              <p style="font-size:17px;color:rgba(255,255,255,0.5);margin-bottom:36px;">NOVA OS is ready for you</p>
              <div style="display:inline-flex;flex-direction:column;gap:8px;text-align:left;">
                <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:rgba(255,255,255,0.6);">
                  <span style="color:var(--accent);">&#x2713;</span> Desktop customized
                </div>
                <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:rgba(255,255,255,0.6);">
                  <span style="color:var(--accent);">&#x2713;</span> ${Object.keys(wallpapers).length > 0 ? 'Wallpaper selected' : 'Default wallpaper'}
                </div>
                <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:rgba(255,255,255,0.6);">
                  <span style="color:var(--accent);">&#x2713;</span> Accent color applied
                </div>
                <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:rgba(255,255,255,0.6);">
                  <span style="color:var(--accent);">&#x2713;</span> 12 apps ready to use
                </div>
                <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:rgba(255,255,255,0.6);">
                  <span style="color:var(--accent);">&#x2713;</span> AI assistant standing by
                </div>
              </div>
            </div>
          `;
          break;
      }
    }

    function next() {
      // Save data from current step
      if (step === 1) {
        const nameInput = wizard.querySelector('#setup-name');
        if (nameInput) userName = nameInput.value.trim() || '';
      }

      if (step >= totalSteps - 1) {
        finish();
      } else {
        step++;
        render();
      }
    }

    function finish() {
      localStorage.setItem('nova-setup-done', 'true');
      localStorage.setItem('nova-username', userName || 'User');
      localStorage.setItem('nova-wallpaper', selectedWallpaper);
      localStorage.setItem('nova-accent', selectedAccent);

      const wp = wallpapers.find(w => w.id === selectedWallpaper);
      if (wp) {
        const desktop = document.getElementById('desktop');
        if (desktop) desktop.style.backgroundImage = wp.colors;
      }
      document.documentElement.style.setProperty('--accent', selectedAccent);

      wizard.style.transition = 'opacity 0.6s ease';
      wizard.style.opacity = '0';
      setTimeout(() => {
        wizard.remove();
        resolve();
      }, 600);
    }

    render();
  });
}
