// NOVA OS — Photos App

import { processManager } from '../kernel/process-manager.js';

export function registerPhotos() {
  processManager.register('photos', {
    name: 'Photos',
    icon: '\uD83D\uDDBC\uFE0F',
    iconClass: 'dock-icon-photos',
    singleInstance: true,
    width: 700,
    height: 500,
    launch: (contentEl) => {
      initPhotos(contentEl);
    }
  });
}

// Demo photo collection using emoji-based artwork
const photoSets = {
  all: [
    { emoji: '\uD83C\uDF05', name: 'Sunset', color: '#e65100' },
    { emoji: '\uD83C\uDF04', name: 'Sunrise', color: '#ff6f00' },
    { emoji: '\uD83C\uDF0A', name: 'Ocean Wave', color: '#006064' },
    { emoji: '\uD83C\uDFD4\uFE0F', name: 'Mountain', color: '#1b5e20' },
    { emoji: '\uD83C\uDF03', name: 'Night City', color: '#1a237e' },
    { emoji: '\uD83C\uDF38', name: 'Cherry Blossom', color: '#ad1457' },
    { emoji: '\uD83C\uDF1F', name: 'Starfield', color: '#0d47a1' },
    { emoji: '\uD83C\uDF08', name: 'Rainbow', color: '#4a148c' },
    { emoji: '\uD83C\uDFD6\uFE0F', name: 'Beach', color: '#00838f' },
    { emoji: '\u2744\uFE0F', name: 'Snowflake', color: '#37474f' },
    { emoji: '\uD83C\uDF3B', name: 'Sunflower', color: '#f57f17' },
    { emoji: '\uD83C\uDF0C', name: 'Galaxy', color: '#311b92' },
    { emoji: '\uD83C\uDF42', name: 'Autumn Leaf', color: '#bf360c' },
    { emoji: '\uD83C\uDFDE\uFE0F', name: 'Lake View', color: '#004d40' },
    { emoji: '\uD83C\uDF0B', name: 'Volcano', color: '#b71c1c' },
    { emoji: '\uD83C\uDF32', name: 'Pine Forest', color: '#1b5e20' },
    { emoji: '\uD83E\uDDB9', name: 'Aurora', color: '#006064' },
    { emoji: '\uD83C\uDFD9\uFE0F', name: 'Cityscape', color: '#263238' },
  ],
};

function initPhotos(container) {
  let activeTab = 'all';
  let lightboxIndex = -1;
  const photos = photoSets.all;

  container.innerHTML = `
    <div class="photos-app">
      <div class="photos-header">
        <div class="photos-header-tab active" data-tab="all">All Photos</div>
        <div class="photos-header-tab" data-tab="favorites">Favorites</div>
        <div class="photos-header-tab" data-tab="albums">Albums</div>
        <div style="margin-left:auto;padding-right:8px;">
          <button id="photos-import-btn" style="background:var(--accent);border:none;color:white;padding:5px 14px;border-radius:6px;font-size:12px;font-family:var(--font);cursor:pointer;">+ Import</button>
        </div>
      </div>
      <div class="photos-grid" id="photos-grid"></div>
      <input type="file" id="photos-upload" accept="image/*" multiple style="display:none">
    </div>
  `;

  const grid = container.querySelector('#photos-grid');
  const uploadInput = container.querySelector('#photos-upload');
  const importBtn = container.querySelector('#photos-import-btn');

  // Load saved user photos
  let userPhotos = [];
  try { userPhotos = JSON.parse(localStorage.getItem('nova-user-photos') || '[]'); } catch {}

  // Import button
  importBtn.addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', (e) => {
    const files = e.target.files;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        userPhotos.push({ dataUrl: ev.target.result, name: file.name });
        localStorage.setItem('nova-user-photos', JSON.stringify(userPhotos));
        renderGrid();
      };
      reader.readAsDataURL(file);
    }
  });

  // Tab switching
  container.querySelectorAll('.photos-header-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.photos-header-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderGrid();
    });
  });

  function renderGrid() {
    grid.innerHTML = '';

    if (activeTab === 'albums') {
      grid.innerHTML = `<div class="photos-empty"><div class="photos-empty-icon">\uD83D\uDCC1</div><div>Create albums to organize your photos</div></div>`;
      return;
    }

    // Show uploaded photos first
    userPhotos.forEach((photo, i) => {
      const el = document.createElement('div');
      el.className = 'photos-item';
      el.style.backgroundImage = `url(${photo.dataUrl})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.innerHTML = `
        <div class="photos-item-overlay"></div>
        <div class="photos-item-name">${photo.name}</div>
      `;
      el.addEventListener('click', () => {
        // Lightbox for uploaded photos
        const lb = document.createElement('div');
        lb.className = 'photos-lightbox';
        lb.innerHTML = `
          <button class="photos-lightbox-close">&times;</button>
          <img src="${photo.dataUrl}" style="max-width:90%;max-height:90%;object-fit:contain;border-radius:8px;">
          <div class="photos-lightbox-info">${photo.name}</div>
        `;
        lb.querySelector('.photos-lightbox-close').addEventListener('click', () => lb.remove());
        lb.addEventListener('click', (e) => { if (e.target === lb) lb.remove(); });
        container.querySelector('.photos-app').appendChild(lb);
      });
      grid.appendChild(el);
    });

    const items = activeTab === 'favorites' ? photos.slice(0, 6) : photos;

    items.forEach((photo, i) => {
      const el = document.createElement('div');
      el.className = 'photos-item';
      el.style.background = photo.color;
      el.innerHTML = `
        ${photo.emoji}
        <div class="photos-item-overlay"></div>
        <div class="photos-item-name">${photo.name}</div>
      `;
      el.addEventListener('click', () => openLightbox(i));
      grid.appendChild(el);
    });
  }

  function openLightbox(index) {
    lightboxIndex = index;
    const photo = photos[index];

    const lb = document.createElement('div');
    lb.className = 'photos-lightbox';
    lb.innerHTML = `
      <button class="photos-lightbox-close">&times;</button>
      <button class="photos-lightbox-nav photos-lightbox-prev">\u25C0</button>
      <div class="photos-lightbox-img">${photo.emoji}</div>
      <button class="photos-lightbox-nav photos-lightbox-next">\u25B6</button>
      <div class="photos-lightbox-info">${photo.name} \u2022 ${index + 1} of ${photos.length}</div>
    `;

    lb.querySelector('.photos-lightbox-close').addEventListener('click', () => lb.remove());
    lb.querySelector('.photos-lightbox-prev').addEventListener('click', () => {
      lb.remove();
      openLightbox((index - 1 + photos.length) % photos.length);
    });
    lb.querySelector('.photos-lightbox-next').addEventListener('click', () => {
      lb.remove();
      openLightbox((index + 1) % photos.length);
    });
    lb.addEventListener('click', (e) => {
      if (e.target === lb) lb.remove();
    });

    container.querySelector('.photos-app').appendChild(lb);
  }

  renderGrid();
}
