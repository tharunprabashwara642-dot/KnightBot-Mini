/**
 * Gemini API Client — supports multiple API keys with automatic rotation.
 *
 * Add as many Gemini keys as you want, either in config.js
 * (gemini.apiKeys: [...]) or via env vars:
 *   GEMINI_API_KEY=single_key
 *   GEMINI_API_KEYS=key_one,key_two,key_three
 *
 * Whenever the currently active key comes back with a rate-limit / quota
 * error (HTTP 429, or a RESOURCE_EXHAUSTED message), that key is put on a
 * short cooldown and the request is automatically retried with the next
 * available key. No manual .env edit or restart needed. If every key is
 * rate-limited at the same time, the one whose cooldown expires soonest is
 * retried.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const STATE_FILE = path.join(__dirname, '..', 'database', 'gemini_state.json');
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 1 minute
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function loadKeys() {
  const fromConfigRaw = config.gemini?.apiKeys;
  const fromConfig = Array.isArray(fromConfigRaw)
    ? fromConfigRaw
    : (fromConfigRaw ? [fromConfigRaw] : []);
  const fromEnvList = (process.env.GEMINI_API_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  const fromEnvSingle = (process.env.GEMINI_API_KEY || '').trim();

  const all = [...fromConfig, ...fromEnvList];
  if (fromEnvSingle) all.push(fromEnvSingle);

  // De-duplicate, drop empties/placeholders
  const seen = new Set();
  const keys = [];
  for (const k of all) {
    const key = String(k || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { currentIndex: 0 };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[gemini] failed to persist key rotation state:', e.message);
  }
}

class GeminiClient {
  constructor() {
    this.keys = loadKeys();
    this.model = process.env.GEMINI_MODEL || config.gemini?.model || 'gemini-2.5-flash';
    const state = loadState();
    this.currentIndex = this.keys.length
      ? ((state.currentIndex || 0) % this.keys.length)
      : 0;
    this.cooldowns = new Array(this.keys.length).fill(0);
  }

  hasKeys() {
    return this.keys.length > 0;
  }

  _isRateLimited(err) {
    const status = err.response?.status;
    if (status === 429) return true;
    const dataStr = JSON.stringify(err.response?.data || err.message || '').toLowerCase();
    return dataStr.includes('rate limit')
      || dataStr.includes('resource_exhausted')
      || dataStr.includes('quota')
      || dataStr.includes('too many requests');
  }

  _pickIndex(skip) {
    const now = Date.now();
    const n = this.keys.length;
    const order = Array.from({ length: n }, (_, i) => (this.currentIndex + i) % n);
    for (const i of order) {
      if (!skip.has(i) && this.cooldowns[i] <= now) return i;
    }
    const candidates = Array.from({ length: n }, (_, i) => i).filter(i => !skip.has(i));
    const pool = candidates.length ? candidates : Array.from({ length: n }, (_, i) => i);
    return pool.reduce((best, i) => (this.cooldowns[i] < this.cooldowns[best] ? i : best), pool[0]);
  }

  _switchTo(index) {
    if (index !== this.currentIndex) {
      this.currentIndex = index;
      saveState({ currentIndex: index });
    }
  }

  /**
   * contents: Gemini "contents" array, e.g. [{ role: 'user', parts: [{ text: 'hi' }] }]
   * opts: { tools, systemInstruction, generationConfig }
   * returns: { text, functionCalls, raw }
   */
  async generate(contents, opts = {}) {
    if (!this.hasKeys()) {
      throw new Error(
        'No Gemini API key configured. Add one in config.js (gemini.apiKeys) ' +
        'or set GEMINI_API_KEY / GEMINI_API_KEYS.'
      );
    }

    const n = this.keys.length;
    const tried = new Set();
    let lastErr = null;

    for (let keyAttempt = 0; keyAttempt < n; keyAttempt++) {
      const idx = this._pickIndex(tried);
      this._switchTo(idx);
      tried.add(idx);
      const apiKey = this.keys[idx];

      for (let retry = 0; retry < 3; retry++) {
        try {
          const isAuthKey = apiKey.startsWith('AQ.');
          const url = isAuthKey
            ? `${API_BASE}/${this.model}:generateContent`
            : `${API_BASE}/${this.model}:generateContent?key=${apiKey}`;
          const body = { contents };
          if (opts.tools) body.tools = opts.tools;
          if (opts.systemInstruction) body.systemInstruction = opts.systemInstruction;
          if (opts.generationConfig) body.generationConfig = opts.generationConfig;

          const headers = isAuthKey ? { Authorization: `Bearer ${apiKey}` } : {};
          const res = await axios.post(url, body, { timeout: 60000, headers });
          const candidate = res.data?.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          const text = parts.filter(p => p.text).map(p => p.text).join('');
          const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
          return { text, functionCalls, raw: res.data };
        } catch (err) {
          lastErr = err;
          const status = err.response?.status;

          if (this._isRateLimited(err)) {
            // This key is spent for now — cool it down and hand off to the
            // next key immediately.
            this.cooldowns[idx] = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            break; // stop retrying this key, move to the next one
          }
          if (status >= 500 && status < 600) {
            await new Promise(r => setTimeout(r, 1500 * (retry + 1)));
            continue;
          }
          if (!status) {
            // Network/timeout error — brief retry on the same key.
            await new Promise(r => setTimeout(r, 1000 * (retry + 1)));
            continue;
          }
          throw new Error(`Gemini API error (${status}): ${JSON.stringify(err.response?.data || err.message)}`);
        }
      }
    }

    throw new Error(`All ${n} Gemini API key(s) failed or are rate-limited right now: ${lastErr?.message || lastErr}`);
  }

  /** Convenience helper for simple one-shot text prompts. */
  async chat(prompt, systemInstruction) {
    const contents = [{ role: 'user', parts: [{ text: prompt }] }];
    const opts = systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {};
    const { text } = await this.generate(contents, opts);
    return text;
  }
}

const instance = new GeminiClient();
module.exports = instance;
module.exports.GeminiClient = GeminiClient;
