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

  async ask(prompt, options = {}) {
    const systemContext = this._buildSystemContext();
    // skipHistory: don't include prior turns and don't record this exchange.
    // Used by the intent planner so planner prompts don't pollute chat history.
    const skip = !!options.skipHistory;
    const messages = [
      ...(skip ? [] : this.conversationHistory.slice(-6)),
      { role: 'user', content: prompt }
    ];

    const provider = this.getProvider();
    const startMs = Date.now();

    // Tell the brain indicator we're thinking (menubar pulses yellow)
    eventBus.emit('ai:thinking');

    // M3 escalation: check if this capability category should skip S1
    const capCat = options.capCategory || 'general';
    let skipS1 = false;
    if (provider === 'auto') {
      try { skipS1 = await shouldEscalate(capCat); } catch {}
    }

    // Auto: try Ollama first (unless escalated), then Anthropic, then mock
    if ((provider === 'auto' && !skipS1) || provider === 'ollama') {
      const reply = await this._tryOllama(systemContext, messages, options);
      if (reply) {
        if (!skip) this._addToHistory(prompt, reply);
        const elapsed = Date.now() - startMs;
        eventBus.emit('ai:response', { brain: 's1', confidence: 0.85, provider: 'ollama', responseTimeMs: elapsed, capCategory: capCat, model: options.model || this.getOllamaModel(), escalated: false, query: prompt.slice(0, 100) });
        return reply;
      }
      if (provider === 'ollama') {
        const mock = this._mockResponse(prompt);
        eventBus.emit('ai:response', { brain: 'offline', confidence: 0.3, provider: 'mock', capCategory: capCat, model: 'mock', escalated: false, query: prompt.slice(0, 100) });
        return mock;
      }
    }

    if (provider === 'auto' || provider === 'anthropic') {
      // M3 budget gate: check spending limits before S2 call
      const model = options.model || 'claude-haiku-4-5-20251001';
      const inputEstimate = Math.max(500, Math.min(8000, Math.round(prompt.length * 1.3)));
      const budgetCheck = checkBudget({ inputTokens: inputEstimate, outputTokens: 500, model });
      if (!budgetCheck.allowed) {
        console.warn('[ai-service] S2 budget exceeded:', budgetCheck.reason);
        // Fall through to mock with a budget warning
        const mock = `I'd love to help, but today's cloud AI budget has been reached. ${budgetCheck.reason}. Try again tomorrow, or use Ollama (free, local) in Settings > AI.`;
        eventBus.emit('ai:response', { brain: 'offline', confidence: 0.3, provider: 'budget-exceeded', capCategory: capCat, model, escalated: skipS1, query: prompt.slice(0, 100) });
        return mock;
      }

      const result = await this._tryAnthropicWithUsage(systemContext, messages, options);
      if (result?.reply) {
        if (!skip) this._addToHistory(prompt, result.reply);
        const elapsed = Date.now() - startMs;
        // Record actual token usage for budget tracking
        recordS2Call({
          inputTokens: result.usage?.input_tokens || 0,
          outputTokens: result.usage?.output_tokens || 0,
          model,
          query: prompt.slice(0, 100),
          ok: true,
        });
        eventBus.emit('ai:response', { brain: 's2', confidence: 0.95, provider: 'anthropic', responseTimeMs: elapsed, capCategory: capCat, model, escalated: skipS1, query: prompt.slice(0, 100) });
        return result.reply;
      }
    }

    const mock = this._mockResponse(prompt);
    eventBus.emit('ai:response', { brain: 'offline', confidence: 0.3, provider: 'mock', capCategory: capCat, model: 'mock', escalated: false, query: prompt.slice(0, 100) });
    return mock;
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
        }),
        signal: AbortSignal.timeout(30000),
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

    // Math
    const mathMatch = lower.match(/(?:what is |calculate |compute )?([\d\s+\-*/.()]+)/);
    if (mathMatch) {
      try {
        const expr = mathMatch[1].trim();
        if (/^[\d\s+\-*/.()]+$/.test(expr) && expr.length > 1 && expr.length < 100 && !/[a-zA-Z_$\\]/.test(expr)) {
          const result = Function('"use strict"; return (' + expr + ')')();
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
