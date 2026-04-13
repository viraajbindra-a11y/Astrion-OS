// Astrion OS — Snake Game
// Phase 4 prep: exports getState() and makeMove() for game autoplay.
import { processManager } from '../kernel/process-manager.js';

// Module-level game API — accessible by game.* capabilities.
// Only one instance at a time (singleInstance: true).
let _game = null;

/**
 * Get the current snake game state. Returns null if no game is running.
 * @returns {{ snake: Array, dir: {x,y}, food: {x,y}, score: number, alive: boolean, width: number, height: number } | null}
 */
export function getSnakeState() {
  return _game ? {
    snake: _game.snake.map(s => ({ ...s })),
    dir: { ..._game.dir },
    food: { ..._game.food },
    score: _game.score,
    alive: _game.alive,
    width: _game.W,
    height: _game.H,
  } : null;
}

/**
 * Change the snake's direction. Validates against 180° turns.
 * @param {'up'|'down'|'left'|'right'} direction
 * @returns {{ ok: boolean, error?: string }}
 */
export function makeSnakeMove(direction) {
  if (!_game) return { ok: false, error: 'No snake game running' };
  if (!_game.alive) return { ok: false, error: 'Game over — press Space to restart' };
  const dirs = {
    up:    { x: 0, y: -1, blocked: { x: 0, y: 1 } },
    down:  { x: 0, y: 1,  blocked: { x: 0, y: -1 } },
    left:  { x: -1, y: 0, blocked: { x: 1, y: 0 } },
    right: { x: 1, y: 0,  blocked: { x: -1, y: 0 } },
  };
  const d = dirs[direction];
  if (!d) return { ok: false, error: `Invalid direction: ${direction}` };
  if (_game.dir.x === d.blocked.x && _game.dir.y === d.blocked.y) {
    return { ok: false, error: `Can't reverse into ${direction}` };
  }
  _game.dir = { x: d.x, y: d.y };
  return { ok: true };
}

export function registerSnake() {
  processManager.register('snake', {
    name: 'Snake', icon: '🐍', singleInstance: true, width: 440, height: 500,
    launch: (el) => {
      const W = 20, H = 20, SZ = 20;
      const state = {
        W, H,
        snake: [{ x: 10, y: 10 }],
        dir: { x: 1, y: 0 },
        food: { x: 15, y: 10 },
        score: 0,
        alive: true,
        interval: null,
      };
      _game = state;

      const canvas = document.createElement('canvas');
      canvas.width = W * SZ;
      canvas.height = H * SZ;
      canvas.style.cssText = 'display:block;margin:0 auto;background:#111;border-radius:8px;';
      el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;height:100%;background:#1a1a22;padding:16px;font-family:var(--font);color:white;">
        <div style="display:flex;justify-content:space-between;width:${W * SZ}px;margin-bottom:8px;">
          <span style="font-size:14px;font-weight:600;">Snake</span>
          <span id="sn-score" style="font-size:14px;">Score: 0</span>
        </div>
        <div id="sn-canvas"></div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:8px;">Arrow keys to move. Space to restart.</div>
      </div>`;
      el.querySelector('#sn-canvas').appendChild(canvas);
      const ctx = canvas.getContext('2d');

      function draw() {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, W * SZ, H * SZ);
        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(state.food.x * SZ, state.food.y * SZ, SZ - 1, SZ - 1);
        state.snake.forEach((s, i) => {
          ctx.fillStyle = i === 0 ? '#34c759' : '#2aa84a';
          ctx.fillRect(s.x * SZ, s.y * SZ, SZ - 1, SZ - 1);
        });
        if (!state.alive) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(0, 0, W * SZ, H * SZ);
          ctx.fillStyle = 'white';
          ctx.font = '20px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Game Over! Space to restart', W * SZ / 2, H * SZ / 2);
        }
      }

      function tick() {
        if (!state.alive) return;
        const head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
        if (head.x < 0 || head.x >= W || head.y < 0 || head.y >= H ||
            state.snake.some(s => s.x === head.x && s.y === head.y)) {
          state.alive = false;
          clearInterval(state.interval);
          draw();
          return;
        }
        state.snake.unshift(head);
        if (head.x === state.food.x && head.y === state.food.y) {
          state.score++;
          el.querySelector('#sn-score').textContent = 'Score: ' + state.score;
          state.food = { x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * H) };
        } else {
          state.snake.pop();
        }
        draw();
      }

      function reset() {
        state.snake = [{ x: 10, y: 10 }];
        state.dir = { x: 1, y: 0 };
        state.food = { x: 15, y: 10 };
        state.score = 0;
        state.alive = true;
        el.querySelector('#sn-score').textContent = 'Score: 0';
        if (state.interval) clearInterval(state.interval);
        state.interval = setInterval(tick, 120);
      }

      document.addEventListener('keydown', (e) => {
        if (!el.isConnected) return;
        if (e.key === 'ArrowUp' && state.dir.y !== 1) state.dir = { x: 0, y: -1 };
        else if (e.key === 'ArrowDown' && state.dir.y !== -1) state.dir = { x: 0, y: 1 };
        else if (e.key === 'ArrowLeft' && state.dir.x !== 1) state.dir = { x: -1, y: 0 };
        else if (e.key === 'ArrowRight' && state.dir.x !== -1) state.dir = { x: 1, y: 0 };
        else if (e.key === ' ' && !state.alive) reset();
      });

      reset();
    },
  });
}
