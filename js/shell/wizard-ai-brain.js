// Astrion OS — Setup Wizard: Pick your AI brain
//
// Used by js/shell/setup-wizard.js. Renders the brain picker and runs the
// pull. Sprint A of the self-hosted AI proposal (tasks/self-hosted-ai-
// proposal-2026-05-02.md). The substrate is already there: Ollama is
// installed in non-slim ISOs, /api/ai/ollama-pull streams ndjson, and
// ai-service.js reads `nova-ai-provider` + `nova-ai-ollama-model` +
// `nova-ai-ollama-url`. Sprint A's only job is the first-boot picker
// step that wires those three keys before the desktop boots.

export const BRAIN_OPTIONS = [
  {
    id: 'tiny',
    name: 'Tiny',
    model: 'qwen2.5:1.5b',
    sizeGb: 1.0,
    minRamMb: 4096,
    blurb: 'Snappy on low-RAM laptops & Chromebooks.',
    detail: 'qwen2.5:1.5b · ~1 GB · runs in 4 GB RAM.',
  },
  {
    id: 'standard',
    name: 'Standard',
    model: 'qwen2.5:7b',
    sizeGb: 4.7,
    minRamMb: 8192,
    blurb: 'Balanced — good for most laptops.',
    detail: 'qwen2.5:7b · ~4.7 GB · runs in 8 GB RAM.',
  },
  {
    id: 'big',
    name: 'Big',
    model: 'gpt-oss:16b',
    sizeGb: 10.0,
    minRamMb: 16384,
    blurb: 'Best answers — needs a beefy machine.',
    detail: 'gpt-oss:16b · ~10 GB · runs in 16 GB+ RAM.',
  },
  {
    id: 'remote',
    name: 'Remote',
    model: null,
    sizeGb: 0,
    minRamMb: 0,
    blurb: 'I have a beefy PC running Ollama on the LAN.',
    detail: 'Point Astrion at http://your-pc:11434 instead.',
  },
  {
    id: 'none',
    name: 'Skip',
    model: null,
    sizeGb: 0,
    minRamMb: 0,
    blurb: "I'll set this up later in Settings.",
    detail: 'Astrion runs with a mock AI until you pick a brain.',
  },
];

// Recommend a brain id from available RAM (MB). Mirrors the table in
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
    ? `${formatGb(state.ramTotalMb)} total · ${formatGb(state.ramAvailableMb)} free`
    : 'RAM info unavailable';

  const cards = BRAIN_OPTIONS.map(opt => {
    const isPicked = state.brain === opt.id;
    const isRec = state.recommendation === opt.id;
    const tooBig = opt.minRamMb && state.ramAvailableMb && opt.minRamMb > (state.ramAvailableMb + 1024);
    const border = isPicked ? 'var(--accent)' : tooBig ? 'rgba(255,59,48,0.45)' : 'rgba(255,255,255,0.12)';
    const bg = isPicked ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
    const recBadge = isRec
      ? `<span style="background:var(--accent);color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:8px;letter-spacing:0.3px;">RECOMMENDED</span>`
      : '';
    const warnBadge = tooBig
      ? `<div style="font-size:11px;color:#ff9f0a;margin-top:6px;">Heads-up: needs ~${formatGb(opt.minRamMb)} RAM, you have ${formatGb(state.ramAvailableMb)} free.</div>`
      : '';
    return `
      <div data-brain="${opt.id}" style="border:2px solid ${border};background:${bg};border-radius:12px;padding:14px 18px;cursor:pointer;text-align:left;transition:all 0.2s;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:15px;font-weight:600;color:white;">${opt.name}${recBadge}</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.4);">${opt.detail.split(' · ').slice(1).join(' · ') || ''}</div>
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,0.65);margin-top:4px;">${opt.blurb}</div>
        ${warnBadge}
      </div>
    `;
  }).join('');

  const remoteField = state.brain === 'remote' ? `
    <div style="margin-top:12px;text-align:left;">
      <label style="font-size:12px;color:rgba(255,255,255,0.55);display:block;margin-bottom:6px;">Remote Ollama URL</label>
      <input id="brain-remote-url" type="text" placeholder="http://192.168.1.42:11434" value="${escapeAttr(state.remoteUrl || '')}"
        style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.12);border-radius:10px;color:white;font-size:14px;font-family:var(--font);outline:none;box-sizing:border-box;">
      <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-top:6px;">Make sure your other PC is running Ollama and reachable on the network.</div>
    </div>
  ` : '';

  el.innerHTML = `
    <div style="text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">&#x1F9E0;</div>
      <h1 style="font-size:28px;font-weight:700;margin-bottom:6px;">Pick your AI brain</h1>
      <p style="font-size:14px;color:rgba(255,255,255,0.45);margin-bottom:8px;">Astrion runs its own AI on your hardware. No cloud, no key.</p>
      <p style="font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:20px;">${ramLabel}</p>
      <div style="display:flex;flex-direction:column;gap:8px;text-align:left;">${cards}</div>
      ${remoteField}
    </div>
  `;

  el.querySelectorAll('[data-brain]').forEach(card => {
    card.addEventListener('click', () => {
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
      <div style="font-size:13px;color:#ff453a;font-weight:600;margin-bottom:4px;">Pull failed</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.6);">${escapeText(state.pullError)}</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;">
      <button id="brain-retry-btn" style="background:var(--accent);border:none;color:white;padding:10px 24px;border-radius:10px;font-size:13px;font-weight:600;font-family:var(--font);cursor:pointer;">Try again</button>
      <button id="brain-skip-btn" style="background:rgba(255,255,255,0.08);border:none;color:rgba(255,255,255,0.7);padding:10px 24px;border-radius:10px;font-size:13px;font-family:var(--font);cursor:pointer;">Skip for now</button>
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
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;color:rgba(255,255,255,0.55);">
      <span>${escapeText(state.pullStatus || 'Starting…')}</span>
      <span>${progressLabel}</span>
    </div>
  `;

  el.innerHTML = `
    <style>@keyframes brainShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }</style>
    <div style="text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">&#x1F4E5;</div>
      <h1 style="font-size:26px;font-weight:700;margin-bottom:6px;">${state.pullError ? 'Could not download brain' : 'Downloading your brain'}</h1>
      <p style="font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:4px;">${opt ? `${opt.name} · ${opt.model}` : ''}</p>
      <p style="font-size:12px;color:rgba(255,255,255,0.35);">${opt && opt.sizeGb ? `~${opt.sizeGb.toFixed(1)} GB · this may take a few minutes` : ''}</p>
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
  if (!opt || !opt.model) return true; // remote/none — nothing to pull
  state.pulling = true;
  state.pullStatus = `Connecting to Ollama…`;
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
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
