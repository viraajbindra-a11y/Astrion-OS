// Astrion OS — Video Editor (CapCut-style)
// Timeline-based video editor with trim, filters, text overlays, export.

import { processManager } from '../kernel/process-manager.js';

export function registerVideoEditor() {
  processManager.register('video-editor', {
    name: 'Video Editor',
    icon: '\uD83C\uDFAC',
    iconClass: 'dock-icon-video-editor',
    singleInstance: true,
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
    launch: (contentEl) => initVideoEditor(contentEl),
  });
}

function initVideoEditor(container) {
  let videoFile = null;
  let videoEl = null;
  let isPlaying = false;
  let trimStart = 0;
  let trimEnd = 1; // as fraction 0-1
  let currentFilter = 'none';
  let textOverlays = [];
  let overlayText = '';
  let overlayColor = '#ffffff';
  let overlaySize = 32;
  let overlayY = 0.5; // 0-1 vertical position
  let volume = 1;
  let playbackRate = 1;
  let rafId = null;

  const FILTERS = [
    { id: 'none', name: 'Original', css: '' },
    { id: 'grayscale', name: 'B&W', css: 'grayscale(100%)' },
    { id: 'sepia', name: 'Vintage', css: 'sepia(80%)' },
    { id: 'warm', name: 'Warm', css: 'saturate(1.3) hue-rotate(-10deg) brightness(1.05)' },
    { id: 'cool', name: 'Cool', css: 'saturate(0.9) hue-rotate(20deg) brightness(1.05)' },
    { id: 'contrast', name: 'Contrast', css: 'contrast(1.4) saturate(1.1)' },
    { id: 'bright', name: 'Bright', css: 'brightness(1.3)' },
    { id: 'dark', name: 'Dark', css: 'brightness(0.7) contrast(1.2)' },
    { id: 'blur', name: 'Blur', css: 'blur(3px)' },
    { id: 'invert', name: 'Negative', css: 'invert(100%)' },
    { id: 'saturate', name: 'Vivid', css: 'saturate(2)' },
    { id: 'hue', name: 'Psychedelic', css: 'hue-rotate(90deg) saturate(2)' },
  ];

  container.innerHTML = `
    <style>
      .ve-app { display:flex; flex-direction:column; height:100%; background:#0c0c10; color:white; font-family:var(--font); overflow:hidden; }
      .ve-top { display:flex; flex:1; min-height:0; }
      .ve-preview { flex:1; display:flex; align-items:center; justify-content:center; background:#000; position:relative; overflow:hidden; }
      .ve-preview video { max-width:100%; max-height:100%; object-fit:contain; }
      .ve-preview canvas { max-width:100%; max-height:100%; object-fit:contain; display:none; }
      .ve-preview-overlay { position:absolute; pointer-events:none; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; }
      .ve-upload { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:40px; cursor:pointer; }
      .ve-upload-icon { font-size:48px; opacity:0.3; }
      .ve-upload-text { font-size:14px; color:rgba(255,255,255,0.4); }
      .ve-upload-btn { padding:10px 24px; background:var(--accent); border:none; color:white; border-radius:10px; font-size:13px; font-weight:500; cursor:pointer; font-family:var(--font); }

      .ve-sidebar { width:240px; border-left:1px solid rgba(255,255,255,0.06); overflow-y:auto; flex-shrink:0; }
      .ve-sidebar-section { padding:12px; border-bottom:1px solid rgba(255,255,255,0.04); }
      .ve-sidebar-label { font-size:10px; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,0.3); margin-bottom:8px; }

      .ve-filter-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; }
      .ve-filter-btn {
        padding:6px 4px; border-radius:6px; border:2px solid transparent;
        background:rgba(255,255,255,0.04); color:rgba(255,255,255,0.7);
        font-size:10px; cursor:pointer; text-align:center; font-family:var(--font);
        transition:all 0.15s;
      }
      .ve-filter-btn:hover { background:rgba(255,255,255,0.08); }
      .ve-filter-btn.active { border-color:var(--accent); background:rgba(0,122,255,0.15); color:white; }

      .ve-timeline { height:120px; border-top:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column; flex-shrink:0; }
      .ve-timeline-controls { display:flex; align-items:center; gap:8px; padding:6px 12px; background:rgba(0,0,0,0.3); }
      .ve-tl-btn {
        background:rgba(255,255,255,0.08); border:none; color:white; padding:6px 12px;
        border-radius:6px; font-size:12px; cursor:pointer; font-family:var(--font);
        transition:all 0.15s;
      }
      .ve-tl-btn:hover { background:rgba(255,255,255,0.12); }
      .ve-tl-btn.play { background:var(--accent); font-size:14px; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; padding:0; }

      .ve-timeline-track {
        flex:1; position:relative; background:rgba(255,255,255,0.02);
        margin:0 12px 8px; border-radius:6px; overflow:hidden; cursor:pointer;
      }
      .ve-tl-waveform { width:100%; height:100%; position:absolute; top:0; left:0; }
      .ve-tl-trim { position:absolute; top:0; height:100%; background:rgba(0,122,255,0.15); border-left:3px solid var(--accent); border-right:3px solid var(--accent); }
      .ve-tl-playhead { position:absolute; top:0; width:2px; height:100%; background:#ff3b30; z-index:2; pointer-events:none; }
      .ve-tl-thumb { width:100%; height:100%; display:flex; }
      .ve-tl-thumb-frame { flex:1; background-size:cover; background-position:center; border-right:1px solid rgba(0,0,0,0.3); }

      .ve-time { font-size:11px; color:rgba(255,255,255,0.5); font-variant-numeric:tabular-nums; min-width:45px; }

      .ve-text-input { width:100%; padding:8px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.06); color:white; font-size:12px; font-family:var(--font); outline:none; margin-bottom:6px; }
      .ve-text-input:focus { border-color:var(--accent); }
      .ve-slider-row { display:flex; align-items:center; gap:6px; margin-bottom:6px; }
      .ve-slider-row label { font-size:11px; color:rgba(255,255,255,0.4); min-width:50px; }
      .ve-slider-row input[type=range] { flex:1; accent-color:var(--accent); }
      .ve-slider-row input[type=color] { width:28px; height:28px; border:none; border-radius:4px; cursor:pointer; background:none; }

      .ve-export-btn {
        width:100%; padding:10px; border-radius:8px; border:none;
        background:var(--accent); color:white; font-size:13px; font-weight:600;
        cursor:pointer; font-family:var(--font); margin-top:8px;
      }
      .ve-export-btn:hover { filter:brightness(1.15); }
    </style>

    <div class="ve-app">
      <div class="ve-top">
        <div class="ve-preview" id="ve-preview">
          <div class="ve-upload" id="ve-upload">
            <div class="ve-upload-icon">\uD83C\uDFAC</div>
            <div class="ve-upload-text">Drop a video here or click to import</div>
            <button class="ve-upload-btn" id="ve-import-btn">Import Video</button>
          </div>
          <input type="file" id="ve-file" accept="video/*" style="display:none;">
          <div class="ve-preview-overlay" id="ve-overlay"></div>
        </div>
        <div class="ve-sidebar" id="ve-sidebar" style="display:none;">
          <div class="ve-sidebar-section">
            <div class="ve-sidebar-label">Filters</div>
            <div class="ve-filter-grid" id="ve-filters"></div>
          </div>
          <div class="ve-sidebar-section">
            <div class="ve-sidebar-label">Text Overlay</div>
            <input class="ve-text-input" id="ve-text" placeholder="Add text to video...">
            <div class="ve-slider-row">
              <label>Color</label>
              <input type="color" id="ve-text-color" value="#ffffff">
            </div>
            <div class="ve-slider-row">
              <label>Size</label>
              <input type="range" id="ve-text-size" min="12" max="72" value="32">
              <span id="ve-text-size-val" style="font-size:10px;color:rgba(255,255,255,0.4);min-width:24px;">32</span>
            </div>
            <div class="ve-slider-row">
              <label>Position</label>
              <input type="range" id="ve-text-pos" min="0" max="100" value="50">
            </div>
          </div>
          <div class="ve-sidebar-section">
            <div class="ve-sidebar-label">Adjustments</div>
            <div class="ve-slider-row">
              <label>Volume</label>
              <input type="range" id="ve-volume" min="0" max="100" value="100">
            </div>
            <div class="ve-slider-row">
              <label>Speed</label>
              <input type="range" id="ve-speed" min="25" max="300" value="100" step="25">
              <span id="ve-speed-val" style="font-size:10px;color:rgba(255,255,255,0.4);min-width:30px;">1x</span>
            </div>
          </div>
          <div class="ve-sidebar-section">
            <button class="ve-export-btn" id="ve-export">\uD83D\uDCE5 Export Video</button>
            <button class="ve-tl-btn" id="ve-screenshot" style="width:100%;margin-top:6px;">\uD83D\uDCF8 Screenshot</button>
          </div>
        </div>
      </div>
      <div class="ve-timeline" id="ve-timeline" style="display:none;">
        <div class="ve-timeline-controls">
          <button class="ve-tl-btn play" id="ve-play">\u25B6</button>
          <span class="ve-time" id="ve-time-cur">0:00</span>
          <span style="color:rgba(255,255,255,0.2);">/</span>
          <span class="ve-time" id="ve-time-dur">0:00</span>
          <div style="flex:1;"></div>
          <button class="ve-tl-btn" id="ve-trim-set">Set Trim</button>
          <button class="ve-tl-btn" id="ve-trim-reset">Reset Trim</button>
        </div>
        <div class="ve-timeline-track" id="ve-track">
          <div class="ve-tl-thumb" id="ve-thumb"></div>
          <div class="ve-tl-trim" id="ve-trim" style="left:0%;width:100%;"></div>
          <div class="ve-tl-playhead" id="ve-playhead" style="left:0%;"></div>
        </div>
      </div>
    </div>
  `;

  const preview = container.querySelector('#ve-preview');
  const uploadEl = container.querySelector('#ve-upload');
  const fileInput = container.querySelector('#ve-file');
  const sidebar = container.querySelector('#ve-sidebar');
  const timeline = container.querySelector('#ve-timeline');
  const playBtn = container.querySelector('#ve-play');
  const timeCur = container.querySelector('#ve-time-cur');
  const timeDur = container.querySelector('#ve-time-dur');
  const trackEl = container.querySelector('#ve-track');
  const trimEl = container.querySelector('#ve-trim');
  const playheadEl = container.querySelector('#ve-playhead');
  const thumbEl = container.querySelector('#ve-thumb');
  const overlayEl = container.querySelector('#ve-overlay');

  // ── Import video ──
  container.querySelector('#ve-import-btn').addEventListener('click', () => fileInput.click());
  uploadEl.addEventListener('click', (e) => { if (e.target === uploadEl || e.target.classList.contains('ve-upload-text') || e.target.classList.contains('ve-upload-icon')) fileInput.click(); });
  preview.addEventListener('dragover', (e) => { e.preventDefault(); });
  preview.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) loadVideo(file);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadVideo(fileInput.files[0]); });

  function loadVideo(file) {
    videoFile = file;
    if (videoEl) videoEl.remove();
    uploadEl.style.display = 'none';

    videoEl = document.createElement('video');
    videoEl.src = URL.createObjectURL(file);
    videoEl.style.cssText = 'max-width:100%;max-height:100%;';
    videoEl.preload = 'auto';
    preview.insertBefore(videoEl, overlayEl);

    videoEl.addEventListener('loadedmetadata', () => {
      timeDur.textContent = fmtTime(videoEl.duration);
      sidebar.style.display = '';
      timeline.style.display = '';
      trimStart = 0; trimEnd = 1;
      updateTrim();
      generateThumbnails();
    });

    videoEl.addEventListener('timeupdate', () => {
      if (!videoEl) return;
      const pct = videoEl.currentTime / videoEl.duration;
      playheadEl.style.left = (pct * 100) + '%';
      timeCur.textContent = fmtTime(videoEl.currentTime);

      // Enforce trim bounds during playback
      const trimEndTime = trimEnd * videoEl.duration;
      if (videoEl.currentTime >= trimEndTime) {
        videoEl.pause();
        videoEl.currentTime = trimStart * videoEl.duration;
        isPlaying = false;
        playBtn.textContent = '\u25B6';
      }
    });

    videoEl.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.textContent = '\u25B6';
    });
  }

  // ── Timeline thumbnails ──
  function generateThumbnails() {
    if (!videoEl) return;
    thumbEl.innerHTML = '';
    const count = 12;
    const tempVideo = document.createElement('video');
    tempVideo.src = videoEl.src;
    tempVideo.muted = true;
    tempVideo.preload = 'auto';

    tempVideo.addEventListener('loadedmetadata', () => {
      let i = 0;
      function captureFrame() {
        if (i >= count) return;
        const t = (i / count) * tempVideo.duration;
        tempVideo.currentTime = t;
      }
      tempVideo.addEventListener('seeked', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 80; canvas.height = 50;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tempVideo, 0, 0, 80, 50);
        const frame = document.createElement('div');
        frame.className = 've-tl-thumb-frame';
        frame.style.backgroundImage = `url(${canvas.toDataURL('image/jpeg', 0.5)})`;
        thumbEl.appendChild(frame);
        i++;
        if (i < count) captureFrame();
      });
      captureFrame();
    });
  }

  // ── Playback ──
  playBtn.addEventListener('click', () => {
    if (!videoEl) return;
    if (isPlaying) {
      videoEl.pause();
      isPlaying = false;
      playBtn.textContent = '\u25B6';
    } else {
      if (videoEl.currentTime < trimStart * videoEl.duration) {
        videoEl.currentTime = trimStart * videoEl.duration;
      }
      videoEl.play();
      isPlaying = true;
      playBtn.textContent = '\u23F8';
    }
  });

  // Click timeline to seek
  trackEl.addEventListener('click', (e) => {
    if (!videoEl) return;
    const rect = trackEl.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoEl.currentTime = pct * videoEl.duration;
  });

  // ── Trim ──
  container.querySelector('#ve-trim-set').addEventListener('click', () => {
    if (!videoEl) return;
    const cur = videoEl.currentTime / videoEl.duration;
    // If near start, set trim start. If near end, set trim end.
    if (cur < (trimStart + trimEnd) / 2) {
      trimStart = cur;
    } else {
      trimEnd = cur;
    }
    if (trimStart > trimEnd) [trimStart, trimEnd] = [trimEnd, trimStart];
    updateTrim();
  });

  container.querySelector('#ve-trim-reset').addEventListener('click', () => {
    trimStart = 0; trimEnd = 1;
    updateTrim();
  });

  function updateTrim() {
    trimEl.style.left = (trimStart * 100) + '%';
    trimEl.style.width = ((trimEnd - trimStart) * 100) + '%';
  }

  // ── Filters ──
  const filtersEl = container.querySelector('#ve-filters');
  FILTERS.forEach(f => {
    const btn = document.createElement('div');
    btn.className = 've-filter-btn' + (f.id === 'none' ? ' active' : '');
    btn.textContent = f.name;
    btn.addEventListener('click', () => {
      currentFilter = f.id;
      filtersEl.querySelectorAll('.ve-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (videoEl) videoEl.style.filter = f.css;
    });
    filtersEl.appendChild(btn);
  });

  // ── Text overlay ──
  const textInput = container.querySelector('#ve-text');
  const textColorInput = container.querySelector('#ve-text-color');
  const textSizeInput = container.querySelector('#ve-text-size');
  const textSizeVal = container.querySelector('#ve-text-size-val');
  const textPosInput = container.querySelector('#ve-text-pos');

  function updateOverlay() {
    overlayText = textInput.value;
    overlayColor = textColorInput.value;
    overlaySize = parseInt(textSizeInput.value);
    overlayY = parseInt(textPosInput.value) / 100;
    textSizeVal.textContent = overlaySize;

    if (overlayText) {
      overlayEl.innerHTML = `<div style="
        position:absolute; left:0; right:0;
        top:${overlayY * 100}%;
        transform:translateY(-50%);
        text-align:center;
        font-size:${overlaySize}px;
        font-weight:700;
        color:${overlayColor};
        text-shadow:0 2px 8px rgba(0,0,0,0.7), 0 0 20px rgba(0,0,0,0.5);
        font-family:var(--font);
        padding:0 20px;
        word-break:break-word;
      ">${escHtml(overlayText)}</div>`;
    } else {
      overlayEl.innerHTML = '';
    }
  }

  textInput.addEventListener('input', updateOverlay);
  textColorInput.addEventListener('input', updateOverlay);
  textSizeInput.addEventListener('input', updateOverlay);
  textPosInput.addEventListener('input', updateOverlay);

  // ── Volume + speed ──
  container.querySelector('#ve-volume').addEventListener('input', (e) => {
    volume = parseInt(e.target.value) / 100;
    if (videoEl) videoEl.volume = volume;
  });

  const speedInput = container.querySelector('#ve-speed');
  const speedVal = container.querySelector('#ve-speed-val');
  speedInput.addEventListener('input', () => {
    playbackRate = parseInt(speedInput.value) / 100;
    speedVal.textContent = playbackRate + 'x';
    if (videoEl) videoEl.playbackRate = playbackRate;
  });

  // ── Export ──
  container.querySelector('#ve-export').addEventListener('click', async () => {
    if (!videoEl) return;
    const exportBtn = container.querySelector('#ve-export');
    exportBtn.textContent = 'Exporting...';
    exportBtn.disabled = true;

    try {
      // Use MediaRecorder to capture the video element + overlay as a stream
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 360;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);

      // Add audio track if available
      if (videoEl.captureStream) {
        const audioTracks = videoEl.captureStream().getAudioTracks();
        audioTracks.forEach(t => stream.addTrack(t));
      }

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'astrion-edit.webm';
        a.click();
        URL.revokeObjectURL(a.href);
        exportBtn.textContent = '\uD83D\uDCE5 Export Video';
        exportBtn.disabled = false;
      };

      // Render frames
      videoEl.currentTime = trimStart * videoEl.duration;
      videoEl.playbackRate = playbackRate;
      videoEl.volume = volume;

      recorder.start();
      videoEl.play();

      const renderFrame = () => {
        if (!videoEl || videoEl.paused || videoEl.ended) { recorder.stop(); return; }
        if (videoEl.currentTime >= trimEnd * videoEl.duration) {
          videoEl.pause();
          recorder.stop();
          return;
        }
        // Apply filter via CSS filter on canvas
        const filterObj = FILTERS.find(f => f.id === currentFilter);
        ctx.filter = filterObj?.css || 'none';
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        ctx.filter = 'none';

        // Draw text overlay
        if (overlayText) {
          ctx.save();
          ctx.font = `700 ${overlaySize * (canvas.height / 400)}px ${getComputedStyle(document.body).fontFamily}`;
          ctx.fillStyle = overlayColor;
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.7)';
          ctx.shadowBlur = 8;
          ctx.fillText(overlayText, canvas.width / 2, canvas.height * overlayY);
          ctx.restore();
        }

        requestAnimationFrame(renderFrame);
      };
      renderFrame();

    } catch (err) {
      console.error('[video-editor] export failed:', err);
      exportBtn.textContent = 'Export failed';
      setTimeout(() => { exportBtn.textContent = '\uD83D\uDCE5 Export Video'; exportBtn.disabled = false; }, 2000);
    }
  });

  // ── Screenshot ──
  container.querySelector('#ve-screenshot').addEventListener('click', () => {
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth || 640;
    canvas.height = videoEl.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    const filterObj = FILTERS.find(f => f.id === currentFilter);
    ctx.filter = filterObj?.css || 'none';
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    if (overlayText) {
      ctx.font = `700 ${overlaySize * (canvas.height / 400)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillStyle = overlayColor;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 8;
      ctx.fillText(overlayText, canvas.width / 2, canvas.height * overlayY);
    }
    const a = document.createElement('a');
    a.download = 'astrion-frame.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  // ── Cleanup ──
  const obs = new MutationObserver(() => {
    if (!container.isConnected) {
      if (videoEl) { videoEl.pause(); videoEl.src = ''; }
      if (rafId) cancelAnimationFrame(rafId);
      obs.disconnect();
    }
  });
  if (container.parentElement) obs.observe(container.parentElement, { childList: true, subtree: true });
}

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
