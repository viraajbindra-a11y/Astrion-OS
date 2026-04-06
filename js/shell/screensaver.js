// Astrion OS — Screensaver
// Activates after idle time. Shows a floating clock over a starfield.
// Any mouse/keyboard input dismisses it.

const SCREENSAVER_KEY = 'nova-screensaver-timeout';
const DEFAULT_TIMEOUT = 5; // minutes

let overlay = null;
let animFrame = null;
let lastActivity = Date.now();
let checkInterval = null;
let active = false;

export function initScreensaver() {
  // Track REAL user activity (only events with isTrusted = true)
  const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'];
  events.forEach(evt => {
    document.addEventListener(evt, (e) => {
      if (e.isTrusted) {
        lastActivity = Date.now();
        if (active) dismiss();
      }
    }, { passive: true });
  });

  // Check every 10s
  checkInterval = setInterval(checkIdle, 10000);
  console.log('[Screensaver] Initialized, timeout:', localStorage.getItem(SCREENSAVER_KEY) || DEFAULT_TIMEOUT, 'min');
}

function checkIdle() {
  if (active) return;
  const timeout = parseInt(localStorage.getItem(SCREENSAVER_KEY) || String(DEFAULT_TIMEOUT));
  if (timeout <= 0) return;

  const idleMin = (Date.now() - lastActivity) / 60000;
  if (idleMin >= timeout) activate();
}

function activate() {
  if (active) return;
  active = true;

  overlay = document.createElement('div');
  overlay.id = 'screensaver';
  overlay.style.cssText = `
    position:fixed; top:0; left:0; width:100vw; height:100vh;
    z-index:99990; background:#000; cursor:none;
    animation: ssFadeIn 1s ease;
  `;

  // Canvas for starfield
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%;';
  overlay.appendChild(canvas);

  // Floating clock
  const clock = document.createElement('div');
  clock.id = 'ss-clock';
  clock.style.cssText = `
    position:absolute; z-index:2;
    font-family:var(--font); color:white; text-align:center;
    transition: transform 8s ease-in-out;
  `;
  overlay.appendChild(clock);

  if (!document.getElementById('ss-styles')) {
    const s = document.createElement('style');
    s.id = 'ss-styles';
    s.textContent = '@keyframes ssFadeIn { from { opacity:0; } to { opacity:1; } }';
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);

  // Init canvas
  const ctx = canvas.getContext('2d');
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  // Stars
  const stars = [];
  for (let i = 0; i < 200; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.3,
      speed: Math.random() * 0.3 + 0.05,
      brightness: Math.random(),
      twinkleSpeed: Math.random() * 0.02 + 0.005,
    });
  }

  let clockX = Math.random() * (canvas.width - 300) + 100;
  let clockY = Math.random() * (canvas.height - 200) + 100;
  let clockDx = (Math.random() - 0.5) * 0.3;
  let clockDy = (Math.random() - 0.5) * 0.2;

  function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    clock.innerHTML = `
      <div style="font-size:64px; font-weight:200; letter-spacing:-2px; text-shadow:0 0 40px rgba(0,122,255,0.3);">${time}</div>
      <div style="font-size:16px; color:rgba(255,255,255,0.5); margin-top:4px;">${date}</div>
    `;
  }

  function frame() {
    if (!active) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw stars
    for (const star of stars) {
      star.brightness += star.twinkleSpeed;
      const alpha = 0.3 + Math.abs(Math.sin(star.brightness)) * 0.7;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();

      // Slow drift
      star.y += star.speed;
      if (star.y > canvas.height) {
        star.y = 0;
        star.x = Math.random() * canvas.width;
      }
    }

    // Occasional shooting star
    if (Math.random() < 0.003) {
      const sx = Math.random() * canvas.width;
      const sy = Math.random() * canvas.height * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 80, sy + 30);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Move clock
    clockX += clockDx;
    clockY += clockDy;
    if (clockX < 50 || clockX > canvas.width - 350) clockDx *= -1;
    if (clockY < 50 || clockY > canvas.height - 150) clockDy *= -1;
    clock.style.left = clockX + 'px';
    clock.style.top = clockY + 'px';

    animFrame = requestAnimationFrame(frame);
  }

  updateClock();
  setInterval(updateClock, 1000);
  frame();
}

function dismiss() {
  if (!active) return;
  active = false;
  lastActivity = Date.now();

  if (animFrame) cancelAnimationFrame(animFrame);
  if (overlay) {
    overlay.style.animation = 'ssFadeIn 0.5s reverse';
    setTimeout(() => { overlay?.remove(); overlay = null; }, 500);
  }
}

export function setScreensaverTimeout(minutes) {
  localStorage.setItem(SCREENSAVER_KEY, String(minutes));
}

export function getScreensaverTimeout() {
  return parseInt(localStorage.getItem(SCREENSAVER_KEY) || String(DEFAULT_TIMEOUT));
}

// Manual trigger
export function triggerScreensaver() {
  activate();
}
