// Astrion OS — Live Chat (P2P between web versions)
// Uses BroadcastChannel for same-device tabs + PeerJS for cross-device.
// No server needed — fully peer-to-peer via WebRTC.

import { processManager } from '../kernel/process-manager.js';
import { sounds } from '../kernel/sound.js';

const CHAT_KEY = 'nova-livechat';
const PEER_PREFIX = 'astrion-';

export function registerLiveChat() {
  processManager.register('live-chat', {
    name: 'Live Chat',
    icon: '\uD83D\uDCE1',
    singleInstance: true,
    width: 500,
    height: 520,
    launch: (contentEl) => initLiveChat(contentEl),
  });
}

function initLiveChat(container) {
  const myName = localStorage.getItem('nova-username') || 'User';
  let myId = localStorage.getItem('nova-livechat-id') || PEER_PREFIX + Math.random().toString(36).slice(2, 8);
  localStorage.setItem('nova-livechat-id', myId);
  let messages = [];
  let peer = null;
  let connections = new Map(); // peerId → connection
  let connected = false;

  // BroadcastChannel for same-device communication (tabs on same browser)
  const bc = new BroadcastChannel('astrion-livechat');
  bc.onmessage = (e) => {
    if (e.data.type === 'chat') {
      messages.push({ from: e.data.from, text: e.data.text, time: Date.now(), source: 'local' });
      sounds.notification();
      renderMessages();
    }
  };

  function render() {
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%; font-family:var(--font); color:white; background:#1a1a22;">
        <div style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <div style="font-size:14px; font-weight:600;">\uD83D\uDCE1 Live Chat</div>
            <div style="font-size:10px; color:${connected ? '#34c759' : 'rgba(255,255,255,0.4)'};">${connected ? '\u25CF Connected' : '\u25CB Offline'}</div>
          </div>
          <div style="display:flex; gap:6px;">
            <div style="flex:1;">
              <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-bottom:2px;">Your Room Code</div>
              <div style="display:flex; gap:4px;">
                <input type="text" id="lc-myid" value="${myId}" readonly style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:white;font-size:11px;font-family:monospace;outline:none;">
                <button id="lc-copy" style="padding:6px 10px;border-radius:6px;border:none;background:var(--accent);color:white;font-size:10px;cursor:pointer;font-family:var(--font);">Copy</button>
              </div>
            </div>
            <div style="flex:1;">
              <div style="font-size:10px; color:rgba(255,255,255,0.4); margin-bottom:2px;">Connect to Friend</div>
              <div style="display:flex; gap:4px;">
                <input type="text" id="lc-peerid" placeholder="Paste their code..." style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:white;font-size:11px;font-family:monospace;outline:none;">
                <button id="lc-connect" style="padding:6px 10px;border-radius:6px;border:none;background:#34c759;color:white;font-size:10px;cursor:pointer;font-family:var(--font);">Join</button>
              </div>
            </div>
          </div>
        </div>

        <div id="lc-messages" style="flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:6px;">
          <div style="text-align:center; color:rgba(255,255,255,0.3); font-size:12px; padding:20px;">
            Share your room code with a friend.<br>They paste it and click Join to connect.<br><br>
            Works across devices — no account needed!
          </div>
        </div>

        <div style="padding:10px 14px; border-top:1px solid rgba(255,255,255,0.06); display:flex; gap:8px;">
          <input type="text" id="lc-input" placeholder="Type a message..." autocomplete="off" style="flex:1;padding:10px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:white;font-size:13px;font-family:var(--font);outline:none;">
          <button id="lc-send" style="padding:10px 18px;border-radius:20px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);">Send</button>
        </div>
      </div>
    `;

    // Copy room code
    container.querySelector('#lc-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(myId);
      container.querySelector('#lc-copy').textContent = 'Copied!';
      setTimeout(() => { container.querySelector('#lc-copy').textContent = 'Copy'; }, 1500);
    });

    // Connect to peer
    container.querySelector('#lc-connect').addEventListener('click', () => {
      const peerId = container.querySelector('#lc-peerid').value.trim();
      if (peerId) connectToPeer(peerId);
    });

    container.querySelector('#lc-peerid').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const peerId = container.querySelector('#lc-peerid').value.trim();
        if (peerId) connectToPeer(peerId);
      }
    });

    // Send message
    const sendMsg = () => {
      const input = container.querySelector('#lc-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      const msg = { from: myName, text, time: Date.now() };
      messages.push({ ...msg, source: 'me' });

      // Send via BroadcastChannel (same browser tabs)
      bc.postMessage({ type: 'chat', from: myName, text });

      // Send via PeerJS (cross-device)
      connections.forEach(conn => {
        try { conn.send({ type: 'chat', from: myName, text }); } catch {}
      });

      sounds.tap();
      renderMessages();
    };

    container.querySelector('#lc-send').addEventListener('click', sendMsg);
    container.querySelector('#lc-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMsg();
    });

    renderMessages();
    initPeer();
  }

  function renderMessages() {
    const el = container.querySelector('#lc-messages');
    if (!el) return;

    if (messages.length === 0) return;

    el.innerHTML = messages.map(m => {
      const isMe = m.source === 'me';
      const time = new Date(m.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `
        <div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'};">
          <div style="max-width:70%; padding:8px 14px; border-radius:${isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px'}; background:${isMe ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}; font-size:13px; line-height:1.4;">
            ${!isMe ? `<div style="font-size:10px; font-weight:600; color:rgba(255,255,255,0.6); margin-bottom:2px;">${esc(m.from)}</div>` : ''}
            ${esc(m.text)}
            <div style="font-size:9px; color:rgba(255,255,255,0.3); margin-top:2px; text-align:${isMe ? 'right' : 'left'};">${time}</div>
          </div>
        </div>
      `;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  async function initPeer() {
    try {
      // Load PeerJS from CDN
      if (!window.Peer) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }

      peer = new window.Peer(myId);

      peer.on('open', (id) => {
        myId = id;
        localStorage.setItem('nova-livechat-id', id);
        const idInput = container.querySelector('#lc-myid');
        if (idInput) idInput.value = id;
      });

      peer.on('connection', (conn) => {
        setupConnection(conn);
      });

      peer.on('error', (err) => {
        console.log('PeerJS error:', err.type);
        if (err.type === 'unavailable-id') {
          // ID taken, generate new one
          myId = PEER_PREFIX + Math.random().toString(36).slice(2, 8);
          localStorage.setItem('nova-livechat-id', myId);
          initPeer();
        }
      });
    } catch (e) {
      console.log('PeerJS not available:', e.message);
    }
  }

  function connectToPeer(peerId) {
    if (!peer) { alert('Connecting... try again in a moment.'); return; }
    const conn = peer.connect(peerId);
    setupConnection(conn);
  }

  function setupConnection(conn) {
    conn.on('open', () => {
      connections.set(conn.peer, conn);
      connected = true;
      messages.push({ from: 'System', text: `Connected to ${conn.peer}`, time: Date.now(), source: 'system' });
      renderMessages();
      // Update status
      const status = container.querySelector('[style*="Connected"]') || container.querySelector('[style*="Offline"]');
      if (status) { status.textContent = '\u25CF Connected'; status.style.color = '#34c759'; }
    });

    conn.on('data', (data) => {
      if (data.type === 'chat') {
        messages.push({ from: data.from, text: data.text, time: Date.now(), source: 'remote' });
        sounds.notification();
        renderMessages();
      }
    });

    conn.on('close', () => {
      connections.delete(conn.peer);
      connected = connections.size > 0;
      messages.push({ from: 'System', text: 'Peer disconnected', time: Date.now(), source: 'system' });
      renderMessages();
    });
  }

  render();
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
