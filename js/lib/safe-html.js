// Astrion OS — safe-html.js
// HTML-escape helpers for the rare cases where you can't avoid string-
// interpolating untrusted text into `innerHTML`. Prefer textContent +
// element-construction — but when you really do need innerHTML (e.g.
// painting a whole sub-tree from a template literal), wrap untrusted
// values in `escapeHtml()` so attacker-controlled `<script>` etc. land
// as text, not as code.
//
// Sprint B-tail (2026-05-02): closed the "err.message → innerHTML"
// XSS surface across appstore, activity-monitor, and settings. Lesson
// #177 captures the discovery rule.

// Returns the input as HTML-escaped text. Never throws — non-string
// input is coerced via String(). Empty / null / undefined become ''.
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convenience for the most common case — Error objects from fetch /
// JSON.parse / API rejection. err.message is attacker-controllable
// when the upstream is a remote service, so it MUST be escaped before
// entering `innerHTML`.
export function escapeError(err) {
  if (!err) return '';
  return escapeHtml(err.message || String(err));
}
