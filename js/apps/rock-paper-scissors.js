// ASTRION OS — Rock Paper Scissors
import { processManager } from '../kernel/process-manager.js';

export function registerRockPaperScissors() {
  processManager.register('rock-paper-scissors', {
    name: 'Rock Paper Scissors',
    icon: '✊',
    singleInstance: true,
    width: 360,
    height: 420,
    launch: (el) => initRPS(el)
  });
}

function initRPS(container) {
  let wins = 0, losses = 0, draws = 0;
  let lastResult = null;
  let playerChoice = null, cpuChoice = null;

  const CHOICES = ['🪨', '📄', '✂️'];
  const NAMES = ['Rock', 'Paper', 'Scissors'];
  const BEATS = { 0: 2, 1: 0, 2: 1 }; // rock beats scissors, etc.

  function play(choice) {
    playerChoice = choice;
    cpuChoice = Math.floor(Math.random() * 3);
    if (playerChoice === cpuChoice) { draws++; lastResult = 'draw'; }
    else if (BEATS[playerChoice] === cpuChoice) { wins++; lastResult = 'win'; }
    else { losses++; lastResult = 'lose'; }
    render();
  }

  function render() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    const resultColors = { win: '#22c55e', lose: '#ef4444', draw: '#f59e0b' };
    const resultText = { win: 'You Win! 🎉', lose: 'You Lose 😢', draw: "It's a Draw 🤝" };

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
        background:#1a1a2e;color:white;font-family:var(--font,system-ui);padding:20px;gap:16px;">
        <div style="font-size:15px;font-weight:700;">Rock Paper Scissors</div>

        ${lastResult ? `
          <div style="display:flex;align-items:center;gap:24px;font-size:48px;">
            <div style="text-align:center;">
              <div>${CHOICES[playerChoice]}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;">You</div>
            </div>
            <div style="font-size:18px;color:rgba(255,255,255,0.3);">vs</div>
            <div style="text-align:center;">
              <div>${CHOICES[cpuChoice]}</div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;">CPU</div>
            </div>
          </div>
          <div style="font-size:16px;font-weight:600;color:${resultColors[lastResult]};">${resultText[lastResult]}</div>
        ` : `<div style="font-size:48px;opacity:0.3;">🎮</div><div style="font-size:13px;color:rgba(255,255,255,0.4);">Pick your move!</div>`}

        <div style="display:flex;gap:12px;">
          ${CHOICES.map((c, i) => `
            <button class="rps-btn" data-idx="${i}" style="
              width:80px;height:80px;border-radius:16px;border:2px solid rgba(255,255,255,0.08);
              background:rgba(255,255,255,0.04);font-size:36px;cursor:pointer;
              transition:transform 0.15s, border-color 0.15s;
            ">${c}</button>
          `).join('')}
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.3);">${NAMES.join('  ·  ')}</div>

        <div style="display:flex;gap:20px;font-size:13px;margin-top:8px;">
          <span style="color:#22c55e;">W: ${wins}</span>
          <span style="color:#ef4444;">L: ${losses}</span>
          <span style="color:#f59e0b;">D: ${draws}</span>
        </div>
      </div>
    `;

    container.querySelectorAll('.rps-btn').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.transform = 'scale(1.1)'; el.style.borderColor = 'rgba(255,255,255,0.3)'; });
      el.addEventListener('mouseleave', () => { el.style.transform = 'scale(1)'; el.style.borderColor = 'rgba(255,255,255,0.08)'; });
      el.addEventListener('click', () => play(+el.dataset.idx));
    });
  }

  render();
}
