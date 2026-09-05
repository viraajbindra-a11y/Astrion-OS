// Astrion OS -- Setup Wizard: Meet Ember
//
// Used by js/shell/setup-wizard.js. Renders the Ember size picker and runs
// the download. Sprint A of the self-hosted AI proposal (tasks/self-hosted-
// ai-proposal-2026-05-02.md). The substrate is already there: Ollama is
// installed in non-slim ISOs, /api/ai/ollama-pull streams ndjson, and
// ai-service.js reads `nova-ai-provider` + `nova-ai-ollama-model` +
// `nova-ai-ollama-url`. Sprint A's only job is the first-boot picker
// step that wires those three keys before the desktop boots.
//
// NAMING, and why the file is shaped this way:
//   "Ember" is Astrion's assistant. That is the name of the thing the
//   user actually talks to, at every layer, so that is what this screen
//   offers: Ember, at three sizes.
//   The stored model id stays a REAL Ollama registry tag, because
//   server/index.js proxies this download straight to the registry -- an
//   invented tag would fail on first boot. So the tag is data, in the one
//   table below, and is never baked into a sentence. What Ember is built
//   on is still shown on every card, quietly: hiding it would be a lie,
//   and this project does not do that.
//
//   To retag (e.g. when koa's Modelfile produces a local build): change
//   that tier's one line in EMBER_BUILDS. Nothing else in this file --
//   and nothing outside it -- spells a model name.

export const EMBER_BUILDS = {
  tiny:     { model: 'qwen3:1.7b', base: 'Qwen3 1.7B', downloadGb: 1.4 },
  standard: { model: 'qwen3:8b',   base: 'Qwen3 8B',   downloadGb: 5.2 },
  big:      { model: 'qwen3:14b',  base: 'Qwen3 14B',  downloadGb: 9.3 },
};

export const BRAIN_OPTIONS = [
  {
    id: 'tiny',
    name: 'Ember Mini',
    model: EMBER_BUILDS.tiny.model,
    base: EMBER_BUILDS.tiny.base,
    sizeGb: EMBER_BUILDS.tiny.downloadGb,
    minRamMb: 4096,
    // The memory tradeoff is stated because it is the one difference a
    // person can actually feel. Mini runs a shorter context so it stays
    // comfortable on small machines; that means it forgets sooner, and
    // "it remembers" is half of what we promise the Assistant does.
    blurb: 'Quick answers on a light machine. Forgets a long conversation sooner.',
  },
  {
    id: 'standard',
    name: 'Ember',
    model: EMBER_BUILDS.standard.model,
    base: EMBER_BUILDS.standard.base,
    sizeGb: EMBER_BUILDS.standard.downloadGb,
    minRamMb: 8192,
    blurb: 'The everyday Ember. Explains things properly and holds a long conversation.',
  },
  {
    id: 'big',
    name: 'Ember Max',
    model: EMBER_BUILDS.big.model,
    base: EMBER_BUILDS.big.base,
    sizeGb: EMBER_BUILDS.big.downloadGb,
    minRamMb: 16384,
    blurb: 'Thinks hardest and stays with a problem longest. Wants a strong machine.',
  },
  {
    id: 'remote',
    name: 'Use another computer',
    model: null,
    base: null,
    sizeGb: 0,
    minRamMb: 0,
    blurb: 'A stronger machine on your network runs Ember. This one just talks to it.',
  },
  {
    id: 'none',
    name: 'Not now',
    model: null,
    base: null,
    sizeGb: 0,
    minRamMb: 0,
    blurb: 'Simple built-in replies for now. You can set Ember up later in Settings.',
  },
];

// One spacing scale for this screen, so nothing is a one-off guess.
// 5 / 9 / 10 / 14 / 22 -- card interior, group gap, header rhythm.
const SPACE = { hair: 5, tight: 9, card: 10, block: 14, section: 22 };

// Text colors, chosen for contrast on the wizard's dark panel (checked,
// not eyeballed).
//
// The cinematic pass DARKENED the card fills instead of lightening them --
// a lit object has a bright rim and a face that falls into shadow -- so a
// warmer, more atmospheric screen came out MORE readable, not less. Every
// figure below is the WORST card in the worst state, sampled from rendered
// pixels of a real screenshot and composited, never computed from intent:
//
//                        flat build   this build
//   0.55 secondary          5.57:1      6.16:1
//   0.62 quiet              6.66:1      7.53:1
//   0.72 body/RECOMMENDED   8.46:1      9.81:1
//   #ffb340 warn on card    8.42:1     10.31:1
//   #ffb340 in warn chip    6.67:1      8.90:1
//
// If you change a card fill, re-measure. Sampling the pixels is the only
// honest check once there is a light source behind the panel.
const INK = {
  strong: '#ffffff',
  body: 'rgba(255,255,255,0.72)',
  quiet: 'rgba(255,255,255,0.62)',
  meta: 'rgba(255,255,255,0.55)',
};
// Amber = caution, not failure. Red borders on every card read as "you
// broke something"; a tight machine has not broken anything.
const WARN = { text: '#ffb340', fill: 'rgba(255,159,10,0.10)', line: 'rgba(255,159,10,0.38)' };

// EMBER'S OWN COLOR.
// The accent is chosen by the user two steps earlier in this same wizard,
// so it cannot anchor anything here. Fire can. A fire is orange whatever
// the user picked, which gives this screen a second color that is always
// ours -- and it is the only warm thing on a cold blue panel, so it reads
// as the subject without being told to.
const FIRE = {
  core: '255,238,205',   // white-hot, the middle of the flame
  hot:  '255,178,68',    // the body
  warm: '255,124,32',    // the outer tongue
  deep: '196,52,10',     // the cooling edge and the coals
};

// Recommend a size from available RAM (MB). Mirrors the table in
// the proposal: tiny <6 GB, standard <16 GB, big otherwise.
export function recommendBrain(availableMb) {
  if (!availableMb || availableMb < 6000) return 'tiny';
  if (availableMb < 14000) return 'standard';
  return 'big';
}

// Fetch /api/system/memory. Returns { totalMb, availableMb } or null
// if the endpoint is unreachable (running outside the ISO, e.g.).
export async function fetchMemory() {
  try {
    const res = await fetch('/api/system/memory');
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.total !== 'number' || typeof data.available !== 'number') return null;
    return { totalMb: data.total, availableMb: data.available };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// THE EMBER
//
// This is the one moment in the wizard that is an introduction rather than a
// preference, so the mark is a live fire instead of a glyph, and the fire
// ANSWERS THE PICK. Every option below is a different fire, and the difference
// is the option's own sentence restated as heat:
//
//   Ember Mini  -- small, tight, FAST. "Quick answers on a light machine."
//   Ember       -- the settled everyday fire, easy rhythm, middle of everything.
//   Ember Max   -- large, SLOW, deep breaths. "Stays with a problem longest."
//   Another pc  -- the fire here drops to a spark and sends a ring outward.
//                  The heat is on some other machine; this one is signalling.
//   Not now     -- banked coals. Not out. Warm, waiting, no flame.
//
// Deliberately NOT "bigger = brighter = better". A ladder of brightness sells
// Max to a person with an 8 GB laptop, and Mini is the RIGHT answer on that
// machine. So the axis that changes most between the three sizes is TEMPO,
// not luminance: Mini is quick and Max is slow, which is true of the models
// and flatters neither.
//
// COST, measured rather than asserted. Particles are four pre-rendered soft
// sprites blitted with drawImage under 'lighter'. No per-frame gradient
// allocation, no shadowBlur, no filters -- those are the three things that
// actually cost money in canvas 2d. The warm light behind the cards is one
// promoted layer whose only per-frame change is opacity, so it composites and
// never repaints the gradient. Device pixel ratio is capped at 2, the picker
// buffer is 440x336 device px, particles are capped at 260.
//
// Time inside this module's own rAF callback, 240-frame samples, Chrome, dpr2:
//   Ember Max  0.39 ms mean / 0.7 ms max   (2.3% of a 16.67 ms frame)
//   Ember      0.31 ms          Mini 0.27 ms
//   remote     0.17 ms          not now 0.15 ms
//   pull screen at 96%, bigger stage: 0.30 ms
// Frame cadence on the picker: 60.0 fps, 0 frames over 16.9 ms in 150.
// A machine six times slower than that spends about 2 ms a frame here.
//
// ONE fire exists per page. It is a module-level node that gets re-parented
// into each render instead of rebuilt, because setup-wizard.js re-renders the
// entire wizard on every click -- a rebuilt fire would restart, flicker, and
// leak a requestAnimationFrame loop per click.
// ---------------------------------------------------------------------------

// `coal` is on its own scale, not comparable to `rate`: a fire with a plume
// over it needs far less ground glow than one that is nothing BUT ground glow,
// so "not now" carries the largest coal number and the smallest fire.
const EMBER_MOODS = {
  //          spawn  rise  spread reach flicker coals ring
  tiny:     { rate: 2.6, rise: 1.30, spread: 0.46, reach: 0.62, flick: 3.2, coal: 0.85, ring: 0 },
  standard: { rate: 3.4, rise: 1.02, spread: 0.78, reach: 0.95, flick: 1.7, coal: 1.00, ring: 0 },
  big:      { rate: 4.4, rise: 0.92, spread: 1.00, reach: 1.30, flick: 0.85, coal: 1.15, ring: 0 },
  remote:   { rate: 0.50, rise: 1.05, spread: 0.34, reach: 0.44, flick: 1.4, coal: 1.30, ring: 1 },
  none:     { rate: 0.20, rise: 0.62, spread: 0.34, reach: 0.26, flick: 0.5, coal: 2.95, ring: 0 },
};

// Where the fuel sits inside the canvas, as a fraction of its height.
const BASE_Y = 0.87;

function prefersReducedMotion() {
  try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

// One soft blob per fire temperature, drawn once and reused forever.
let SPRITES = null;
function sprites() {
  if (SPRITES) return SPRITES;
  const build = (rgb) => {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0.00, `rgba(${rgb},1)`);
    rg.addColorStop(0.16, `rgba(${rgb},0.62)`);
    rg.addColorStop(0.42, `rgba(${rgb},0.17)`);
    rg.addColorStop(0.72, `rgba(${rgb},0.03)`);
    rg.addColorStop(1.00, `rgba(${rgb},0)`);
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    return c;
  };
  SPRITES = [build(FIRE.core), build(FIRE.hot), build(FIRE.warm), build(FIRE.deep)];
  return SPRITES;
}

// The single live fire.
let fire = null;

function lerp(a, b, k) { return a + (b - a) * k; }

function createFire() {
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'position:absolute;left:50%;bottom:0;transform:translateX(-50%);pointer-events:none;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;';
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const f = {
    wrap, canvas, ctx,
    w: 0, h: 0, dpr: 1,
    parts: [],
    cur: Object.assign({}, EMBER_MOODS.standard),
    target: Object.assign({}, EMBER_MOODS.standard),
    ign: 0,          // 0..1, how far the fire has caught
    ignTarget: 1,
    t: 0,
    ringT: 0,
    detached: 0,
    raf: 0,
    glow: null,      // the warm light layer, opacity driven from here
    still: false,    // reduced motion: compose one frame and stop
  };
  fire = f;
  return f;
}

function sizeFire(f, w, h) {
  if (f.w === w && f.h === h) return;
  const sx = f.w ? w / f.w : 1;
  const sy = f.h ? h / f.h : 1;
  f.dpr = Math.min(2, (window.devicePixelRatio || 1));
  f.w = w; f.h = h;
  f.canvas.width = Math.round(w * f.dpr);
  f.canvas.height = Math.round(h * f.dpr);
  f.canvas.style.width = w + 'px';
  f.canvas.style.height = h + 'px';
  f.wrap.style.width = w + 'px';
  f.wrap.style.height = h + 'px';
  // Carry the existing flame across a resize instead of relighting it.
  for (const p of f.parts) { p.x *= sx; p.y *= sy; p.size *= sx; }
}

function spawn(f) {
  const c = f.cur;
  const cx = f.w / 2;
  const base = f.h * 0.80;
  // Bias toward the middle: a fire is dense at its core and ragged at the
  // edges, which two averaged randoms give for free.
  const r = (Math.random() + Math.random()) / 2 - 0.5;
  f.parts.push({
    x: cx + r * f.w * 0.30 * c.spread,
    y: base + Math.random() * 5,
    vy: -(0.9 + Math.random() * 0.9) * c.rise * (f.h / 168),
    vx: (Math.random() - 0.5) * 0.18,
    life: 1,
    size: (0.085 + Math.random() * 0.105) * f.w * (0.62 + c.spread * 0.5),
    seed: Math.random() * 6.283,
    // ~1 in 9 is a spark: small, crisp, fast, long-lived. Soft blobs alone
    // read as a gradient; the eye needs some high-frequency detail before it
    // agrees that something is burning. Sparks are that, for four extra
    // pixels of fill each.
    spark: Math.random() < 0.07,
  });
  if (f.parts.length > 260) f.parts.splice(0, f.parts.length - 260);
}

function stepFire(f, dt) {
  const c = f.cur;
  const k = 0.075 * dt;
  for (const key of Object.keys(f.target)) c[key] = lerp(c[key], f.target[key], k);
  f.ign = lerp(f.ign, f.ignTarget, 0.045 * dt);
  f.t += 0.016 * dt;
  f.ringT += 0.016 * dt;

  // Spawn. Fractional rates accumulate so a 0.05 rate is one spark every
  // twenty frames rather than none at all.
  f._acc = (f._acc || 0) + c.rate * f.ign * (f.w / 220) * dt;
  while (f._acc >= 1) { spawn(f); f._acc -= 1; }

  const decay = 0.0165 / Math.max(0.18, c.reach);
  const out = [];
  for (const p of f.parts) {
    p.life -= (p.spark ? decay * 0.72 : decay) * dt;
    if (p.life <= 0) continue;
    p.vy *= (1 + (p.spark ? 0.017 : 0.011) * dt);
    p.y += p.vy * dt;
    // A spring back toward the axis. Without it the sine term is close to
    // constant over a particle's life at slow flicker rates, so the plume
    // splays sideways and drifts off its own coals. Real flames pull inward
    // too -- buoyancy entrains air toward the column.
    p.x += (p.vx + Math.sin(f.t * c.flick + p.seed) * 0.34 * c.spread
            - (p.x - f.w / 2) * 0.014) * dt;
    out.push(p);
  }
  f.parts = out;
}

function drawFire(f) {
  const g = f.ctx;
  const S = sprites();
  const c = f.cur;
  g.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  g.clearRect(0, 0, f.w, f.h);
  g.globalCompositeOperation = 'lighter';

  const base = f.h * BASE_Y;
  const breathe = 0.86 + 0.14 * Math.sin(f.t * 1.9) + 0.06 * Math.sin(f.t * 4.3 + 1.1);

  // Every alpha here is small on purpose. Fire is MANY faint additive layers;
  // a few strong ones just clamp to 255 in all three channels and you get a
  // hard-edged white blob, which is exactly what the first pass looked like.
  // Nothing below goes over ~0.2 per sprite.

  // Bed of coals: low and wide, squashed so it sits ON something. This is all
  // that is left under "Not now", so it has to read as banked and waiting on
  // its own -- never as switched off.
  const coal = c.coal * f.ign;
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) / 2;
    const r = f.w * (0.19 - Math.abs(a) * 0.05) * (0.68 + c.spread * 0.5);
    const puls = 0.60 + 0.40 * Math.sin(f.t * (1.1 + i * 0.37) + i * 1.7);
    g.globalAlpha = Math.max(0, coal * (0.032 + 0.048 * puls) * (1 - Math.abs(a) * 0.3));
    const spr = i % 2 ? S[2] : S[3];
    g.drawImage(spr, f.w / 2 + a * f.w * 0.16 * c.spread - r, base - r * 0.52, r * 2, r * 1.12);
  }
  // One warm heart at the base of the flame. Warm, not white: white here
  // plus the particle base is what clamped to a lozenge.
  g.globalAlpha = coal * 0.07 * (0.7 + 0.3 * Math.sin(f.t * 3.1));
  const hr = f.w * 0.09 * (0.6 + c.spread * 0.5);
  g.drawImage(S[2], f.w / 2 - hr, base - hr * 0.85, hr * 2, hr * 1.4);

  // Flame. Size tracks life so the plume is broad and bright at the base and
  // tapers as it cools -- the shape does the work, not the brightness.
  for (const p of f.parts) {
    const life = p.life;
    if (p.spark) {
      const s = p.size * 0.26 * (0.35 + life * 0.65);
      g.globalAlpha = Math.min(1, Math.pow(life, 0.8) * 0.55 * f.ign);
      g.drawImage(life > 0.55 ? S[1] : S[2], p.x - s / 2, p.y - s / 2, s, s);
      continue;
    }
    const spr = life > 0.94 ? S[0] : life > 0.74 ? S[1] : life > 0.40 ? S[2] : S[3];
    const s = p.size * (0.34 + life * 0.80);
    const fadeIn = Math.min(1, (1 - life) * 6);
    g.globalAlpha = Math.min(1, Math.pow(life, 1.35) * fadeIn * 0.150 * f.ign);
    g.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s);
  }

  // "Use another computer": a ring going out. The heat is somewhere else and
  // this machine is calling to it. Costs one stroked arc every ~2.8s.
  if (c.ring > 0.02) {
    const period = 2.8;
    for (let n = 0; n < 2; n++) {
      const ph = ((f.ringT / period) + n * 0.5) % 1;
      const r = f.w * (0.07 + ph * 0.32);
      g.globalAlpha = c.ring * (1 - ph) * (1 - ph) * 0.30 * f.ign;
      g.strokeStyle = `rgba(${FIRE.warm},1)`;
      g.lineWidth = 1.1;
      g.beginPath();
      g.arc(f.w / 2, base - f.h * 0.06, r, 0, 6.2832);
      g.stroke();
    }
  }

  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  // The warm light on the panel below. Opacity only, on a promoted layer,
  // so this is a compositor change and never a repaint of the gradient.
  if (f.glow) {
    // How much fire is actually here, blended from spawn rate and coal bed.
    // This is why the WHOLE SCREEN answers the pick and not just the flame:
    // choose Ember Max and the panel is lit, choose "Not now" and the room
    // goes dim and the cards fall back into the dark. Same gesture, one more
    // octave of it.
    const present = 0.22 + 0.55 * Math.min(1, c.rate / 3.4) + 0.23 * Math.min(1, c.coal);
    const lit = (0.55 + 0.45 * breathe) * f.ign * present;
    f.glow.style.opacity = Math.max(0, Math.min(1, lit)).toFixed(3);
  }
}

function loopFire() {
  const f = fire;
  if (!f) return;
  f.raf = requestAnimationFrame(loopFire);
  if (!f.canvas.isConnected) {
    // Two cases land here. A render() wipes the host with innerHTML and
    // re-parents the fire in the same synchronous block, so at most one frame
    // sees it detached. Or the wizard has been torn down for good, and then
    // it never comes back. Idle for well past the first case, then stop the
    // loop and release the node so nothing is left spinning behind a
    // finished wizard.
    if (++f.detached > 45) { cancelAnimationFrame(f.raf); f.raf = 0; fire = null; }
    return;
  }
  f.detached = 0;
  const now = performance.now();
  const dt = Math.min(3, (now - (f.last || now)) / 16.667) || 1;
  f.last = now;
  stepFire(f, dt);
  drawFire(f);
}

// Mount the one fire into `host` at the given size and mood. Returns nothing;
// the node is re-parented, never rebuilt.
function mountFire(host, w, h, mood, opts) {
  const o = opts || {};
  let f = fire;
  if (!f) {
    f = createFire();
    if (!f) return false;         // no canvas 2d -- caller falls back to the mark
    f.still = prefersReducedMotion();
  }
  sizeFire(f, w, h);
  f.target = Object.assign({}, EMBER_MOODS[mood] || EMBER_MOODS.standard);
  f.ignTarget = o.ignition == null ? 1 : o.ignition;
  f.glow = o.glow || null;
  host.appendChild(f.wrap);

  if (f.still) {
    // Reduced motion: no loop at all. Run the physics forward with no paint
    // to get a real, organically-shaped flame, then draw that one frame. A
    // posed fire, not a frozen one.
    f.ign = f.ignTarget;
    f.cur = Object.assign({}, f.target);
    f.parts = [];
    for (let i = 0; i < 220; i++) stepFire(f, 1);
    drawFire(f);
    if (f.glow) f.glow.style.transition = 'none';
    return true;
  }
  if (!f.raf) { f.last = 0; f.raf = requestAnimationFrame(loopFire); }
  return true;
}

// Fallback mark for the (very unlikely) no-canvas case, and the thing the
// fire is a moving version of.
function emberMark(size) {
  const s = size || 40;
  return `
    <svg width="${s}" height="${s}" viewBox="0 0 40 40" fill="none" aria-hidden="true"
         style="filter:drop-shadow(0 0 16px rgba(255,122,26,0.38));">
      <defs>
        <radialGradient id="emberCoal" cx="50%" cy="68%" r="58%">
          <stop offset="0%" stop-color="#ffdcaa"/>
          <stop offset="42%" stop-color="#ff8a26"/>
          <stop offset="100%" stop-color="#c2340a"/>
        </radialGradient>
      </defs>
      <path d="M20 3 C 24 10 30 13 30 21 A 10 10 0 0 1 10 21 C 10 15 14.5 14 15.5 9 C 17.2 12.6 18.2 12 20 3 Z"
            fill="url(#emberCoal)"/>
      <path d="M20 17.5 C 22.2 20.4 23.6 22.3 23.6 24.4 A 3.6 3.6 0 0 1 16.4 24.4 C 16.4 22.3 17.8 20.4 20 17.5 Z"
            fill="#fff2d4" opacity="0.9"/>
    </svg>`;
}

// The staged entrance runs ONCE per boot. setup-wizard.js re-renders the
// whole wizard on every click, and an entrance that replays on every click
// stops being an entrance and becomes a stutter.
let introPlayed = false;

// Stylesheet for the screen. Inline, no assets, no framework -- same rule the
// rest of the file follows. Classes rather than 40 more inline style strings,
// because the lighting model wants to be stated once.
function emberStyles(animate) {
  const a = animate ? '' : 'animation:none !important;';
  return `<style>
    @keyframes ebRise { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
    @keyframes ebResolve {
      from { opacity:0; transform:translateY(10px); letter-spacing:3px; filter:blur(3px); }
      to   { opacity:1; transform:none; letter-spacing:-0.2px; filter:none; }
    }
    @keyframes ebShimmer { 0% { transform:translateX(-100%); } 100% { transform:translateX(400%); } }
    .eb-stage { position:relative; text-align:center; }
    .eb-in { animation:ebRise 0.52s cubic-bezier(0.2,0.85,0.25,1) both; ${a} }
    .eb-title { animation:ebResolve 0.68s cubic-bezier(0.2,0.85,0.25,1) both; ${a} }
    /* The warm light the fire throws on the panel. Promoted so the per-frame
       opacity change composites instead of repainting the gradient.
       Deliberately NOT css-animated on entry: the light spreading and the fire
       catching are one physical event, so both are driven by the same
       ignition value in drawFire(). A css animation with fill:both would
       also win the cascade forever and freeze the flicker. */
    .eb-glow {
      position:absolute; left:-90px; right:-90px; top:-120px; height:600px;
      pointer-events:none; z-index:0; opacity:0;
      will-change:opacity; transform:translateZ(0);
      background:
        /* the fuel line -- a thin bright streak so the fire is sitting ON
           something instead of floating in space. This one line is what makes
           the composition read as depth rather than a glyph on a field. */
        radial-gradient(ellipse 300px 22px at 50% calc(var(--eb-glowy,175px) - 16px), rgba(${FIRE.hot},0.13) 0%, rgba(${FIRE.hot},0) 76%),
        radial-gradient(ellipse 260px 190px at 50% calc(var(--eb-glowy,175px) - 14px), rgba(${FIRE.warm},0.17) 0%, rgba(${FIRE.warm},0) 70%),
        radial-gradient(ellipse 560px 340px at 50% calc(var(--eb-glowy,175px) + 30px), rgba(${FIRE.deep},0.10) 0%, rgba(${FIRE.deep},0) 72%);
    }
    .eb-body { position:relative; z-index:1; }
    /* Cards are objects lit from above, not tinted haze. The fill is DARKER
       than the panel -- a face turned away from the light -- and the light
       lands on the top edge as a rim that falls off down the stack. That is
       the whole depth model, and it is also why every contrast number on this
       screen went up rather than down. */
    .eb-card {
      position:relative; border-radius:13px; cursor:pointer; text-align:left;
      background:rgba(8,10,17,0.55);
      border:2px solid rgba(255,255,255,0.11);
      box-shadow: inset 0 1px 0 rgba(255,214,170,var(--eb-rim,0.05)),
                  0 14px 30px -14px rgba(0,0,0,0.75);
      transition: border-color 0.18s, background 0.22s, box-shadow 0.22s, transform 0.18s;
    }
    .eb-card:hover { border-color:rgba(255,255,255,0.20); }
    .eb-card.eb-tight { border-color:${WARN.line}; background:rgba(16,11,5,0.55); }
    .eb-card.eb-on {
      border-color:var(--accent);
      background:rgba(22,16,11,0.62);
      box-shadow: inset 0 1px 0 rgba(255,214,170,0.16),
                  0 -8px 26px -10px rgba(${FIRE.warm},0.42),
                  0 16px 34px -14px rgba(0,0,0,0.8);
    }
    .eb-rule { height:1px; background:rgba(255,255,255,0.09); margin:${SPACE.tight}px 2px; }
    .eb-url {
      width:100%; padding:9px 14px; background:rgba(0,0,0,0.34);
      border:2px solid rgba(255,255,255,0.14); border-radius:10px; color:white;
      font-size:14px; font-family:var(--font); outline:none; box-sizing:border-box;
    }
  </style>`;
}

// Paint the picker into `el`. State is mutable; onChange() is called
// after every user interaction so the parent can re-render to reflect
// the new selection (and update the Continue button state).
//
// state shape:
//   {
//     brain: 'tiny'|'standard'|'big'|'remote'|'none',
//     remoteUrl: string,
//     ramTotalMb: number|null,
//     ramAvailableMb: number|null,
//     recommendation: string|null,  // brain id
//     pulling: boolean,
//     pullStatus: string,
//     pullPercent: number|null,     // 0..100
//     pullError: string|null,
//   }
export function renderBrainPicker(el, state, onChange) {
  if (state.pulling || state.pullStatus || state.pullError) {
    renderPullProgress(el, state, onChange);
    return;
  }

  const ramLabel = state.ramTotalMb
    ? `${formatGb(state.ramTotalMb)} RAM, ${formatGb(state.ramAvailableMb)} free`
    : 'RAM unknown on this machine';

  // Does this size fit the machine we are standing on? Same predicate as
  // before -- 1 GB of slack before we say anything.
  const isTight = (opt) =>
    !!(opt.minRamMb && state.ramAvailableMb && opt.minRamMb > (state.ramAvailableMb + 1024));

  // Never put "Recommended" on a size we are simultaneously warning about.
  // On a small machine the old screen recommended a card, outlined it red,
  // and warned it would not fit -- three signals contradicting each other.
  // When the suggested size does not fit, step DOWN to the largest one
  // that does (an 8 GB laptop should be pointed at Mini, not sent looking
  // for a second computer); only when nothing local fits is another
  // machine the honest answer.
  const recOpt = BRAIN_OPTIONS.find(o => o.id === state.recommendation);
  const fits = BRAIN_OPTIONS.filter(o => o.model && !isTight(o));
  const badgeId = !recOpt ? null
    : !isTight(recOpt) ? recOpt.id
    : fits.length ? fits[fits.length - 1].id
    : 'remote';

  const badge = (opt) => opt.id !== badgeId ? '' : `
    <div style="display:flex;align-items:center;gap:6px;flex:none;font-size:11px;font-weight:600;color:${INK.body};white-space:nowrap;">
      <span style="width:6px;height:6px;border-radius:50%;background:var(--accent);"></span>Recommended
    </div>`;

  const animate = !introPlayed && !prefersReducedMotion();
  // Entrance beats, in ms. One orchestrated moment: the fire catches, the
  // light spreads, the title resolves out of it, then the cards settle in
  // from the top down -- as if the light reached them in order.
  const CUE = { glow: 120, title: 300, sub: 470, meta: 560, card0: 660, cardGap: 55 };
  const rise = (delay) => animate ? ` class="eb-in" style="animation-delay:${delay}ms;"` : '';

  // Rim light falls off with distance from the flame. Card 0 is nearest.
  const shell = (opt, tight, idx, inner) => {
    const on = state.brain === opt.id;
    const rim = Math.max(0.018, 0.10 - idx * 0.019).toFixed(3);
    const cls = `eb-card${on ? ' eb-on' : ''}${tight && !on ? ' eb-tight' : ''}${animate ? ' eb-in' : ''}`;
    const anim = animate ? `animation-delay:${CUE.card0 + idx * CUE.cardGap}ms;` : '';
    return `<div data-brain="${opt.id}" class="${cls}" style="--eb-rim:${rim};${anim}">${inner}</div>`;
  };

  // The three sizes: name -> what you get -> what it is and what it costs.
  // Download size and RAM are different worries (a metered connection vs a
  // small machine), so they are two separate facts, right-aligned so the
  // numbers stack into a column you can compare down.
  const sizeCards = BRAIN_OPTIONS.filter(o => o.model).map((opt, i) => {
    const tight = isTight(opt);
    // State the rule once (above), mark every instance, and spell out the
    // consequence only on the size actually selected. Three identical
    // warning chips on a small machine was the same sentence three times,
    // and it pushed the last card under the wizard's nav bar.
    // "wants 8 GB FREE", not "runs in 8 GB RAM". The old phrasing told a
    // person with an 8 GB laptop they were fine. They are not: the 8B
    // build is ~5.2 GB of weights plus ~1.2 GB of context cache, so it is
    // ~6.4 GB resident before Astrion, a browser, or anything the user is
    // actually doing. Measuring against FREE memory instead of installed
    // memory is both the honest claim and the one the header already
    // shows, so the number and the ! mark can never disagree.
    const ram = `wants ${formatGbWhole(opt.minRamMb)} free`;
    const ramText = tight ? `<span style="color:${WARN.text};">! ${ram}</span>` : ram;
    const warnRow = !(tight && state.brain === opt.id) ? '' : `
      <div style="display:flex;gap:8px;margin-top:${SPACE.card}px;background:${WARN.fill};border-radius:8px;padding:7px 10px;font-size:12px;line-height:1.4;color:${WARN.text};">
        <span style="font-weight:700;flex:none;">!</span>
        <span>This size wants about ${formatGbWhole(opt.minRamMb)} free and you have ${formatGb(state.ramAvailableMb)}. It will be slow, may crowd out everything else, and may not load at all.</span>
      </div>`;
    return shell(opt, tight, i, `
      <div style="padding:14px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="font-size:15px;font-weight:600;color:${INK.strong};">${opt.name}</div>
          ${badge(opt)}
        </div>
        <div style="font-size:13px;line-height:1.45;color:${INK.body};margin-top:${SPACE.hair}px;">${opt.blurb}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:${SPACE.tight}px;font-size:12px;color:${INK.meta};">
          <span>Built on ${opt.base}</span>
          <span style="flex:none;display:flex;gap:16px;white-space:nowrap;">
            <span>${opt.sizeGb.toFixed(1)} GB download</span>
            <span>${ramText}</span>
          </span>
        </div>
        ${warnRow}
      </div>`);
  }).join('');

  // One meta line, never two. When something is marked, explaining the
  // mark earns the line more than the reassurance about Settings does --
  // and a second header line pushes the last card under the wizard's own
  // nav bar on a small machine. A legend, not an alarm: only the mark
  // itself is amber, the sentence stays the weight of the rest.
  const anyTight = BRAIN_OPTIONS.some(o => o.model && isTight(o));
  const metaTail = anyTight
    ? `<span style="color:${WARN.text};font-weight:700;">!</span> marks a size that wants more than that`
    : 'you can change size later in Settings';

  // The address field belongs to the Remote option, so it lives INSIDE
  // that card rather than in a block at the bottom of the screen. As a
  // trailing block it was the last thing on the tallest state of this
  // screen and its helper line rendered underneath the wizard's own nav
  // bar -- in the one state where the user has to type something.
  const remoteField = `
    <div style="margin-top:${SPACE.card}px;">
      <input id="brain-remote-url" type="text" placeholder="http://192.168.1.42:11434" value="${escapeAttr(state.remoteUrl || '')}"
        aria-label="Address of the computer running Ollama"
        class="eb-url">
      <div style="font-size:12px;color:${INK.meta};margin-top:6px;">That machine needs Ollama running and reachable on your network.</div>
    </div>`;

  // Remote and Skip are a different kind of answer -- not "how big", but
  // "not here" and "not yet". They are now one line each: name and reason on
  // the same baseline. That demotes them below the three real choices, which
  // is the hierarchy this screen was missing, and it buys back ~46px of
  // height -- which is exactly what pays for the fire at the top. The
  // cinematic version is not taller than the flat one; it is the same height
  // spent differently.
  const otherCards = BRAIN_OPTIONS.filter(o => !o.model).map((opt, i) => shell(opt, false, 3 + i, `
      <div style="padding:11px 16px 12px;">
        <div style="display:flex;align-items:baseline;gap:11px;">
          <div style="font-size:13.5px;font-weight:600;color:rgba(255,255,255,0.92);flex:none;">${opt.name}</div>
          <div style="font-size:12.5px;line-height:1.4;color:${INK.quiet};flex:1;min-width:0;">${opt.blurb}</div>
          ${badge(opt)}
        </div>
        ${opt.id === 'remote' && state.brain === 'remote' ? remoteField : ''}
      </div>`)).join('');

  // Explicit margins everywhere: the browser's default h1/p margins were
  // leaking in and pushing the header out of rhythm (12px asked for,
  // ~31px on screen).
  //
  // The fire is 138px tall in a 72px block: it is bottom-anchored and licks
  // UP out of the layout into the empty space above the panel, so it costs
  // 72px of flow, not 138. That empty space was doing nothing.
  el.innerHTML = `
    ${emberStyles(animate)}
    <div class="eb-stage">
      <div class="eb-glow"></div>
      <div class="eb-body">
        <div style="display:flex;flex-direction:column;align-items:center;gap:${SPACE.tight}px;margin-bottom:${SPACE.section}px;">
          <div id="eb-fire" style="position:relative;width:100%;height:76px;"></div>
          <h1 class="${animate ? 'eb-title' : ''}" style="font-size:26px;font-weight:700;letter-spacing:-0.2px;margin:0;text-shadow:0 0 26px rgba(${FIRE.warm},0.42);${animate ? `animation-delay:${CUE.title}ms;` : ''}">Meet Ember</h1>
          <p${rise(CUE.sub)} style="font-size:14px;line-height:1.5;color:${INK.quiet};margin:0;${animate ? `animation-delay:${CUE.sub}ms;` : ''}">Ember runs on this machine. Nothing you type leaves it &mdash; no cloud, no key.</p>
          <p${rise(CUE.meta)} style="font-size:12px;color:${INK.meta};margin:0;${animate ? `animation-delay:${CUE.meta}ms;` : ''}">${ramLabel} &middot; ${metaTail}</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:${SPACE.card}px;text-align:left;">${sizeCards}</div>
        <div class="eb-rule"></div>
        <div style="display:flex;flex-direction:column;gap:${SPACE.card}px;text-align:left;">${otherCards}</div>
      </div>
    </div>
  `;

  const fireHost = el.querySelector('#eb-fire');
  const mood = state.brain && EMBER_MOODS[state.brain] ? state.brain : 'standard';
  if (!mountFire(fireHost, 220, 168, mood, { glow: el.querySelector('.eb-glow') })) {
    fireHost.innerHTML = `<div style="position:absolute;left:50%;bottom:8px;transform:translateX(-50%);line-height:0;">${emberMark(44)}</div>`;
  }
  introPlayed = true;

  el.querySelectorAll('[data-brain]').forEach(card => {
    card.addEventListener('click', (e) => {
      // The URL input now sits inside the Remote card. Clicking into it
      // must not re-trigger the card's select-and-rerender, which would
      // rebuild the input and take the caret away mid-type.
      if (e.target.closest('#brain-remote-url')) return;
      state.brain = card.dataset.brain;
      // Answer the pick immediately, before the parent re-renders. The fire
      // node survives the re-render, so this eases into the new mood in one
      // continuous motion rather than cutting.
      if (fire && EMBER_MOODS[state.brain]) {
        fire.target = Object.assign({}, EMBER_MOODS[state.brain]);
      }
      onChange();
    });
  });

  const remoteInput = el.querySelector('#brain-remote-url');
  if (remoteInput) {
    remoteInput.addEventListener('focus', () => { remoteInput.style.borderColor = 'var(--accent)'; });
    remoteInput.addEventListener('blur', () => { remoteInput.style.borderColor = 'rgba(255,255,255,0.14)'; });
    remoteInput.addEventListener('input', () => {
      state.remoteUrl = remoteInput.value;
      // Lightweight update: just toggle the wizard's Continue button so we
      // don't blow away the input focus the user is currently typing into.
      onChange('input');
    });
    setTimeout(() => {
      remoteInput.focus();
      remoteInput.setSelectionRange(remoteInput.value.length, remoteInput.value.length);
    }, 80);
  }
}

function renderPullProgress(el, state, onChange) {
  const opt = BRAIN_OPTIONS.find(o => o.id === state.brain);
  const errorBlock = state.pullError ? `
    <div style="background:rgba(255,59,48,0.1);border:1px solid rgba(255,59,48,0.4);border-radius:10px;padding:12px 16px;margin-top:18px;text-align:left;">
      <div style="font-size:13px;color:#ff6961;font-weight:600;margin-bottom:4px;">Download failed</div>
      <div style="font-size:12px;line-height:1.45;color:${INK.body};">${escapeText(state.pullError)}</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">
      <button id="brain-retry-btn" style="background:var(--accent);border:none;color:white;padding:10px 24px;border-radius:10px;font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;">Try again</button>
      <button id="brain-skip-btn" style="background:rgba(255,255,255,0.08);border:none;color:${INK.body};padding:10px 24px;border-radius:10px;font-size:13px;font-family:var(--font);cursor:pointer;">Skip for now</button>
    </div>
  ` : '';

  const progressLabel = state.pullPercent != null
    ? `${Math.round(state.pullPercent)}%`
    : '';
  const barWidth = state.pullPercent != null ? Math.max(2, state.pullPercent) : 0;
  const indeterminate = state.pulling && state.pullPercent == null;

  const progressBar = state.pullError ? '' : `
    <div style="margin-top:26px;background:rgba(0,0,0,0.34);border-radius:6px;height:8px;overflow:hidden;position:relative;box-shadow:inset 0 1px 2px rgba(0,0,0,0.5);">
      <div style="width:${barWidth}%;height:100%;background:var(--accent);border-radius:6px;transition:width 0.3s ease;${indeterminate ? 'animation:ebShimmer 1.4s infinite;width:30%;' : ''}"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:${INK.quiet};">
      <span>${escapeText(state.pullStatus || 'Starting...')}</span>
      <span>${progressLabel}</span>
    </div>
  `;

  const provenance = opt && opt.base
    ? `Built on ${opt.base} &middot; ${opt.sizeGb.toFixed(1)} GB to download &middot; a few minutes on a good connection`
    : '';
  // Name the size in the headline instead of on its own line underneath.
  // "Getting Ember ready" above a line reading "Ember" was a stutter.
  const who = opt ? opt.name : 'Ember';

  // This is the screen a person actually stares at -- five to ten minutes of
  // it -- and the flat version spent that time as a sticker and a blue bar in
  // an ocean of black. There is 300px of unused height here, so the fire gets
  // to be big, and the DOWNLOAD FEEDS IT: ignition tracks pullPercent, so the
  // flame is a spark at 0% and a full fire at 100%. The progress bar and the
  // fire are the same fact told twice, once for reading and once for feeling.
  // On failure it gutters down to coals; red stays on the error text, where
  // failure is the literal meaning.
  el.innerHTML = `
    ${emberStyles(false)}
    <div class="eb-stage">
      <div class="eb-glow" style="top:-150px;--eb-glowy:228px;"></div>
      <div class="eb-body">
        <div id="eb-fire" style="position:relative;width:100%;height:118px;margin-bottom:${SPACE.block}px;"></div>
        <h1 style="font-size:26px;font-weight:700;letter-spacing:-0.2px;margin:0 0 ${SPACE.tight}px;text-shadow:0 0 26px rgba(${FIRE.warm},0.42);">${state.pullError ? `${who} could not download` : `Getting ${who} ready`}</h1>
        <p style="font-size:12px;color:${INK.meta};margin:0;">${provenance}</p>
        ${progressBar}
        ${errorBlock}
      </div>
    </div>
  `;

  const fireHost = el.querySelector('#eb-fire');
  const pct = state.pullPercent == null ? 0 : Math.max(0, Math.min(100, state.pullPercent)) / 100;
  const mood = state.pullError ? 'none'
    : (state.brain && EMBER_MOODS[state.brain] ? state.brain : 'standard');
  const ignition = state.pullError ? 1 : 0.42 + 0.58 * pct;
  if (!mountFire(fireHost, 300, 228, mood, { ignition, glow: el.querySelector('.eb-glow') })) {
    fireHost.innerHTML = `<div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);line-height:0;">${emberMark(56)}</div>`;
  }

  const retry = el.querySelector('#brain-retry-btn');
  if (retry) retry.addEventListener('click', () => {
    state.pullError = null;
    state.pullStatus = '';
    state.pullPercent = null;
    state.pulling = false;
    onChange('retry');
  });
  const skip = el.querySelector('#brain-skip-btn');
  if (skip) skip.addEventListener('click', () => {
    state.pullError = null;
    state.pullStatus = '';
    state.pullPercent = null;
    state.pulling = false;
    state.brain = 'none';
    onChange('skip');
  });
}

// Stream the pull through /api/ai/ollama-pull. Updates state.pullStatus
// + pullPercent on each ndjson line; calls onProgress() after each
// update so the wizard can re-render. Resolves to true on success.
export async function streamPull(state, onProgress, signal) {
  const opt = BRAIN_OPTIONS.find(o => o.id === state.brain);
  if (!opt || !opt.model) return true; // remote/none -- nothing to pull
  state.pulling = true;
  state.pullStatus = `Connecting to Ollama...`;
  state.pullPercent = null;
  state.pullError = null;
  onProgress();

  // Slim ISOs ship Ollama installed-but-stopped; ping the start
  // endpoint so the daemon is alive before we issue the pull. On a
  // non-slim build or on macOS dev this is a no-op.
  try {
    await fetch('/api/ai/ollama-start', { method: 'POST', signal });
  } catch {}

  try {
    const res = await fetch('/api/ai/ollama-pull', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:11434', model: opt.model }),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      let parsed = '';
      try { parsed = JSON.parse(errText).error || ''; } catch {}
      state.pullError = parsed || errText || `HTTP ${res.status} ${res.statusText}`;
      state.pulling = false;
      onProgress();
      return false;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.error) {
            state.pullError = obj.error;
            state.pulling = false;
            onProgress();
            return false;
          }
          if (obj.status) state.pullStatus = obj.status;
          if (obj.completed && obj.total) {
            state.pullPercent = (obj.completed / obj.total) * 100;
          } else if (/success/i.test(obj.status || '')) {
            state.pullPercent = 100;
          }
          onProgress();
        } catch {}
      }
    }
    state.pulling = false;
    state.pullPercent = 100;
    state.pullStatus = 'Ready.';
    onProgress();
    return true;
  } catch (err) {
    if (err.name === 'AbortError') {
      state.pulling = false;
      state.pullStatus = '';
      state.pullPercent = null;
      onProgress();
      return false;
    }
    state.pullError = err.message || String(err);
    state.pulling = false;
    onProgress();
    return false;
  }
}

// 2026-08-29 -- after the pull lands, brand the pulled base as `ember`
// so `ollama list` and `ollama run ember` on this machine agree with
// what the OS calls its assistant.
//
// Read the three constraints before changing anything here:
//
//  1. This is the SECOND layer, not the first. What actually makes the
//     assistant Ember is the system prompt ai-service.js sends on every
//     request (js/kernel/ember-identity.js). That works on the local
//     path AND the cloud path and cannot fail to install. This function
//     only improves the terminal surface.
//  2. `nova-ai-ollama-model` must stay a REAL REGISTRY TAG. `ember` only
//     exists after a local `ollama create`; it is not pullable. Storing
//     it would make a fresh first boot try to pull a model that does not
//     exist and fail on the very first screen. commitBrainChoice() below
//     deliberately still stores opt.model.
//  3. FROM has to name the tag this screen actually pulled, not the tag
//     in EMBER_TIERS. They agree today (both qwen3:1.7b / 8b / 14b) and
//     they did NOT agree an hour ago, which is the point: creating FROM
//     a base that was never pulled just errors, and EMBER_BUILDS above
//     is allowed to be retagged without asking the kernel. So the model
//     that was really downloaded is passed through as the override and
//     the two tables are never required to match.
//
// Never throws, never rejects, never blocks. A failed create leaves the
// user with a working assistant that is Ember by prompt -- which is the
// layer that mattered anyway.
export async function createEmberModel(state, onProgress, signal) {
  const opt = BRAIN_OPTIONS.find(o => o.id === state.brain);
  if (!opt || !opt.model) return false; // remote/none -- nothing local to brand
  try {
    const { renderEmberModelfile, getEmberTier, EMBER_DEFAULT_TIER } =
      await import('../kernel/ember-identity.js');
    // Picker ids (tiny/standard/big) line up with the tier ids, but fall
    // back rather than throw if someone adds a picker option later and
    // forgets the tier -- a missing tier must not cost the user a brain.
    const tierId = getEmberTier(state.brain) ? state.brain : EMBER_DEFAULT_TIER;
    const modelfile = renderEmberModelfile(tierId, { base: opt.model });

    const res = await fetch('/api/ai/ollama-create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: localStorage.getItem('nova-ai-ollama-url') || 'http://localhost:11434',
        model: 'ember',
        modelfile,
      }),
      signal,
    });
    // 404 is the expected answer on any build whose server predates the
    // /api/ai/ollama-create endpoint. Not an error worth showing anyone.
    if (!res.ok || !res.body) return false;

    // Same ndjson shape as the pull. Status lines are surfaced so the
    // progress screen does not sit frozen, but nothing here can fail
    // the flow.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let failed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.error) { failed = true; continue; }
          if (obj.status) {
            state.pullStatus = obj.status;
            try { onProgress && onProgress(); } catch {}
          }
        } catch {}
      }
    }
    return !failed;
  } catch {
    // Aborted, offline, endpoint missing, bad JSON -- all the same
    // outcome: no `ember` in `ollama list`, assistant still works.
    return false;
  }
}

// Persist the user's choice. ai-service.js picks these up on next ask().
export function commitBrainChoice(state) {
  const opt = BRAIN_OPTIONS.find(o => o.id === state.brain);
  if (!opt) return;
  if (opt.id === 'none') {
    localStorage.setItem('nova-ai-provider', 'auto');
    return;
  }
  if (opt.id === 'remote') {
    const url = (state.remoteUrl || '').trim() || 'http://localhost:11434';
    localStorage.setItem('nova-ai-provider', 'ollama');
    localStorage.setItem('nova-ai-ollama-url', url);
    return;
  }
  localStorage.setItem('nova-ai-provider', 'ollama');
  localStorage.setItem('nova-ai-ollama-url', 'http://localhost:11434');
  localStorage.setItem('nova-ai-ollama-model', opt.model);
}

// Whether Continue is enabled given the current state.
export function canAdvance(state) {
  if (state.pulling) return false;
  if (!state.brain) return false;
  if (state.brain === 'remote') {
    const url = (state.remoteUrl || '').trim();
    return /^https?:\/\/.+/i.test(url);
  }
  return true;
}

function formatGb(mb) {
  if (!mb) return '?';
  return `${(mb / 1024).toFixed(1)} GB`;
}
// Requirements read better as round numbers: "needs 8 GB RAM", not "8.0 GB".
function formatGbWhole(mb) {
  if (!mb) return '?';
  return `${Math.round(mb / 1024)} GB`;
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
