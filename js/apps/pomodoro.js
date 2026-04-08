// Astrion OS — Pomodoro Timer
// 25 min work / 5 min break cycle with notifications.

import { processManager } from '../kernel/process-manager.js';
import { notifications } from '../kernel/notifications.js';
import { sounds } from '../kernel/sound.js';

export function registerPomodoro() {
  processManager.register('pomodoro', {
    name: 'Pomodoro',
    icon: '\uD83C\uDF45',
    singleInstance: true,
    width: 380,
    height: 480,
    launch: (contentEl) => initPomodoro(contentEl),
  });
}

function initPomodoro(container) {
  let mode = 'work'; // work | break | longbreak
  let timeLeft = 25 * 60; // seconds
  let running = false;
  let interval = null;
  let sessions = parseInt(localStorage.getItem('nova-pomodoro-sessions') || '0');

  const MODES = {
    work:      { label: 'Focus',      time: 25 * 60, color: '#ff3b30', next: 'break' },
    break:     { label: 'Short Break', time: 5 * 60,  color: '#34c759', next: 'work' },
    longbreak: { label: 'Long Break',  time: 15 * 60, color: '#007aff', next: 'work' },
  };

  function render() {
    const m = MODES[mode];
    const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0');
    const secs = String(timeLeft % 60).padStart(2, '0');
    const progress = 1 - (timeLeft / m.time);

    container.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; font-family:var(--font); color:white; background:#1a1a22; padding:24px;">
        <div style="font-size:14px; font-weight:600; color:${m.color}; text-transform:uppercase; letter-spacing:1px; margin-bottom:24px;">${m.label}</div>

        <div style="position:relative; width:200px; height:200px; margin-bottom:24px;">
          <svg width="200" height="200" viewBox="0 0 200 200" style="transform:rotate(-90deg);">
            <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
            <circle cx="100" cy="100" r="90" fill="none" stroke="${m.color}" stroke-width="8"
              stroke-dasharray="${2 * Math.PI * 90}" stroke-dashoffset="${2 * Math.PI * 90 * (1 - progress)}"
              stroke-linecap="round" style="transition:stroke-dashoffset 0.5s ease;"/>
          </svg>
          <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:48px; font-weight:200; font-variant-numeric:tabular-nums;">
            ${mins}:${secs}
          </div>
        </div>

        <div style="display:flex; gap:12px; margin-bottom:24px;">
          <button id="pm-toggle" style="
            padding:12px 32px; border-radius:12px; border:none;
            background:${running ? 'rgba(255,255,255,0.1)' : m.color};
            color:white; font-size:14px; font-weight:600; cursor:pointer;
            font-family:var(--font); min-width:120px;
          ">${running ? 'Pause' : 'Start'}</button>
          <button id="pm-reset" style="
            padding:12px 20px; border-radius:12px; border:1px solid rgba(255,255,255,0.1);
            background:transparent; color:rgba(255,255,255,0.6); font-size:14px;
            cursor:pointer; font-family:var(--font);
          ">Reset</button>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:20px;">
          ${['work', 'break', 'longbreak'].map(m => `
            <button class="pm-mode" data-mode="${m}" style="
              padding:8px 16px; border-radius:8px; border:none;
              background:${mode === m ? 'rgba(255,255,255,0.1)' : 'transparent'};
              color:${mode === m ? 'white' : 'rgba(255,255,255,0.4)'};
              font-size:12px; cursor:pointer; font-family:var(--font);
            ">${MODES[m].label}</button>
          `).join('')}
        </div>

        <div style="font-size:12px; color:rgba(255,255,255,0.3);">
          Sessions today: ${sessions} \uD83C\uDF45
        </div>
      </div>
    `;

    container.querySelector('#pm-toggle').addEventListener('click', () => {
      if (running) pause();
      else start();
    });

    container.querySelector('#pm-reset').addEventListener('click', () => {
      pause();
      timeLeft = MODES[mode].time;
      render();
    });

    container.querySelectorAll('.pm-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        pause();
        mode = btn.dataset.mode;
        timeLeft = MODES[mode].time;
        render();
      });
    });
  }

  function start() {
    running = true;
    render();
    interval = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        pause();
        sounds.notification();

        if (mode === 'work') {
          sessions++;
          localStorage.setItem('nova-pomodoro-sessions', String(sessions));
          notifications.show({
            title: '\uD83C\uDF45 Focus session complete!',
            body: `${sessions} sessions today. Time for a break.`,
            icon: '\uD83C\uDF45',
            duration: 10000,
          });
          mode = sessions % 4 === 0 ? 'longbreak' : 'break';
        } else {
          notifications.show({
            title: '\u2705 Break over!',
            body: 'Ready to focus again?',
            icon: '\uD83D\uDCAA',
            duration: 10000,
          });
          mode = 'work';
        }
        timeLeft = MODES[mode].time;
        render();
      } else {
        // Update timer display without full re-render
        const timerEl = container.querySelector('[style*="font-size:48px"]');
        if (timerEl) {
          timerEl.textContent = `${String(Math.floor(timeLeft / 60)).padStart(2, '0')}:${String(timeLeft % 60).padStart(2, '0')}`;
        }
        // Update progress ring
        const circle = container.querySelector('circle:last-of-type');
        if (circle) {
          const progress = 1 - (timeLeft / MODES[mode].time);
          circle.setAttribute('stroke-dashoffset', String(2 * Math.PI * 90 * (1 - progress)));
        }
      }
    }, 1000);
  }

  function pause() {
    running = false;
    if (interval) clearInterval(interval);
    interval = null;
    render();
  }

  render();
}
