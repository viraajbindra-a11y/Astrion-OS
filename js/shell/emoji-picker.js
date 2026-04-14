// NOVA OS — Emoji Picker
// Press Ctrl+Cmd+Space to open. Type to search, click or Enter to insert.
// The picked emoji is inserted at the active text cursor and copied to the clipboard.

const EMOJI_DATA = [
  // Smileys
  { e: '\uD83D\uDE00', n: 'grinning face' },
  { e: '\uD83D\uDE01', n: 'beaming face smile eyes' },
  { e: '\uD83D\uDE02', n: 'face tears of joy laughing cry' },
  { e: '\uD83E\uDD23', n: 'rolling floor laughing rofl' },
  { e: '\uD83D\uDE03', n: 'grinning face big eyes' },
  { e: '\uD83D\uDE04', n: 'grinning face smile eyes' },
  { e: '\uD83D\uDE05', n: 'grinning face sweat' },
  { e: '\uD83D\uDE06', n: 'grinning squinting laugh' },
  { e: '\uD83D\uDE07', n: 'smiling halo angel' },
  { e: '\uD83D\uDE09', n: 'winking face' },
  { e: '\uD83D\uDE0A', n: 'smiling blushing happy' },
  { e: '\uD83D\uDE0B', n: 'yum savoring food' },
  { e: '\uD83D\uDE0D', n: 'heart eyes love' },
  { e: '\uD83E\uDD70', n: 'smiling face hearts love' },
  { e: '\uD83D\uDE18', n: 'face blowing kiss' },
  { e: '\uD83D\uDE17', n: 'kissing face' },
  { e: '\uD83D\uDE1B', n: 'face tongue' },
  { e: '\uD83D\uDE1C', n: 'winking face tongue' },
  { e: '\uD83E\uDD29', n: 'star struck amazed' },
  { e: '\uD83E\uDD2A', n: 'zany face crazy' },
  { e: '\uD83E\uDD14', n: 'thinking face' },
  { e: '\uD83E\uDD28', n: 'face raised eyebrow skeptical' },
  { e: '\uD83D\uDE10', n: 'neutral face' },
  { e: '\uD83D\uDE11', n: 'expressionless face' },
  { e: '\uD83D\uDE36', n: 'face without mouth' },
  { e: '\uD83D\uDE0F', n: 'smirking face' },
  { e: '\uD83D\uDE12', n: 'unamused face' },
  { e: '\uD83D\uDE44', n: 'face rolling eyes' },
  { e: '\uD83D\uDE2A', n: 'weary face sleepy' },
  { e: '\uD83E\uDD24', n: 'drooling face' },
  { e: '\uD83D\uDE2B', n: 'tired face' },
  { e: '\uD83E\uDD71', n: 'yawning face' },
  { e: '\uD83D\uDE14', n: 'pensive face sad' },
  { e: '\uD83D\uDE1E', n: 'disappointed face sad' },
  { e: '\uD83D\uDE22', n: 'crying face' },
  { e: '\uD83D\uDE2D', n: 'loudly crying sobbing' },
  { e: '\uD83D\uDE28', n: 'fearful face scared' },
  { e: '\uD83D\uDE30', n: 'anxious sweat worried' },
  { e: '\uD83D\uDE31', n: 'screaming fear shocked' },
  { e: '\uD83D\uDE20', n: 'angry face mad' },
  { e: '\uD83D\uDE21', n: 'pouting face rage' },
  { e: '\uD83E\uDD2C', n: 'face symbols cursing' },
  { e: '\uD83D\uDC80', n: 'skull' },
  { e: '\uD83D\uDC7B', n: 'ghost' },
  { e: '\uD83D\uDC7D', n: 'alien' },
  { e: '\uD83E\uDD16', n: 'robot' },

  // Gestures & people
  { e: '\uD83D\uDC4D', n: 'thumbs up yes good' },
  { e: '\uD83D\uDC4E', n: 'thumbs down no bad' },
  { e: '\uD83D\uDC4C', n: 'ok hand' },
  { e: '\u270C\uFE0F', n: 'victory peace' },
  { e: '\uD83E\uDD1E', n: 'crossed fingers hopeful' },
  { e: '\uD83E\uDD18', n: 'sign of horns rock' },
  { e: '\uD83E\uDD1F', n: 'love you gesture' },
  { e: '\uD83D\uDC4F', n: 'clapping hands applause' },
  { e: '\uD83D\uDE4C', n: 'raising hands celebration praise' },
  { e: '\uD83D\uDE4F', n: 'folded hands please thank you' },
  { e: '\uD83E\uDD1D', n: 'handshake' },
  { e: '\u270B', n: 'raised hand stop' },
  { e: '\uD83D\uDC4B', n: 'waving hand hello' },
  { e: '\uD83D\uDC40', n: 'eyes' },
  { e: '\uD83E\uDDE0', n: 'brain' },
  { e: '\uD83E\uDDBE', n: 'mechanical arm' },
  { e: '\uD83D\uDCAA', n: 'flexed biceps muscle strong' },

  // Hearts
  { e: '\u2764\uFE0F', n: 'red heart love' },
  { e: '\uD83E\uDDE1', n: 'orange heart' },
  { e: '\uD83D\uDC9B', n: 'yellow heart' },
  { e: '\uD83D\uDC9A', n: 'green heart' },
  { e: '\uD83D\uDC99', n: 'blue heart' },
  { e: '\uD83D\uDC9C', n: 'purple heart' },
  { e: '\uD83D\uDDA4', n: 'black heart' },
  { e: '\uD83E\uDD0D', n: 'white heart' },
  { e: '\uD83D\uDC94', n: 'broken heart' },
  { e: '\uD83D\uDC96', n: 'sparkling heart' },
  { e: '\uD83D\uDC97', n: 'growing heart' },
  { e: '\uD83D\uDC98', n: 'heart arrow cupid' },

  // Objects & symbols
  { e: '\uD83D\uDCAF', n: '100 hundred points score' },
  { e: '\u2728', n: 'sparkles shiny' },
  { e: '\u2B50', n: 'star' },
  { e: '\uD83C\uDF1F', n: 'glowing star' },
  { e: '\uD83D\uDD25', n: 'fire hot' },
  { e: '\uD83D\uDCA5', n: 'collision bang boom' },
  { e: '\uD83D\uDCA6', n: 'sweat drops water' },
  { e: '\u26A1', n: 'lightning bolt electric zap' },
  { e: '\uD83C\uDF08', n: 'rainbow' },
  { e: '\u2600\uFE0F', n: 'sun sunny' },
  { e: '\uD83C\uDF19', n: 'crescent moon night' },
  { e: '\uD83D\uDCA7', n: 'droplet water' },
  { e: '\uD83C\uDF0A', n: 'water wave ocean' },
  { e: '\uD83C\uDF89', n: 'party popper celebration' },
  { e: '\uD83C\uDF8A', n: 'confetti ball party' },
  { e: '\uD83C\uDF81', n: 'gift present' },
  { e: '\uD83C\uDF82', n: 'birthday cake' },
  { e: '\u2615', n: 'hot beverage coffee' },
  { e: '\uD83C\uDF7D', n: 'plate food dinner' },
  { e: '\uD83C\uDF55', n: 'pizza' },
  { e: '\uD83C\uDF54', n: 'hamburger burger' },
  { e: '\uD83C\uDF2D', n: 'hot dog' },
  { e: '\uD83C\uDF5F', n: 'french fries' },
  { e: '\uD83C\uDF69', n: 'doughnut donut' },
  { e: '\uD83C\uDF6A', n: 'cookie' },
  { e: '\uD83C\uDF6B', n: 'chocolate bar' },
  { e: '\uD83C\uDF4E', n: 'red apple fruit' },
  { e: '\uD83C\uDF4C', n: 'banana fruit' },
  { e: '\uD83C\uDF47', n: 'grapes fruit' },

  // Tech & work
  { e: '\uD83D\uDCBB', n: 'laptop computer code' },
  { e: '\u2328\uFE0F', n: 'keyboard' },
  { e: '\uD83D\uDDB1\uFE0F', n: 'mouse computer' },
  { e: '\uD83D\uDCF1', n: 'phone mobile smartphone' },
  { e: '\uD83D\uDCF7', n: 'camera' },
  { e: '\uD83D\uDCE1', n: 'satellite antenna' },
  { e: '\uD83D\uDD0B', n: 'battery' },
  { e: '\uD83D\uDD0C', n: 'plug electric' },
  { e: '\uD83D\uDCA1', n: 'light bulb idea' },
  { e: '\uD83D\uDD27', n: 'wrench tool' },
  { e: '\uD83D\uDD28', n: 'hammer tool' },
  { e: '\u2699\uFE0F', n: 'gear settings cog' },
  { e: '\uD83D\uDD12', n: 'locked lock secure' },
  { e: '\uD83D\uDD13', n: 'unlocked' },
  { e: '\uD83D\uDD11', n: 'key' },
  { e: '\uD83D\uDCE7', n: 'email mail envelope' },
  { e: '\uD83D\uDCE6', n: 'package box shipping' },
  { e: '\uD83D\uDCDD', n: 'memo note document' },
  { e: '\uD83D\uDCC4', n: 'page document' },
  { e: '\uD83D\uDCC5', n: 'calendar date' },
  { e: '\uD83D\uDD52', n: 'clock time two' },
  { e: '\u23F0', n: 'alarm clock time' },
  { e: '\uD83D\uDD14', n: 'bell notification' },
  { e: '\uD83D\uDD15', n: 'bell slash silent mute' },
  { e: '\uD83D\uDD0D', n: 'magnifying glass search' },
  { e: '\uD83D\uDD17', n: 'link chain' },
  { e: '\uD83C\uDF10', n: 'globe internet world web' },

  // Nature
  { e: '\uD83C\uDF33', n: 'tree forest' },
  { e: '\uD83C\uDF32', n: 'evergreen tree' },
  { e: '\uD83C\uDF31', n: 'seedling plant sprout' },
  { e: '\uD83C\uDF3A', n: 'hibiscus flower' },
  { e: '\uD83C\uDF39', n: 'rose flower' },
  { e: '\uD83C\uDF37', n: 'tulip flower' },
  { e: '\uD83C\uDF3B', n: 'sunflower' },
  { e: '\uD83D\uDC31', n: 'cat face' },
  { e: '\uD83D\uDC36', n: 'dog face' },
  { e: '\uD83D\uDC1F', n: 'fish' },
  { e: '\uD83E\uDD8B', n: 'butterfly' },
  { e: '\uD83D\uDC1D', n: 'bee honeybee' },

  // Symbols
  { e: '\u2705', n: 'check mark done' },
  { e: '\u274C', n: 'cross mark no wrong' },
  { e: '\u26A0\uFE0F', n: 'warning caution' },
  { e: '\u2139\uFE0F', n: 'information info' },
  { e: '\u2753', n: 'question mark' },
  { e: '\u2757', n: 'exclamation mark' },
  { e: '\u27A1\uFE0F', n: 'right arrow' },
  { e: '\u2B05\uFE0F', n: 'left arrow' },
  { e: '\u2B06\uFE0F', n: 'up arrow' },
  { e: '\u2B07\uFE0F', n: 'down arrow' },
  { e: '\uD83D\uDD04', n: 'refresh reload cycle' },
  { e: '\uD83D\uDD03', n: 'clockwise arrows' },
];

const RECENT_KEY = 'nova-emoji-recent';
let isOpen = false;
let panel = null;
let savedSelection = null;

export function initEmojiPicker() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Cmd+Space (macOS style)
    if (e.ctrlKey && (e.metaKey || e.key === ' ') && e.code === 'Space') {
      if (e.ctrlKey && (e.metaKey || e.altKey)) {
        e.preventDefault();
        toggle();
      }
    }
    // Also Ctrl+; or Ctrl+. (Windows/Linux emoji shortcut)
    if (e.ctrlKey && (e.key === ';' || e.key === '.')) {
      e.preventDefault();
      toggle();
    }
  });
}

function toggle() {
  if (isOpen) close();
  else open();
}

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch { return []; }
}

function saveRecent(emoji) {
  let recent = getRecent().filter(e => e !== emoji);
  recent.unshift(emoji);
  recent = recent.slice(0, 16);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

function open() {
  // Save active element / selection so we can restore & insert
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
    savedSelection = {
      element: active,
      start: active.selectionStart,
      end: active.selectionEnd,
    };
  } else {
    savedSelection = null;
  }

  panel = document.createElement('div');
  panel.id = 'emoji-picker';
  panel.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 440px;
    max-height: 480px;
    background: rgba(30, 30, 36, 0.92);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 14px;
    z-index: 99999;
    font-family: var(--font);
    color: white;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: emojiPop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  panel.innerHTML = `
    <input type="text" id="emoji-search" placeholder="Search emoji…" autocomplete="off" autocorrect="off" spellcheck="false"
      style="width: 100%; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.05); color: white; font-size: 14px; font-family: var(--font); outline: none; box-sizing: border-box;">
    <div id="emoji-grid" style="overflow-y: auto; max-height: 380px; display: grid; grid-template-columns: repeat(10, 1fr); gap: 2px;"></div>
    <div style="font-size: 10px; color: rgba(255,255,255,0.4); text-align: center;">Click to insert • Esc to close</div>
  `;

  if (!document.getElementById('emoji-styles')) {
    const s = document.createElement('style');
    s.id = 'emoji-styles';
    s.textContent = `
      @keyframes emojiPop {
        from { opacity: 0; transform: translate(-50%, -48%) scale(0.95); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      #emoji-grid > div {
        width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        font-size: 24px; border-radius: 8px; cursor: pointer;
        transition: background 0.1s;
      }
      #emoji-grid > div:hover { background: rgba(255,255,255,0.12); }
      #emoji-grid > .section-header {
        grid-column: 1 / -1; font-size: 10px; color: rgba(255,255,255,0.4);
        text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 4px 2px;
        cursor: default; background: none; justify-content: flex-start;
      }
      #emoji-grid > .section-header:hover { background: none; }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(panel);

  const search = panel.querySelector('#emoji-search');
  const grid = panel.querySelector('#emoji-grid');

  function renderGrid(filter = '') {
    grid.innerHTML = '';

    if (!filter) {
      const recent = getRecent();
      if (recent.length > 0) {
        const header = document.createElement('div');
        header.className = 'section-header';
        header.textContent = 'Recently Used';
        grid.appendChild(header);
        recent.forEach(e => {
          const el = document.createElement('div');
          el.textContent = e;
          el.addEventListener('click', () => pick(e));
          grid.appendChild(el);
        });
      }
      const header2 = document.createElement('div');
      header2.className = 'section-header';
      header2.textContent = 'All Emoji';
      grid.appendChild(header2);
    }

    const filtered = filter
      ? EMOJI_DATA.filter(d => d.n.toLowerCase().includes(filter.toLowerCase()))
      : EMOJI_DATA;

    filtered.forEach(({ e, n }) => {
      const el = document.createElement('div');
      el.textContent = e;
      el.title = n;
      el.addEventListener('click', () => pick(e));
      grid.appendChild(el);
    });
  }

  renderGrid();
  search.focus();
  search.addEventListener('input', () => renderGrid(search.value));

  // Close on Esc
  function escHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      document.removeEventListener('keydown', escHandler);
    }
    // Enter — pick first result
    if (e.key === 'Enter' && search.value) {
      const first = EMOJI_DATA.find(d => d.n.toLowerCase().includes(search.value.toLowerCase()));
      if (first) pick(first.e);
    }
  }
  document.addEventListener('keydown', escHandler);

  // Click outside to close
  setTimeout(() => {
    document.addEventListener('click', function clickOut(e) {
      if (!panel?.contains(e.target)) {
        close();
        document.removeEventListener('click', clickOut);
      }
    });
  }, 10);

  isOpen = true;
}

function pick(emoji) {
  saveRecent(emoji);

  if (savedSelection) {
    const { element, start, end } = savedSelection;
    if (element.isContentEditable) {
      element.focus();
      document.execCommand('insertText', false, emoji);
    } else {
      const val = element.value || '';
      element.value = val.slice(0, start) + emoji + val.slice(end);
      element.focus();
      element.selectionStart = element.selectionEnd = start + emoji.length;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Also copy to clipboard for convenience
  try { navigator.clipboard.writeText(emoji); } catch {}

  close();
}

function close() {
  if (panel) panel.remove();
  panel = null;
  isOpen = false;
  savedSelection = null;
}
