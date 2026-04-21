// Astrion OS — AI Service
// Unified AI provider: Ollama (local), Anthropic (cloud), or mock fallback.
// Configure in Settings > AI Assistant.
//
// Dual-process brain tagging (M3 seed): every ask() emits `ai:thinking`
// before the call and `ai:response` with `{brain, confidence, provider}`
// after. The menubar brain indicator (js/shell/menubar.js) subscribes to
// these events to show which brain answered the last question.
//   - Ollama success → brain: 's1' (fast local)
//   - Anthropic success → brain: 's2' (slow cloud)
//   - Mock fallback → brain: 'offline' (no real AI wired up)

import { eventBus } from './event-bus.js';
import { checkBudget, recordS2Call, getPerIntentCap } from './budget-manager.js';
import { shouldEscalate, capCategory as getCapCategory } from './calibration-tracker.js';

const AI_PROVIDER_KEY = 'nova-ai-provider';   // 'ollama' | 'anthropic' | 'mock'
const AI_OLLAMA_URL_KEY = 'nova-ai-ollama-url';
const AI_OLLAMA_MODEL_KEY = 'nova-ai-ollama-model';

class AIService {
  constructor() {
    this.conversationHistory = [];
    this.context = {};
  }

  getProvider() {
    return localStorage.getItem(AI_PROVIDER_KEY) || 'auto';
  }

  setProvider(provider) {
    localStorage.setItem(AI_PROVIDER_KEY, provider);
  }

  getOllamaUrl() {
    return localStorage.getItem(AI_OLLAMA_URL_KEY) || 'http://localhost:11434';
  }

  setOllamaUrl(url) {
    localStorage.setItem(AI_OLLAMA_URL_KEY, url);
  }

  getOllamaModel() {
    return localStorage.getItem(AI_OLLAMA_MODEL_KEY) || 'qwen2.5:7b';
  }

  setOllamaModel(model) {
    localStorage.setItem(AI_OLLAMA_MODEL_KEY, model);
  }

  setContext(key, value) {
    this.context[key] = value;
  }

  clearContext(key) {
    delete this.context[key];
  }

  /**
   * Same as ask() but returns the metadata the menubar/calibration code needs.
   * Resolves to { reply, meta } where meta = { brain, confidence, provider,
   * capCategory, model, escalated, responseTimeMs }.
   *
   * Use this instead of subscribing to `ai:response` when you need the brain
   * tag for the SPECIFIC call you just made — the event bus is global and a
   * concurrent call can clobber the value between your await and your read.
   */
  async askWithMeta(prompt, options = {}) {
    const systemContext = this._buildSystemContext();
    const skip = !!options.skipHistory;
    const messages = [
      ...(skip ? [] : this.conversationHistory.slice(-6)),
      { role: 'user', content: prompt }
    ];

    const provider = this.getProvider();
    const startMs = Date.now();

    eventBus.emit('ai:thinking');

    const capCat = options.capCategory || 'general';
    let skipS1 = false;
    if (provider === 'auto') {
      try { skipS1 = await shouldEscalate(capCat); } catch {}
    }

    const emitMeta = (meta) => { eventBus.emit('ai:response', { ...meta, query: prompt.slice(0, 100) }); return meta; };

    if ((provider === 'auto' && !skipS1) || provider === 'ollama') {
      const reply = await this._tryOllama(systemContext, messages, options);
      if (reply) {
        if (!skip) this._addToHistory(prompt, reply);
        const meta = emitMeta({ brain: 's1', confidence: 0.85, provider: 'ollama',
          responseTimeMs: Date.now() - startMs, capCategory: capCat,
          model: options.model || this.getOllamaModel(), escalated: false });
        return { reply, meta };
      }
      if (provider === 'ollama') {
        const reply = this._mockResponse(prompt);
        const meta = emitMeta({ brain: 'offline', confidence: 0.3, provider: 'mock',
          capCategory: capCat, model: 'mock', escalated: false });
        return { reply, meta };
      }
    }

    if (provider === 'auto' || provider === 'anthropic') {
      const model = options.model || 'claude-haiku-4-5-20251001';
      const inputEstimate = Math.max(500, Math.min(8000, Math.round(prompt.length * 1.3)));
      const budgetCheck = checkBudget({ inputTokens: inputEstimate, outputTokens: 500, model });
      if (!budgetCheck.allowed) {
        console.warn('[ai-service] S2 budget exceeded:', budgetCheck.reason);
        const reply = `I'd love to help, but today's cloud AI budget has been reached. ${budgetCheck.reason}. Try again tomorrow, or use Ollama (free, local) in Settings > AI.`;
        const meta = emitMeta({ brain: 'offline', confidence: 0.3, provider: 'budget-exceeded',
          capCategory: capCat, model, escalated: skipS1 });
        return { reply, meta };
      }

      const result = await this._tryAnthropicWithUsage(systemContext, messages, options);
      if (result?.reply) {
        if (!skip) this._addToHistory(prompt, result.reply);
        recordS2Call({
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
          model, query: prompt.slice(0, 100), ok: true,
        });
        const meta = emitMeta({ brain: 's2', confidence: 0.95, provider: 'anthropic',
          responseTimeMs: Date.now() - startMs, capCategory: capCat, model,
          escalated: skipS1 });
        return { reply: result.reply, meta };
      }
    }

    const reply = this._mockResponse(prompt);
    const meta = emitMeta({ brain: 'offline', confidence: 0.3, provider: 'mock',
      capCategory: capCat, model: 'mock', escalated: false });
    return { reply, meta };
  }

  async ask(prompt, options = {}) {
    const { reply } = await this.askWithMeta(prompt, options);
    return reply;
  }

  async _tryOllama(system, messages, options) {
    try {
      const ollamaUrl = this.getOllamaUrl();
      const model = options.model || this.getOllamaModel();

      // Try via our server proxy (handles CORS)
      const res = await fetch('/api/ai/ollama', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: ollamaUrl,
          model,
          system,
          messages,
          ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
          ...(options.format ? { format: options.format } : {}),
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (res.ok) {
        const data = await res.json();
        return data.reply || data.message?.content || null;
      }
    } catch {}
    return null;
  }

  async _tryAnthropic(system, messages, options) {
    const result = await this._tryAnthropicWithUsage(system, messages, options);
    return result?.reply || null;
  }

  /**
   * Try Anthropic and return both the reply text AND the usage stats.
   * Used by ask() for M3 budget tracking.
   */
  async _tryAnthropicWithUsage(system, messages, options) {
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system,
          messages,
          model: options.model || 'claude-haiku-4-5-20251001',
          max_tokens: options.maxTokens || 1024,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.content?.[0]?.text || null;
        const usage = data.usage || null; // { input_tokens, output_tokens }
        return reply ? { reply, usage } : null;
      }
    } catch {}
    return null;
  }

  _addToHistory(prompt, reply) {
    this.conversationHistory.push({ role: 'user', content: prompt });
    this.conversationHistory.push({ role: 'assistant', content: reply });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-12);
    }
  }

  _buildSystemContext() {
    let ctx = `You are Astrion, the built-in AI assistant for Astrion OS — an AI-native desktop operating system. You are helpful, concise, and knowledgeable. Keep responses short unless asked for detail.\n`;

    if (this.context.activeApp) ctx += `\nUser is using: ${this.context.activeApp}`;
    if (this.context.activeFile) ctx += `\nActive file: ${this.context.activeFile}`;
    if (this.context.selectedText) ctx += `\nSelected text: ${this.context.selectedText}`;
    if (this.context.terminalOutput) ctx += `\nTerminal output: ${this.context.terminalOutput}`;

    return ctx;
  }

  _mockResponse(prompt) {
    const lower = prompt.toLowerCase();

    if (lower.includes('hello') || lower.includes('hi ') || lower === 'hi')
      return "Hey! I'm Astrion, your AI assistant. Ask me anything — I can help with code, homework, ideas, or just chat. To connect me to a real AI, go to Settings > AI Assistant.";

    if (lower.includes('help') || lower.includes('what can you do'))
      return "I can:\n\u2022 Answer questions\n\u2022 Help with code\n\u2022 Open apps: \"open terminal\"\n\u2022 Do math: \"42 * 17\"\n\u2022 Tell jokes\n\nConnect me to Ollama or an API key in Settings > AI for full power!";

    if (lower.includes('time'))
      return `It's ${new Date().toLocaleTimeString()} on ${new Date().toLocaleDateString()}.`;

    if (lower.includes('joke')) {
      const jokes = [
        'Why do programmers prefer dark mode? Because light attracts bugs!',
        "There are 10 types of people: those who understand binary and those who don't.",
        'A SQL query walks into a bar, sees two tables, and asks "Can I JOIN you?"',
      ];
      return jokes[Math.floor(Math.random() * jokes.length)];
    }

    // Math — hand-rolled parser (no Function/eval). Input is gated by
    // the regex to digits/whitespace/+ - * / ^ ( ) . plus a limited
    // identifier alphabet (a-z/A-Z for the 'pi'/'e' constants) so the
    // worst a bad input can do is throw. Unknown identifiers hit
    // safeMathEval's "bad identifier" branch and the try/catch below
    // swallows it. Exponents accept both ** and ^. Scientific notation
    // (1e6, 1.5e-3) handled by the tokenizer.
    const mathMatch = lower.match(/(?:what is |calculate |compute )?([a-zA-Z\d\s+\-*/.()^]+)/);
    if (mathMatch) {
      try {
        const expr = mathMatch[1].trim();
        if (/^[a-zA-Z\d\s+\-*/.()^]+$/.test(expr) && expr.length > 1 && expr.length < 100 && /[\d+\-*/^()]/.test(expr)) {
          const result = safeMathEval(expr);
          if (typeof result === 'number' && isFinite(result)) return `${expr} = ${result}`;
        }
      } catch {}
    }

    return "I'm in offline mode right now. Connect me to Ollama (free, local AI) or an API key in **Settings > AI Assistant** for full capabilities. In the meantime, I can do math, tell jokes, and open apps!";
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

export const aiService = new AIService();

// ─── Safe math evaluator (replaces Function() in _mockResponse) ───
// Tiny recursive-descent parser for + - * / and parentheses. Operates on
// a tokenized stream so there is no path back to eval/Function. Throws
// on malformed input; caller catches.
function safeMathEval(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let n = '';
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        n += expr[i++];
      }
      // Scientific notation: 1e6, 1.5e-3, 2E+10. Only consume the e/E
      // suffix if it's followed by [optional + or -] then at least one
      // digit — otherwise leave the e/E for the operator parser to
      // reject (which will throw 'bad char').
      if (i < expr.length && (expr[i] === 'e' || expr[i] === 'E')) {
        let look = i + 1;
        if (look < expr.length && (expr[look] === '+' || expr[look] === '-')) look++;
        if (look < expr.length && expr[look] >= '0' && expr[look] <= '9') {
          n += expr[i++];
          if (expr[i] === '+' || expr[i] === '-') n += expr[i++];
          while (i < expr.length && expr[i] >= '0' && expr[i] <= '9') n += expr[i++];
        }
      }
      const v = parseFloat(n);
      if (!isFinite(v)) throw new Error('safeMathEval: bad number ' + n);
      tokens.push({ t: 'num', v });
    } else if (ch === '*' && expr[i + 1] === '*') {
      tokens.push({ t: 'op', v: '^' });
      i += 2;
    } else if ('+-*/()^'.indexOf(ch) >= 0) {
      tokens.push({ t: 'op', v: ch });
      i++;
    } else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      // Named constant: pi / e / PI / E. Kept deliberately small — if
      // someone types 'sin(…)' we'd rather throw than pretend to
      // support it. Only accept full-word matches (not embedded in an
      // identifier) by lookahead — the next char must end the ident.
      let name = '';
      while (i < expr.length && ((expr[i] >= 'a' && expr[i] <= 'z') || (expr[i] >= 'A' && expr[i] <= 'Z'))) {
        name += expr[i++];
      }
      const low = name.toLowerCase();
      if (low === 'pi') tokens.push({ t: 'num', v: Math.PI });
      else if (low === 'e' && i < expr.length && expr[i] !== '+' && expr[i] !== '-') {
        // lone 'e' — only a constant when NOT followed by exponent sign
        // (which is handled above in the number-path). But we reach
        // this branch because the number-path was never entered.
        tokens.push({ t: 'num', v: Math.E });
      }
      else if (low === 'e') tokens.push({ t: 'num', v: Math.E });
      else throw new Error('safeMathEval: bad identifier ' + name);
    } else {
      throw new Error('safeMathEval: bad char ' + ch);
    }
  }
  let p = 0;
  function expect(v) {
    if (!tokens[p] || tokens[p].v !== v) throw new Error('safeMathEval: expected ' + v);
    p++;
  }
  function parseExpr() {
    let left = parseTerm();
    while (tokens[p] && (tokens[p].v === '+' || tokens[p].v === '-')) {
      const op = tokens[p++].v;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parsePower();
    while (tokens[p] && (tokens[p].v === '*' || tokens[p].v === '/')) {
      const op = tokens[p++].v;
      const right = parsePower();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  // Exponent — right-associative. 2^3^2 = 2^(3^2) = 512
  function parsePower() {
    const left = parseFactor();
    if (tokens[p] && tokens[p].v === '^') {
      p++;
      const right = parsePower();
      return Math.pow(left, right);
    }
    return left;
  }
  function parseFactor() {
    const tok = tokens[p];
    if (!tok) throw new Error('safeMathEval: unexpected end');
    if (tok.v === '(') { p++; const v = parseExpr(); expect(')'); return v; }
    if (tok.v === '-') { p++; return -parsePower(); }
    if (tok.v === '+') { p++; return  parsePower(); }
    if (tok.t === 'num') { p++; return tok.v; }
    throw new Error('safeMathEval: bad token ' + JSON.stringify(tok));
  }
  const result = parseExpr();
  if (p !== tokens.length) throw new Error('safeMathEval: trailing tokens');
  return result;
}

// ─── Sanity tests (localhost only) ───
if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
  const cases = [
    ['1 + 2', 3],
    ['2 * 3', 6],
    ['10 - 4', 6],
    ['8 / 2', 4],
    ['2 ^ 3', 8],
    ['2 ** 10', 1024],
    ['(1 + 2) * 3', 9],
    ['-5', -5],
    ['+5', 5],
    ['5 + +3', 8],
    ['5 - -3', 8],
    ['1e6', 1000000],
    ['1.5e3', 1500],
    ['2.5e-2', 0.025],
    ['1E+2', 100],
    ['1e6 + 1', 1000001],
    // Named constants (approximate match since floats are floats)
    ['pi', Math.PI],
    ['PI', Math.PI],
    ['2 * pi', 2 * Math.PI],
    ['pi / 2', Math.PI / 2],
    ['e', Math.E],
    ['e + 1', Math.E + 1],
  ];
  let f = 0;
  for (const [expr, want] of cases) {
    try {
      const got = safeMathEval(expr);
      if (Math.abs(got - want) > 1e-9) { console.warn('[ai-service] math FAIL:', expr, 'got', got, 'want', want); f++; }
    } catch (e) {
      console.warn('[ai-service] math THREW:', expr, '→', e.message);
      f++;
    }
  }
  // Negative cases — must throw
  const bad = ['1e', '2 ++', '* 3', '(1 + 2', 'sin(pi)', 'xyz'];
  for (const expr of bad) {
    try { safeMathEval(expr); console.warn('[ai-service] math should have thrown:', expr); f++; } catch {}
  }
  if (f === 0) console.log('[ai-service] all', cases.length + bad.length, 'safeMathEval sanity tests pass');
  else console.warn('[ai-service]', f, 'safeMathEval sanity tests failed');
}
