// friday-phase.js — Project Friday integration phase for Veronica
//
// Responsibilities:
//   1. Monitor the Friday bridge (http://127.0.0.1:8001) health every 15s
//   2. Emit veronica:friday-online / veronica:friday-offline events so other
//      phases and the UI can react to bridge availability
//   3. Expose a debug helper on window.VERONICA.friday for console testing
//
// The bridge exposes Project Friday tools as REST endpoints called by the
// Rust backend.  This phase is purely coordinative — it does not call
// tools directly; the Rust chat loop does that.

import { registerPhase } from '../phase-registry.js';

const BRIDGE_URL = 'http://127.0.0.1:8001';
const HEALTH_INTERVAL_MS = 15_000;
const STARTUP_DELAY_MS   = 2_000;   // give bridge time to start before first check

registerPhase({
  name: 'friday',
  version: '1.0.0',

  /** Called once by Veronica at boot, receives the VeronicaAPI instance. */
  async init(api) {
    this._api = api;
    this._online = false;
    this._timer = null;

    // Wait a moment so the bridge has a chance to start before we check.
    await new Promise(r => setTimeout(r, STARTUP_DELAY_MS));
    await this._check();
    this._timer = setInterval(() => this._check(), HEALTH_INTERVAL_MS);

    // Expose debug helpers on window.VERONICA.friday
    if (typeof window !== 'undefined' && window.VERONICA) {
      window.VERONICA.friday = {
        isOnline: () => this._online,
        check:    () => this._check(),
        fetchNews: () => this._callTool('GET', '/tools/world_news'),
        systemInfo: () => this._callTool('GET', '/tools/system_info'),
        fetchUrl: (url) => this._callTool('POST', '/tools/fetch_url', { url }),
      };
    }
  },

  // ── Health check ──────────────────────────────────────────────────────────

  async _check() {
    try {
      const r = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      const wasOnline = this._online;
      this._online = r.ok;
      if (r.ok && !wasOnline) {
        console.log('[Veronica · friday-phase] Bridge online');
        this._api.emit('friday-online', { url: BRIDGE_URL, time: Date.now() });
      }
    } catch {
      if (this._online) {
        console.warn('[Veronica · friday-phase] Bridge offline');
        this._api.emit('friday-offline', { time: Date.now() });
      }
      this._online = false;
    }
  },

  // ── Direct tool call helper (used by debug surface only) ─────────────────

  async _callTool(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    try {
      const r = await fetch(`${BRIDGE_URL}${path}`, opts);
      return r.json();
    } catch (e) {
      return { error: String(e) };
    }
  },

  /** Called by Veronica on app unload or explicit disablePhase(). */
  destroy() {
    if (this._timer) clearInterval(this._timer);
    if (typeof window !== 'undefined' && window.VERONICA) {
      delete window.VERONICA.friday;
    }
  },
});
