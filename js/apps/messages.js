// Astrion OS — Messages App (Phase 0: Chat Foundation)
// Chat interface with AI assistant + local conversation history.
// Phase 0: Messages routes actionable intents through the planner so the
// AI can DO things mid-conversation, not just chat.
// Future: Matrix/XMPP integration for real messaging.

import { processManager } from '../kernel/process-manager.js';
import { aiService } from '../kernel/ai-service.js';
import { sounds } from '../kernel/sound.js';
import { parseIntent } from '../kernel/intent-parser.js';
import { routeQuery, planIntent } from '../kernel/intent-planner.js';
import { getCapability, resolveCapability } from '../kernel/capability-api.js';
import { getContextBundle } from '../kernel/context-bundle.js';
import { getOrCreateSession, getRecentTurns, recordTurn } from '../kernel/conversation-memory.js';
import { resolveBindings, findUnresolvedBindings, pickBindValue } from '../kernel/intent-executor.js';
import { eventBus } from '../kernel/event-bus.js';

const CONVERSATIONS_KEY = 'nova-messages-conversations';
const PERSONALITY_KEY = 'nova-ai-personality';

// AI Personalities — each wraps the user's message with a system-style instruction
const AI_PERSONALITIES = {
  default: { name: 'Default', icon: '\uD83E\uDD16', prompt: '' },
  friendly: { name: 'Friendly', icon: '\uD83D\uDE0A', prompt: 'Respond in an extremely friendly, warm, and encouraging way. Use casual language and occasional emojis. Be supportive and positive. ' },
  pirate: { name: 'Pirate', icon: '\u2620\uFE0F', prompt: 'Respond as a pirate. Use pirate slang, say "arr", "matey", "ye", "aye", talk about the sea and treasure. Stay in character completely. ' },
  shakespeare: { name: 'Shakespeare', icon: '\uD83C\uDFAD', prompt: 'Respond in Shakespearean English. Use "thou", "thee", "doth", "forsooth", "prithee", and dramatic iambic language. Be theatrical and poetic. ' },
  sarcastic: { name: 'Sarcastic', icon: '\uD83D\uDE0F', prompt: 'Respond with dry, witty sarcasm. Be clever and funny but still helpful. Use irony and deadpan humor. ' },
  eli5: { name: 'ELI5', icon: '\uD83D\uDC76', prompt: 'Explain everything as if talking to a 5-year-old. Use very simple words, fun analogies, and short sentences. Make complex things sound easy and fun. ' },
  coder: { name: 'Coder', icon: '\uD83D\uDC68\u200D\uD83D\uDCBB', prompt: 'Respond as a senior software engineer. Be concise and technical. Use code examples when relevant. Prefer precision over friendliness. ' },
  zen: { name: 'Zen', icon: '\uD83E\uDDD8', prompt: 'Respond like a calm zen master. Be peaceful, philosophical, and use metaphors from nature. Keep answers brief and thoughtful. Occasionally use koans. ' },
};

function getCurrentPersonality() {
  return localStorage.getItem(PERSONALITY_KEY) || 'default';
}

function setPersonality(id) {
  localStorage.setItem(PERSONALITY_KEY, id);
}

// Capability IDs whose output IS the reply — don't double-call AI for these
const DIRECT_REPLY_CAPS = new Set(['ai.ask', 'ai.explain', 'ai.summarize', 'compute.calculate']);

export function registerMessages() {
  processManager.register('messages', {
    name: 'Messages',
    icon: '\uD83D\uDCAC',
    singleInstance: true,
    width: 820,
    height: 540,
    minWidth: 600,
    minHeight: 400,
    launch: (contentEl) => initMessages(contentEl),
  });
}

function getConversations() {
  try { return JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)) || []; }
  catch { return []; }
}

function saveConversations(convos) {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(convos));
}

// ═══════════════════════════════════════════════════════════════
// CHAT HELPERS (Phase 0)
// ═══════════════════════════════════════════════════════════════

/**
 * Mini-executor for Messages. Runs plan steps sequentially via cap.execute()
 * WITHOUT emitting plan:* events (prevents Spotlight from hijacking the UI).
 */
async function executeStepsInChat(steps, query, container) {
  const bindings = {};
  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Skip chat.sendAsAgent — Messages handles its own reply
    if (step.cap === 'chat.sendAsAgent') {
      results.push({ index: i, cap: step.cap, ok: true, output: { skipped: true } });
      continue;
    }

    const cap = getCapability(step.cap);
    if (!cap) {
      results.push({ index: i, cap: step.cap, ok: false, error: `unknown capability: ${step.cap}` });
      break;
    }

    // Resolve bindings from prior steps
    const resolvedArgs = resolveBindings(step.args || {}, bindings);

    // Check for unresolved bindings
    const unresolved = findUnresolvedBindings(resolvedArgs);
    if (unresolved.length > 0) {
      results.push({ index: i, cap: step.cap, ok: false, error: `unresolved: ${unresolved.join(', ')}` });
      break;
    }

    // Inject _intent context for capability providers that read it
    resolvedArgs._intent = { raw: query, args: step.args || {} };

    // Show step progress in typing indicator
    updateTypingStatus(container, `Step ${i + 1}/${steps.length}: ${cap.summary}...`);

    try {
      const result = await cap.execute(resolvedArgs);
      if (result.ok) {
        if (step.binds) {
          bindings[step.binds] = pickBindValue(result.output);
        }
        results.push({ index: i, cap: step.cap, ok: true, output: result.output });
      } else {
        results.push({ index: i, cap: step.cap, ok: false, error: result.error });
      }
    } catch (err) {
      results.push({ index: i, cap: step.cap, ok: false, error: err?.message || String(err) });
    }
  }

  return results;
}

/**
 * Build a summary prompt so the AI generates a conversational reply about
 * what it just did. The AI sees the action results and the original query,
 * and writes a natural reply that covers both actions and any chat-only parts.
 */
function buildChatSummaryPrompt(query, actionResults) {
  const successes = actionResults.filter(r => r.ok && !r.output?.skipped);
  const failures = actionResults.filter(r => !r.ok);

  let summary = `The user said: "${query}"\n\n`;

  if (successes.length > 0) {
    summary += 'I successfully completed these actions:\n';
    for (const r of successes) {
      summary += `- ${r.cap}: ${JSON.stringify(r.output)}\n`;
    }
  }
  if (failures.length > 0) {
    summary += '\nThese actions failed:\n';
    for (const r of failures) {
      summary += `- ${r.cap}: ${r.error}\n`;
    }
  }

  summary += '\nNow reply to the user conversationally. Confirm what you did (or explain what failed). If the user also asked a question, joke, or chat-only request, answer that too. Be concise, warm, and helpful. Do NOT use markdown.';

  return summary;
}

/**
 * Replace the typing dots with a status message showing step progress.
 */
function updateTypingStatus(container, statusText) {
  const dots = container?.querySelector('.typing-dots');
  if (dots && dots.parentElement) {
    dots.parentElement.textContent = statusText;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

function initMessages(container) {
  let conversations = getConversations();
  let activeConvo = conversations[0]?.id || null;
  let _processing = false; // guard against interleaved rapid sends

  // Ensure default AI conversation exists
  if (!conversations.find(c => c.id === 'astrion-ai')) {
    conversations.unshift({
      id: 'astrion-ai',
      name: 'Astrion AI',
      avatar: '\u2728',
      messages: [
        { from: 'them', text: "Hey! I'm Astrion, your AI assistant. Ask me anything, or tell me to do something — I can create files, open apps, do math, and more.", time: Date.now() }
      ],
      isAI: true,
    });
    saveConversations(conversations);
  }

  if (!activeConvo) activeConvo = 'astrion-ai';

  function render() {
    container.innerHTML = `
      <div style="display:flex; height:100%; font-family:var(--font); color:white; background:#1a1a22;">
        <!-- Sidebar -->
        <div style="width:260px; border-right:1px solid rgba(255,255,255,0.06); display:flex; flex-direction:column;">
          <div style="padding:14px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:14px; font-weight:600;">Messages</div>
            <button id="msg-new" style="background:rgba(255,255,255,0.08); border:none; color:white; width:26px; height:26px; border-radius:6px; cursor:pointer; font-size:14px;" title="New conversation">+</button>
          </div>
          <div id="msg-list" style="flex:1; overflow-y:auto;"></div>
        </div>

        <!-- Chat area -->
        <div style="flex:1; display:flex; flex-direction:column;">
          <div id="msg-header" style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; align-items:center; gap:10px;"></div>
          <div id="msg-chat" style="flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:8px;"></div>
          <div style="padding:12px 16px; border-top:1px solid rgba(255,255,255,0.06); display:flex; gap:8px;">
            <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off" style="
              flex:1; padding:10px 14px; border-radius:20px; border:1px solid rgba(255,255,255,0.1);
              background:rgba(255,255,255,0.06); color:white; font-size:13px; font-family:var(--font); outline:none;
            ">
            <button id="msg-send" style="
              padding:10px 18px; border-radius:20px; border:none; background:var(--accent);
              color:white; font-size:13px; font-weight:500; cursor:pointer; font-family:var(--font);
            ">Send</button>
          </div>
        </div>
      </div>
    `;

    renderConvoList();
    renderChat();

    const input = container.querySelector('#msg-input');
    const sendBtn = container.querySelector('#msg-send');

    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendMessage(text);
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    sendBtn.addEventListener('click', send);

    container.querySelector('#msg-new').addEventListener('click', async () => {
      const { showPrompt } = await import('../lib/dialog.js');
      const name = await showPrompt('Contact name:', '');
      if (!name) return;
      const id = 'contact-' + Date.now();
      conversations.push({ id, name, avatar: name[0]?.toUpperCase() || '?', messages: [], isAI: false });
      activeConvo = id;
      saveConversations(conversations);
      render();
    });
  }

  function renderConvoList() {
    const list = container.querySelector('#msg-list');
    list.innerHTML = conversations.map(c => {
      const lastMsg = c.messages[c.messages.length - 1];
      const preview = lastMsg ? lastMsg.text.slice(0, 40) + (lastMsg.text.length > 40 ? '...' : '') : 'No messages';
      const isActive = c.id === activeConvo;
      return `
        <div class="msg-convo" data-id="${c.id}" style="
          padding:12px 14px; cursor:pointer; display:flex; gap:10px; align-items:center;
          background:${isActive ? 'rgba(0,122,255,0.15)' : 'transparent'};
          transition: background 0.1s;
        ">
          <div style="width:36px; height:36px; border-radius:50%; background:${c.isAI ? 'linear-gradient(135deg, #007aff, #5856d6)' : stringColor(c.name)};
            display:flex; align-items:center; justify-content:center; font-size:${c.isAI ? '16px' : '14px'}; font-weight:600; flex-shrink:0;">
            ${c.avatar}
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:${isActive ? '600' : '500'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.name)}</div>
            <div style="font-size:11px; color:rgba(255,255,255,0.4); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(preview)}</div>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.msg-convo').forEach(el => {
      el.addEventListener('click', () => {
        activeConvo = el.dataset.id;
        renderConvoList();
        renderChat();
      });
      el.addEventListener('mouseenter', () => { if (el.dataset.id !== activeConvo) el.style.background = 'rgba(255,255,255,0.04)'; });
      el.addEventListener('mouseleave', () => { if (el.dataset.id !== activeConvo) el.style.background = 'transparent'; });
    });
  }

  function renderChat() {
    const convo = conversations.find(c => c.id === activeConvo);
    if (!convo) return;

    const header = container.querySelector('#msg-header');
    const currentP = AI_PERSONALITIES[getCurrentPersonality()];
    header.innerHTML = `
      <div style="width:32px; height:32px; border-radius:50%; background:${convo.isAI ? 'linear-gradient(135deg, #007aff, #5856d6)' : stringColor(convo.name)};
        display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:600;">${convo.avatar}</div>
      <div style="flex:1;">
        <div style="font-size:13px; font-weight:600;">${esc(convo.name)}</div>
        <div style="font-size:10px; color:rgba(255,255,255,0.4);">${convo.isAI ? `AI Assistant \u2022 ${currentP?.name || 'Default'} mode` : 'Contact'}</div>
      </div>
      ${convo.isAI ? `<select id="msg-personality" style="
        padding:4px 8px; border-radius:8px; background:rgba(255,255,255,0.06);
        border:1px solid rgba(255,255,255,0.1); color:white; font-size:11px;
        font-family:var(--font); cursor:pointer; outline:none;
      ">${Object.entries(AI_PERSONALITIES).map(([id, p]) =>
        `<option value="${id}" ${id === getCurrentPersonality() ? 'selected' : ''}>${p.icon} ${p.name}</option>`
      ).join('')}</select>` : ''}
    `;
    // Wire personality selector
    const pSel = header.querySelector('#msg-personality');
    if (pSel) {
      pSel.addEventListener('change', () => {
        setPersonality(pSel.value);
        renderChat(); // re-render to update subtitle
      });
    }

    const chat = container.querySelector('#msg-chat');
    chat.innerHTML = convo.messages.map(m => {
      const isMe = m.from === 'me';
      return `
        <div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'};">
          <div style="
            max-width:65%; padding:10px 14px; border-radius:${isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
            background:${isMe ? 'var(--accent)' : 'rgba(255,255,255,0.08)'};
            font-size:13px; line-height:1.5; word-break:break-word;
          ">
            ${isMe ? esc(m.text).replace(/\n/g, '<br>') : renderMarkdown(m.text)}
            <div style="font-size:9px; color:rgba(255,255,255,0.35); margin-top:4px; text-align:${isMe ? 'right' : 'left'};">
              ${formatTime(m.time)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    chat.scrollTop = chat.scrollHeight;

    // Smart reply suggestions — show quick-action chips after AI messages
    if (convo.isAI && convo.messages.length > 0) {
      const last = convo.messages[convo.messages.length - 1];
      if (last.from === 'them') {
        const suggestions = getSmartReplies(last.text, convo.messages);
        if (suggestions.length > 0) {
          const chipsEl = document.createElement('div');
          chipsEl.id = 'msg-smart-replies';
          chipsEl.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap; padding:4px 0; justify-content:flex-end;';
          suggestions.forEach(s => {
            const chip = document.createElement('button');
            chip.textContent = s;
            chip.style.cssText = `
              padding:6px 12px; border-radius:16px; border:1px solid rgba(255,255,255,0.12);
              background:rgba(255,255,255,0.05); color:rgba(255,255,255,0.8);
              font-size:11px; cursor:pointer; font-family:var(--font);
              transition:all 0.15s;
            `;
            chip.addEventListener('mouseenter', () => { chip.style.background = 'rgba(255,255,255,0.12)'; });
            chip.addEventListener('mouseleave', () => { chip.style.background = 'rgba(255,255,255,0.05)'; });
            chip.addEventListener('click', () => {
              const input = container.querySelector('#msg-input');
              if (input) { input.value = s; input.focus(); }
            });
            chipsEl.appendChild(chip);
          });
          chat.appendChild(chipsEl);
        }
      }
    }

    chat.scrollTop = chat.scrollHeight;
    container.querySelector('#msg-input')?.focus();
  }

  /**
   * Generate smart reply suggestions based on the last AI message.
   * Pure pattern matching — no AI call needed.
   */
  function getSmartReplies(lastMsg, allMessages) {
    const lower = lastMsg.toLowerCase();
    const replies = [];

    // Question detection — suggest yes/no + elaboration
    if (/\?$/.test(lastMsg.trim()) || /\b(would you|do you|should i|can i|want me to)\b/i.test(lower)) {
      replies.push('Yes, please!', 'No thanks');
    }
    // AI offered help
    if (/\b(anything else|help you with|can i help|what else|need anything)\b/i.test(lower)) {
      replies.push("That's all, thanks!", 'Tell me a fun fact');
    }
    // AI explained something
    if (/\b(here's|explanation|means that|in other words|basically)\b/i.test(lower)) {
      replies.push('Explain more', 'Give me an example', 'Thanks!');
    }
    // AI created/did something
    if (/\b(created|done|finished|made|here you go|all set)\b/i.test(lower)) {
      replies.push('Thanks!', 'Can you change it?');
    }
    // AI couldn't do something
    if (/\b(sorry|couldn't|can't|unable|failed|error)\b/i.test(lower)) {
      replies.push('Try again', "That's okay");
    }
    // Greeting
    if (allMessages.length <= 2 || /\b(hello|hi|hey|welcome)\b/i.test(lower)) {
      if (replies.length === 0) replies.push("What can you do?", 'Tell me a joke', "What's the weather?");
    }

    // Fallback if nothing matched
    if (replies.length === 0) {
      replies.push('Tell me more', 'Thanks!');
    }

    return replies.slice(0, 3);
  }

  // ─── Typing indicator helpers ───

  function showTypingIndicator() {
    const chat = container.querySelector('#msg-chat');
    if (!chat) return;
    const typing = document.createElement('div');
    typing.id = 'msg-typing';
    typing.style.cssText = 'display:flex; justify-content:flex-start;';
    typing.innerHTML = `<div style="padding:10px 14px; border-radius:18px 18px 18px 4px; background:rgba(255,255,255,0.08); font-size:13px; color:rgba(255,255,255,0.5);">
      <span class="typing-dots" style="display:inline-flex; gap:3px;">
        <span style="animation:blink 1.4s infinite;">.</span>
        <span style="animation:blink 1.4s infinite 0.2s;">.</span>
        <span style="animation:blink 1.4s infinite 0.4s;">.</span>
      </span>
    </div>`;
    chat.appendChild(typing);
    chat.scrollTop = chat.scrollHeight;

    if (!document.getElementById('typing-css')) {
      const s = document.createElement('style');
      s.id = 'typing-css';
      s.textContent = '@keyframes blink { 0%,100% { opacity:0.3; } 50% { opacity:1; } }';
      document.head.appendChild(s);
    }
  }

  function removeTypingIndicator() {
    const el = container.querySelector('#msg-typing');
    if (el) el.remove();
  }

  // ─── Core send logic (Phase 0: planner-aware) ───

  async function sendMessage(text) {
    const convo = conversations.find(c => c.id === activeConvo);
    if (!convo) return;

    // Guard BEFORE render to prevent race window (audit bug #12)
    const isAI = convo.isAI;
    if (isAI) {
      if (_processing) return;
      _processing = true;
    }

    // Push user bubble
    convo.messages.push({ from: 'me', text, time: Date.now() });
    saveConversations(conversations);
    renderChat();
    sounds.tap();

    // Non-AI conversations: no response
    if (!isAI) return;

    const input = container.querySelector('#msg-input');
    if (input) input.disabled = true;

    showTypingIndicator();

    try {
      let reply;

      // ─── Route decision ───
      const intent = parseIntent(text);
      const route = routeQuery(text, intent);

      if (route === 'plan') {
        // ─── COMPOUND PLAN PATH ───
        reply = await handlePlanPath(text, intent, convo);
      } else if (intent && intent.confidence >= 0.55) {
        // ─── FAST SINGLE-CAPABILITY PATH ───
        reply = await handleFastPath(text, intent, convo);
      } else {
        // ─── PURE CHAT FALLBACK ───
        const personality = AI_PERSONALITIES[getCurrentPersonality()];
        const prompt = personality?.prompt ? personality.prompt + '\n\nUser: ' + text : text;
        reply = await aiService.ask(prompt);
      }

      // Null guard — aiService.ask can return null if all providers fail (audit bug #14)
      reply = reply || "I couldn't reach the AI right now. Check Settings > AI Assistant.";

      convo.messages.push({ from: 'them', text: reply, time: Date.now() });
      sounds.notification();
    } catch (err) {
      console.warn('[messages] sendMessage error:', err);
      convo.messages.push({ from: 'them', text: "Sorry, I couldn't process that. Are you connected to the internet?", time: Date.now() });
    } finally {
      _processing = false;
      if (input) input.disabled = false;
      removeTypingIndicator();
      saveConversations(conversations);
      renderChat();
    }
  }

  /**
   * Handle compound/multi-step queries via the planner.
   * Calls planIntent(), executes steps inline, generates conversational reply.
   */
  async function handlePlanPath(text, intent, convo) {
    const context = getContextBundle();
    const sessionId = getOrCreateSession();
    const memory = await getRecentTurns(sessionId);

    const plan = await planIntent({ query: text, context, memory, parsedIntent: intent });

    if (plan.status === 'clarify') {
      // Record the clarify turn
      await recordTurn({ sessionId, query: text, parsedIntent: intent, ok: false, error: 'clarify', capSummary: 'clarify' });
      return plan.question + (plan.choices?.length ? '\n\nOptions: ' + plan.choices.join(', ') : '');
    }

    if (plan.status !== 'plan') {
      // Planner failed — fall through to pure chat
      await recordTurn({ sessionId, query: text, parsedIntent: intent, ok: false, error: plan.error, capSummary: 'planner-failed' });
      return await aiService.ask(text);
    }

    // Execute plan steps inline (no event bus → no Spotlight hijack)
    const actionResults = await executeStepsInChat(plan.steps, text, container);
    const allOk = actionResults.every(r => r.ok);

    // Record the turn
    await recordTurn({
      sessionId, query: text, parsedIntent: intent, plan,
      ok: allOk, error: allOk ? null : actionResults.find(r => !r.ok)?.error,
      capSummary: `plan (${plan.steps.length} steps)`,
    });

    // Generate conversational reply about the results
    updateTypingStatus(container, 'Composing reply...');
    const summaryPrompt = buildChatSummaryPrompt(text, actionResults);
    return await aiService.ask(summaryPrompt, { skipHistory: true });
  }

  /**
   * Handle single-capability intents on the fast path.
   * For ai.ask/explain/summarize, use the output directly (no double AI call).
   * For other capabilities, execute then generate a conversational summary.
   */
  async function handleFastPath(text, intent, convo) {
    const cap = resolveCapability(intent);
    if (!cap) {
      // No capability matches — pure chat fallback
      return await aiService.ask(text);
    }

    // Direct reply caps (ai.ask, ai.explain, ai.summarize) — just forward to AI
    if (DIRECT_REPLY_CAPS.has(cap.id)) {
      const sessionId = getOrCreateSession();
      const result = await aiService.ask(text);
      await recordTurn({ sessionId, query: text, parsedIntent: intent, ok: true, capSummary: cap.id });
      return result;
    }

    // Execute the single capability
    const args = { ...intent.args, _intent: intent };

    updateTypingStatus(container, cap.summary + '...');

    let result;
    try {
      result = await cap.execute(args);
    } catch (err) {
      const sessionId = getOrCreateSession();
      await recordTurn({ sessionId, query: text, parsedIntent: intent, ok: false, error: err?.message, capSummary: cap.id });
      return `I tried to ${cap.summary.toLowerCase()} but hit an error: ${err?.message || 'unknown error'}`;
    }

    const sessionId = getOrCreateSession();
    await recordTurn({
      sessionId, query: text, parsedIntent: intent,
      ok: result.ok, error: result.error || null, capSummary: cap.id,
    });

    if (!result.ok) {
      return `I tried to ${cap.summary.toLowerCase()} but it failed: ${result.error || 'unknown error'}`;
    }

    // Generate a conversational reply about the result
    updateTypingStatus(container, 'Composing reply...');
    const actionResults = [{ index: 0, cap: cap.id, ok: true, output: result.output }];
    const summaryPrompt = buildChatSummaryPrompt(text, actionResults);
    return await aiService.ask(summaryPrompt, { skipHistory: true });
  }

  // ─── Cross-context agent replies (e.g. Spotlight → Messages) ───
  eventBus.on('chat:agent-reply', ({ text, conversationId }) => {
    const convo = conversations.find(c => c.id === (conversationId || 'astrion-ai'));
    if (!convo) return;
    convo.messages.push({ from: 'them', text, time: Date.now() });
    saveConversations(conversations);
    if (activeConvo === convo.id) renderChat();
    sounds.notification();
  });

  render();
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function stringColor(str) {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 40%)`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/**
 * Simple markdown → HTML for AI responses.
 * Supports: **bold**, *italic*, `inline code`, ```code blocks```, - lists
 */
function renderMarkdown(text) {
  let html = esc(text);
  // Code blocks (```...```)
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:6px;font-family:var(--mono,monospace);font-size:12px;overflow-x:auto;margin:4px 0;">$1</pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-family:var(--mono,monospace);font-size:12px;">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // List items (- or *)
  html = html.replace(/^[\-\*] (.+)$/gm, '<div style="padding-left:12px;">• $1</div>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ═══════════════════════════════════════════════════════════════
// INLINE SANITY TESTS (localhost only)
// ═══════════════════════════════════════════════════════════════

if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  let fail = 0;

  // Test 1: resolveBindings substitution
  const bound = resolveBindings({ path: '${binds.folder}/test.txt' }, { folder: '/Desktop/Homework' });
  if (bound.path !== '/Desktop/Homework/test.txt') {
    console.warn('[messages] FAIL: binding resolution:', bound.path);
    fail++;
  }

  // Test 2: findUnresolvedBindings detection
  const unresolved = findUnresolvedBindings({ path: '${binds.missing}/file.txt' });
  if (unresolved.length !== 1 || unresolved[0] !== 'missing') {
    console.warn('[messages] FAIL: unresolved detection:', unresolved);
    fail++;
  }

  // Test 3: buildChatSummaryPrompt structure
  const prompt = buildChatSummaryPrompt('make a folder', [
    { index: 0, cap: 'files.createFolder', ok: true, output: { path: '/Desktop/Test' } },
  ]);
  if (!prompt.includes('files.createFolder') || !prompt.includes('successfully')) {
    console.warn('[messages] FAIL: summary prompt:', prompt.slice(0, 100));
    fail++;
  }

  // Test 4: compound query routes to 'plan'
  const compoundRoute = routeQuery('create a folder called Homework on the Desktop and tell me a joke', parseIntent('create a folder called Homework on the Desktop and tell me a joke'));
  if (compoundRoute !== 'plan') {
    console.warn('[messages] FAIL: compound route:', compoundRoute);
    fail++;
  }

  // Test 5: pure chat routes correctly (should be a string)
  const chatRoute = routeQuery('tell me about the history of bread', parseIntent('tell me about the history of bread'));
  if (typeof chatRoute !== 'string') {
    console.warn('[messages] FAIL: chat route type:', typeof chatRoute);
    fail++;
  }

  if (fail === 0) console.log('[messages] all 5 sanity tests pass');
  else console.warn(`[messages] ${fail}/5 sanity tests FAILED`);
}
