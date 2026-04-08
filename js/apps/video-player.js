// Astrion OS — Video Player
// Plays local video files with controls.

import { processManager } from '../kernel/process-manager.js';

export function registerVideoPlayer() {
  processManager.register('video-player', {
    name: 'Video Player',
    icon: '\u25B6\uFE0F',
    singleInstance: false,
    width: 780,
    height: 520,
    launch: (contentEl, instanceId, options) => initVideo(contentEl, options),
  });
}

function initVideo(container, options = {}) {
  container.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100%; background:#000; font-family:var(--font);">
      <div id="vp-area" style="flex:1; display:flex; align-items:center; justify-content:center; cursor:pointer;">
        <div id="vp-empty" style="text-align:center; color:rgba(255,255,255,0.4);">
          <div style="font-size:64px; margin-bottom:12px;">\u25B6\uFE0F</div>
          <div style="font-size:14px;">Drop a video file or click to open</div>
          <button id="vp-open" style="margin-top:16px; padding:10px 24px; border-radius:10px; border:none; background:var(--accent); color:white; font-size:13px; cursor:pointer; font-family:var(--font);">Open Video</button>
        </div>
        <video id="vp-video" style="max-width:100%; max-height:100%; display:none;" controls></video>
      </div>
    </div>
  `;

  const video = container.querySelector('#vp-video');
  const empty = container.querySelector('#vp-empty');
  const area = container.querySelector('#vp-area');

  function loadVideo(src) {
    video.src = src;
    video.style.display = 'block';
    empty.style.display = 'none';
    video.play();
  }

  container.querySelector('#vp-open').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadVideo(URL.createObjectURL(file));
    });
    input.click();
  });

  // Drag and drop
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.style.background = 'rgba(0,122,255,0.1)'; });
  area.addEventListener('dragleave', () => { area.style.background = '#000'; });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.style.background = '#000';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) loadVideo(URL.createObjectURL(file));
  });

  if (options.url) loadVideo(options.url);
}
