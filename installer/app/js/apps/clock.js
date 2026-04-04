// NOVA OS — Clock App (World Clock, Stopwatch, Timer)

import { processManager } from '../kernel/process-manager.js';

export function registerClock() {
  processManager.register('clock', {
    name: 'Clock',
    icon: '\uD83D\uDD50',
    iconClass: 'dock-icon-clock',
    singleInstance: true,
    width: 400,
    height: 500,
    launch: (contentEl) => {
      initClock(contentEl);
    }
  });
}

function initClock(container) {
  let activeTab = 'world';
  let swRunning = false, swTime = 0, swInterval = null, swLaps = [];
  let tmRunning = false, tmTime = 0, tmInterval = null;

  const cities = [
    { name: 'San Francisco', offset: -7 },
    { name: 'New York', offset: -4 },
    { name: 'London', offset: 1 },
    { name: 'Tokyo', offset: 9 },
    { name: 'Sydney', offset: 11 },
    { name: 'Dubai', offset: 4 },
  ];

  container.innerHTML = `
    <div class="clock-app">
      <div class="clock-tabs">
        <div class="clock-tab active" data-tab="world">\uD83C\uDF0D World</div>
        <div class="clock-tab" data-tab="stopwatch">\u23F1 Stopwatch</div>
        <div class="clock-tab" data-tab="timer">\u23F2 Timer</div>
      </div>
      <div class="clock-content" id="clock-content"></div>
    </div>
  `;

  const content = container.querySelector('#clock-content');
  container.querySelectorAll('.clock-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.clock-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      render();
    });
  });

  function render() {
    switch (activeTab) {
      case 'world': renderWorld(); break;
      case 'stopwatch': renderStopwatch(); break;
      case 'timer': renderTimer(); break;
    }
  }

  function renderWorld() {
    const now = new Date();
    const localOffset = -now.getTimezoneOffset() / 60;

    content.innerHTML = `<div class="clock-world-list">
      ${cities.map(city => {
        const cityTime = new Date(now.getTime() + (city.offset - localOffset) * 3600000);
        const hours = cityTime.getHours();
        const mins = cityTime.getMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const h12 = hours % 12 || 12;
        const diff = city.offset - localOffset;
        const diffStr = diff === 0 ? 'Same time' : `${diff > 0 ? '+' : ''}${diff}h`;
        return `<div class="clock-world-item">
          <div>
            <div class="clock-world-city">${city.name}</div>
            <div class="clock-world-diff">${diffStr}</div>
          </div>
          <div>
            <span class="clock-world-time">${h12}:${mins}</span>
            <span class="clock-world-ampm">${ampm}</span>
          </div>
        </div>`;
      }).join('')}
    </div>`;

    if (activeTab === 'world') setTimeout(renderWorld, 1000);
  }

  function renderStopwatch() {
    const mins = Math.floor(swTime / 60000).toString().padStart(2, '0');
    const secs = Math.floor((swTime % 60000) / 1000).toString().padStart(2, '0');
    const ms = Math.floor((swTime % 1000) / 10).toString().padStart(2, '0');

    content.innerHTML = `
      <div class="clock-stopwatch-display">${mins}:${secs}<span class="clock-stopwatch-ms">.${ms}</span></div>
      <div class="clock-stopwatch-controls">
        <button class="clock-stopwatch-btn reset" id="sw-reset">${swRunning ? 'Lap' : 'Reset'}</button>
        <button class="clock-stopwatch-btn ${swRunning ? 'stop' : 'start'}" id="sw-toggle">${swRunning ? 'Stop' : 'Start'}</button>
      </div>
      <div class="clock-stopwatch-laps" id="sw-laps">
        ${swLaps.map((lap, i) => {
          const lm = Math.floor(lap / 60000).toString().padStart(2, '0');
          const ls = Math.floor((lap % 60000) / 1000).toString().padStart(2, '0');
          const lms = Math.floor((lap % 1000) / 10).toString().padStart(2, '0');
          return `<div class="clock-stopwatch-lap"><span>Lap ${swLaps.length - i}</span><span>${lm}:${ls}.${lms}</span></div>`;
        }).join('')}
      </div>
    `;

    content.querySelector('#sw-toggle').addEventListener('click', () => {
      if (swRunning) {
        clearInterval(swInterval);
        swRunning = false;
      } else {
        const start = Date.now() - swTime;
        swInterval = setInterval(() => {
          swTime = Date.now() - start;
          if (activeTab === 'stopwatch') renderStopwatch();
        }, 30);
        swRunning = true;
      }
      renderStopwatch();
    });

    content.querySelector('#sw-reset').addEventListener('click', () => {
      if (swRunning) {
        swLaps.unshift(swTime);
      } else {
        swTime = 0;
        swLaps = [];
        clearInterval(swInterval);
      }
      renderStopwatch();
    });
  }

  function renderTimer() {
    const mins = Math.floor(tmTime / 60000).toString().padStart(2, '0');
    const secs = Math.floor((tmTime % 60000) / 1000).toString().padStart(2, '0');

    content.innerHTML = `
      <div class="clock-timer-display">${mins}:${secs}</div>
      <div class="clock-timer-presets">
        <button class="clock-timer-preset" data-time="60000">1 min</button>
        <button class="clock-timer-preset" data-time="180000">3 min</button>
        <button class="clock-timer-preset" data-time="300000">5 min</button>
        <button class="clock-timer-preset" data-time="600000">10 min</button>
        <button class="clock-timer-preset" data-time="1500000">25 min</button>
      </div>
      <div class="clock-stopwatch-controls">
        <button class="clock-stopwatch-btn reset" id="tm-reset">Cancel</button>
        <button class="clock-stopwatch-btn ${tmRunning ? 'stop' : 'start'}" id="tm-toggle">${tmRunning ? 'Pause' : 'Start'}</button>
      </div>
    `;

    content.querySelectorAll('.clock-timer-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        tmTime = parseInt(btn.dataset.time);
        tmRunning = false;
        clearInterval(tmInterval);
        renderTimer();
      });
    });

    content.querySelector('#tm-toggle').addEventListener('click', () => {
      if (tmTime <= 0) return;
      if (tmRunning) {
        clearInterval(tmInterval);
        tmRunning = false;
      } else {
        const end = Date.now() + tmTime;
        tmInterval = setInterval(() => {
          tmTime = Math.max(0, end - Date.now());
          if (tmTime <= 0) {
            clearInterval(tmInterval);
            tmRunning = false;
            // Alert
            try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH+LkZKPi4J3aV1RRz1COk5biJafoJ2WjH1uYFJHPTk4O0JQYXSOm6SloJiMfG1eT0M6NjU4P0xdcIiYo6ejm5CAdmheUkc+ODY2OT9OX3KKm6Wmop2Tg3ZoW09DPDc1NjlBUGJ2jJ2nq6ifk4R0Zlo=').play(); } catch(e) {}
          }
          if (activeTab === 'timer') renderTimer();
        }, 100);
        tmRunning = true;
      }
      renderTimer();
    });

    content.querySelector('#tm-reset').addEventListener('click', () => {
      clearInterval(tmInterval);
      tmRunning = false;
      tmTime = 0;
      renderTimer();
    });
  }

  render();
}
