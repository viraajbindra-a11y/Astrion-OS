// ASTRION OS — Random Facts
import { processManager } from '../kernel/process-manager.js';

export function registerRandomFacts() {
  processManager.register('random-facts', {
    name: 'Random Facts',
    icon: '🧠',
    singleInstance: true,
    width: 380,
    height: 400,
    launch: (el) => initFacts(el)
  });
}

function initFacts(container) {
  const FACTS = [
    { fact: "Honey never spoils. Archaeologists have found 3000-year-old honey in Egyptian tombs that was still edible.", category: "Nature", emoji: "🍯" },
    { fact: "Octopuses have three hearts, nine brains, and blue blood.", category: "Animals", emoji: "🐙" },
    { fact: "A day on Venus is longer than a year on Venus. It takes 243 Earth days to rotate once.", category: "Space", emoji: "🪐" },
    { fact: "The first computer bug was an actual bug — a moth found in a Harvard Mark II computer in 1947.", category: "Tech", emoji: "🐛" },
    { fact: "Bananas are berries, but strawberries aren't.", category: "Nature", emoji: "🍌" },
    { fact: "The inventor of the Pringles can is buried in one.", category: "Fun", emoji: "🥔" },
    { fact: "There are more possible chess games than atoms in the observable universe.", category: "Math", emoji: "♟️" },
    { fact: "A group of flamingos is called a 'flamboyance'.", category: "Animals", emoji: "🦩" },
    { fact: "The shortest war in history lasted 38 minutes — between Britain and Zanzibar in 1896.", category: "History", emoji: "⚔️" },
    { fact: "Light takes 8 minutes and 20 seconds to travel from the Sun to Earth.", category: "Space", emoji: "☀️" },
    { fact: "The average person walks about 100,000 miles in their lifetime — that's 4 trips around Earth.", category: "Human", emoji: "🚶" },
    { fact: "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.", category: "History", emoji: "🏛️" },
    { fact: "A single strand of spaghetti is called a 'spaghetto'.", category: "Fun", emoji: "🍝" },
    { fact: "The total weight of all ants on Earth is roughly equal to the total weight of all humans.", category: "Nature", emoji: "🐜" },
    { fact: "WiFi was invented by Australian scientists in 1992.", category: "Tech", emoji: "📶" },
    { fact: "Your brain uses about 20% of your body's total energy — despite being only 2% of your body weight.", category: "Human", emoji: "🧠" },
    { fact: "The first website ever made is still online: info.cern.ch", category: "Tech", emoji: "🌐" },
    { fact: "There are more stars in the universe than grains of sand on all of Earth's beaches.", category: "Space", emoji: "⭐" },
    { fact: "Sharks are older than trees. Sharks have existed for about 400 million years, trees for 350 million.", category: "Nature", emoji: "🦈" },
    { fact: "The unicorn is the national animal of Scotland.", category: "Fun", emoji: "🦄" },
  ];

  let currentIdx = Math.floor(Math.random() * FACTS.length);
  let favorites = [];
  try { favorites = JSON.parse(localStorage.getItem('nova-fav-facts')) || []; } catch {}

  function saveFavs() { try { localStorage.setItem('nova-fav-facts', JSON.stringify(favorites)); } catch {} }

  function nextFact() {
    let next;
    do { next = Math.floor(Math.random() * FACTS.length); } while (next === currentIdx && FACTS.length > 1);
    currentIdx = next;
    render();
  }

  function toggleFav() {
    const fact = FACTS[currentIdx].fact;
    if (favorites.includes(fact)) favorites = favorites.filter(f => f !== fact);
    else favorites.push(fact);
    saveFavs();
    render();
  }

  function render() {
    const f = FACTS[currentIdx];
    const isFav = favorites.includes(f.fact);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;
        background:#1a1a2e;color:white;font-family:var(--font,system-ui);padding:24px;gap:16px;">
        <div style="font-size:56px;">${f.emoji}</div>
        <div style="padding:6px 14px;border-radius:16px;background:rgba(255,255,255,0.06);font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);">${f.category}</div>
        <div style="font-size:15px;line-height:1.7;text-align:center;max-width:320px;color:rgba(255,255,255,0.85);">${f.fact}</div>
        <div style="display:flex;gap:10px;margin-top:8px;">
          <button class="rf-fav" style="padding:8px 16px;border-radius:10px;border:none;
            background:${isFav ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)'};
            color:${isFav ? '#ef4444' : 'white'};font-size:13px;cursor:pointer;">${isFav ? '❤️ Saved' : '🤍 Save'}</button>
          <button class="rf-next" style="padding:8px 24px;border-radius:10px;border:none;background:${accent};color:white;font-size:13px;font-weight:600;cursor:pointer;">Next Fact →</button>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.2);margin-top:auto;">${currentIdx + 1} / ${FACTS.length} · ${favorites.length} saved</div>
      </div>
    `;
    container.querySelector('.rf-next').addEventListener('click', nextFact);
    container.querySelector('.rf-fav').addEventListener('click', toggleFav);
  }
  render();
}
