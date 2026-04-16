// ASTRION OS — Tic Tac Toe
import { processManager } from '../kernel/process-manager.js';

export function registerTicTacToe() {
  processManager.register('tic-tac-toe', {
    name: 'Tic Tac Toe',
    icon: '❌',
    singleInstance: true,
    width: 340,
    height: 440,
    launch: (el) => initTTT(el)
  });
}

function initTTT(container) {
  let board = Array(9).fill(null);
  let turn = 'X';
  let winner = null;
  let score = { X: 0, O: 0 };

  const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

  function check() {
    for (const [a,b,c] of WINS) {
      if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
    }
    return board.every(c => c) ? 'draw' : null;
  }

  function cpuMove() {
    // Simple AI: win > block > center > corner > random
    for (const [a,b,c] of WINS) {
      const line = [board[a],board[b],board[c]];
      if (line.filter(x=>x==='O').length===2 && line.includes(null)) { board[[a,b,c][line.indexOf(null)]] = 'O'; return; }
    }
    for (const [a,b,c] of WINS) {
      const line = [board[a],board[b],board[c]];
      if (line.filter(x=>x==='X').length===2 && line.includes(null)) { board[[a,b,c][line.indexOf(null)]] = 'O'; return; }
    }
    if (!board[4]) { board[4] = 'O'; return; }
    const corners = [0,2,6,8].filter(i => !board[i]);
    if (corners.length) { board[corners[Math.floor(Math.random()*corners.length)]] = 'O'; return; }
    const empty = board.map((v,i) => v ? -1 : i).filter(i => i >= 0);
    if (empty.length) board[empty[Math.floor(Math.random()*empty.length)]] = 'O';
  }

  function play(idx) {
    if (board[idx] || winner) return;
    board[idx] = 'X';
    winner = check();
    if (!winner) { cpuMove(); winner = check(); }
    if (winner === 'X') score.X++;
    else if (winner === 'O') score.O++;
    render();
  }

  function reset() { board = Array(9).fill(null); turn = 'X'; winner = null; render(); }

  function render() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
        background:#1a1a2e;color:white;font-family:var(--font,system-ui);padding:20px;gap:14px;">
        <div style="font-size:15px;font-weight:700;">Tic Tac Toe</div>
        <div style="font-size:13px;color:rgba(255,255,255,0.5);">
          ${winner === 'draw' ? "It's a draw!" : winner ? `${winner} wins!` : `Your turn (X)`}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:240px;height:240px;">
          ${board.map((cell, i) => `
            <div class="ttt-cell" data-idx="${i}" style="
              display:flex;align-items:center;justify-content:center;
              background:rgba(255,255,255,0.04);border-radius:12px;font-size:36px;font-weight:700;
              cursor:${cell || winner ? 'default' : 'pointer'};
              color:${cell === 'X' ? '#3b82f6' : cell === 'O' ? '#ef4444' : 'transparent'};
              transition:background 0.15s;
            ">${cell || '·'}</div>
          `).join('')}
        </div>
        <div style="display:flex;gap:20px;font-size:13px;">
          <span style="color:#3b82f6;">You (X): ${score.X}</span>
          <span style="color:#ef4444;">CPU (O): ${score.O}</span>
        </div>
        ${winner ? `<button class="ttt-reset" style="padding:8px 24px;border-radius:10px;border:none;background:${accent};color:white;font-size:13px;cursor:pointer;">Play Again</button>` : ''}
      </div>
    `;
    container.querySelectorAll('.ttt-cell').forEach(el => {
      el.addEventListener('mouseenter', () => { if (!board[+el.dataset.idx] && !winner) el.style.background = 'rgba(255,255,255,0.08)'; });
      el.addEventListener('mouseleave', () => el.style.background = 'rgba(255,255,255,0.04)');
      el.addEventListener('click', () => play(+el.dataset.idx));
    });
    container.querySelector('.ttt-reset')?.addEventListener('click', reset);
  }
  render();
}
