// Astrion OS — Voice Memos
// Record audio memos via microphone, save to file system, playback.

import { processManager } from '../kernel/process-manager.js';
import { fileSystem } from '../kernel/file-system.js';
import { notifications } from '../kernel/notifications.js';

const MEMOS_KEY = 'nova-voice-memos';

export function registerVoiceMemos() {
  processManager.register('voice-memos', {
    name: 'Voice Memos',
    icon: '\uD83C\uDF99\uFE0F',
    singleInstance: true,
    width: 500,
    height: 520,
    launch: (contentEl) => initVoiceMemos(contentEl),
  });
}

function getMemos() {
  try { return JSON.parse(localStorage.getItem(MEMOS_KEY)) || []; }
  catch { return []; }
}

function saveMemos(memos) {
  localStorage.setItem(MEMOS_KEY, JSON.stringify(memos));
}

function initVoiceMemos(container) {
  let memos = getMemos();
  let recorder = null;
  let chunks = [];
  let recording = false;
  let startTime = 0;
  let timerInterval = null;

  function render() {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%; font-family:var(--font); color:white; background:#1a1a22;">
        <div style="padding:16px; text-align:center; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:14px; font-weight:600; margin-bottom:16px;">Voice Memos</div>
          <div id="vm-timer" style="font-size:36px; font-weight:200; font-variant-numeric:tabular-nums; margin-bottom:16px; color:${recording ? '#ff3b30' : 'rgba(255,255,255,0.5)'};">
            ${recording ? '00:00' : '--:--'}
          </div>
          <button id="vm-record" style="
            width:64px; height:64px; border-radius:50%; border:none;
            background:${recording ? '#ff3b30' : 'var(--accent)'};
            color:white; font-size:24px; cursor:pointer;
            box-shadow:0 4px 20px ${recording ? 'rgba(255,59,48,0.4)' : 'rgba(0,122,255,0.3)'};
            transition: all 0.2s;
          ">${recording ? '\u23F9' : '\uD83C\uDF99'}</button>
          <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-top:10px;">
            ${recording ? 'Tap to stop recording' : 'Tap to start recording'}
          </div>
        </div>
        <div style="flex:1; overflow-y:auto; padding:8px;">
          ${memos.length === 0 ? '<div style="text-align:center; padding:40px; color:rgba(255,255,255,0.3); font-size:13px;">No recordings yet</div>' :
            memos.map((m, i) => `
              <div class="vm-memo" data-idx="${i}" style="
                display:flex; align-items:center; gap:12px; padding:12px 14px;
                border-radius:10px; margin-bottom:4px; transition:background 0.1s;
              ">
                <button class="vm-play" data-idx="${i}" style="
                  width:36px; height:36px; border-radius:50%; border:none;
                  background:var(--accent); color:white; font-size:14px; cursor:pointer;
                  flex-shrink:0;
                ">\u25B6</button>
                <div style="flex:1; min-width:0;">
                  <div style="font-size:13px; font-weight:500;">${esc(m.name)}</div>
                  <div style="font-size:10px; color:rgba(255,255,255,0.4);">${m.duration} \u00B7 ${timeAgo(m.date)}</div>
                </div>
                <button class="vm-delete" data-idx="${i}" style="
                  background:none; border:none; color:rgba(255,255,255,0.3);
                  cursor:pointer; font-size:16px; padding:4px;
                ">\u00D7</button>
              </div>
            `).join('')}
        </div>
      </div>
    `;

    // Record button
    container.querySelector('#vm-record').addEventListener('click', () => {
      if (recording) stopRecording();
      else startRecording();
    });

    // Play buttons
    container.querySelectorAll('.vm-play').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = memos[parseInt(btn.dataset.idx)];
        if (m?.data) {
          const audio = new Audio(m.data);
          audio.play();
          btn.textContent = '\u23F8';
          audio.onended = () => { btn.textContent = '\u25B6'; };
        }
      });
    });

    // Delete buttons
    container.querySelectorAll('.vm-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        memos.splice(parseInt(btn.dataset.idx), 1);
        saveMemos(memos);
        render();
      });
    });

    // Hover effects
    container.querySelectorAll('.vm-memo').forEach(el => {
      el.addEventListener('mouseenter', () => el.style.background = 'rgba(255,255,255,0.04)');
      el.addEventListener('mouseleave', () => el.style.background = 'transparent');
    });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const duration = formatDuration(Date.now() - startTime);
          const name = `Memo ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
          memos.unshift({ name, data: reader.result, duration, date: Date.now() });
          saveMemos(memos);
          notifications.show({ title: 'Memo saved', body: name, icon: '\uD83C\uDF99\uFE0F', duration: 2000 });
          render();
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      recording = true;
      startTime = Date.now();
      render();

      // Update timer
      timerInterval = setInterval(() => {
        const el = container.querySelector('#vm-timer');
        if (el) el.textContent = formatDuration(Date.now() - startTime);
      }, 100);
    } catch (err) {
      notifications.show({ title: 'Microphone error', body: err.message, icon: '\u26A0\uFE0F' });
    }
  }

  function stopRecording() {
    if (recorder) recorder.stop();
    recording = false;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  render();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
