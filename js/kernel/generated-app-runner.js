// Astrion OS — Generated App Runner (M4.P5)
//
// Executes LLM-generated app code in a sandboxed iframe with a UI
// scaffold. The code was already verified by M4.P3's test suite in
// the sandbox; this runner gives it a visible window.
//
// Security model (defense in depth):
//   - sandbox="allow-scripts" (NO allow-same-origin) → unique origin,
//     can't read parent localStorage/IDB/cookies
//   - CSP via <meta> tag inside srcdoc → no external fetch/XHR
//   - No access to parent window, document, or Astrion kernel
//   - The generated code can only manipulate its own DOM inside the
//     iframe. It cannot escape.
//
// The scaffold provides:
//   - A <div id="app"> root element for the generated code to render into
//   - A minimal CSS reset (dark theme matching Astrion)
//   - A postMessage bridge for status reporting (ready/error)
//
// Usage: call `launchGeneratedApp(codeBlob, container)` where container
// is the window-content element from processManager.

/**
 * Build the srcdoc HTML that will run inside the sandboxed iframe.
 * The generated code is injected as a <script> that receives a #app div.
 */
function buildSrcdoc(codeBlob) {
  // Escape </script> in the code blob to prevent premature tag close
  const safeCode = codeBlob.replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1a1a22;
    color: #e0e0e0;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }
  #app {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  button {
    font-family: inherit;
    cursor: pointer;
  }
  input, textarea, select {
    font-family: inherit;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.15);
    color: #e0e0e0;
    border-radius: 6px;
    padding: 6px 10px;
    outline: none;
  }
  input:focus, textarea:focus {
    border-color: #007aff;
  }
</style>
</head>
<body>
<div id="app"></div>
<script>
try {
  const App = (function() {
    ${safeCode}
  })();

  // If the code exports a function or class, try to call it
  if (typeof App === 'function') {
    const result = App(document.getElementById('app'));
    // If it returns a cleanup function, store it
    if (typeof result === 'function') window.__cleanup = result;
  }

  parent.postMessage({ type: 'app-ready' }, '*');
} catch (err) {
  document.getElementById('app').innerHTML =
    '<div style="color:#ff5f57;padding:20px;font-size:13px;">' +
    '<strong>App Error</strong><br>' +
    err.message.replace(/</g, '&lt;') +
    '</div>';
  parent.postMessage({ type: 'app-error', error: err.message }, '*');
}
</script>
</body>
</html>`;
}

/**
 * Launch a generated app's code blob inside a sandboxed iframe
 * within the given container element.
 *
 * @param {string} codeBlob — the JS code (single blob, verified by M4.P3)
 * @param {HTMLElement} container — the window-content div
 * @param {object} [meta] — optional provenance info to show in header
 * @returns {{ iframe: HTMLIFrameElement, destroy: () => void }}
 */
export function launchGeneratedApp(codeBlob, container, meta = {}) {
  container.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;background:#1a1a22;';

  // Status bar at top showing this is a generated app
  const statusBar = document.createElement('div');
  statusBar.style.cssText = `
    display:flex; align-items:center; gap:8px; padding:4px 12px;
    background:rgba(255,255,255,0.03); border-bottom:1px solid rgba(255,255,255,0.06);
    font-size:10px; color:rgba(255,255,255,0.4); font-family:var(--font);
    flex-shrink:0;
  `;
  statusBar.innerHTML = `
    <span style="color:#f1fa8c;">AI Generated</span>
    <span>\u00B7</span>
    <span>Sandboxed</span>
    ${meta.model ? `<span>\u00B7</span><span>${meta.model}</span>` : ''}
    ${meta.testsTotal ? `<span>\u00B7</span><span>${meta.testsPassed}/${meta.testsTotal} tests</span>` : ''}
    <span style="flex:1;"></span>
    <span id="gen-app-status" style="color:#50fa7b;">Loading\u2026</span>
  `;
  container.appendChild(statusBar);

  // Sandboxed iframe
  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-scripts'; // NO allow-same-origin
  iframe.style.cssText = 'flex:1;width:100%;border:none;background:#1a1a22;';
  iframe.srcdoc = buildSrcdoc(codeBlob);
  container.appendChild(iframe);

  // Listen for status messages from the iframe
  const statusEl = statusBar.querySelector('#gen-app-status');
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.data?.type === 'app-ready') {
      statusEl.textContent = 'Running';
      statusEl.style.color = '#50fa7b';
    } else if (e.data?.type === 'app-error') {
      statusEl.textContent = 'Error';
      statusEl.style.color = '#ff5f57';
    }
  };
  window.addEventListener('message', onMessage);

  const destroy = () => {
    window.removeEventListener('message', onMessage);
    try { iframe.srcdoc = ''; } catch {}
  };

  return { iframe, destroy };
}
