// NOVA OS — System Sounds
// Plays UI sounds (click, notification, error, success, boot).
// Sounds are generated with Web Audio API so we don't ship WAV files.

const SOUND_ENABLED_KEY = 'nova-sounds-enabled';

class SoundSystem {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
  }

  _ensureContext() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      // resume() only succeeds within a user gesture (click/keydown).
      // Catch and ignore if called outside one — the next user-triggered
      // sound call will resume it.
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem(SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
  }

  isEnabled() {
    return this.enabled;
  }

  // ─── Generate sounds with Web Audio ───

  _beep({ freq, duration, type = 'sine', volume = 0.08, attack = 0.005, release = 0.05 }) {
    if (!this.enabled) return;
    const ctx = this._ensureContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(volume, now + duration - release);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  _chord(notes, duration = 0.3) {
    notes.forEach(n => this._beep({ freq: n, duration, type: 'sine', volume: 0.05 }));
  }

  // ─── Public sounds ───

  click() {
    this._beep({ freq: 1200, duration: 0.02, type: 'square', volume: 0.03 });
  }

  tap() {
    this._beep({ freq: 800, duration: 0.015, type: 'sine', volume: 0.04 });
  }

  notification() {
    // Two-tone: E5 → G5
    this._beep({ freq: 659.25, duration: 0.12, type: 'sine', volume: 0.1 });
    setTimeout(() => this._beep({ freq: 783.99, duration: 0.2, type: 'sine', volume: 0.1 }), 80);
  }

  success() {
    // C5 → E5 → G5 triad
    this._chord([523.25, 659.25, 783.99], 0.4);
  }

  error() {
    // Low buzz
    this._beep({ freq: 180, duration: 0.15, type: 'sawtooth', volume: 0.12 });
    setTimeout(() => this._beep({ freq: 150, duration: 0.2, type: 'sawtooth', volume: 0.12 }), 120);
  }

  warning() {
    this._beep({ freq: 440, duration: 0.1, type: 'triangle', volume: 0.1 });
    setTimeout(() => this._beep({ freq: 440, duration: 0.1, type: 'triangle', volume: 0.1 }), 150);
  }

  boot() {
    // NOVA OS startup chime — major chord with swell
    const notes = [261.63, 329.63, 392, 523.25]; // C4 E4 G4 C5
    notes.forEach((freq, i) => {
      setTimeout(() => {
        this._beep({ freq, duration: 1.0, type: 'sine', volume: 0.08, attack: 0.15, release: 0.4 });
      }, i * 60);
    });
  }

  shutdown() {
    // Descending tones
    [523.25, 392, 261.63].forEach((freq, i) => {
      setTimeout(() => this._beep({ freq, duration: 0.2, type: 'sine', volume: 0.08 }), i * 100);
    });
  }

  windowOpen() {
    this._beep({ freq: 880, duration: 0.06, type: 'sine', volume: 0.03 });
  }

  windowClose() {
    this._beep({ freq: 660, duration: 0.06, type: 'sine', volume: 0.03 });
  }

  volume() {
    this._beep({ freq: 1000, duration: 0.04, type: 'sine', volume: 0.06 });
  }

  lock() {
    this._beep({ freq: 440, duration: 0.08, type: 'square', volume: 0.06 });
    setTimeout(() => this._beep({ freq: 220, duration: 0.15, type: 'square', volume: 0.06 }), 80);
  }

  unlock() {
    this._beep({ freq: 440, duration: 0.08, type: 'sine', volume: 0.06 });
    setTimeout(() => this._beep({ freq: 880, duration: 0.12, type: 'sine', volume: 0.06 }), 80);
  }
}

export const sounds = new SoundSystem();
