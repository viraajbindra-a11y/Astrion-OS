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

  return null;
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
      || tryTimeZone(query)
      || tryColorPreview(query)
      || tryPercentage(query)
      || tryBaseConversion(query)
      || tryFun(query);
}
