// ASTRION OS — Reaction Test
import { processManager } from '../kernel/process-manager.js';

export function registerReactionTest() {
  processManager.register('reaction-test', {
    name: 'Reaction Test',
    icon: '⚡',
    singleInstance: true,
    width: 380,
    height: 420,
    launch: (el) => initReactionTest(el)
  });
}

function initReactionTest(container) {
  let state = 'waiting'; // waiting, ready, toosoon, result
  let startTime = 0;
  let reactionTime = 0;
  let best = Infinity;
  let attempts = [];
  let timeout = null;

  try {
    const saved = localStorage.getItem('nova-reaction-best');
    if (saved) best = parseInt(saved);
  } catch {}

  function render() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    const colors = {
      waiting: '#2563eb',
      ready: '#16a34a',
      toosoon: '#dc2626',
      result: '#7c3aed',
    };
    const bg = colors[state];

    let content = '';
    if (state === 'waiting') {
      content = `
        <div style="font-size:48px;margin-bottom:16px;">🎯</div>
        <div style="font-size:20px;font-weight:600;">Click when green</div>
        <div style="font-size:13px;opacity:0.7;margin-top:8px;">Wait for the screen to turn green, then click as fast as you can!</div>
      `;
    } else if (state === 'ready') {
      content = `
        <div style="font-size:48px;margin-bottom:16px;">⚡</div>
        <div style="font-size:24px;font-weight:700;">CLICK NOW!</div>
      `;
    } else if (state === 'toosoon') {
      content = `
        <div style="font-size:48px;margin-bottom:16px;">❌</div>
        <div style="font-size:20px;font-weight:600;">Too soon!</div>
        <div style="font-size:13px;opacity:0.7;margin-top:8px;">Wait for green before clicking</div>
      `;
    } else if (state === 'result') {
      const rating = reactionTime < 200 ? '🔥 Incredible!' : reactionTime < 300 ? '⚡ Fast!' : reactionTime < 400 ? '👍 Good' : '🐢 Keep practicing';
      content = `
        <div style="font-size:56px;font-weight:700;margin-bottom:4px;">${reactionTime}ms</div>
        <div style="font-size:16px;margin-bottom:12px;">${rating}</div>
        ${best < Infinity ? `<div style="font-size:12px;opacity:0.6;">Personal best: ${best}ms</div>` : ''}
        ${attempts.length > 1 ? `<div style="font-size:12px;opacity:0.5;margin-top:4px;">Average: ${Math.round(attempts.reduce((a,b) => a+b, 0) / attempts.length)}ms (${attempts.length} tries)</div>` : ''}
      `;
    }

    container.innerHTML = `
      <div class="reaction-area" style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100%;background:${bg};color:white;font-family:var(--font,system-ui);
        cursor:pointer;user-select:none;padding:30px;text-align:center;
        transition:background 0.15s;
      ">${content}
        ${state === 'result' || state === 'toosoon' ? `<div style="font-size:12px;opacity:0.5;margin-top:20px;">Click to try again</div>` : ''}
      </div>
    `;

    container.querySelector('.reaction-area').addEventListener('click', handleClick);
  }

  function handleClick() {
    if (state === 'waiting') {
      // Start countdown to green
      state = 'waiting'; // visual stays blue
      const delay = 1500 + Math.random() * 3000; // 1.5-4.5s random
      timeout = setTimeout(() => {
        state = 'ready';
        startTime = performance.now();
        render();
      }, delay);
      // Re-render with subtle "wait..." message
      container.querySelector('.reaction-area').innerHTML = `
        <div style="font-size:48px;margin-bottom:16px;">⏳</div>
        <div style="font-size:20px;font-weight:600;">Wait for green...</div>
        <div style="font-size:13px;opacity:0.5;margin-top:8px;">Don't click yet!</div>
      `;
      // Clicking during wait = too soon
      container.querySelector('.reaction-area').onclick = () => {
        clearTimeout(timeout);
        state = 'toosoon';
        render();
      };
    } else if (state === 'ready') {
      reactionTime = Math.round(performance.now() - startTime);
      attempts.push(reactionTime);
      if (reactionTime < best) {
        best = reactionTime;
        try { localStorage.setItem('nova-reaction-best', String(best)); } catch {}
      }
      state = 'result';
      render();
    } else if (state === 'toosoon' || state === 'result') {
      state = 'waiting';
      render();
    }
  }

  render();

  const obs = new MutationObserver(() => {
    if (!container.isConnected) { clearTimeout(timeout); obs.disconnect(); }
  });
  if (container.parentElement) obs.observe(container.parentElement, { childList: true, subtree: true });
}
