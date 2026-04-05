// NOVA OS — Crypto Kernel
// Real cryptography using the browser's Web Crypto API.
// Used by the Vault app, login password hashing, and file encryption.

const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_ITERS = 250000; // PBKDF2 iterations

// ─── Password hashing (for login) ─────────────────────────────────────

/** Hash a password with PBKDF2-SHA256. Returns "iters$salt$hash" (base64). */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: KEY_ITERS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `${KEY_ITERS}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

/** Verify a plain password against a stored hash string. */
export async function verifyPassword(password, stored) {
  const [iters, saltB64, hashB64] = stored.split('$');
  if (!iters || !saltB64 || !hashB64) return false;
  const salt = fromB64(saltB64);
  const expected = fromB64(hashB64);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: parseInt(iters), hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return constantTimeEqual(new Uint8Array(bits), expected);
}

// ─── Symmetric encryption (AES-GCM) ──────────────────────────────────

/** Derive an AES-GCM key from a password + salt. */
async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KEY_ITERS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt plaintext with a password. Returns base64 "salt$iv$cipher". */
export async function encryptWithPassword(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${b64(salt)}$${b64(iv)}$${b64(new Uint8Array(cipher))}`;
}

/** Decrypt a string produced by encryptWithPassword. Returns null on failure. */
export async function decryptWithPassword(encrypted, password) {
  try {
    const [saltB64, ivB64, cipherB64] = encrypted.split('$');
    const salt = fromB64(saltB64);
    const iv = fromB64(ivB64);
    const cipher = fromB64(cipherB64);
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Generate a strong random password. */
export function generatePassword(length = 20, opts = {}) {
  const { lowercase = true, uppercase = true, digits = true, symbols = true } = opts;
  let chars = '';
  if (lowercase) chars += 'abcdefghijkmnpqrstuvwxyz'; // no l, o
  if (uppercase) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
  if (digits) chars += '23456789'; // no 0, 1
  if (symbols) chars += '!@#$%^&*-_=+?';

  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

/** Estimate password strength (0-4). */
export function passwordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^\w]/.test(password)) score++;
  return Math.min(4, score);
}
