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
export function makeChessMove(fromR, fromC, toR, toC) {
  if (!_game) return { ok: false, error: 'No chess game running' };
  const b = _game.board;
  const piece = b[fromR]?.[fromC];
  if (!piece || piece === ' ') return { ok: false, error: 'No piece at source' };
  const pieceIsWhite = piece === piece.toUpperCase();
  if ((_game.turn === 'white' && !pieceIsWhite) || (_game.turn === 'black' && pieceIsWhite)) {
    return { ok: false, error: `Not ${_game.turn}'s piece` };
  }
  if (fromR === toR && fromC === toC) return { ok: false, error: 'Source equals destination' };
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
              return `<div class="sq" data-r="${r}" data-c="${c}" style="width:${sz}px;height:${sz}px;background:${sel ? '#007aff' : light ? '#b58863' : '#f0d9b5'};display:flex;align-items:center;justify-content:center;font-size:36px;cursor:pointer;user-select:none;">${p !== ' ' ? (PIECES[p] || '') : ''}</div>`;
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
