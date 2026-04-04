// NOVA OS — Music Player App

import { processManager } from '../kernel/process-manager.js';

export function registerMusic() {
  processManager.register('music', {
    name: 'Music',
    icon: '\uD83C\uDFB5',
    iconClass: 'dock-icon-music',
    singleInstance: true,
    width: 750,
    height: 480,
    launch: (contentEl) => {
      initMusic(contentEl);
    }
  });
}

// Audio synthesizer — generates music from Web Audio API
class NovaAudio {
  constructor() {
    this.ctx = null;
    this.gainNode = null;
    this.playing = false;
    this.scheduledNotes = [];
    this.loopTimer = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0.15;
    this.gainNode.connect(this.ctx.destination);
  }

  setVolume(v) {
    if (this.gainNode) this.gainNode.gain.value = v / 100 * 0.25;
  }

  playTrack(trackIndex) {
    this.init();
    this.stop();
    this.playing = true;

    // Each track gets a unique scale/pattern based on its index
    const scales = [
      [261, 293, 329, 349, 392, 440, 493],       // C major
      [293, 329, 369, 392, 440, 493, 554],       // D major
      [220, 261, 293, 329, 369, 440, 493],       // A minor
      [246, 293, 329, 369, 415, 493, 554],       // B minor
      [329, 369, 415, 440, 493, 554, 622],       // E major
      [196, 220, 246, 261, 293, 329, 369],       // G major
      [174, 207, 233, 261, 293, 329, 349],       // F major
      [277, 311, 329, 369, 415, 466, 493],       // C# minor
      [233, 277, 311, 329, 369, 415, 466],       // Bb major
      [349, 392, 440, 466, 523, 587, 659],       // F major high
    ];

    const scale = scales[trackIndex % scales.length];
    const tempos = [0.4, 0.35, 0.5, 0.6, 0.45, 0.3, 0.55, 0.4, 0.65, 0.5];
    const noteLength = tempos[trackIndex % tempos.length];

    // Generate a repeating melody pattern
    const patterns = [
      [0, 2, 4, 3, 2, 4, 5, 3],
      [0, 4, 3, 2, 5, 4, 3, 1],
      [0, 1, 2, 4, 6, 4, 2, 1],
      [5, 4, 2, 0, 2, 4, 5, 6],
      [0, 2, 3, 5, 3, 2, 0, 1],
      [4, 3, 1, 0, 1, 3, 4, 6],
      [0, 3, 5, 3, 0, 2, 4, 2],
      [6, 5, 3, 1, 0, 1, 3, 5],
      [0, 1, 3, 5, 6, 5, 3, 1],
      [2, 0, 4, 2, 5, 3, 6, 4],
    ];
    const pattern = patterns[trackIndex % patterns.length];

    let noteIndex = 0;
    const playNote = () => {
      if (!this.playing) return;

      const freq = scale[pattern[noteIndex % pattern.length]];
      const osc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();

      // Alternate between wave types for variety
      const waves = ['sine', 'triangle', 'sine', 'square'];
      osc.type = waves[trackIndex % waves.length];
      osc.frequency.value = freq;

      noteGain.gain.setValueAtTime(0, this.ctx.currentTime);
      noteGain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.05);
      noteGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + noteLength * 0.9);

      osc.connect(noteGain);
      noteGain.connect(this.gainNode);
      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + noteLength);

      // Add a bass note every 4 beats
      if (noteIndex % 4 === 0) {
        const bass = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bass.type = 'sine';
        bass.frequency.value = scale[0] / 2;
        bassGain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        bassGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + noteLength * 2);
        bass.connect(bassGain);
        bassGain.connect(this.gainNode);
        bass.start(this.ctx.currentTime);
        bass.stop(this.ctx.currentTime + noteLength * 2);
      }

      noteIndex++;
      this.loopTimer = setTimeout(playNote, noteLength * 1000);
    };

    playNote();
  }

  stop() {
    this.playing = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
  }

  pause() {
    this.playing = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
  }

  resume(trackIndex) {
    this.playTrack(trackIndex);
  }
}

const audio = new NovaAudio();

// Demo tracks
const tracks = [
  { title: 'Midnight Drive', artist: 'Synthwave FM', duration: '3:42', art: '\uD83C\uDF03', color: '#1a237e' },
  { title: 'Neon Lights', artist: 'Retro Beats', duration: '4:15', art: '\uD83C\uDF06', color: '#880e4f' },
  { title: 'Digital Dreams', artist: 'Cyber Pulse', duration: '3:58', art: '\uD83D\uDCA0', color: '#1b5e20' },
  { title: 'Ocean Breeze', artist: 'Chill Vibes', duration: '5:20', art: '\uD83C\uDF0A', color: '#006064' },
  { title: 'Starlight', artist: 'Nova Sound', duration: '4:33', art: '\u2B50', color: '#4a148c' },
  { title: 'Electric Feel', artist: 'Voltage', duration: '3:15', art: '\u26A1', color: '#e65100' },
  { title: 'Pixel Rain', artist: 'Chipcloud', duration: '4:48', art: '\uD83C\uDF27\uFE0F', color: '#263238' },
  { title: 'Sunset Boulevard', artist: 'Golden Hour', duration: '3:55', art: '\uD83C\uDF05', color: '#bf360c' },
  { title: 'Deep Focus', artist: 'Study Beats', duration: '6:12', art: '\uD83C\uDFAF', color: '#311b92' },
  { title: 'Aurora', artist: 'Northern Lights', duration: '5:01', art: '\uD83C\uDF0C', color: '#0d47a1' },
];

function initMusic(container) {
  let currentTrack = -1;
  let isPlaying = false;
  let progress = 0;
  let progressInterval = null;
  let volume = 80;

  container.innerHTML = `
    <div class="music-app">
      <div class="music-header">
        <div class="music-header-tab active">Library</div>
        <div class="music-header-tab">Playlists</div>
        <div class="music-header-tab">Radio</div>
      </div>
      <div class="music-content">
        <div class="music-sidebar">
          <div class="music-sidebar-section">Library</div>
          <div class="music-sidebar-item active">\uD83C\uDFB5 All Songs</div>
          <div class="music-sidebar-item">\u2764\uFE0F Favorites</div>
          <div class="music-sidebar-item">\uD83D\uDD52 Recently Played</div>
          <div class="music-sidebar-section">Playlists</div>
          <div class="music-sidebar-item">\uD83C\uDF1F Chill Vibes</div>
          <div class="music-sidebar-item">\u26A1 Workout</div>
          <div class="music-sidebar-item">\uD83C\uDFAF Focus</div>
        </div>
        <div class="music-main">
          <div class="music-track-list" id="music-tracks"></div>
        </div>
      </div>
      <div class="music-player">
        <div class="music-player-art" id="music-art">\uD83C\uDFB5</div>
        <div class="music-player-info">
          <div class="music-player-title" id="music-title">Not Playing</div>
          <div class="music-player-artist" id="music-artist">—</div>
        </div>
        <div class="music-player-controls">
          <button class="music-ctrl-btn" id="music-prev" title="Previous">\u23EE</button>
          <button class="music-ctrl-btn play" id="music-play" title="Play">\u25B6</button>
          <button class="music-ctrl-btn" id="music-next" title="Next">\u23ED</button>
        </div>
        <div class="music-visualizer" id="music-viz"></div>
        <div class="music-progress">
          <span class="music-progress-time" id="music-time-cur">0:00</span>
          <div class="music-progress-bar" id="music-progress-bar">
            <div class="music-progress-fill" id="music-progress-fill"></div>
          </div>
          <span class="music-progress-time" id="music-time-total">0:00</span>
        </div>
        <div class="music-volume">
          <span style="font-size:13px">\uD83D\uDD0A</span>
          <input type="range" class="music-volume-slider" min="0" max="100" value="${volume}">
        </div>
      </div>
    </div>
  `;

  const tracksEl = container.querySelector('#music-tracks');
  const artEl = container.querySelector('#music-art');
  const titleEl = container.querySelector('#music-title');
  const artistEl = container.querySelector('#music-artist');
  const playBtn = container.querySelector('#music-play');
  const prevBtn = container.querySelector('#music-prev');
  const nextBtn = container.querySelector('#music-next');
  const progressFill = container.querySelector('#music-progress-fill');
  const progressBar = container.querySelector('#music-progress-bar');
  const timeCur = container.querySelector('#music-time-cur');
  const timeTotal = container.querySelector('#music-time-total');
  const vizEl = container.querySelector('#music-viz');

  // Create visualizer bars
  for (let i = 0; i < 16; i++) {
    const bar = document.createElement('div');
    bar.className = 'music-viz-bar';
    bar.style.height = '2px';
    vizEl.appendChild(bar);
  }

  // Render tracks
  tracks.forEach((track, i) => {
    const el = document.createElement('div');
    el.className = 'music-track';
    el.innerHTML = `
      <div class="music-track-num">${i + 1}</div>
      <div class="music-track-art" style="background:${track.color}">${track.art}</div>
      <div class="music-track-info">
        <div class="music-track-title">${track.title}</div>
        <div class="music-track-artist">${track.artist}</div>
      </div>
      <div class="music-track-duration">${track.duration}</div>
    `;
    el.addEventListener('dblclick', () => playTrack(i));
    el.addEventListener('click', () => {
      tracksEl.querySelectorAll('.music-track').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
    });
    tracksEl.appendChild(el);
  });

  // Controls
  playBtn.addEventListener('click', () => {
    if (currentTrack === -1) playTrack(0);
    else togglePlay();
  });

  prevBtn.addEventListener('click', () => {
    if (currentTrack > 0) playTrack(currentTrack - 1);
  });

  nextBtn.addEventListener('click', () => {
    if (currentTrack < tracks.length - 1) playTrack(currentTrack + 1);
  });

  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    progress = ((e.clientX - rect.left) / rect.width) * 100;
    progressFill.style.width = progress + '%';
    updateTime();
  });

  function playTrack(index) {
    currentTrack = index;
    const track = tracks[index];
    artEl.textContent = track.art;
    artEl.style.background = track.color;
    titleEl.textContent = track.title;
    artistEl.textContent = track.artist;
    timeTotal.textContent = track.duration;
    progress = 0;
    isPlaying = true;
    playBtn.textContent = '\u23F8';

    // Highlight active track
    tracksEl.querySelectorAll('.music-track').forEach((t, i) => {
      t.classList.toggle('active', i === index);
    });

    startProgress(track.duration);
    startVisualizer();
    audio.playTrack(index);
  }

  function togglePlay() {
    isPlaying = !isPlaying;
    playBtn.textContent = isPlaying ? '\u23F8' : '\u25B6';
    if (isPlaying) {
      startProgress(tracks[currentTrack].duration);
      startVisualizer();
      audio.resume(currentTrack);
    } else {
      clearInterval(progressInterval);
      audio.pause();
      stopVisualizer();
    }
  }

  function startProgress(durationStr) {
    clearInterval(progressInterval);
    const parts = durationStr.split(':');
    const totalSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    const increment = 100 / totalSec;

    progressInterval = setInterval(() => {
      if (!isPlaying) return;
      progress += increment;
      if (progress >= 100) {
        progress = 0;
        if (currentTrack < tracks.length - 1) {
          playTrack(currentTrack + 1);
        } else {
          isPlaying = false;
          playBtn.textContent = '\u25B6';
          clearInterval(progressInterval);
          stopVisualizer();
          audio.stop();
        }
        return;
      }
      progressFill.style.width = progress + '%';
      updateTime();
    }, 1000);
  }

  function updateTime() {
    if (currentTrack < 0) return;
    const parts = tracks[currentTrack].duration.split(':');
    const totalSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    const currentSec = Math.floor(totalSec * progress / 100);
    const min = Math.floor(currentSec / 60);
    const sec = currentSec % 60;
    timeCur.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  }

  let vizInterval;
  function startVisualizer() {
    clearInterval(vizInterval);
    const bars = vizEl.querySelectorAll('.music-viz-bar');
    vizInterval = setInterval(() => {
      bars.forEach(bar => {
        bar.style.height = (Math.random() * 24 + 4) + 'px';
      });
    }, 120);
  }

  function stopVisualizer() {
    clearInterval(vizInterval);
    vizEl.querySelectorAll('.music-viz-bar').forEach(bar => {
      bar.style.height = '2px';
    });
  }

  // Volume control
  container.querySelector('.music-volume-slider').addEventListener('input', (e) => {
    volume = parseInt(e.target.value);
    audio.setVolume(volume);
  });
}
