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
// not eyeballed): 0.72 = 9.2:1, 0.62 = 7.5:1, 0.55 = 6.1:1 -- all clear
// of 4.5:1. The old 0.35 secondary measured 3.2:1 and was too faint.
const INK = {
  strong: '#ffffff',
  body: 'rgba(255,255,255,0.72)',
  quiet: 'rgba(255,255,255,0.62)',
  meta: 'rgba(255,255,255,0.55)',
};
// Amber = caution, not failure. Red borders on every card read as "you
// broke something"; a tight machine has not broken anything.
const WARN = { text: '#ffb340', fill: 'rgba(255,159,10,0.10)', line: 'rgba(255,159,10,0.38)' };

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

// Ember's mark. Inline SVG, no assets, no emoji -- the old brain emoji
// rendered bright pink on a blue screen and read as clip art. Ember keeps
// its own warm color the way an app icon does; everything else on this
// screen stays on the user's chosen accent.
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

  const shell = (opt, tight, inner) => {
    const isPicked = state.brain === opt.id;
    const border = isPicked ? 'var(--accent)' : tight ? WARN.line : 'rgba(255,255,255,0.12)';
    const bg = isPicked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
    return `<div data-brain="${opt.id}" style="border:2px solid ${border};background:${bg};border-radius:12px;cursor:pointer;text-align:left;transition:border-color 0.18s,background 0.18s;">${inner}</div>`;
  };

  // The three sizes: name -> what you get -> what it is and what it costs.
  // Download size and RAM are different worries (a metered connection vs a
  // small machine), so they are two separate facts, right-aligned so the
  // numbers stack into a column you can compare down.
  const sizeCards = BRAIN_OPTIONS.filter(o => o.model).map(opt => {
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
    return shell(opt, tight, `
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
        style="width:100%;padding:9px 14px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.12);border-radius:10px;color:white;font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box;">
      <div style="font-size:12px;color:${INK.meta};margin-top:6px;">That machine needs Ollama running and reachable on your network.</div>
    </div>`;

  // Remote and Skip are a different kind of answer -- not "how big", but
  // "not here" and "not yet" -- so they sit below a rule, lighter.
  const otherCards = BRAIN_OPTIONS.filter(o => !o.model).map(opt => shell(opt, false, `
      <div style="padding:12px 18px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="font-size:14px;font-weight:600;color:rgba(255,255,255,0.92);">${opt.name}</div>
          ${badge(opt)}
        </div>
        <div style="font-size:12.5px;line-height:1.45;color:${INK.quiet};margin-top:4px;">${opt.blurb}</div>
        ${opt.id === 'remote' && state.brain === 'remote' ? remoteField : ''}
      </div>`)).join('');

  // Explicit margins everywhere: the browser's default h1/p margins were
  // leaking in and pushing the header out of rhythm (12px asked for,
  // ~31px on screen).
  el.innerHTML = `
    <div style="text-align:center;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:${SPACE.tight}px;margin-bottom:${SPACE.section}px;">
        <div style="line-height:0;margin-bottom:${SPACE.hair}px;">${emberMark(40)}</div>
        <h1 style="font-size:26px;font-weight:700;letter-spacing:-0.2px;margin:0;">Meet Ember</h1>
        <p style="font-size:14px;line-height:1.5;color:${INK.quiet};margin:0;">Ember runs on this machine. Nothing you type leaves it &mdash; no cloud, no key.</p>
        <p style="font-size:12px;color:${INK.meta};margin:0;">${ramLabel} &middot; ${metaTail}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:${SPACE.card}px;text-align:left;">${sizeCards}</div>
      <div style="height:1px;background:rgba(255,255,255,0.1);margin:${SPACE.tight}px 2px;"></div>
      <div style="display:flex;flex-direction:column;gap:${SPACE.card}px;text-align:left;">${otherCards}</div>
    </div>
  `;

  el.querySelectorAll('[data-brain]').forEach(card => {
    card.addEventListener('click', (e) => {
      // The URL input now sits inside the Remote card. Clicking into it
      // must not re-trigger the card's select-and-rerender, which would
      // rebuild the input and take the caret away mid-type.
      if (e.target.closest('#brain-remote-url')) return;
      state.brain = card.dataset.brain;
      onChange();
    });
  });

  const remoteInput = el.querySelector('#brain-remote-url');
  if (remoteInput) {
    remoteInput.addEventListener('focus', () => { remoteInput.style.borderColor = 'var(--accent)'; });
    remoteInput.addEventListener('blur', () => { remoteInput.style.borderColor = 'rgba(255,255,255,0.12)'; });
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
    <div style="margin-top:24px;background:rgba(255,255,255,0.08);border-radius:6px;height:8px;overflow:hidden;position:relative;">
      <div style="width:${barWidth}%;height:100%;background:var(--accent);border-radius:6px;transition:width 0.3s ease;${indeterminate ? 'animation:brainShimmer 1.4s infinite;width:30%;' : ''}"></div>
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

  el.innerHTML = `
    <style>@keyframes brainShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }</style>
    <div style="text-align:center;">
      <div style="margin-bottom:${SPACE.block}px;line-height:0;">${emberMark(40)}</div>
      <h1 style="font-size:26px;font-weight:700;letter-spacing:-0.2px;margin:0 0 ${SPACE.tight}px;">${state.pullError ? `${who} could not download` : `Getting ${who} ready`}</h1>
      <p style="font-size:12px;color:${INK.meta};margin:0;">${provenance}</p>
      ${progressBar}
      ${errorBlock}
    </div>
  `;

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

// 2026-08-29 — after the pull lands, brand the pulled base as `ember`
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
