// NOVA OS — Music Player App (v3 — Radio + YouTube + Local Files)

import { processManager } from '../kernel/process-manager.js';
import { loadYouTubeAPI, extractVideoId, getYTApiKey, setYTApiKey, searchYouTube, escHtml, fmtTime } from '../lib/youtube-api.js';

export function registerMusic() {
  processManager.register('music', {
    name: 'Music',
    icon: '\uD83C\uDFB5',
    iconClass: 'dock-icon-music',
    singleInstance: true,
    width: 820,
    height: 560,
    minWidth: 640,
    minHeight: 440,
    launch: (contentEl) => {
      initMusic(contentEl);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   NOTE FREQUENCY TABLE
   ═══════════════════════════════════════════════════════════════════ */
const N = {
  C3:131, D3:147, Eb3:156, E3:165, F3:175, Fs3:185, G3:196, Gs3:208, Ab3:208, A3:220, Bb3:233, B3:247,
  C4:262, Cs4:277, Db4:277, D4:294, Ds4:311, Eb4:311, E4:330, F4:349, Fs4:370, Gb4:370, G4:392, Gs4:415, Ab4:415, A4:440, Bb4:466, B4:494,
  C5:523, Cs5:554, Db5:554, D5:587, Ds5:622, Eb5:622, E5:659, F5:698, Fs5:740, G5:784, Gs5:831, Ab5:831, A5:880, Bb5:932, B5:988,
  C6:1047, D6:1175, E6:1319, F6:1397, G6:1568,
  R: -1
};
const R = N.R;

/* ═══════════════════════════════════════════════════════════════════
   GENRE DEFINITIONS (Radio mode)
   ═══════════════════════════════════════════════════════════════════ */
const GENRES = {
  classical: {
    name: 'Classical', emoji: '\uD83C\uDFBB', color: '#4e342e', bpm: 100, swing: 0,
    oscTypes: ['sine','triangle'], detune: 2, filterFreq: 5000, filterQ: 0.5,
    reverbDecay: 3.0, reverbMix: 0.45, melodyVol: 0.11, chordVol: 0.04, bassVol: 0.06, drumVol: 0,
    drumPattern:{kick:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],snare:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],hihat:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],openhat:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
    tracks: [
      { title:'F\u00FCr Elise', artist:'Beethoven', bpm:75,
        melody:[N.E5,N.Ds5,N.E5,N.Ds5,N.E5,N.B4,N.D5,N.C5,N.A4,R,N.C4,N.E4,N.A4,R,N.E4,N.Gs4,N.B4,R,N.E4,N.Gs4,N.B4,R,N.C5,R,N.E5,N.Ds5,N.E5,N.Ds5,N.E5,N.B4,N.D5,N.C5,N.A4,R,N.C4,N.E4,N.A4,R,N.E4,N.Gs4,N.B4,R,N.E4,N.C5,N.B4,N.A4,R,R],
        chords:[[N.A3,N.C4,N.E4],[N.A3,N.C4,N.E4],[N.E3,N.Gs3,N.B3],[N.A3,N.C4,N.E4],[N.A3,N.C4,N.E4],[N.E3,N.Gs3,N.B3]]},
      { title:'Ode to Joy', artist:'Beethoven', bpm:108,
        melody:[N.Fs4,N.Fs4,N.G4,N.A4,N.A4,N.G4,N.Fs4,N.E4,N.D4,N.D4,N.E4,N.Fs4,N.Fs4,R,N.E4,N.E4,N.Fs4,N.Fs4,N.G4,N.A4,N.A4,N.G4,N.Fs4,N.E4,N.D4,N.D4,N.E4,N.Fs4,N.E4,R,N.D4,N.D4,N.E4,N.E4,N.Fs4,N.D4,N.E4,N.Fs4,N.G4,N.Fs4,N.D4,N.E4,N.Fs4,N.G4,N.Fs4,N.E4,N.D4,N.E4],
        chords:[[N.D3,N.Fs3,N.A3],[N.A3,N.Cs4,N.E4],[N.B3,N.D4,N.Fs4],[N.G3,N.B3,N.D4],[N.D3,N.Fs3,N.A3],[N.A3,N.Cs4,N.E4]]},
      { title:'Canon in D', artist:'Pachelbel', bpm:72,
        melody:[N.Fs5,R,N.E5,R,N.D5,R,N.Cs5,R,N.B4,R,N.A4,R,N.B4,R,N.Cs5,R,N.D5,R,N.Cs5,R,N.B4,R,N.A4,R,N.G4,R,N.Fs4,R,N.G4,R,N.A4,R,N.Fs4,N.G4,N.A4,N.Fs4,N.G4,N.A4,N.A4,N.B4,N.G4,N.A4,N.B4,N.G4,N.A4,N.B4,N.Cs5,N.D5,N.A4,N.B4,N.Cs5,N.D5,N.E5,N.Fs5,N.E5,N.D5,N.Cs5,N.B4,N.A4,N.B4,N.A4,N.G4,N.Fs4,N.E4],
        chords:[[N.D3,N.Fs3,N.A3],[N.A3,N.Cs4,N.E4],[N.B3,N.D4,N.Fs4],[N.Fs3,N.A3,N.Cs4],[N.G3,N.B3,N.D4],[N.D3,N.Fs3,N.A3],[N.G3,N.B3,N.D4],[N.A3,N.Cs4,N.E4]]},
      { title:'Gymnopedie No. 1', artist:'Satie', bpm:56,
        melody:[N.Fs5,R,R,R,N.D5,R,R,R,N.E5,R,R,R,N.Cs5,R,R,R,N.B4,R,R,R,N.D5,R,R,R,N.A4,R,R,R,R,R,R,R,N.Fs5,R,R,R,N.D5,R,R,R,N.E5,R,R,R,N.Cs5,R,R,R,N.D5,R,R,R,N.B4,R,R,R,N.A4,R,R,N.B4,N.A4,R,R,R],
        chords:[[N.G3,N.B3,N.D4,N.Fs4],[N.A3,N.D4,N.Fs4],[N.G3,N.B3,N.D4,N.Fs4],[N.A3,N.D4,N.Fs4],[N.E3,N.G3,N.B3,N.D4],[N.Fs3,N.A3,N.D4],[N.E3,N.G3,N.B3,N.D4],[N.A3,N.Cs4,N.E4]]},
      { title:'Prelude in C', artist:'Bach', bpm:88,
        melody:[N.C4,N.E4,N.G4,N.C5,N.E5,N.C5,N.G4,N.E4,N.D4,N.F4,N.A4,N.D5,N.F5,N.D5,N.A4,N.F4,N.B3,N.D4,N.G4,N.B4,N.D5,N.B4,N.G4,N.D4,N.C4,N.E4,N.G4,N.C5,N.E5,N.C5,N.G4,N.E4,N.A3,N.C4,N.E4,N.A4,N.C5,N.A4,N.E4,N.C4,N.D4,N.Fs4,N.A4,N.D5,N.Fs5,N.D5,N.A4,N.Fs4,N.G3,N.B3,N.D4,N.G4,N.B4,N.G4,N.D4,N.B3,N.C4,N.E4,N.G4,N.C5,N.E5,N.C5,N.G4,N.E4],
        chords:[[N.C3,N.E3,N.G3],[N.D3,N.F3,N.A3],[N.G3,N.B3,N.D4],[N.C3,N.E3,N.G3],[N.A3,N.C4,N.E4],[N.D3,N.Fs3,N.A3],[N.G3,N.B3,N.D4],[N.C3,N.E3,N.G3]]},
      { title:'Greensleeves', artist:'Traditional', bpm:80,
        melody:[N.A4,R,N.C5,N.D5,N.E5,R,N.F5,N.E5,N.D5,R,N.B4,N.G4,N.A4,R,N.B4,N.C5,N.A4,N.A4,N.Gs4,N.A4,N.B4,R,N.Gs4,N.E4,N.A4,R,N.C5,N.D5,N.E5,R,N.F5,N.E5,N.D5,R,N.B4,N.G4,N.A4,R,N.B4,N.C5,N.B4,N.A4,N.Gs4,R,N.A4,R,R,R],
        chords:[[N.A3,N.C4,N.E4],[N.G3,N.B3,N.D4],[N.A3,N.C4,N.E4],[N.E3,N.Gs3,N.B3],[N.A3,N.C4,N.E4],[N.E3,N.Gs3,N.B3]]},
    ],
  },
  jazz: {
    name: 'Jazz', emoji: '\uD83C\uDFB7', color: '#bf360c', bpm: 132, swing: 0.25,
    oscTypes: ['sine','triangle'], detune: 3, filterFreq: 3200, filterQ: 1,
    reverbDecay: 1.5, reverbMix: 0.22, melodyVol: 0.1, chordVol: 0.04, bassVol: 0.09, drumVol: 0.1,
    drumPattern:{kick:[1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0],snare:[0,0,0,0,1,0,0,1,0,0,0,0,1,0,0,0],hihat:[1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1],openhat:[0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0]},
    tracks: [
      { title:'Blue Note Alley', artist:'Smooth Keys',
        melody:[N.E5,N.D5,N.C5,N.Bb4,N.A4,N.G4,N.A4,N.B4,N.C5,R,N.E4,N.G4,N.Bb4,N.A4,N.G4,R,N.A4,N.C5,N.D5,N.E5,N.G5,N.E5,N.D5,N.C5,N.A4,R,N.G4,N.E4,N.D4,R,N.C4,R],
        chords:[[N.D4,N.F4,N.A4,N.C5],[N.G3,N.B3,N.D4,N.F4],[N.C4,N.E4,N.G4,N.B4],[N.A3,N.C4,N.E4,N.G4]]},
      { title:'Midnight Blues', artist:'Miles Out', bpm:100,
        melody:[N.C4,N.Eb4,N.F4,N.Fs4,N.G4,R,N.Eb4,N.C4,N.G4,N.Bb4,N.G4,N.F4,N.Eb4,R,N.C4,R,N.F4,N.Ab4,N.F4,N.Eb4,N.C4,N.Eb4,N.F4,R,N.C4,R,N.Eb4,N.G4,N.Bb4,N.G4,N.F4,N.Eb4],
        chords:[[N.C3,N.Eb3,N.G3,N.Bb3],[N.F3,N.Ab3,N.C4,N.Eb4],[N.G3,N.B3,N.D4,N.F4],[N.C3,N.Eb3,N.G3,N.Bb3]]},
      { title:'Sax & The City', artist:'Cool Cats', bpm:138,
        melody:[N.G4,N.A4,N.B4,N.D5,N.E5,R,N.D5,N.B4,N.A4,N.G4,R,N.E4,N.Fs4,N.G4,N.A4,R,N.B4,N.D5,N.Fs5,N.E5,N.D5,R,N.B4,N.A4,N.G4,R,N.A4,N.B4,N.G4,R,R,R],
        chords:[[N.G3,N.B3,N.D4,N.Fs4],[N.E3,N.G3,N.B3,N.D4],[N.A3,N.Cs4,N.E4,N.G4],[N.D3,N.Fs3,N.A3,N.C4]]},
      { title:'Late Set', artist:'Trio Session', bpm:120,
        melody:[N.D5,R,N.C5,R,N.A4,R,N.G4,R,N.F4,R,N.E4,N.D4,N.E4,N.F4,N.A4,R,N.G4,R,N.A4,N.C5,N.D5,R,N.C5,N.A4,N.G4,N.F4,N.E4,R,N.D4,R,R,R],
        chords:[[N.D3,N.F3,N.A3,N.C4],[N.Bb3,N.D4,N.F4,N.A4],[N.E3,N.G3,N.Bb3,N.D4],[N.A3,N.Cs4,N.E4,N.G4]]},
    ],
  },
  lofi: {
    name: 'Lo-Fi Hip Hop', emoji: '\uD83C\uDF19', color: '#6b4c9a', bpm: 75, swing: 0.15,
    oscTypes: ['triangle','sine'], detune: 8, filterFreq: 800, filterQ: 2,
    reverbDecay: 2.5, reverbMix: 0.35, melodyVol: 0.12, chordVol: 0.06, bassVol: 0.1, drumVol: 0.13,
    drumPattern:{kick:[1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0],snare:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],hihat:[1,0,1,1,1,0,1,0,1,0,1,1,1,0,1,0],openhat:[0,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0]},
    tracks: [
      { title:'Rainy Window', artist:'Lo-Fi Beats',
        melody:[N.Eb5,R,N.C5,N.Bb4,R,N.Ab4,N.G4,R,N.Ab4,R,N.Bb4,R,N.C5,R,N.Eb5,R,N.D5,R,N.C5,N.Bb4,R,N.Ab4,R,N.G4,N.Ab4,N.Bb4,N.Ab4,R,N.G4,R,R,R],
        chords:[[N.Ab3,N.C4,N.Eb4,N.G4],[N.Bb3,N.D4,N.F4,N.Ab4],[N.Eb3,N.G3,N.Bb3,N.D4],[N.Ab3,N.C4,N.Eb4]]},
      { title:'Late Night Study', artist:'Chill Hop',
        melody:[R,N.E4,N.G4,R,N.A4,R,N.B4,R,N.C5,R,R,N.B4,N.A4,R,N.G4,R,R,N.F4,N.A4,R,N.C5,R,N.B4,R,N.A4,R,N.G4,R,N.E4,R,R,R],
        chords:[[N.C4,N.E4,N.G4,N.B4],[N.A3,N.C4,N.E4,N.G4],[N.F3,N.A3,N.C4,N.E4],[N.G3,N.B3,N.D4,N.F4]]},
      { title:'3AM Coffee', artist:'Mellow Vibes',
        melody:[N.D5,R,N.E5,R,N.Fs5,R,N.E5,N.D5,N.B4,R,N.A4,R,N.Fs4,R,R,R,N.G4,R,N.A4,N.B4,N.D5,R,N.Cs5,R,N.B4,R,N.A4,N.G4,N.Fs4,R,R,R],
        chords:[[N.D3,N.Fs3,N.A3,N.Cs4],[N.B3,N.D4,N.Fs4,N.A4],[N.G3,N.B3,N.D4,N.Fs4],[N.A3,N.Cs4,N.E4,N.G4]]},
      { title:'Vinyl Crackle', artist:'Dusty Grooves',
        melody:[N.C5,R,N.Eb5,R,N.F5,R,N.G5,R,N.Eb5,R,N.C5,R,N.Bb4,R,N.C5,R,N.G4,R,N.Bb4,R,N.C5,N.Eb5,N.C5,R,N.Bb4,R,N.G4,R,N.F4,R,R,R],
        chords:[[N.C4,N.Eb4,N.G4,N.Bb4],[N.Ab3,N.C4,N.Eb4,N.G4],[N.Bb3,N.D4,N.F4],[N.G3,N.Bb3,N.D4]]},
    ],
  },
  synthwave: {
    name: 'Synthwave', emoji: '\uD83C\uDF06', color: '#e91e63', bpm: 110, swing: 0,
    oscTypes: ['sawtooth','square'], detune: 15, filterFreq: 2200, filterQ: 4,
    reverbDecay: 1.8, reverbMix: 0.25, melodyVol: 0.08, chordVol: 0.04, bassVol: 0.12, drumVol: 0.15,
    drumPattern:{kick:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],snare:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],hihat:[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],openhat:[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1]},
    tracks: [
      { title:'Midnight Drive', artist:'Neon Runner',
        melody:[N.E4,N.A4,N.B4,N.E5,N.B4,N.A4,N.E4,N.B4,N.D4,N.Fs4,N.A4,N.D5,N.A4,N.Fs4,N.D4,N.A4,N.C4,N.E4,N.G4,N.C5,N.G4,N.E4,N.C4,N.G4,N.D4,N.G4,N.A4,N.D5,N.A4,N.G4,N.D4,N.A4],
        chords:[[N.A3,N.Cs4,N.E4],[N.D3,N.Fs3,N.A3],[N.C3,N.E3,N.G3],[N.G3,N.B3,N.D4]]},
      { title:'Chrome Horizon', artist:'Retro Future',
        melody:[N.E5,N.E5,N.Fs5,N.G5,N.Fs5,R,N.E5,N.D5,N.B4,R,N.D5,R,N.E5,R,R,R,N.E5,N.E5,N.Fs5,N.G5,N.A5,R,N.G5,N.Fs5,N.E5,R,N.D5,N.E5,N.B4,R,R,R],
        chords:[[N.E3,N.Gs3,N.B3],[N.B3,N.Ds4,N.Fs4],[N.Cs4,N.E4,N.Gs4],[N.A3,N.Cs4,N.E4]]},
      { title:'Laser Grid', artist:'Voltage 84', bpm:120,
        melody:[N.A4,N.A5,N.A4,N.A5,N.G4,N.G5,N.A4,N.A5,N.F4,N.F5,N.G4,N.G5,N.A4,N.A5,N.G4,N.F4,N.E4,N.E5,N.E4,N.E5,N.D4,N.D5,N.E4,N.E5,N.F4,N.G4,N.A4,N.G4,N.F4,N.E4,N.D4,N.E4],
        chords:[[N.A3,N.C4,N.E4],[N.F3,N.A3,N.C4],[N.E3,N.Gs3,N.B3],[N.A3,N.C4,N.E4]]},
      { title:'Neon Lights', artist:'Synthwave FM',
        melody:[N.C5,R,N.D5,N.Eb5,N.G5,R,N.F5,N.Eb5,N.D5,R,N.C5,R,N.Bb4,R,N.C5,R,N.Eb5,R,N.F5,N.G5,N.Bb5,R,N.G5,N.F5,N.Eb5,R,N.D5,N.C5,N.Bb4,R,N.C5,R],
        chords:[[N.C4,N.Eb4,N.G4],[N.Bb3,N.D4,N.F4],[N.Ab3,N.C4,N.Eb4],[N.Bb3,N.D4,N.F4]]},
    ],
  },
  ambient: {
    name: 'Ambient', emoji: '\uD83C\uDF0C', color: '#00695c', bpm: 60, swing: 0,
    oscTypes: ['sine','triangle'], detune: 5, filterFreq: 1200, filterQ: 0.7,
    reverbDecay: 4.0, reverbMix: 0.55, melodyVol: 0.07, chordVol: 0.05, bassVol: 0.06, drumVol: 0,
    drumPattern:{kick:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],snare:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],hihat:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],openhat:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
    tracks: [
      { title:'Floating', artist:'Deep Space',
        melody:[N.E5,R,R,R,R,R,R,R,N.B4,R,R,R,R,R,N.D5,R,R,R,R,R,N.A4,R,R,R,R,R,N.E5,R,R,R,R,R],
        chords:[[N.A3,N.E4,N.B4],[N.G3,N.D4,N.B4],[N.F3,N.C4,N.A4],[N.E3,N.B3,N.Gs4]]},
      { title:'Clouds Below', artist:'Ether',
        melody:[N.G5,R,R,N.E5,R,R,N.D5,R,R,R,N.C5,R,R,R,R,R,N.D5,R,R,R,N.E5,R,R,N.G5,R,R,R,R,R,R,R,R],
        chords:[[N.C4,N.G4,N.E5],[N.A3,N.E4,N.C5],[N.F3,N.C4,N.A4],[N.G3,N.D4,N.B4]]},
      { title:'Still Water', artist:'Horizon',
        melody:[R,R,R,R,N.A4,R,R,R,R,R,R,R,R,R,R,R,N.E5,R,R,R,R,R,N.D5,R,R,R,R,R,R,R,R,R],
        chords:[[N.D3,N.A3,N.Fs4],[N.A3,N.E4,N.Cs5],[N.G3,N.D4,N.B4],[N.D3,N.A3,N.Fs4]]},
      { title:'Northern Lights', artist:'Aurora', bpm:50,
        melody:[N.B5,R,R,R,R,R,N.Gs5,R,R,R,R,R,N.E5,R,R,R,R,R,N.Fs5,R,R,R,R,R,N.Gs5,R,R,R,R,R,R,R],
        chords:[[N.E3,N.B3,N.Gs4],[N.Cs4,N.E4,N.Gs4],[N.A3,N.E4,N.Cs5],[N.B3,N.Fs4,N.Ds4]]},
    ],
  },
};

/* ═══════════════════════════════════════════════════════════════════
   SYNTH ENGINE (Radio mode backend)
   ═══════════════════════════════════════════════════════════════════ */
class SynthEngine {
  constructor() {
    this.ctx = null; this.masterGain = null; this.reverbGain = null;
    this.dryGain = null; this.reverbSend = null; this.filter = null;
    this.analyser = null; this.playing = false; this.schedulerTimer = null;
    this.currentGenre = null; this.currentTrack = null;
    this.step = 0; this.chordIdx = 0; this.melodyPos = 0;
    this.nextStepTime = 0; this._volume = 0.8; this._filterLFOTimer = null;
  }
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 256;
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._volume * 0.25;
    this.masterGain.connect(this.analyser); this.analyser.connect(this.ctx.destination);
    this.dryGain = this.ctx.createGain(); this.dryGain.connect(this.masterGain);
    this.reverbGain = this.ctx.createGain(); this.reverbGain.connect(this.masterGain);
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = 0.3;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass'; this.filter.frequency.value = 2000; this.filter.Q.value = 1;
    this.filter.connect(this.dryGain);
    this._buildReverb(2.0, 0.3);
  }
  _buildReverb(decay, mix) {
    try { this.reverbSend.disconnect(); } catch(_){}
    this.reverbSend = this.ctx.createGain(); this.reverbSend.gain.value = mix;
    const merger = this.ctx.createGain(); merger.gain.value = 0.5;
    merger.connect(this.reverbGain);
    [0.03,0.07,0.11,0.17,0.23,0.31].forEach((t,i) => {
      const d = this.ctx.createDelay(1); d.delayTime.value = t*(decay/2);
      const g = this.ctx.createGain(); g.gain.value = [0.6,0.5,0.4,0.3,0.2,0.15][i];
      this.reverbSend.connect(d); d.connect(g); g.connect(merger);
      const fb = this.ctx.createGain(); fb.gain.value = 0.2; g.connect(fb); fb.connect(d);
    });
    this.filter.connect(this.reverbSend);
  }
  setVolume(v) {
    this._volume = v/100;
    if (this.masterGain) this.masterGain.gain.setTargetAtTime(this._volume*0.25, this.ctx.currentTime, 0.05);
  }
  play(genreKey, trackIdx) {
    this.init();
    if (this.playing) this._crossfadeOut();
    const genre = GENRES[genreKey]; const track = genre.tracks[trackIdx];
    this.currentGenre = genre; this.currentTrack = track;
    this.step = 0; this.chordIdx = 0; this.melodyPos = 0; this.playing = true;
    this._currentBPM = track.bpm || genre.bpm;
    this.filter.frequency.setTargetAtTime(genre.filterFreq, this.ctx.currentTime, 0.1);
    this.filter.Q.setTargetAtTime(genre.filterQ, this.ctx.currentTime, 0.1);
    this._buildReverb(genre.reverbDecay, genre.reverbMix);
    this.dryGain.gain.value = 1 - genre.reverbMix*0.5;
    this._startFilterLFO(genre);
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this._schedule();
  }
  _crossfadeOut() {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      setTimeout(() => { if (this.masterGain) this.masterGain.gain.setTargetAtTime(this._volume*0.25, this.ctx.currentTime, 0.08); }, 400);
    }
    this._stopScheduler();
  }
  _startFilterLFO(genre) {
    if (this._filterLFOTimer) clearInterval(this._filterLFOTimer);
    let phase = 0;
    this._filterLFOTimer = setInterval(() => {
      if (!this.playing || !this.filter) return;
      phase += 0.05;
      this.filter.frequency.setTargetAtTime(Math.max(200, genre.filterFreq + Math.sin(phase)*genre.filterFreq*0.3), this.ctx.currentTime, 0.1);
    }, 100);
  }
  _schedule() {
    if (!this.playing) return;
    const genre = this.currentGenre; const track = this.currentTrack;
    const secPerStep = (60/this._currentBPM)/4;
    while (this.nextStepTime < this.ctx.currentTime + 0.1) {
      const t = this.nextStepTime; const s = this.step % 16;
      const st = t + (s%2===1 && genre.swing > 0 ? secPerStep*genre.swing : 0);
      if (s===0) {
        const chords = track.chords;
        if (chords?.length) {
          const chord = chords[this.chordIdx % chords.length];
          this._playChord(chord, st, secPerStep*16, genre);
          this._playBass(chord[0]/2, st, secPerStep*8, genre);
          this.chordIdx++;
        }
      }
      if (s%2===0) {
        const melody = track.melody;
        if (melody?.length) {
          const freq = melody[this.melodyPos % melody.length];
          if (freq > 0) this._playMelody(freq, st, secPerStep*2.5, genre);
          this.melodyPos++;
        }
      }
      if (genre.drumVol > 0) {
        const dp = track.drumPattern || genre.drumPattern;
        if (dp.kick[s]) this._playKick(st, genre);
        if (dp.snare[s]) this._playSnare(st, genre);
        if (dp.hihat[s]) this._playHihat(st, false, genre);
        if (dp.openhat[s]) this._playHihat(st, true, genre);
      }
      this.step++; this.nextStepTime += secPerStep;
    }
    this.schedulerTimer = setTimeout(() => this._schedule(), 25);
  }
  _playChord(freqs, time, dur, genre) {
    freqs.forEach((freq,i) => {
      const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
      osc.type = genre.oscTypes[i%genre.oscTypes.length]; osc.frequency.value = freq;
      osc.detune.value = (i-1)*genre.detune;
      g.gain.setValueAtTime(0,time); g.gain.linearRampToValueAtTime(genre.chordVol,time+0.08);
      g.gain.setValueAtTime(genre.chordVol,time+dur*0.6);
      g.gain.exponentialRampToValueAtTime(0.001,time+dur*0.95);
      osc.connect(g); g.connect(this.filter); osc.start(time); osc.stop(time+dur);
    });
  }
  _playBass(freq, time, dur, genre) {
    const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
    osc.type='sine'; osc.frequency.value=freq;
    const sub = this.ctx.createOscillator(); const sg = this.ctx.createGain();
    sub.type='sine'; sub.frequency.value=freq/2;
    sg.gain.setValueAtTime(genre.bassVol*0.3,time); sg.gain.exponentialRampToValueAtTime(0.001,time+dur);
    sub.connect(sg); sg.connect(this.filter); sub.start(time); sub.stop(time+dur);
    g.gain.setValueAtTime(0,time); g.gain.linearRampToValueAtTime(genre.bassVol,time+0.02);
    g.gain.exponentialRampToValueAtTime(0.001,time+dur*0.9);
    osc.connect(g); g.connect(this.filter); osc.start(time); osc.stop(time+dur);
  }
  _playMelody(freq, time, dur, genre) {
    for (let i=0;i<2;i++) {
      const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
      osc.type = genre.oscTypes[i%genre.oscTypes.length]; osc.frequency.value = freq;
      osc.detune.value = (i===0?-genre.detune:genre.detune);
      const vol = genre.melodyVol*(i===0?1:0.5);
      g.gain.setValueAtTime(0,time); g.gain.linearRampToValueAtTime(vol,time+0.02);
      g.gain.setValueAtTime(vol*0.8,time+dur*0.5);
      g.gain.exponentialRampToValueAtTime(0.001,time+dur);
      osc.connect(g); g.connect(this.filter); osc.start(time); osc.stop(time+dur+0.01);
    }
  }
  _playKick(time, genre) {
    const osc = this.ctx.createOscillator(); const g = this.ctx.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(150,time);
    osc.frequency.exponentialRampToValueAtTime(40,time+0.12);
    g.gain.setValueAtTime(genre.drumVol,time); g.gain.exponentialRampToValueAtTime(0.001,time+0.3);
    osc.connect(g); g.connect(this.filter); osc.start(time); osc.stop(time+0.35);
    const c = this.ctx.createOscillator(); const cg = this.ctx.createGain();
    c.type='square'; c.frequency.value=800;
    cg.gain.setValueAtTime(genre.drumVol*0.3,time); cg.gain.exponentialRampToValueAtTime(0.001,time+0.015);
    c.connect(cg); cg.connect(this.filter); c.start(time); c.stop(time+0.02);
  }
  _playSnare(time, genre) {
    const bs = this.ctx.sampleRate*0.15; const buf = this.ctx.createBuffer(1,bs,this.ctx.sampleRate);
    const d = buf.getChannelData(0); for(let i=0;i<bs;i++) d[i]=Math.random()*2-1;
    const n = this.ctx.createBufferSource(); n.buffer=buf;
    const ng = this.ctx.createGain(); const nf = this.ctx.createBiquadFilter();
    nf.type='highpass'; nf.frequency.value=1500;
    ng.gain.setValueAtTime(genre.drumVol*0.7,time); ng.gain.exponentialRampToValueAtTime(0.001,time+0.15);
    n.connect(nf); nf.connect(ng); ng.connect(this.filter); n.start(time); n.stop(time+0.2);
    const o = this.ctx.createOscillator(); const og = this.ctx.createGain();
    o.type='triangle'; o.frequency.value=200;
    og.gain.setValueAtTime(genre.drumVol*0.5,time); og.gain.exponentialRampToValueAtTime(0.001,time+0.08);
    o.connect(og); og.connect(this.filter); o.start(time); o.stop(time+0.1);
  }
  _playHihat(time, open, genre) {
    const bs = this.ctx.sampleRate*(open?0.2:0.05); const buf = this.ctx.createBuffer(1,bs,this.ctx.sampleRate);
    const d = buf.getChannelData(0); for(let i=0;i<bs;i++) d[i]=Math.random()*2-1;
    const n = this.ctx.createBufferSource(); n.buffer=buf;
    const g = this.ctx.createGain(); const f = this.ctx.createBiquadFilter();
    f.type='bandpass'; f.frequency.value=open?8000:10000; f.Q.value=1;
    const vol = genre.drumVol*(open?0.35:0.25); const decay = open?0.18:0.04;
    g.gain.setValueAtTime(vol,time); g.gain.exponentialRampToValueAtTime(0.001,time+decay);
    n.connect(f); f.connect(g); g.connect(this.filter); n.start(time); n.stop(time+decay+0.01);
  }
  pause() { this.playing=false; this._stopScheduler(); if(this.ctx?.state==='running') this.ctx.suspend(); }
  resume() { if(!this.ctx||!this.currentGenre) return; if(this.ctx.state==='suspended') this.ctx.resume(); this.playing=true; this.nextStepTime=this.ctx.currentTime+0.05; this._schedule(); }
  stop() { this.playing=false; this._stopScheduler(); }
  _stopScheduler() { if(this.schedulerTimer){clearTimeout(this.schedulerTimer);this.schedulerTimer=null;} if(this._filterLFOTimer){clearInterval(this._filterLFOTimer);this._filterLFOTimer=null;} }
  getAnalyserData() { if(!this.analyser) return null; const d=new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteFrequencyData(d); return d; }
  destroy() { this.stop(); if(this.ctx){this.ctx.close().catch(()=>{}); this.ctx=null;} }
}

/* ═══════════════════════════════════════════════════════════════════
   YOUTUBE PLAYER (wraps IFrame API)
   Shared loader/utils imported from ../lib/youtube-api.js
   ═══════════════════════════════════════════════════════════════════ */

class YouTubePlayer {
  constructor(containerEl, onStateChange) {
    this.container = containerEl;
    this.onStateChange = onStateChange;
    this.player = null;
    this.ready = false;
    this._volume = 80;
    this._pollTimer = null;
  }

  async init() {
    await loadYouTubeAPI();
    // Create the div for the player
    const div = document.createElement('div');
    div.id = 'mv2-yt-player-' + Date.now();
    this.container.appendChild(div);

    return new Promise(resolve => {
      this.player = new window.YT.Player(div.id, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          fs: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => { this.ready = true; this.player.setVolume(this._volume); resolve(); },
          onStateChange: (e) => { if (this.onStateChange) this.onStateChange(e.data); },
        }
      });
    });
  }

  playVideo(videoId) {
    if (!this.ready) return;
    this.player.loadVideoById(videoId);
    this._startPoll();
  }

  play() { if (this.ready) { this.player.playVideo(); this._startPoll(); } }
  pause() { if (this.ready) this.player.pauseVideo(); }
  stop() { if (this.ready) { this.player.stopVideo(); this._stopPoll(); } }

  setVolume(v) {
    this._volume = v;
    if (this.ready) this.player.setVolume(v);
  }

  getDuration() { return this.ready ? this.player.getDuration() || 0 : 0; }
  getCurrentTime() { return this.ready ? this.player.getCurrentTime() || 0 : 0; }
  seekTo(sec) { if (this.ready) this.player.seekTo(sec, true); }

  getTitle() {
    try {
      const data = this.player.getVideoData();
      return data?.title || 'YouTube Video';
    } catch { return 'YouTube Video'; }
  }

  _startPoll() {
    this._stopPoll();
    this._pollTimer = setInterval(() => {
      if (this.onProgress) this.onProgress(this.getCurrentTime(), this.getDuration());
    }, 500);
  }
  _stopPoll() { if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; } }

  destroy() {
    this._stopPoll();
    if (this.player) { try { this.player.destroy(); } catch(_){} this.player = null; }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   LOCAL FILE PLAYER (HTML5 Audio + Web Audio API analyser)
   ═══════════════════════════════════════════════════════════════════ */
class LocalPlayer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.audioEl = null;
    this.source = null;
    this.playlist = []; // { file, name, url }
    this.currentIdx = -1;
    this._volume = 80;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);

    this.audioEl = document.createElement('audio');
    this.audioEl.crossOrigin = 'anonymous';
    this.source = this.ctx.createMediaElementSource(this.audioEl);
    this.source.connect(this.analyser);
  }

  addFiles(files) {
    this.init();
    for (const file of files) {
      // Skip non-audio files
      if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac|wma|opus|webm)$/i.test(file.name)) continue;
      const url = URL.createObjectURL(file);
      const name = file.name.replace(/\.[^.]+$/, '');
      this.playlist.push({ file, name, url });
    }
  }

  playIdx(idx) {
    if (idx < 0 || idx >= this.playlist.length) return;
    this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.currentIdx = idx;
    const item = this.playlist[idx];
    this.audioEl.src = item.url;
    this.audioEl.volume = this._volume / 100;
    this.audioEl.play().catch(() => {});
  }

  play() { if (this.audioEl) { if (this.ctx?.state === 'suspended') this.ctx.resume(); this.audioEl.play().catch(() => {}); } }
  pause() { if (this.audioEl) this.audioEl.pause(); }
  stop() { if (this.audioEl) { this.audioEl.pause(); this.audioEl.currentTime = 0; } }

  setVolume(v) {
    this._volume = v;
    if (this.audioEl) this.audioEl.volume = v / 100;
  }

  getDuration() { return this.audioEl?.duration || 0; }
  getCurrentTime() { return this.audioEl?.currentTime || 0; }
  seekTo(sec) { if (this.audioEl) this.audioEl.currentTime = sec; }

  getAnalyserData() {
    if (!this.analyser) return null;
    const d = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(d);
    return d;
  }

  destroy() {
    if (this.audioEl) { this.audioEl.pause(); this.audioEl.src = ''; }
    this.playlist.forEach(p => URL.revokeObjectURL(p.url));
    this.playlist = [];
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════════ */
function initMusic(container) {
  const synthEngine = new SynthEngine();
  const localPlayer = new LocalPlayer();
  let ytPlayer = null; // lazy init

  let activeMode = 'radio'; // 'radio' | 'youtube' | 'local'
  let currentTrackIdx = -1;
  let isPlaying = false;
  let vizRAF = null;
  let tickTimer = null;
  let elapsed = 0;
  let shuffle = false;
  let repeatMode = false;

  const genreKeys = Object.keys(GENRES);

  container.innerHTML = `
    <style>
      .music-v2 {
        display:flex; flex-direction:column; height:100%;
        background:rgba(18,18,22,0.95); color:var(--text-primary,#fff);
        font-family:var(--font,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);
        border-radius:0 0 var(--radius-lg,14px) var(--radius-lg,14px);
        overflow:hidden; user-select:none;
      }
      /* ── Mode Tabs ── */
      .mv2-mode-tabs {
        display:flex; gap:0; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0;
      }
      .mv2-mode-tab {
        flex:1; padding:9px 0; text-align:center; font-size:12px; font-weight:500;
        color:var(--text-secondary,#aaa); cursor:pointer; border:none; background:none;
        transition:all 0.2s; border-bottom:2px solid transparent;
      }
      .mv2-mode-tab:hover { color:#fff; background:rgba(255,255,255,0.03); }
      .mv2-mode-tab.active { color:var(--accent,#007aff); border-bottom-color:var(--accent,#007aff); }
      /* ── Sub bar (genre filter / search / etc) ── */
      .mv2-subbar {
        display:flex; gap:6px; padding:8px 14px 6px; flex-shrink:0;
        border-bottom:1px solid rgba(255,255,255,0.04); overflow-x:auto;
        align-items:center;
      }
      .mv2-subbar.hidden { display:none; }
      .mv2-genre-btn {
        padding:5px 12px; border-radius:20px; border:none;
        background:rgba(255,255,255,0.06); color:var(--text-secondary,#aaa);
        font-size:11px; cursor:pointer; white-space:nowrap;
        transition:all 0.2s; display:flex; align-items:center; gap:4px;
      }
      .mv2-genre-btn:hover { background:rgba(255,255,255,0.1); color:#fff; }
      .mv2-genre-btn.active { background:var(--accent,#007aff); color:#fff; font-weight:600; }
      /* ── Body ── */
      .mv2-body { display:flex; flex:1; min-height:0; }
      .mv2-content { flex:1; overflow-y:auto; }
      .mv2-content::-webkit-scrollbar { width:5px; }
      .mv2-content::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:3px; }
      /* ── Track rows ── */
      .mv2-track {
        display:flex; align-items:center; gap:10px;
        padding:7px 16px; cursor:pointer; transition:background 0.15s;
      }
      .mv2-track:hover { background:rgba(255,255,255,0.04); }
      .mv2-track.active { background:rgba(255,255,255,0.07); }
      .mv2-track.playing .mv2-track-num { color:var(--accent,#007aff); }
      .mv2-track-num { width:20px; text-align:right; font-size:11px; color:var(--text-tertiary,#666); }
      .mv2-track-art {
        width:34px; height:34px; border-radius:5px;
        display:flex; align-items:center; justify-content:center;
        font-size:16px; flex-shrink:0; background-size:cover; background-position:center;
      }
      .mv2-track-info { flex:1; min-width:0; }
      .mv2-track-title { font-size:12px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mv2-track-artist { font-size:10px; color:var(--text-secondary,#aaa); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mv2-track-badge {
        font-size:9px; color:var(--text-tertiary,#666);
        background:rgba(255,255,255,0.05); padding:2px 7px; border-radius:10px; flex-shrink:0;
      }
      /* ── Right panel (viz / video) ── */
      .mv2-right-panel {
        width:230px; display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        border-left:1px solid rgba(255,255,255,0.06);
        padding:12px; flex-shrink:0;
      }
      .mv2-viz-canvas { width:200px; height:130px; border-radius:8px; background:rgba(0,0,0,0.3); }
      .mv2-yt-video-wrap {
        width:200px; height:130px; border-radius:8px; overflow:hidden;
        background:#000; display:none;
      }
      .mv2-yt-video-wrap iframe { width:100%; height:100%; border:none; }
      .mv2-viz-label { font-size:9px; color:var(--text-tertiary,#666); margin-top:6px; text-transform:uppercase; letter-spacing:1px; }
      .mv2-now-info { text-align:center; margin-bottom:10px; max-width:200px; }
      .mv2-now-emoji { font-size:28px; margin-bottom:4px; }
      .mv2-now-title { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .mv2-now-artist { font-size:10px; color:var(--text-secondary,#aaa); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* ── Player bar ── */
      .mv2-player {
        display:flex; align-items:center; gap:10px;
        padding:8px 14px; border-top:1px solid rgba(255,255,255,0.06);
        background:rgba(0,0,0,0.2); flex-shrink:0;
      }
      .mv2-ctrl-btn {
        background:none; border:none; color:var(--text-secondary,#aaa);
        font-size:16px; cursor:pointer; padding:4px 5px; border-radius:6px; transition:all 0.15s;
        display:flex; align-items:center; justify-content:center;
      }
      .mv2-ctrl-btn:hover { color:#fff; background:rgba(255,255,255,0.08); }
      .mv2-ctrl-btn.play {
        font-size:20px; color:#fff; background:var(--accent,#007aff);
        width:34px; height:34px; border-radius:50%;
      }
      .mv2-ctrl-btn.play:hover { filter:brightness(1.15); }
      .mv2-progress-wrap { flex:1; display:flex; align-items:center; gap:6px; }
      .mv2-time { font-size:10px; color:var(--text-tertiary,#666); font-variant-numeric:tabular-nums; min-width:30px; }
      .mv2-progress-bar { flex:1; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; cursor:pointer; position:relative; }
      .mv2-progress-fill { height:100%; background:var(--accent,#007aff); border-radius:2px; width:0; transition:width 0.3s linear; }
      .mv2-volume { display:flex; align-items:center; gap:5px; }
      .mv2-volume-icon { font-size:12px; color:var(--text-secondary,#aaa); }
      .mv2-volume-slider {
        width:60px; height:4px; -webkit-appearance:none; appearance:none;
        background:rgba(255,255,255,0.1); border-radius:2px; outline:none;
      }
      .mv2-volume-slider::-webkit-slider-thumb { -webkit-appearance:none; width:11px; height:11px; background:#fff; border-radius:50%; cursor:pointer; }
      .mv2-small-btn {
        background:none; border:none; color:var(--text-tertiary,#666);
        font-size:13px; cursor:pointer; padding:3px; border-radius:4px; transition:color 0.15s;
      }
      .mv2-small-btn:hover { color:var(--text-secondary,#aaa); }
      .mv2-small-btn.active { color:var(--accent,#007aff); }
      /* ── YouTube search ── */
      .mv2-yt-bar { display:flex; gap:6px; padding:8px 14px; border-bottom:1px solid rgba(255,255,255,0.04); flex-shrink:0; }
      .mv2-yt-bar.hidden { display:none; }
      .mv2-yt-input {
        flex:1; padding:6px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.08);
        background:rgba(255,255,255,0.06); color:#fff; font-size:12px; outline:none;
        font-family:inherit;
      }
      .mv2-yt-input:focus { border-color:var(--accent,#007aff); }
      .mv2-yt-input::placeholder { color:var(--text-tertiary,#666); }
      .mv2-yt-btn {
        padding:6px 12px; border-radius:8px; border:none;
        background:var(--accent,#007aff); color:#fff; font-size:11px;
        cursor:pointer; font-weight:600; white-space:nowrap;
      }
      .mv2-yt-btn:hover { filter:brightness(1.15); }
      .mv2-yt-btn.secondary { background:rgba(255,255,255,0.08); color:var(--text-secondary,#aaa); }
      .mv2-yt-btn.secondary:hover { background:rgba(255,255,255,0.12); color:#fff; }
      /* ── Local files ── */
      .mv2-drop-zone {
        margin:16px; padding:30px; border:2px dashed rgba(255,255,255,0.1);
        border-radius:12px; text-align:center; color:var(--text-tertiary,#666);
        font-size:12px; cursor:pointer; transition:all 0.2s;
      }
      .mv2-drop-zone:hover, .mv2-drop-zone.dragover {
        border-color:var(--accent,#007aff); color:var(--text-secondary,#aaa);
        background:rgba(0,122,255,0.05);
      }
      .mv2-drop-zone-icon { font-size:28px; margin-bottom:8px; }
      .mv2-local-bar { display:flex; gap:6px; padding:8px 14px; border-bottom:1px solid rgba(255,255,255,0.04); }
      .mv2-local-bar.hidden { display:none; }
    </style>

    <div class="music-v2">
      <div class="mv2-mode-tabs">
        <button class="mv2-mode-tab active" data-mode="radio">\uD83C\uDFB6 Radio</button>
        <button class="mv2-mode-tab" data-mode="youtube">\u25B6 YouTube</button>
        <button class="mv2-mode-tab" data-mode="local">\uD83D\uDCC1 Local Files</button>
      </div>

      <!-- Radio sub-bar (genre filters) -->
      <div class="mv2-subbar" id="mv2-genres"></div>

      <!-- YouTube search bar -->
      <div class="mv2-yt-bar hidden" id="mv2-yt-bar">
        <input class="mv2-yt-input" id="mv2-yt-input" placeholder="Paste YouTube URL or search..." />
        <button class="mv2-yt-btn" id="mv2-yt-search">\uD83D\uDD0D Search</button>
        <button class="mv2-yt-btn secondary" id="mv2-yt-key" title="Set API Key">\u2699</button>
      </div>

      <!-- Local files bar -->
      <div class="mv2-local-bar hidden" id="mv2-local-bar">
        <button class="mv2-yt-btn secondary" id="mv2-local-add">\u2795 Add Files</button>
        <input type="file" id="mv2-file-input" multiple accept="audio/*" style="display:none" />
      </div>

      <div class="mv2-body">
        <div class="mv2-content" id="mv2-content"></div>
        <div class="mv2-right-panel">
          <div class="mv2-now-info">
            <div class="mv2-now-emoji" id="mv2-now-emoji">\uD83C\uDFB5</div>
            <div class="mv2-now-title" id="mv2-now-title">Not Playing</div>
            <div class="mv2-now-artist" id="mv2-now-artist">\u2014</div>
          </div>
          <div class="mv2-yt-video-wrap" id="mv2-yt-video"></div>
          <canvas class="mv2-viz-canvas" id="mv2-viz" width="400" height="260"></canvas>
          <div class="mv2-viz-label" id="mv2-viz-label">Visualizer</div>
        </div>
      </div>

      <div class="mv2-player">
        <button class="mv2-small-btn" id="mv2-shuffle" title="Shuffle">\uD83D\uDD00</button>
        <button class="mv2-ctrl-btn" id="mv2-prev">\u23EE</button>
        <button class="mv2-ctrl-btn play" id="mv2-play">\u25B6</button>
        <button class="mv2-ctrl-btn" id="mv2-next">\u23ED</button>
        <button class="mv2-small-btn" id="mv2-repeat" title="Repeat">\uD83D\uDD01</button>
        <div class="mv2-progress-wrap">
          <span class="mv2-time" id="mv2-time-cur">0:00</span>
          <div class="mv2-progress-bar" id="mv2-pbar">
            <div class="mv2-progress-fill" id="mv2-pfill"></div>
          </div>
          <span class="mv2-time" id="mv2-time-dur">0:00</span>
        </div>
        <div class="mv2-volume">
          <span class="mv2-volume-icon">\uD83D\uDD0A</span>
          <input type="range" class="mv2-volume-slider" id="mv2-vol" min="0" max="100" value="80">
        </div>
      </div>
    </div>
  `;

  // ── Element refs ──
  const contentEl = container.querySelector('#mv2-content');
  const genresEl = container.querySelector('#mv2-genres');
  const ytBar = container.querySelector('#mv2-yt-bar');
  const ytInput = container.querySelector('#mv2-yt-input');
  const ytSearchBtn = container.querySelector('#mv2-yt-search');
  const ytKeyBtn = container.querySelector('#mv2-yt-key');
  const localBar = container.querySelector('#mv2-local-bar');
  const localAddBtn = container.querySelector('#mv2-local-add');
  const fileInput = container.querySelector('#mv2-file-input');
  const ytVideoWrap = container.querySelector('#mv2-yt-video');
  const vizCanvas = container.querySelector('#mv2-viz');
  const vizCtx = vizCanvas.getContext('2d');
  const vizLabel = container.querySelector('#mv2-viz-label');
  const nowEmoji = container.querySelector('#mv2-now-emoji');
  const nowTitle = container.querySelector('#mv2-now-title');
  const nowArtist = container.querySelector('#mv2-now-artist');
  const playBtn = container.querySelector('#mv2-play');
  const prevBtn = container.querySelector('#mv2-prev');
  const nextBtn = container.querySelector('#mv2-next');
  const shuffleBtn = container.querySelector('#mv2-shuffle');
  const repeatBtn = container.querySelector('#mv2-repeat');
  const timeCur = container.querySelector('#mv2-time-cur');
  const timeDur = container.querySelector('#mv2-time-dur');
  const pFill = container.querySelector('#mv2-pfill');
  const pBar = container.querySelector('#mv2-pbar');
  const volSlider = container.querySelector('#mv2-vol');

  // ── Mode switching ──
  const modeTabs = container.querySelectorAll('.mv2-mode-tab');
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      if (mode === activeMode) return;
      stopAll();
      activeMode = mode;
      modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
      genresEl.classList.toggle('hidden', mode !== 'radio');
      ytBar.classList.toggle('hidden', mode !== 'youtube');
      localBar.classList.toggle('hidden', mode !== 'local');
      ytVideoWrap.style.display = mode === 'youtube' ? 'block' : 'none';
      vizCanvas.style.display = mode === 'youtube' ? 'none' : 'block';
      vizLabel.textContent = mode === 'youtube' ? '' : 'Visualizer';
      renderContent();
    });
  });

  function stopAll() {
    synthEngine.stop();
    localPlayer.stop();
    if (ytPlayer) ytPlayer.stop();
    isPlaying = false;
    playBtn.textContent = '\u25B6';
    stopTick(); stopViz();
    nowTitle.textContent = 'Not Playing';
    nowArtist.textContent = '\u2014';
    nowEmoji.textContent = '\uD83C\uDFB5';
    timeCur.textContent = '0:00';
    timeDur.textContent = '0:00';
    pFill.style.width = '0';
  }

  // ══════════════════════════════════════════════════
  // RADIO MODE
  // ══════════════════════════════════════════════════
  let radioTracks = [];
  let radioFilter = null;

  function buildRadioTracks(filterGenre) {
    radioTracks = [];
    const keys = filterGenre ? [filterGenre] : genreKeys;
    keys.forEach(gk => {
      const g = GENRES[gk];
      g.tracks.forEach((t, i) => {
        radioTracks.push({ ...t, genreKey: gk, genreTrackIdx: i, genre: g });
      });
    });
  }

  // Genre buttons
  const allBtn = document.createElement('button');
  allBtn.className = 'mv2-genre-btn active'; allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    genresEl.querySelectorAll('.mv2-genre-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active'); radioFilter = null;
    buildRadioTracks(null); renderContent();
  });
  genresEl.appendChild(allBtn);
  genreKeys.forEach(gk => {
    const g = GENRES[gk];
    const btn = document.createElement('button');
    btn.className = 'mv2-genre-btn';
    btn.innerHTML = `${g.emoji} ${g.name}`;
    btn.addEventListener('click', () => {
      genresEl.querySelectorAll('.mv2-genre-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); radioFilter = gk;
      buildRadioTracks(gk); renderContent();
    });
    genresEl.appendChild(btn);
  });
  buildRadioTracks(null);

  // ══════════════════════════════════════════════════
  // YOUTUBE MODE
  // ══════════════════════════════════════════════════
  let ytResults = []; // search results
  let ytHistory = []; // played videos { id, title, channel }

  async function initYTPlayer() {
    if (ytPlayer) return;
    ytPlayer = new YouTubePlayer(ytVideoWrap, (state) => {
      // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering
      if (state === 0) { // ended
        if (repeatMode) { ytPlayer.seekTo(0); ytPlayer.play(); }
        else { isPlaying = false; playBtn.textContent = '\u25B6'; stopTick(); }
      }
    });
    await ytPlayer.init();
    ytPlayer.onProgress = (cur, dur) => {
      if (activeMode !== 'youtube' || !isPlaying) return;
      timeCur.textContent = fmtTime(cur);
      timeDur.textContent = fmtTime(dur);
      pFill.style.width = dur > 0 ? (cur/dur*100)+'%' : '0';
    };
  }

  async function playYTVideo(videoId, title, channel) {
    if (!videoId) return; // guard against invalid URLs
    try {
      await initYTPlayer();
    } catch (e) {
      nowTitle.textContent = 'YouTube unavailable';
      nowArtist.textContent = 'Check your internet connection';
      return;
    }
    ytPlayer.playVideo(videoId);
    isPlaying = true; playBtn.textContent = '\u23F8';
    nowEmoji.textContent = '\u25B6';
    nowTitle.textContent = title || ytPlayer.getTitle();
    nowArtist.textContent = channel || 'YouTube';
    // Add to history (deduplicate)
    ytHistory = ytHistory.filter(h => h.id !== videoId);
    ytHistory.unshift({ id: videoId, title: title || 'Video', channel: channel || '' });
    if (ytHistory.length > 20) ytHistory.pop();
  }

  ytSearchBtn.addEventListener('click', () => doYTSearch());
  ytInput.addEventListener('keydown', e => { if (e.key === 'Enter') doYTSearch(); });

  async function doYTSearch() {
    const val = ytInput.value.trim();
    if (!val) return;
    // Check if it's a URL
    const vid = extractVideoId(val);
    if (vid) {
      playYTVideo(vid, '', '');
      renderContent();
      return;
    }
    // Try search
    const key = getYTApiKey();
    if (!key) {
      promptForAPIKey();
      return;
    }
    ytSearchBtn.textContent = '...';
    ytResults = await searchYouTube(val, key);
    ytSearchBtn.textContent = '\uD83D\uDD0D Search';
    renderContent();
  }

  ytKeyBtn.addEventListener('click', promptForAPIKey);

  function promptForAPIKey() {
    const current = getYTApiKey();
    const key = prompt('Enter your YouTube Data API v3 key:\n(Get one free at console.cloud.google.com)', current);
    if (key !== null) {
      setYTApiKey(key.trim());
    }
  }

  // ══════════════════════════════════════════════════
  // LOCAL FILES MODE
  // ══════════════════════════════════════════════════
  localAddBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      localPlayer.addFiles(fileInput.files);
      renderContent();
    }
    fileInput.value = '';
  });

  // ══════════════════════════════════════════════════
  // CONTENT RENDERER
  // ══════════════════════════════════════════════════
  function renderContent() {
    contentEl.innerHTML = '';
    if (activeMode === 'radio') renderRadioContent();
    else if (activeMode === 'youtube') renderYTContent();
    else if (activeMode === 'local') renderLocalContent();
  }

  function renderRadioContent() {
    radioTracks.forEach((track, idx) => {
      const el = document.createElement('div');
      const isCurrent = activeMode === 'radio' && idx === currentTrackIdx && isPlaying;
      el.className = 'mv2-track' + (isCurrent ? ' active playing' : '');
      el.innerHTML = `
        <div class="mv2-track-num">${idx+1}</div>
        <div class="mv2-track-art" style="background:${track.genre.color}">${track.genre.emoji}</div>
        <div class="mv2-track-info">
          <div class="mv2-track-title">${track.title}</div>
          <div class="mv2-track-artist">${track.artist}</div>
        </div>
        <div class="mv2-track-badge">${track.genre.name}</div>
      `;
      el.addEventListener('dblclick', () => playRadioTrack(idx));
      contentEl.appendChild(el);
    });
  }

  function renderYTContent() {
    // Search results
    if (ytResults.length) {
      const label = document.createElement('div');
      label.style.cssText = 'padding:8px 16px;font-size:10px;color:var(--text-tertiary,#666);text-transform:uppercase;letter-spacing:1px;';
      label.textContent = 'Search Results';
      contentEl.appendChild(label);

      ytResults.forEach((r, idx) => {
        const el = document.createElement('div');
        el.className = 'mv2-track';
        el.innerHTML = `
          <div class="mv2-track-num">${idx+1}</div>
          <div class="mv2-track-art" style="background-image:url(${r.thumb});background-size:cover;background-color:#222;"></div>
          <div class="mv2-track-info">
            <div class="mv2-track-title">${escHtml(r.title)}</div>
            <div class="mv2-track-artist">${escHtml(r.channel)}</div>
          </div>
        `;
        el.addEventListener('click', () => playYTVideo(r.id, r.title, r.channel));
        contentEl.appendChild(el);
      });
    }

    // History
    if (ytHistory.length) {
      const label = document.createElement('div');
      label.style.cssText = 'padding:8px 16px;font-size:10px;color:var(--text-tertiary,#666);text-transform:uppercase;letter-spacing:1px;margin-top:8px;';
      label.textContent = ytResults.length ? 'Recently Played' : 'Recently Played \u2014 paste a URL or search above';
      contentEl.appendChild(label);

      ytHistory.forEach((h, idx) => {
        const el = document.createElement('div');
        el.className = 'mv2-track';
        el.innerHTML = `
          <div class="mv2-track-num">${idx+1}</div>
          <div class="mv2-track-art" style="background-image:url(https://img.youtube.com/vi/${h.id}/default.jpg);background-size:cover;background-color:#222;"></div>
          <div class="mv2-track-info">
            <div class="mv2-track-title">${escHtml(h.title)}</div>
            <div class="mv2-track-artist">${escHtml(h.channel)}</div>
          </div>
        `;
        el.addEventListener('click', () => playYTVideo(h.id, h.title, h.channel));
        contentEl.appendChild(el);
      });
    }

    if (!ytResults.length && !ytHistory.length) {
      contentEl.innerHTML = `
        <div style="padding:40px 20px;text-align:center;color:var(--text-tertiary,#666);">
          <div style="font-size:32px;margin-bottom:10px;">\u25B6</div>
          <div style="font-size:13px;margin-bottom:6px;">Paste a YouTube URL to play</div>
          <div style="font-size:11px;">Or set an API key (\u2699) to enable search</div>
        </div>
      `;
    }
  }

  function renderLocalContent() {
    if (localPlayer.playlist.length === 0) {
      contentEl.innerHTML = `
        <div class="mv2-drop-zone" id="mv2-drop-zone">
          <div class="mv2-drop-zone-icon">\uD83D\uDCC1</div>
          <div>Drop audio files here</div>
          <div style="font-size:10px;margin-top:4px;color:var(--text-tertiary,#666)">MP3, WAV, OGG, FLAC, M4A</div>
        </div>
      `;
      setupDropZone();
      return;
    }

    localPlayer.playlist.forEach((item, idx) => {
      const el = document.createElement('div');
      const isCurrent = activeMode === 'local' && idx === currentTrackIdx && isPlaying;
      el.className = 'mv2-track' + (isCurrent ? ' active playing' : '');
      el.innerHTML = `
        <div class="mv2-track-num">${idx+1}</div>
        <div class="mv2-track-art" style="background:#2a2a3a">\uD83C\uDFB5</div>
        <div class="mv2-track-info">
          <div class="mv2-track-title">${escHtml(item.name)}</div>
          <div class="mv2-track-artist">Local File</div>
        </div>
      `;
      el.addEventListener('dblclick', () => playLocalTrack(idx));
      contentEl.appendChild(el);
    });

    // Add drop zone at bottom
    const dz = document.createElement('div');
    dz.className = 'mv2-drop-zone';
    dz.id = 'mv2-drop-zone';
    dz.style.cssText = 'margin:8px 16px;padding:16px;';
    dz.innerHTML = '<div style="font-size:11px;">\u2795 Drop more files or click to add</div>';
    contentEl.appendChild(dz);
    setupDropZone();
  }

  function setupDropZone() {
    const dz = contentEl.querySelector('#mv2-drop-zone');
    if (!dz) return;
    dz.addEventListener('click', () => fileInput.click());
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        localPlayer.addFiles(e.dataTransfer.files);
        renderContent();
      }
    });
  }

  // ── Playback functions ──

  function playRadioTrack(idx) {
    stopAll();
    activeMode = 'radio'; currentTrackIdx = idx;
    const track = radioTracks[idx];
    if (!track) return;
    nowEmoji.textContent = track.genre.emoji;
    nowTitle.textContent = track.title;
    nowArtist.textContent = track.artist + ' \u00B7 ' + track.genre.name;
    isPlaying = true; playBtn.textContent = '\u23F8';
    elapsed = 0;
    synthEngine.play(track.genreKey, track.genreTrackIdx);
    startRadioTick(); startViz();
    renderContent();
  }

  function playLocalTrack(idx) {
    stopAll();
    activeMode = 'local'; currentTrackIdx = idx;
    const item = localPlayer.playlist[idx];
    if (!item) return;
    nowEmoji.textContent = '\uD83C\uDFB5';
    nowTitle.textContent = item.name;
    nowArtist.textContent = 'Local File';
    isPlaying = true; playBtn.textContent = '\u23F8';
    localPlayer.playIdx(idx);

    // Listen for track end
    localPlayer.audioEl.onended = () => {
      if (repeatMode) { localPlayer.playIdx(currentTrackIdx); }
      else { nextTrack(); }
    };

    startLocalTick(); startViz();
    renderContent();
  }

  // ── Transport controls ──

  playBtn.addEventListener('click', () => {
    if (activeMode === 'radio') {
      if (!isPlaying && currentTrackIdx >= 0) {
        isPlaying = true; playBtn.textContent = '\u23F8';
        synthEngine.resume(); startRadioTick(); startViz();
      } else if (!isPlaying) {
        playRadioTrack(0);
      } else {
        isPlaying = false; playBtn.textContent = '\u25B6';
        synthEngine.pause(); stopTick(); stopViz();
      }
    } else if (activeMode === 'youtube') {
      if (!ytPlayer) return;
      if (isPlaying) { ytPlayer.pause(); isPlaying = false; playBtn.textContent = '\u25B6'; }
      else { ytPlayer.play(); isPlaying = true; playBtn.textContent = '\u23F8'; startFakeViz('#e91e63'); }
    } else if (activeMode === 'local') {
      if (!isPlaying && currentTrackIdx >= 0) {
        isPlaying = true; playBtn.textContent = '\u23F8';
        localPlayer.play(); startLocalTick(); startViz();
      } else if (!isPlaying && localPlayer.playlist.length) {
        playLocalTrack(0);
      } else {
        isPlaying = false; playBtn.textContent = '\u25B6';
        localPlayer.pause(); stopTick(); stopViz();
      }
    }
  });

  function nextTrack() {
    if (activeMode === 'radio') {
      if (!radioTracks.length) return;
      const next = shuffle ? Math.floor(Math.random()*radioTracks.length) : (currentTrackIdx+1) % radioTracks.length;
      playRadioTrack(next);
    } else if (activeMode === 'local') {
      if (!localPlayer.playlist.length) return;
      const next = shuffle ? Math.floor(Math.random()*localPlayer.playlist.length) : (currentTrackIdx+1) % localPlayer.playlist.length;
      playLocalTrack(next);
    }
  }

  function prevTrack() {
    if (activeMode === 'radio') {
      if (!radioTracks.length) return;
      let prev = currentTrackIdx - 1; if (prev < 0) prev = radioTracks.length - 1;
      playRadioTrack(prev);
    } else if (activeMode === 'local') {
      if (!localPlayer.playlist.length) return;
      let prev = currentTrackIdx - 1; if (prev < 0) prev = localPlayer.playlist.length - 1;
      playLocalTrack(prev);
    }
  }

  nextBtn.addEventListener('click', nextTrack);
  prevBtn.addEventListener('click', prevTrack);
  shuffleBtn.addEventListener('click', () => { shuffle = !shuffle; shuffleBtn.classList.toggle('active', shuffle); });
  repeatBtn.addEventListener('click', () => { repeatMode = !repeatMode; repeatBtn.classList.toggle('active', repeatMode); });
  volSlider.addEventListener('input', () => {
    const v = parseInt(volSlider.value);
    synthEngine.setVolume(v);
    localPlayer.setVolume(v);
    if (ytPlayer) ytPlayer.setVolume(v);
  });

  // Progress bar seeking
  pBar.addEventListener('click', e => {
    const rect = pBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (activeMode === 'youtube' && ytPlayer) {
      const dur = ytPlayer.getDuration();
      if (dur > 0) ytPlayer.seekTo(dur * pct);
    } else if (activeMode === 'local') {
      const dur = localPlayer.getDuration();
      if (dur > 0) localPlayer.seekTo(dur * pct);
    }
    // Radio mode: synth engine doesn't support seeking
  });

  // ── Timers ──

  function startRadioTick() {
    stopTick(); elapsed = 0;
    tickTimer = setInterval(() => {
      if (!isPlaying) return;
      elapsed++;
      timeCur.textContent = fmtTime(elapsed);
      timeDur.textContent = '4:00';
      pFill.style.width = Math.min(100, elapsed/240*100) + '%';
      if (elapsed >= 240) {
        if (repeatMode) playRadioTrack(currentTrackIdx);
        else nextTrack();
      }
    }, 1000);
  }

  function startLocalTick() {
    stopTick();
    tickTimer = setInterval(() => {
      if (!isPlaying) return;
      const cur = localPlayer.getCurrentTime();
      const dur = localPlayer.getDuration();
      timeCur.textContent = fmtTime(cur);
      timeDur.textContent = fmtTime(dur);
      pFill.style.width = dur > 0 ? (cur/dur*100)+'%' : '0';
    }, 500);
  }

  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  // ── Visualizer ──

  function startViz() {
    stopViz();
    const draw = () => {
      vizRAF = requestAnimationFrame(draw);
      let data;
      if (activeMode === 'radio') data = synthEngine.getAnalyserData();
      else if (activeMode === 'local') data = localPlayer.getAnalyserData();
      else return;
      const w = vizCanvas.width, h = vizCanvas.height;
      vizCtx.clearRect(0, 0, w, h);
      if (!data) return;
      const color = activeMode === 'radio' ? (radioTracks[currentTrackIdx]?.genre?.color || '#007aff') : '#007aff';
      const cr = parseInt(color.slice(1,3),16), cg = parseInt(color.slice(3,5),16), cb = parseInt(color.slice(5,7),16);
      const barCount = 32, barW = (w/barCount)-2, step = Math.floor(data.length/barCount);
      for (let i=0;i<barCount;i++) {
        const val = data[i*step]/255, barH = val*h*0.85;
        const grad = vizCtx.createLinearGradient(0,h,0,h-barH);
        grad.addColorStop(0,`rgba(${cr},${cg},${cb},0.8)`);
        grad.addColorStop(1,`rgba(${cr},${cg},${cb},0.2)`);
        vizCtx.fillStyle = grad;
        const x = i*(barW+2)+1, radius = Math.min(barW/2,3);
        vizCtx.beginPath();
        vizCtx.moveTo(x,h); vizCtx.lineTo(x,h-barH+radius);
        vizCtx.quadraticCurveTo(x,h-barH,x+radius,h-barH);
        vizCtx.lineTo(x+barW-radius,h-barH);
        vizCtx.quadraticCurveTo(x+barW,h-barH,x+barW,h-barH+radius);
        vizCtx.lineTo(x+barW,h); vizCtx.fill();
      }
    };
    draw();
  }

  // YouTube mode: video is visible instead of visualizer, no RAF needed
  function startFakeViz() { stopViz(); }

  function stopViz() {
    if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = null; }
    vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
  }

  // ── Utilities ──

  function fmtTime(sec) {
    if (!sec || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec/60), s = Math.floor(sec%60);
    return `${m}:${s.toString().padStart(2,'0')}`;
  }

  function escHtml(s) {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
  }

  // ── Initial render ──
  renderContent();

  // ── Cleanup ──
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      synthEngine.destroy();
      localPlayer.destroy();
      if (ytPlayer) ytPlayer.destroy();
      stopTick(); stopViz();
      observer.disconnect();
    }
  });
  observer.observe(container.parentElement || document.body, { childList: true, subtree: true });
}
