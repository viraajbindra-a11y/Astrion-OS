// Astrion OS — Chess (2-player local)
// Phase 4 prep: exports getState() and makeMove() for game autoplay.
import { processManager } from '../kernel/process-manager.js';

let _game = null;

/**
 * Get the current chess game state. Returns null if no game is running.
 * @returns {{ board: string[][], turn: 'white'|'black', selected: [number,number]|null } | null}
 */
export function getChessState() {
  if (!_game) return null;
  return {
    board: _game.board.map(r => [...r]),
    turn: _game.turn,
    selected: _game.selected ? [..._game.selected] : null,
  };
}

/**
 * Make a chess move. No validation beyond basic ownership check — this is
 * a casual 2-player game, not a rules engine.
 * @param {number} fromR — source row (0-7)
 * @param {number} fromC — source column (0-7)
 * @param {number} toR — destination row (0-7)
 * @param {number} toC — destination column (0-7)
 * @returns {{ ok: boolean, captured?: string, error?: string }}
 */
// Basic move shape validation (no check/checkmate/castling/en passant/promotion)
function isValidMove(board, fromR, fromC, toR, toC) {
  const piece = board[fromR][fromC];
  const target = board[toR][toC];
  const isWhite = piece === piece.toUpperCase();
  // Can't capture own pieces
  if (target !== ' ' && (target === target.toUpperCase()) === isWhite) return false;

  const dr = toR - fromR, dc = toC - fromC;
  const absDr = Math.abs(dr), absDc = Math.abs(dc);
  const type = piece.toLowerCase();

  if (type === 'p') {
    const dir = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    // Forward 1
    if (dc === 0 && dr === dir && target === ' ') return true;
    // Forward 2 from starting row
    if (dc === 0 && dr === 2 * dir && fromR === startRow && target === ' ' && board[fromR + dir][fromC] === ' ') return true;
    // Diagonal capture
    if (absDc === 1 && dr === dir && target !== ' ') return true;
    return false;
  }
  if (type === 'n') return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
  if (type === 'k') return absDr <= 1 && absDc <= 1;

  // Sliding pieces: check path is clear
  function pathClear(stepR, stepC) {
    let r = fromR + stepR, c = fromC + stepC;
    while (r !== toR || c !== toC) {
      if (board[r][c] !== ' ') return false;
      r += stepR; c += stepC;
    }
    return true;
  }

  if (type === 'r') {
    if (dr !== 0 && dc !== 0) return false;
    return pathClear(Math.sign(dr), Math.sign(dc));
  }
  if (type === 'b') {
    if (absDr !== absDc) return false;
    return pathClear(Math.sign(dr), Math.sign(dc));
  }
  if (type === 'q') {
    if (dr === 0 || dc === 0) return pathClear(Math.sign(dr), Math.sign(dc));
    if (absDr === absDc) return pathClear(Math.sign(dr), Math.sign(dc));
    return false;
  }
  return false;
}

export function makeChessMove(fromR, fromC, toR, toC) {
  if (!_game) return { ok: false, error: 'No chess game running' };
  if (fromR < 0 || fromR > 7 || fromC < 0 || fromC > 7 || toR < 0 || toR > 7 || toC < 0 || toC > 7) {
    return { ok: false, error: 'Out of bounds' };
  }
  const b = _game.board;
  const piece = b[fromR][fromC];
  if (!piece || piece === ' ') return { ok: false, error: 'No piece at source' };
  const pieceIsWhite = piece === piece.toUpperCase();
  if ((_game.turn === 'white' && !pieceIsWhite) || (_game.turn === 'black' && pieceIsWhite)) {
    return { ok: false, error: `Not ${_game.turn}'s piece` };
  }
  if (fromR === toR && fromC === toC) return { ok: false, error: 'Source equals destination' };
  if (!isValidMove(b, fromR, fromC, toR, toC)) return { ok: false, error: 'Illegal move' };
  const captured = b[toR][toC] !== ' ' ? b[toR][toC] : null;
  b[toR][toC] = piece;
  b[fromR][fromC] = ' ';
  _game.turn = _game.turn === 'white' ? 'black' : 'white';
  _game.selected = null;
  _game.render();
  return { ok: true, captured };
}

export function registerChess() {
  processManager.register('chess', {
    name: 'Chess', icon: '♚', singleInstance: true, width: 520, height: 560,
    launch: (el) => {
      const PIECES = {
        r: '♜', n: '♞', b: '♝', q: '♛', k: '♚', p: '♟',
        R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔', P: '♙',
      };
      const INITIAL = [
        ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
        ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
        [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
        ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
        ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
      ];

      const state = {
        board: INITIAL.map(r => [...r]),
        selected: null,
        turn: 'white',
        render: null, // set below
      };
      _game = state;

      function isWhite(p) { return p === p.toUpperCase() && p !== ' '; }

      function render() {
        const sz = 56;
        el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:16px;">
          <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${state.turn === 'white' ? '♔' : '♚'} ${state.turn}'s turn</div>
          <div style="display:grid;grid-template-columns:repeat(8,${sz}px);border:2px solid #555;">
            ${state.board.flatMap((row, r) => row.map((p, c) => {
              const light = (r + c) % 2 === 0;
              const sel = state.selected && state.selected[0] === r && state.selected[1] === c;
              return `<div class="sq" data-r="${r}" data-c="${c}" style="width:${sz}px;height:${sz}px;background:${sel ? '#007aff' : light ? '#f0d9b5' : '#b58863'};display:flex;align-items:center;justify-content:center;font-size:36px;cursor:pointer;user-select:none;">${p !== ' ' ? (PIECES[p] || '') : ''}</div>`;
            })).join('')}
          </div>
          <button id="ch-reset" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:12px;cursor:pointer;font-family:var(--font);">New Game</button>
        </div>`;
        el.querySelectorAll('.sq').forEach(sq => {
          sq.onclick = () => {
            const r = parseInt(sq.dataset.r), c = parseInt(sq.dataset.c), p = state.board[r][c];
            if (state.selected) {
              const [sr, sc] = state.selected;
              if (r !== sr || c !== sc) {
                makeChessMove(sr, sc, r, c);
              } else {
                state.selected = null;
                render();
              }
            } else if (p !== ' ') {
              const pw = isWhite(p);
              if ((state.turn === 'white' && pw) || (state.turn === 'black' && !pw)) {
                state.selected = [r, c];
                render();
              }
            }
          };
        });
        el.querySelector('#ch-reset').onclick = () => {
          state.board = INITIAL.map(r => [...r]);
          state.turn = 'white';
          state.selected = null;
          render();
        };
      }

      state.render = render;
      render();
    },
  });
}
