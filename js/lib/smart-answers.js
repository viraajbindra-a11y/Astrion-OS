// Astrion OS — Smart Instant Answers
// Local-only "AI-like" answers for Spotlight. No API key needed.
// Handles: unit conversion, time zones, color preview, date math,
// percentage calc, base conversion, lorem ipsum, UUID gen, coin flip.

// ═══════════════════════════════════════════════════════════════
// UNIT CONVERSION
// ═══════════════════════════════════════════════════════════════

const UNIT_MAP = {
  // Length
  km:   { base: 'meter', factor: 1000 },
  m:    { base: 'meter', factor: 1 },
  cm:   { base: 'meter', factor: 0.01 },
  mm:   { base: 'meter', factor: 0.001 },
  mi:   { base: 'meter', factor: 1609.344 },
  mile: { base: 'meter', factor: 1609.344 },
  miles:{ base: 'meter', factor: 1609.344 },
  yd:   { base: 'meter', factor: 0.9144 },
  yard: { base: 'meter', factor: 0.9144 },
  yards:{ base: 'meter', factor: 0.9144 },
  ft:   { base: 'meter', factor: 0.3048 },
  feet: { base: 'meter', factor: 0.3048 },
  foot: { base: 'meter', factor: 0.3048 },
  in:   { base: 'meter', factor: 0.0254 },
  inch: { base: 'meter', factor: 0.0254 },
  inches:{ base: 'meter', factor: 0.0254 },
  // Weight
  kg:   { base: 'gram', factor: 1000 },
  g:    { base: 'gram', factor: 1 },
  mg:   { base: 'gram', factor: 0.001 },
  lb:   { base: 'gram', factor: 453.592 },
  lbs:  { base: 'gram', factor: 453.592 },
  pound:{ base: 'gram', factor: 453.592 },
  pounds:{ base: 'gram', factor: 453.592 },
  oz:   { base: 'gram', factor: 28.3495 },
  ounce:{ base: 'gram', factor: 28.3495 },
  ounces:{ base: 'gram', factor: 28.3495 },
  // Temperature (special — handled separately)
  c:    { base: 'temp', unit: 'c' },
  f:    { base: 'temp', unit: 'f' },
  celsius:    { base: 'temp', unit: 'c' },
  fahrenheit: { base: 'temp', unit: 'f' },
  // Volume
  l:    { base: 'liter', factor: 1 },
  liter:{ base: 'liter', factor: 1 },
  liters:{ base: 'liter', factor: 1 },
  ml:   { base: 'liter', factor: 0.001 },
  gal:  { base: 'liter', factor: 3.78541 },
  gallon:{ base: 'liter', factor: 3.78541 },
  gallons:{ base: 'liter', factor: 3.78541 },
  cup:  { base: 'liter', factor: 0.236588 },
  cups: { base: 'liter', factor: 0.236588 },
  // Data
  kb:   { base: 'byte', factor: 1024 },
  mb:   { base: 'byte', factor: 1048576 },
  gb:   { base: 'byte', factor: 1073741824 },
  tb:   { base: 'byte', factor: 1099511627776 },
  byte: { base: 'byte', factor: 1 },
  bytes:{ base: 'byte', factor: 1 },
};

// "5 lbs in kg" or "100 cm to inches" or "72 f to c"
const CONVERT_RE = /^([\d.]+)\s*([a-z]+)\s+(?:in|to|as|=)\s+([a-z]+)$/i;

function tryUnitConversion(query) {
  const m = query.match(CONVERT_RE);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const fromKey = m[2].toLowerCase();
  const toKey = m[3].toLowerCase();
  if (isNaN(val)) return null;

  const from = UNIT_MAP[fromKey];
  const to = UNIT_MAP[toKey];
  if (!from || !to) return null;

  // Temperature special case
  if (from.base === 'temp' && to.base === 'temp') {
    let result;
    if (from.unit === 'c' && to.unit === 'f') result = val * 9/5 + 32;
    else if (from.unit === 'f' && to.unit === 'c') result = (val - 32) * 5/9;
    else return null;
    const display = Number.isInteger(result) ? result : result.toFixed(2);
    return { icon: '🌡️', title: `${display}°${to.unit.toUpperCase()}`, subtitle: `${val}°${from.unit.toUpperCase()} = ${display}°${to.unit.toUpperCase()}` };
  }

  if (from.base !== to.base) return null;

  const baseVal = val * from.factor;
  const result = baseVal / to.factor;
  const display = result < 0.01 ? result.toExponential(3) :
                  Number.isInteger(result) ? result.toLocaleString() :
                  parseFloat(result.toPrecision(6)).toLocaleString();
  return { icon: '📐', title: `${display} ${toKey}`, subtitle: `${val} ${fromKey} = ${display} ${toKey}` };
}

// ═══════════════════════════════════════════════════════════════
// CURRENCY CONVERSION (approximate, offline rates)
// ═══════════════════════════════════════════════════════════════
// These are approximate rates for offline use. Not financial advice!
// Rates relative to 1 USD (updated ~Apr 2026 approximations)

const CURRENCY_RATES = {
  usd: 1, dollar: 1, dollars: 1, '$': 1,
  eur: 0.92, euro: 0.92, euros: 0.92,
  gbp: 0.79, pound: 0.79, pounds: 0.79, '£': 0.79,
  jpy: 151, yen: 151, '¥': 151,
  cad: 1.36, cny: 7.24, yuan: 7.24,
  aud: 1.53, inr: 83.5, rupee: 83.5, rupees: 83.5,
  krw: 1340, won: 1340,
  brl: 5.0, real: 5.0,
  mxn: 17.1, peso: 17.1, pesos: 17.1,
  chf: 0.88, franc: 0.88, francs: 0.88,
  sek: 10.5, krona: 10.5,
  nok: 10.7, sgd: 1.34,
  hkd: 7.82, nzd: 1.64,
  btc: 0.000015, bitcoin: 0.000015,
};

// "50 usd to eur" or "$100 in yen" or "100 dollars to euros"
const CURRENCY_RE = /^([\d,.]+)\s*(\$|£|¥|[a-z]+)\s+(?:in|to|as)\s+(\$|£|¥|[a-z]+)$/i;

function tryCurrencyConversion(query) {
  const m = query.match(CURRENCY_RE);
  if (!m) return null;
  const val = parseFloat(m[1].replace(/,/g, ''));
  const fromKey = m[2].toLowerCase();
  const toKey = m[3].toLowerCase();
  if (isNaN(val)) return null;

  const fromRate = CURRENCY_RATES[fromKey];
  const toRate = CURRENCY_RATES[toKey];
  if (!fromRate || !toRate) return null;

  // Convert: amount in fromCurrency → USD → toCurrency
  const usd = val / fromRate;
  const result = usd * toRate;
  const display = result < 1 ? result.toPrecision(4) : result < 100 ? result.toFixed(2) : Math.round(result).toLocaleString();

  return {
    icon: '💱',
    title: `${display} ${toKey}`,
    subtitle: `${val.toLocaleString()} ${fromKey} ≈ ${display} ${toKey} (approximate rate)`,
  };
}

// ═══════════════════════════════════════════════════════════════
// TIME ZONES
// ═══════════════════════════════════════════════════════════════

const TIMEZONE_MAP = {
  'tokyo': 'Asia/Tokyo',
  'japan': 'Asia/Tokyo',
  'london': 'Europe/London',
  'uk': 'Europe/London',
  'paris': 'Europe/Paris',
  'france': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'germany': 'Europe/Berlin',
  'new york': 'America/New_York',
  'nyc': 'America/New_York',
  'la': 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'sf': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'sydney': 'Australia/Sydney',
  'australia': 'Australia/Sydney',
  'india': 'Asia/Kolkata',
  'mumbai': 'Asia/Kolkata',
  'delhi': 'Asia/Kolkata',
  'dubai': 'Asia/Dubai',
  'singapore': 'Asia/Singapore',
  'beijing': 'Asia/Shanghai',
  'china': 'Asia/Shanghai',
  'seoul': 'Asia/Seoul',
  'korea': 'Asia/Seoul',
  'moscow': 'Europe/Moscow',
  'russia': 'Europe/Moscow',
  'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver',
  'hawaii': 'Pacific/Honolulu',
  'utc': 'UTC',
  'gmt': 'UTC',
  'est': 'America/New_York',
  'pst': 'America/Los_Angeles',
  'cst': 'America/Chicago',
  'ist': 'Asia/Kolkata',
  'jst': 'Asia/Tokyo',
  'aest': 'Australia/Sydney',
};

// "time in tokyo" or "what time is it in london"
const TIME_RE = /(?:what\s+)?time\s+(?:in|at)\s+(.+)/i;

function tryTimeZone(query) {
  const m = query.match(TIME_RE);
  if (!m) return null;
  const city = m[1].trim().toLowerCase();
  const tz = TIMEZONE_MAP[city];
  if (!tz) return null;

  try {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    return { icon: '🕐', title: `${time}`, subtitle: `${date} in ${m[1].trim()} (${tz})` };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════
// COLOR PREVIEW
// ═══════════════════════════════════════════════════════════════

// "#ff6b6b" or "rgb(255, 107, 107)" or "hsl(0, 100%, 71%)"
const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

function tryColorPreview(query) {
  const q = query.trim();
  let hex = null;
  let r, g, b;

  if (HEX_RE.test(q)) {
    hex = q;
    const h = q.slice(1);
    if (h.length === 3) {
      r = parseInt(h[0]+h[0], 16); g = parseInt(h[1]+h[1], 16); b = parseInt(h[2]+h[2], 16);
    } else if (h.length >= 6) {
      r = parseInt(h.slice(0,2), 16); g = parseInt(h.slice(2,4), 16); b = parseInt(h.slice(4,6), 16);
    }
  } else if (RGB_RE.test(q)) {
    const m = q.match(RGB_RE);
    r = parseInt(m[1]); g = parseInt(m[2]); b = parseInt(m[3]);
    hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  if (hex == null || r == null) return null;

  const rgbStr = `rgb(${r}, ${g}, ${b})`;
  // Compute HSL
  const rn = r/255, gn = g/255, bn = b/255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  const hslStr = `hsl(${Math.round(h*360)}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`;

  return {
    icon: `<div style="width:28px;height:28px;border-radius:6px;background:${hex};border:1px solid rgba(255,255,255,0.2);"></div>`,
    iconIsHtml: true,
    title: hex.toUpperCase(),
    subtitle: `${rgbStr} · ${hslStr}`,
    copyValue: hex,
  };
}

// ═══════════════════════════════════════════════════════════════
// PERCENTAGE CALCULATOR
// ═══════════════════════════════════════════════════════════════

// "15% of 200" or "what is 20% of 350"
const PCT_RE = /(?:what\s+is\s+)?(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?)/i;
// "200 + 15%" or "200 - 15%"
const PCT_MATH_RE = /^(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*%$/;

function tryPercentage(query) {
  let m = query.match(PCT_RE);
  if (m) {
    const pct = parseFloat(m[1]);
    const of = parseFloat(m[2]);
    const result = (pct / 100) * of;
    return { icon: '📊', title: `${result}`, subtitle: `${pct}% of ${of} = ${result}` };
  }
  m = query.match(PCT_MATH_RE);
  if (m) {
    const base = parseFloat(m[1]);
    const op = m[2];
    const pct = parseFloat(m[3]);
    const delta = (pct / 100) * base;
    const result = op === '+' ? base + delta : base - delta;
    return { icon: '📊', title: `${result}`, subtitle: `${base} ${op} ${pct}% = ${result}` };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// BASE CONVERSION
// ═══════════════════════════════════════════════════════════════

// "0xff in decimal" or "255 in hex" or "255 in binary"
const BASE_RE = /^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\s+(?:in|to|as)\s+(hex|decimal|dec|binary|bin|octal|oct)$/i;

function tryBaseConversion(query) {
  const m = query.match(BASE_RE);
  if (!m) return null;
  let val;
  const src = m[1];
  if (src.startsWith('0x')) val = parseInt(src, 16);
  else if (src.startsWith('0b')) val = parseInt(src.slice(2), 2);
  else if (src.startsWith('0o')) val = parseInt(src.slice(2), 8);
  else val = parseInt(src, 10);
  if (isNaN(val)) return null;

  const target = m[2].toLowerCase();
  let result, label;
  if (target === 'hex') { result = '0x' + val.toString(16).toUpperCase(); label = 'hexadecimal'; }
  else if (target === 'decimal' || target === 'dec') { result = val.toString(10); label = 'decimal'; }
  else if (target === 'binary' || target === 'bin') { result = '0b' + val.toString(2); label = 'binary'; }
  else if (target === 'octal' || target === 'oct') { result = '0o' + val.toString(8); label = 'octal'; }
  else return null;

  return { icon: '🔢', title: result, subtitle: `${src} in ${label}` };
}

// ═══════════════════════════════════════════════════════════════
// FUN / UTILITY
// ═══════════════════════════════════════════════════════════════

function tryFun(query) {
  const q = query.trim().toLowerCase();

  // Coin flip
  if (q === 'flip a coin' || q === 'coin flip' || q === 'heads or tails') {
    return { icon: '🪙', title: Math.random() < 0.5 ? 'Heads' : 'Tails', subtitle: 'Fair coin flip' };
  }

  // Dice roll
  if (q === 'roll a dice' || q === 'roll a die' || q === 'dice' || q === 'roll dice') {
    return { icon: '🎲', title: `${Math.floor(Math.random() * 6) + 1}`, subtitle: 'Six-sided die' };
  }

  // Random number — "random 1-100"
  const rng = q.match(/^random\s+(\d+)\s*[-–to]+\s*(\d+)$/);
  if (rng) {
    const lo = parseInt(rng[1]), hi = parseInt(rng[2]);
    const result = Math.floor(Math.random() * (hi - lo + 1)) + lo;
    return { icon: '🎰', title: `${result}`, subtitle: `Random number between ${lo} and ${hi}` };
  }

  // UUID
  if (q === 'uuid' || q === 'generate uuid' || q === 'new uuid') {
    const uuid = crypto.randomUUID();
    return { icon: '🔑', title: uuid, subtitle: 'Click to copy', copyValue: uuid };
  }

  // Now playing / what song
  if (q === 'now playing' || q === 'whats playing' || q === "what's playing" || q === 'current song') {
    return { icon: '\uD83C\uDFB5', title: 'Now Playing', subtitle: 'Open Music app', action: 'launch', appId: 'music' };
  }

  // Wifi / network
  if (q === 'wifi' || q === 'network' || q === 'internet' || q === 'connected') {
    return { icon: '\uD83D\uDCF6', title: 'Wi-Fi Settings', subtitle: 'Open network settings', action: 'launch', appId: 'settings' };
  }

  // Screenshot
  if (q === 'screenshot' || q === 'take screenshot' || q === 'screen capture' || q === 'print screen') {
    return { icon: '\uD83D\uDCF8', title: 'Take Screenshot', subtitle: 'Capture the current screen', action: 'launch', appId: 'screen-recorder' };
  }

  // Lock screen
  if (q === 'lock' || q === 'lock screen' || q === 'lock computer') {
    return { icon: '\uD83D\uDD12', title: 'Lock Screen', subtitle: 'Lock Astrion OS', action: 'event', event: 'system:lock' };
  }

  // System info shortcuts
  if (q === 'battery' || q === 'battery level') {
    if (navigator.getBattery) {
      // Return a promise-like result — the caller will handle async
      return { icon: '🔋', title: 'Checking...', subtitle: 'Battery status', action: 'launch', appId: 'system-info' };
    }
    return { icon: '🔋', title: 'Battery', subtitle: 'Open System Info', action: 'launch', appId: 'system-info' };
  }
  if (q === 'memory' || q === 'ram' || q === 'cpu' || q === 'disk' || q === 'storage' || q === 'system info') {
    return { icon: '💻', title: 'System Info', subtitle: 'Open System Info app', action: 'launch', appId: 'system-info' };
  }

  // Random color
  if (q === 'random color' || q === 'random colour' || q === 'color' || q === 'generate color') {
    const hex = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return {
      icon: `<div style="width:28px;height:28px;border-radius:6px;background:${hex};border:1px solid rgba(255,255,255,0.2);"></div>`,
      iconIsHtml: true,
      title: hex.toUpperCase(),
      subtitle: `rgb(${r}, ${g}, ${b}) · Click to copy`,
      copyValue: hex,
    };
  }

  // Date / today
  if (q === 'today' || q === 'date' || q === 'what day is it' || q === 'whats the date') {
    const now = new Date();
    return {
      icon: '📅',
      title: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      subtitle: `Week ${getWeekNumber(now)} · Day ${getDayOfYear(now)} of ${now.getFullYear()}`,
    };
  }

  // Days until — "days until dec 25" or "days until 2026-06-01"
  const daysUntil = q.match(/days?\s+(?:until|till|to)\s+(.+)/);
  if (daysUntil) {
    const target = new Date(daysUntil[1]);
    if (!isNaN(target.getTime())) {
      const diff = Math.ceil((target - new Date()) / (1000 * 60 * 60 * 24));
      return { icon: '📅', title: `${diff} day${diff !== 1 ? 's' : ''}`, subtitle: `Until ${target.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` };
    }
  }

  // Timer — "timer 5m", "timer 30s", "set timer for 10 minutes"
  const timerMatch = q.match(/(?:timer|set\s+(?:a\s+)?timer\s+(?:for\s+)?)?(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)\s*(?:timer)?/i);
  if (timerMatch && (q.includes('timer') || q.includes('set'))) {
    const val = parseInt(timerMatch[1]);
    const unit = timerMatch[2][0].toLowerCase();
    const seconds = unit === 'h' ? val * 3600 : unit === 'm' ? val * 60 : val;
    const display = seconds >= 3600 ? `${Math.floor(seconds/3600)}h ${Math.floor((seconds%3600)/60)}m`
                  : seconds >= 60 ? `${Math.floor(seconds/60)}m ${seconds%60 ? seconds%60+'s' : ''}`
                  : `${seconds}s`;
    return { icon: '⏲️', title: `Timer: ${display.trim()}`, subtitle: 'Open Clock app to start', action: 'launch', appId: 'clock' };
  }

  // Stopwatch
  if (q === 'stopwatch' || q === 'start stopwatch') {
    return { icon: '⏱️', title: 'Stopwatch', subtitle: 'Open Clock app', action: 'launch', appId: 'clock' };
  }

  // Lorem ipsum
  if (q === 'lorem ipsum' || q === 'lorem' || q === 'placeholder text') {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.';
    return { icon: '📝', title: text.slice(0, 60) + '...', subtitle: 'Placeholder text · Click to copy', copyValue: text };
  }

  // Password generator
  if (q === 'generate password' || q === 'password' || q === 'random password') {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    let pwd = '';
    for (let i = 0; i < 16; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return { icon: '🔐', title: pwd, subtitle: 'Random 16-char password · Click to copy', copyValue: pwd };
  }

  // Encode/decode
  // Decode must come before encode (both match "base64 decode X")
  const decodeMatch = q.match(/^(?:base64|b64)\s+decode\s+(.+)/i);
  if (decodeMatch) {
    try {
      const decoded = atob(decodeMatch[1].trim());
      return { icon: '🔓', title: decoded, subtitle: 'Base64 decoded · Click to copy', copyValue: decoded };
    } catch { /* invalid base64 */ }
  }
  const encodeMatch = q.match(/^(?:base64|b64)\s+encode\s+(.+)/i);
  if (encodeMatch) {
    try {
      const encoded = btoa(encodeMatch[1]);
      return { icon: '🔒', title: encoded, subtitle: 'Base64 encoded · Click to copy', copyValue: encoded };
    } catch { /* invalid chars */ }
  }

  // IP info (shows local info)
  if (q === 'my ip' || q === 'ip address' || q === 'what is my ip') {
    return { icon: '🌐', title: 'Check your IP', subtitle: 'Search "what is my ip" to find out', action: 'launch', appId: 'browser' };
  }

  // ASCII / char code — "ascii A" or "charcode 65"
  // Use original query for case-sensitive character lookup
  const asciiMatch = query.match(/^(?:ascii|charcode|char)\s+(.+)/i);
  if (asciiMatch) {
    const input = asciiMatch[1].trim();
    if (/^\d+$/.test(input)) {
      const code = parseInt(input);
      if (code >= 0 && code <= 127) {
        const char = code === 32 ? '(space)' : code < 32 ? '(control)' : String.fromCharCode(code);
        return { icon: '🔤', title: `${char}`, subtitle: `ASCII ${code} = "${char}"`, copyValue: String.fromCharCode(code) };
      }
    } else if (input.length === 1) {
      return { icon: '🔤', title: `${input.charCodeAt(0)}`, subtitle: `"${input}" = ASCII ${input.charCodeAt(0)}`, copyValue: String(input.charCodeAt(0)) };
    }
  }

  // Word count — "count words in <text>"
  const wordCountMatch = q.match(/^(?:count|how many)\s+(?:words?|chars?|characters?)\s+(?:in\s+)?(.+)/i);
  if (wordCountMatch) {
    const text = wordCountMatch[1];
    const words = text.trim().split(/\s+/).length;
    const chars = text.length;
    return { icon: '📊', title: `${words} words, ${chars} chars`, subtitle: `"${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"` };
  }

  // Define — open dictionary app
  const defineMatch = q.match(/^(?:define|definition|meaning of|what does .+ mean)\s+(.+)/);
  if (defineMatch) {
    const word = defineMatch[1].trim();
    return { icon: '📖', title: `Define: ${word}`, subtitle: 'Open Dictionary app', action: 'launch', appId: 'dictionary' };
  }
  if (q.match(/^what (?:is|are) (.+)\??$/i)) {
    // This could be a definition request — but only for short single-word queries
    const match = q.match(/^what (?:is|are) (.+)\??$/i);
    if (match && match[1].split(/\s+/).length <= 2 && !/\d/.test(match[1])) {
      return { icon: '📖', title: `Define: ${match[1]}`, subtitle: 'Open Dictionary app', action: 'launch', appId: 'dictionary' };
    }
  }

  // Timestamp
  if (q === 'timestamp' || q === 'unix timestamp' || q === 'epoch') {
    const ts = Math.floor(Date.now() / 1000);
    return { icon: '⏱️', title: `${ts}`, subtitle: 'Current Unix timestamp · Click to copy', copyValue: String(ts) };
  }

  // Age calculator — "age 1999-05-15" or "how old 2010-03-20"
  const ageMatch = q.match(/^(?:age|how old|born)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i);
  if (ageMatch) {
    const birth = new Date(ageMatch[1]);
    if (!isNaN(birth.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
      const days = Math.floor((now - birth) / 86400000);
      return { icon: '🎂', title: `${age} years old`, subtitle: `${days.toLocaleString()} days since birth` };
    }
  }

  // Roman numerals — "42 in roman" or "roman XLII"
  const romanToMatch = q.match(/^(\d+)\s+(?:in|to)\s+roman$/i);
  if (romanToMatch) {
    const num = parseInt(romanToMatch[1]);
    if (num > 0 && num <= 3999) {
      const roman = toRoman(num);
      return { icon: '🏛️', title: roman, subtitle: `${num} in Roman numerals · Click to copy`, copyValue: roman };
    }
  }
  const romanFromMatch = q.match(/^roman\s+([IVXLCDM]+)$/i);
  if (romanFromMatch) {
    const num = fromRoman(romanFromMatch[1].toUpperCase());
    if (num > 0) return { icon: '🏛️', title: `${num}`, subtitle: `${romanFromMatch[1].toUpperCase()} = ${num}`, copyValue: String(num) };
  }

  // Binary — "42 in binary" or "101010 in decimal"
  const binMatch = q.match(/^(\d+)\s+(?:in|to)\s+binary$/i);
  if (binMatch) {
    const bin = parseInt(binMatch[1]).toString(2);
    return { icon: '💾', title: bin, subtitle: `${binMatch[1]} in binary · Click to copy`, copyValue: bin };
  }
  const binDecMatch = q.match(/^([01]+)\s+(?:in|to)\s+decimal$/i);
  if (binDecMatch && binDecMatch[1].length > 1) {
    const dec = parseInt(binDecMatch[1], 2);
    return { icon: '💾', title: `${dec}`, subtitle: `Binary ${binDecMatch[1]} = ${dec}`, copyValue: String(dec) };
  }

  // Reverse text — "reverse hello world"
  const reverseMatch = q.match(/^reverse\s+(.+)/i);
  if (reverseMatch) {
    const reversed = [...reverseMatch[1]].reverse().join('');
    return { icon: '🔄', title: reversed, subtitle: 'Reversed text · Click to copy', copyValue: reversed };
  }

  // ROT13 — "rot13 hello"
  const rot13Match = q.match(/^rot13\s+(.+)/i);
  if (rot13Match) {
    const rot = rot13Match[1].replace(/[a-zA-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13)));
    return { icon: '🔐', title: rot, subtitle: 'ROT13 encoded · Click to copy', copyValue: rot };
  }

  // Tip calculator — "tip 45.50" or "tip on 80" or "20% tip on 60"
  const tipMatch = q.match(/^(?:(\d+)%?\s+)?tip\s+(?:on\s+)?(?:\$)?([\d.]+)$/i) || q.match(/^tip\s+(?:on\s+)?(?:\$)?([\d.]+)(?:\s+(\d+)%)?$/i);
  if (tipMatch) {
    const amount = parseFloat(tipMatch[2] || tipMatch[1]);
    const pct = parseInt(tipMatch[1] || tipMatch[3] || '18');
    if (!isNaN(amount)) {
      const tip15 = (amount * 0.15).toFixed(2);
      const tip18 = (amount * 0.18).toFixed(2);
      const tip20 = (amount * 0.20).toFixed(2);
      return { icon: '💵', title: `$${tip18} (18%)`, subtitle: `15%: $${tip15} · 20%: $${tip20} · Total: $${(amount + parseFloat(tip18)).toFixed(2)}` };
    }
  }

  // Morse code — "morse hello"
  const morseMatch = q.match(/^morse\s+(.+)/i);
  if (morseMatch) {
    const MORSE = {'A':'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....','I':'..','J':'.---','K':'-.-','L':'.-..','M':'--','N':'-.','O':'---','P':'.--.','Q':'--.-','R':'.-.','S':'...','T':'-','U':'..-','V':'...-','W':'.--','X':'-..-','Y':'-.--','Z':'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',' ':' / '};
    const morse = morseMatch[1].toUpperCase().split('').map(c => MORSE[c] || c).join(' ');
    return { icon: '📡', title: morse, subtitle: 'Morse code · Click to copy', copyValue: morse };
  }

  // Emoji meaning — "emoji 🔥"
  const emojiMatch = q.match(/^emoji\s+(.+)/i);
  if (emojiMatch) {
    const MEANINGS = {'🔥':'fire/hot/lit','❤️':'love/heart','😂':'laughing/crying','💀':'dead/skull','✨':'sparkles/magic','🎉':'party/celebration','👑':'crown/king/queen','🤔':'thinking','😭':'crying','🥺':'pleading','💪':'strong/flex','🙏':'pray/thanks','👀':'eyes/looking','🫠':'melting','🤡':'clown','💅':'sassy/nails','🧠':'brain/smart','⚡':'lightning/fast','🌊':'wave/ocean','🎯':'target/bullseye'};
    const emoji = emojiMatch[1].trim();
    const meaning = MEANINGS[emoji];
    if (meaning) return { icon: emoji, title: meaning, subtitle: `Meaning of ${emoji}` };
  }

  // Day of week — "what day was 2000-01-01"
  const dayOfMatch = q.match(/^what\s+day\s+(?:is|was)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/i);
  if (dayOfMatch) {
    const d = new Date(dayOfMatch[1]);
    if (!isNaN(d.getTime())) {
      return { icon: '📅', title: d.toLocaleDateString('en-US', { weekday: 'long' }), subtitle: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) };
    }
  }

  // Motivation / quote
  if (q === 'motivate me' || q === 'motivation' || q === 'inspire' || q === 'quote') {
    const quotes = [
      'The best time to plant a tree was 20 years ago. The second best time is now.',
      'Every expert was once a beginner.',
      'Code is like humor. When you have to explain it, it\'s bad.',
      'The only way to do great work is to love what you do.',
      'Ships don\'t sink because of the water around them. They sink because of the water that gets in them.',
      'It always seems impossible until it\'s done.',
      'Don\'t watch the clock; do what it does. Keep going.',
      'The future belongs to those who believe in the beauty of their dreams.',
    ];
    return { icon: '💡', title: quotes[Math.floor(Math.random() * quotes.length)], subtitle: 'Daily motivation' };
  }

  return null;
}

function toRoman(num) {
  const vals = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let result = '';
  for (const [v, s] of vals) { while (num >= v) { result += s; num -= v; } }
  return result;
}

function fromRoman(s) {
  const vals = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000};
  let result = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = vals[s[i]] || 0;
    const next = vals[s[i+1]] || 0;
    result += cur < next ? -cur : cur;
  }
  return result;
}

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getDayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Try to generate an instant answer for the query. Returns null if
 * no smart answer matches. No network calls, no AI — pure local.
 *
 * @param {string} query
 * @returns {{ icon: string, iconIsHtml?: boolean, title: string, subtitle: string, copyValue?: string } | null}
 */
export function getSmartAnswer(query) {
  if (!query || query.length < 2) return null;
  return tryUnitConversion(query)
      || tryCurrencyConversion(query)
      || tryTimeZone(query)
      || tryColorPreview(query)
      || tryPercentage(query)
      || tryBaseConversion(query)
      || tryFun(query);
}
