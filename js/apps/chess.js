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
// ─── Chess engine (2026-05-12) ─────────────────────────────────────
//
// Real rules: piece-shape legality + king-safety filter + castling +
// en passant + pawn promotion + check / checkmate / stalemate. The
// state argument carries castling rights and the en-passant target
// square; the UI builds and mutates it.
//
// state shape:
//   {
//     castling: { K: bool, Q: bool, k: bool, q: bool },   // KQkq classic
//     enPassantTarget: [r, c] | null,                      // square a pawn could capture to (set by a 2-step pawn move)
//     halfmoveClock: number,                               // for 50-move rule (unused for now)
//     fullmoveNumber: number,
//   }
//
// All engine helpers operate on a fresh board copy when they need to
// simulate; the live state.board is mutated only in makeChessMove
// after a fully-legal move is accepted.

function isWhitePiece(p) { return p !== ' ' && p === p.toUpperCase(); }

function cloneBoard(board) { return board.map(r => [...r]); }

function findKing(board, isWhite) {
  const k = isWhite ? 'K' : 'k';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === k) return [r, c];
    }
  }
  return null;
}

// Piece-shape legality only (no king-safety, no castling/en-passant).
// Used by isSquareAttacked() to ask "can this piece reach there?"
// without recursing into king-safety (which itself calls back here).
function pseudoValidMove(board, fromR, fromC, toR, toC, state) {
  const piece = board[fromR][fromC];
  if (!piece || piece === ' ') return false;
  const target = board[toR][toC];
  const isWhite = isWhitePiece(piece);
  if (target !== ' ' && isWhitePiece(target) === isWhite) return false; // can't capture own

  const dr = toR - fromR, dc = toC - fromC;
  const absDr = Math.abs(dr), absDc = Math.abs(dc);
  const type = piece.toLowerCase();

  if (type === 'p') {
    const dir = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    if (dc === 0 && dr === dir && target === ' ') return true;
    if (dc === 0 && dr === 2 * dir && fromR === startRow && target === ' ' && board[fromR + dir][fromC] === ' ') return true;
    if (absDc === 1 && dr === dir && target !== ' ') return true;
    // En passant: empty diagonal square that matches state.enPassantTarget
    if (absDc === 1 && dr === dir && target === ' ' && state?.enPassantTarget
        && state.enPassantTarget[0] === toR && state.enPassantTarget[1] === toC) {
      return true;
    }
    return false;
  }
  if (type === 'n') return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
  if (type === 'k') {
    if (absDr <= 1 && absDc <= 1) return true;
    // Castling: king moves two squares horizontally on its home rank.
    // The full castling preconditions (rights, empty path, not through
    // check) are validated in isValidMove() — this branch just lets
    // pseudoValidMove recognize the SHAPE so getLegalMoves enumerates it.
    if (dr === 0 && absDc === 2 && state) return true;
    return false;
  }

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

// Is square (r,c) attacked by `byWhite` side on this board?
// Pseudo-moves only (no king-safety) — kings can't legally move into
// attacked squares but their pseudo-attack range still threatens.
function isSquareAttacked(board, r, c, byWhite) {
  for (let fr = 0; fr < 8; fr++) {
    for (let fc = 0; fc < 8; fc++) {
      const p = board[fr][fc];
      if (p === ' ' || isWhitePiece(p) !== byWhite) continue;
      // Pawn attacks are diagonal-forward only, not the forward-move
      // pseudoValidMove allows. Inline the check to avoid false threats.
      if (p.toLowerCase() === 'p') {
        const dir = byWhite ? -1 : 1;
        if (r - fr === dir && Math.abs(c - fc) === 1) return true;
        continue;
      }
      // Kings attack adjacent squares
      if (p.toLowerCase() === 'k') {
        if (Math.abs(r - fr) <= 1 && Math.abs(c - fc) <= 1 && (fr !== r || fc !== c)) return true;
        continue;
      }
      // Everything else: pseudo-move shape says they can reach (r,c).
      // Pass {} so pseudoValidMove doesn't try castling/en-passant.
      if (pseudoValidMove(board, fr, fc, r, c, {})) return true;
    }
  }
  return false;
}

function isInCheck(board, isWhiteToMove) {
  const k = findKing(board, isWhiteToMove);
  if (!k) return false;
  return isSquareAttacked(board, k[0], k[1], !isWhiteToMove);
}

// Full move legality: shape + king-safety + (for kings) castling
// preconditions + (for pawns) en-passant target validity.
// Returns { ok: boolean, special?: 'castle'|'enpassant'|'promote', reason? }.
function isValidMove(board, fromR, fromC, toR, toC, state) {
  const piece = board[fromR][fromC];
  if (!piece || piece === ' ') return { ok: false, reason: 'empty source' };
  const isWhite = isWhitePiece(piece);

  if (!pseudoValidMove(board, fromR, fromC, toR, toC, state)) {
    return { ok: false, reason: 'illegal piece shape' };
  }

  // Castling: kingside (dc=+2) or queenside (dc=-2) on home rank.
  let special = null;
  if (piece.toLowerCase() === 'k' && Math.abs(toC - fromC) === 2 && toR === fromR) {
    const side = toC > fromC ? 'K' : 'Q';
    const right = isWhite ? side : side.toLowerCase();
    if (!state?.castling?.[right]) return { ok: false, reason: 'castling right lost' };
    const homeR = isWhite ? 7 : 0;
    if (fromR !== homeR || fromC !== 4) return { ok: false, reason: 'castling king not on home square' };
    // Rook must be at corner
    const rookC = side === 'K' ? 7 : 0;
    const rookExpected = isWhite ? (side === 'K' ? 'R' : 'R') : (side === 'K' ? 'r' : 'r');
    if (board[homeR][rookC] !== rookExpected) return { ok: false, reason: 'castling rook missing' };
    // Path between king and rook must be empty
    const step = side === 'K' ? 1 : -1;
    for (let c = fromC + step; c !== rookC; c += step) {
      if (board[homeR][c] !== ' ') return { ok: false, reason: 'castling path blocked' };
    }
    // King may not be in check, pass through check, or land in check
    for (let c = fromC; c !== toC + step; c += step) {
      if (isSquareAttacked(board, homeR, c, !isWhite)) return { ok: false, reason: 'castling through check' };
    }
    special = 'castle';
  }

  // En passant
  if (piece.toLowerCase() === 'p' && Math.abs(toC - fromC) === 1 && board[toR][toC] === ' '
      && state?.enPassantTarget && state.enPassantTarget[0] === toR && state.enPassantTarget[1] === toC) {
    special = 'enpassant';
  }

  // Promotion: pawn reaching last rank
  if (piece.toLowerCase() === 'p' && (toR === 0 || toR === 7)) {
    special = special || 'promote';
  }

  // King-safety filter: simulate the move and reject if own king ends up in check.
  const sim = cloneBoard(board);
  sim[toR][toC] = piece;
  sim[fromR][fromC] = ' ';
  if (special === 'castle') {
    const homeR = isWhite ? 7 : 0;
    const kingside = toC > fromC;
    const rookFromC = kingside ? 7 : 0;
    const rookToC = kingside ? toC - 1 : toC + 1;
    sim[homeR][rookToC] = sim[homeR][rookFromC];
    sim[homeR][rookFromC] = ' ';
  }
  if (special === 'enpassant') {
    sim[fromR][toC] = ' '; // remove the pawn that was captured en-passant
  }
  if (isInCheck(sim, isWhite)) {
    return { ok: false, reason: 'leaves king in check' };
  }

  return { ok: true, special };
}

// Enumerate every legal move for the side-to-move. Used for AI move
// selection and for mate / stalemate detection.
function getAllLegalMoves(board, isWhiteTurn, state) {
  const moves = [];
  for (let fr = 0; fr < 8; fr++) {
    for (let fc = 0; fc < 8; fc++) {
      const p = board[fr][fc];
      if (p === ' ' || isWhitePiece(p) !== isWhiteTurn) continue;
      for (let tr = 0; tr < 8; tr++) {
        for (let tc = 0; tc < 8; tc++) {
          if (fr === tr && fc === tc) continue;
          const v = isValidMove(board, fr, fc, tr, tc, state);
          if (v.ok) moves.push({ fromR: fr, fromC: fc, toR: tr, toC: tc, special: v.special });
        }
      }
    }
  }
  return moves;
}

// Exposed for v03 + AI capability tests
export const _engine = {
  isWhitePiece, findKing, pseudoValidMove, isSquareAttacked,
  isInCheck, isValidMove, getAllLegalMoves, cloneBoard,
};

export function makeChessMove(fromR, fromC, toR, toC, promotionPiece) {
  if (!_game) return { ok: false, error: 'No chess game running' };
  if (_game.gameOver) return { ok: false, error: `Game over: ${_game.gameOver}` };
  if (fromR < 0 || fromR > 7 || fromC < 0 || fromC > 7 || toR < 0 || toR > 7 || toC < 0 || toC > 7) {
    return { ok: false, error: 'Out of bounds' };
  }
  const b = _game.board;
  const piece = b[fromR][fromC];
  if (!piece || piece === ' ') return { ok: false, error: 'No piece at source' };
  const pieceIsWhite = isWhitePiece(piece);
  if ((_game.turn === 'white' && !pieceIsWhite) || (_game.turn === 'black' && pieceIsWhite)) {
    return { ok: false, error: `Not ${_game.turn}'s piece` };
  }
  if (fromR === toR && fromC === toC) return { ok: false, error: 'Source equals destination' };

  const v = isValidMove(b, fromR, fromC, toR, toC, _game);
  if (!v.ok) return { ok: false, error: 'Illegal move: ' + v.reason };

  let captured = b[toR][toC] !== ' ' ? b[toR][toC] : null;
  const pType = piece.toLowerCase();

  // Apply the move (board mutation).
  b[toR][toC] = piece;
  b[fromR][fromC] = ' ';

  // Special-move side effects.
  if (v.special === 'castle') {
    const homeR = pieceIsWhite ? 7 : 0;
    const kingside = toC > fromC;
    const rookFromC = kingside ? 7 : 0;
    const rookToC = kingside ? toC - 1 : toC + 1;
    b[homeR][rookToC] = b[homeR][rookFromC];
    b[homeR][rookFromC] = ' ';
  }
  if (v.special === 'enpassant') {
    // The captured pawn sits on fromR, toC (one rank behind the
    // destination from the mover's perspective).
    captured = b[fromR][toC];
    b[fromR][toC] = ' ';
  }
  if (v.special === 'promote' || (pType === 'p' && (toR === 0 || toR === 7))) {
    // Default to queen if the caller didn't specify. (UI offers a
    // picker; AI auto-queens.)
    const promo = (promotionPiece || 'q').toLowerCase();
    const valid = ['q', 'r', 'b', 'n'].includes(promo) ? promo : 'q';
    b[toR][toC] = pieceIsWhite ? valid.toUpperCase() : valid;
  }

  // Update castling rights — any king move drops both for that side;
  // any rook move from a home corner drops the matching side.
  if (pType === 'k') {
    if (pieceIsWhite) { _game.castling.K = false; _game.castling.Q = false; }
    else              { _game.castling.k = false; _game.castling.q = false; }
  }
  if (pType === 'r') {
    if (pieceIsWhite) {
      if (fromR === 7 && fromC === 7) _game.castling.K = false;
      if (fromR === 7 && fromC === 0) _game.castling.Q = false;
    } else {
      if (fromR === 0 && fromC === 7) _game.castling.k = false;
      if (fromR === 0 && fromC === 0) _game.castling.q = false;
    }
  }
  // Capturing a rook on its home square also drops the matching right
  if (toR === 7 && toC === 7) _game.castling.K = false;
  if (toR === 7 && toC === 0) _game.castling.Q = false;
  if (toR === 0 && toC === 7) _game.castling.k = false;
  if (toR === 0 && toC === 0) _game.castling.q = false;

  // Update en-passant target — only set when a pawn just moved TWO squares.
  if (pType === 'p' && Math.abs(toR - fromR) === 2) {
    _game.enPassantTarget = [(fromR + toR) / 2, fromC];
  } else {
    _game.enPassantTarget = null;
  }

  // Switch sides
  _game.turn = _game.turn === 'white' ? 'black' : 'white';
  _game.selected = null;

  // Check for game-ending conditions on the new side-to-move.
  const nowWhite = _game.turn === 'white';
  const legalReplies = getAllLegalMoves(b, nowWhite, _game);
  const inCheck = isInCheck(b, nowWhite);
  if (legalReplies.length === 0) {
    _game.gameOver = inCheck
      ? `Checkmate — ${nowWhite ? 'black' : 'white'} wins`
      : 'Stalemate — draw';
    _game.inCheck = inCheck;
  } else {
    _game.inCheck = inCheck;
  }

  if (typeof _game.render === 'function') _game.render();
  return { ok: true, captured, special: v.special || null, inCheck: _game.inCheck, gameOver: _game.gameOver || null };
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
        render: null,
        autoPlay: false,
        autoTimer: null,
        // Real-chess state (2026-05-12)
        castling: { K: true, Q: true, k: true, q: true },
        enPassantTarget: null,
        halfmoveClock: 0,
        fullmoveNumber: 1,
        gameOver: null,        // null | string like "Checkmate — white wins" | "Stalemate — draw"
        inCheck: false,        // is the side-to-move currently in check
      };
      _game = state;

      function isWhite(p) { return p === p.toUpperCase() && p !== ' '; }

      // ─── AI: enumerate legal moves via the engine, score, pick ───
      const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

      function scoreMoves(moves, board) {
        for (const m of moves) {
          const captured = board[m.toR][m.toC];
          const captureVal = captured !== ' ' ? (PIECE_VALUES[captured.toLowerCase()] || 0) : 0;
          const centerBonus = (3.5 - Math.abs(m.toR - 3.5)) * 0.1 + (3.5 - Math.abs(m.toC - 3.5)) * 0.1;
          // Heavy bonus for moves that put the opponent in check
          const sim = cloneBoard(board);
          sim[m.toR][m.toC] = sim[m.fromR][m.fromC];
          sim[m.fromR][m.fromC] = ' ';
          const opponentWhite = !isWhite(sim[m.toR][m.toC]);
          const givesCheck = isInCheck(sim, opponentWhite) ? 2 : 0;
          m.score = captureVal * 10 + centerBonus + givesCheck + Math.random() * 0.5;
        }
        moves.sort((a, b) => b.score - a.score);
        return moves;
      }

      function aiMove() {
        if (!state.autoPlay || !_game || _game.gameOver) return;
        const isW = state.turn === 'white';
        const moves = scoreMoves(getAllLegalMoves(state.board, isW, state), state.board);
        if (moves.length === 0) return; // game already over; render will catch it
        // Pick from top 3 moves randomly for variety
        const pick = moves[Math.floor(Math.random() * Math.min(3, moves.length))];
        makeChessMove(pick.fromR, pick.fromC, pick.toR, pick.toC);
      }

      function toggleAutoPlay() {
        state.autoPlay = !state.autoPlay;
        if (state.autoPlay) {
          state.autoTimer = setInterval(() => {
            if (!state.autoPlay || !el.isConnected) {
              clearInterval(state.autoTimer);
              state.autoTimer = null;
              state.autoPlay = false;
              render();
              return;
            }
            aiMove();
          }, 800);
        } else {
          if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; }
        }
        render();
      }

      // Build a set of squares the currently-selected piece can move to
      // so the UI can highlight legal destinations as hints.
      function legalDestsFor(r, c) {
        const dests = new Set();
        const moves = getAllLegalMoves(state.board, isWhite(state.board[r][c]), state);
        for (const m of moves) {
          if (m.fromR === r && m.fromC === c) dests.add(m.toR * 8 + m.toC);
        }
        return dests;
      }

      function render() {
        const sz = 56;
        const dests = state.selected ? legalDestsFor(state.selected[0], state.selected[1]) : null;
        const statusLine = state.gameOver
          ? `<span style="font-size:14px;font-weight:700;color:#fab387;">${state.gameOver}</span>`
          : state.inCheck
            ? `<span style="font-size:14px;font-weight:700;color:#f38ba8;">${state.turn === 'white' ? '♔' : '♚'} ${state.turn} in CHECK</span>`
            : `<span style="font-size:14px;font-weight:600;">${state.turn === 'white' ? '♔' : '♚'} ${state.turn}'s turn</span>`;
        el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;height:100%;font-family:var(--font);color:white;background:#1a1a22;padding:16px;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            ${statusLine}
            <button id="ch-auto" style="padding:4px 12px;border-radius:6px;border:none;background:${state.autoPlay ? 'var(--accent)' : 'rgba(255,255,255,0.08)'};color:${state.autoPlay ? 'white' : 'rgba(255,255,255,0.7)'};font-size:11px;cursor:pointer;font-family:var(--font);">${state.autoPlay ? '🤖 Auto ON' : '🤖 Auto'}</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(8,${sz}px);border:2px solid #555;">
            ${state.board.flatMap((row, r) => row.map((p, c) => {
              const light = (r + c) % 2 === 0;
              const sel = state.selected && state.selected[0] === r && state.selected[1] === c;
              const hint = dests && dests.has(r * 8 + c);
              const bg = sel ? '#007aff' : light ? '#f0d9b5' : '#b58863';
              const hintDot = hint ? `<div style="position:absolute;width:14px;height:14px;border-radius:50%;background:${p === ' ' ? 'rgba(0,122,255,0.45)' : 'transparent'};box-shadow:${p === ' ' ? 'none' : 'inset 0 0 0 3px rgba(0,122,255,0.55)'};pointer-events:none;"></div>` : '';
              return `<div class="sq" data-r="${r}" data-c="${c}" style="position:relative;width:${sz}px;height:${sz}px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:36px;cursor:pointer;user-select:none;">${p !== ' ' ? (PIECES[p] || '') : ''}${hintDot}</div>`;
            })).join('')}
          </div>
          <button id="ch-reset" style="margin-top:12px;padding:8px 20px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);color:white;font-size:12px;cursor:pointer;font-family:var(--font);">New Game</button>
        </div>`;
        el.querySelectorAll('.sq').forEach(sq => {
          sq.onclick = () => {
            if (state.gameOver) return; // game ended; only New Game accepted
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
          state.castling = { K: true, Q: true, k: true, q: true };
          state.enPassantTarget = null;
          state.halfmoveClock = 0;
          state.fullmoveNumber = 1;
          state.gameOver = null;
          state.inCheck = false;
          if (state.autoPlay) { state.autoPlay = false; if (state.autoTimer) { clearInterval(state.autoTimer); state.autoTimer = null; } }
          render();
        };
        el.querySelector('#ch-auto').onclick = toggleAutoPlay;
      }

      state.render = render;
      render();

      // Cleanup on window close
      const _obs = new MutationObserver(() => {
        if (!el.isConnected) {
          if (state.autoTimer) clearInterval(state.autoTimer);
          _game = null;
          _obs.disconnect();
        }
      });
      if (el.parentElement) _obs.observe(el.parentElement, { childList: true, subtree: true });
    },
  });
}
