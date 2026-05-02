// veronica-api.js — Stable API surface for Project Friday phases
//
// Phases import VeronicaAPI exclusively — never Friday Core internals.
// This isolation means refactors inside Friday Core don't break phases,
// and Project Friday can evolve its phase interfaces independently.
//
// Usage (in a Project Friday phase):
//   import { VeronicaAPI } from '../veronica/veronica-api.js';
//   // api instance is provided to phase.init(api) by the phase registry

export const VERONICA_VERSION = '1.0.0';

export class VeronicaAPI {
  #stateMachine;
  #renderer;
  #invoke;
  #stateListeners = [];

  constructor({ stateMachine, renderer, invoke }) {
    this.#stateMachine = stateMachine;
    this.#renderer = renderer;
    this.#invoke = invoke;

    // Intercept state transitions to broadcast to phase listeners
    const originalOnChange = this.#stateMachine.onStateChange;
    this.#stateMachine.onStateChange = (newState, config) => {
      originalOnChange?.(newState, config);
      for (const fn of this.#stateListeners) {
        try { fn(newState, config); } catch {}
      }
    };
  }

  // ── State Control ──────────────────────────────────────────────

  /** Transition to a named state (IDLE/LISTENING/THINKING/SPEAKING/ALERT). */
  setState(state) {
    return this.#stateMachine.transition(state);
  }

  /** Returns the current state name. */
  getState() {
    return this.#stateMachine.state;
  }

  /**
   * Subscribe to state changes.
   * @param {(state: string, config: object) => void} fn
   * @returns {() => void} unsubscribe function
   */
  onStateChange(fn) {
    this.#stateListeners.push(fn);
    return () => {
      this.#stateListeners = this.#stateListeners.filter(f => f !== fn);
    };
  }

  /**
   * Trigger the ALERT state with a message.
   * @param {string} message
   */
  setAlert(message) {
    this.#stateMachine.setAlert(message);
  }

  // ── Backend Bridge ─────────────────────────────────────────────

  /**
   * Invoke a Tauri backend command.
   * Phases use this to call existing Friday Core Rust commands or
   * any new Veronica commands without importing Tauri directly.
   * @param {string} cmd
   * @param {object} [args]
   * @returns {Promise<any>}
   */
  invoke(cmd, args = {}) {
    return this.#invoke(cmd, args);
  }

  // ── Event Bus ──────────────────────────────────────────────────

  /**
   * Listen to a Tauri backend event or a Veronica inter-phase event.
   * @param {string} event
   * @param {(payload: any) => void} handler
   * @returns {Promise<{ remove: () => void }>}
   */
  listen(event, handler) {
    if (typeof window !== 'undefined' && window.__TAURI__?.event?.listen) {
      return window.__TAURI__.event.listen(event, handler);
    }
    // Dev / non-Tauri fallback: DOM custom events
    const wrapper = (e) => handler({ payload: e.detail });
    window.addEventListener(`veronica:${event}`, wrapper);
    return Promise.resolve({ remove: () => window.removeEventListener(`veronica:${event}`, wrapper) });
  }

  /**
   * Emit an inter-phase event. Phases can communicate without coupling directly.
   * @param {string} event
   * @param {any} payload
   */
  emit(event, payload) {
    window.dispatchEvent(new CustomEvent(`veronica:${event}`, { detail: payload }));
  }

  // ── Renderer Access ────────────────────────────────────────────

  /**
   * Read-only snapshot of the renderer's current visual state.
   * Phases can query but should never write to the renderer directly.
   */
  get rendererState() {
    return this.#renderer ? { ...this.#renderer } : null;
  }

  // ── Metadata ───────────────────────────────────────────────────

  get version() { return VERONICA_VERSION; }
}
