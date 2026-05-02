// main.js — FRIDAY Core Entry Point
// Integrates: Renderer + StateMachine + InteractionHandler + Actions + Tauri Bridge
//
// Architecture:
//   Renderer       → Canvas 2D visual engine (rings, particles, glow)
//   StateMachine   → 5-state lifecycle (idle/listening/thinking/speaking/alert)
//   InteractionHandler → Click, hover, drag, context menu, keyboard
//   Actions        → Placeholder AI integration points
//   Tauri Bridge   → Rust backend commands (position, lock, tray)

import { createRenderer } from './renderer.js';
import { StateMachine, STATES } from './state-machine.js';
import { InteractionHandler } from './interactions.js';
import { actions, registerExtension } from './actions.js';
import { VeronicaAPI } from './veronica/veronica-api.js';
import { initPhases, destroyAllPhases, listPhases, registerPhase } from './veronica/phase-registry.js';

// Load Project Friday integration phase — registers itself via registerPhase()
import './veronica/phases/friday-phase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True when running inside a Tauri webview with the native API available. */
const isTauri = typeof window !== 'undefined' && !!window.__TAURI__;

/** Safe wrapper around Tauri's invoke — returns fallback in dev mode. */
async function invoke(cmd, args = {}) {
  if (isTauri && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    return window.__TAURI__.core.invoke(cmd, args);
  }
  console.warn(`[FRIDAY] Tauri not available — skipped command: ${cmd}`);
  return null;
}

/** Listen to a Tauri backend event. */
function listen(event, handler) {
  if (isTauri && window.__TAURI__.event && window.__TAURI__.event.listen) {
    return window.__TAURI__.event.listen(event, handler);
  }
  console.warn(`[FRIDAY] Tauri not available — skipped listener: ${event}`);
  return Promise.resolve({ remove: () => {} });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock Indicator UI
// ─────────────────────────────────────────────────────────────────────────────

function updateLockIndicator(locked) {
  const el = document.getElementById('lock-indicator');
  if (!el) return;
  el.style.display = locked ? 'block' : 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Initialization
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  console.log('[Veronica] Initializing...');

  // ── DOM validation ─────────────────────────────────────────────────
  const canvas = document.getElementById('friday-canvas');
  const appEl = document.getElementById('app');

  if (!canvas || !appEl) {
    console.error('[Veronica] Required DOM elements missing (friday-canvas or app)');
    return;
  }

  // ── Renderer ───────────────────────────────────────────────────────
  const renderer = createRenderer(canvas);
  renderer.start();

  // ── State Machine ──────────────────────────────────────────────────
  const stateMachine = new StateMachine(renderer, (newState, config) => {
    console.log(`[Veronica] State → ${newState}`);
  });

  // ── Interactions ───────────────────────────────────────────────────
  const interactions = new InteractionHandler(stateMachine, renderer);

  // Load lock state from backend
  try {
    const locked = await invoke('is_locked');
    if (locked !== null) {
      interactions.setLocked(locked);
      updateLockIndicator(locked);
    }
  } catch (e) {
    console.warn('[Veronica] Could not load lock state:', e);
  }

  // ── Tauri Event Listeners ─────────────────────────────────────────
  if (isTauri) {
    // Listen for lock state changes from backend (tray menu, global shortcut)
    await listen('lock-state-changed', (event) => {
      const locked = event.payload === true || event.payload === false
        ? event.payload
        : (typeof event.payload === 'object' ? event.payload?.locked : event.payload);
      interactions.setLocked(!!locked);
      updateLockIndicator(!!locked);
    });

    // Listen for state commands from backend
    await listen('state-command', (event) => {
      const state = typeof event.payload === 'object'
        ? event.payload?.state
        : event.payload;
      if (state && STATES[state]) {
        stateMachine.transition(state);
      }
    });
  }

  // ── Keyboard Shortcuts ────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // 1-5 keys: direct state selection (debug/dev)
    if (e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.metaKey) {
      const stateNames = ['IDLE', 'LISTENING', 'THINKING', 'SPEAKING', 'ALERT'];
      stateMachine.transition(stateNames[parseInt(e.key, 10) - 1]);
    }

    // Escape: return to idle
    if (e.key === 'Escape') {
      stateMachine.transition(STATES.IDLE);
    }
  });

  // ── Window blur: hide context menu ────────────────────────────────
  window.addEventListener('blur', () => {
    interactions.hideContextMenu();
  });

  // ── Set initial state ─────────────────────────────────────────────
  stateMachine.transition(STATES.IDLE);

  // ── Veronica Phase Layer ──────────────────────────────────────────
  // Build the stable API surface that Project Friday phases consume.
  // Phases never import Friday Core internals — only VeronicaAPI.
  const veronicaAPI = new VeronicaAPI({ stateMachine, renderer, invoke });

  // Initialize all phases that were registered before boot
  // (Project Friday phases call registerPhase() at module load time).
  await initPhases(veronicaAPI);

  // ── Cleanup on unload ─────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    destroyAllPhases();
    renderer.stop();
    stateMachine.destroy();
    interactions.destroy();
  });

  // ── Expose debug APIs ─────────────────────────────────────────────
  // window.FRIDAY — unchanged for backwards compatibility with existing tooling
  window.FRIDAY = {
    version: '1.0.0',
    stateMachine,
    renderer,
    interactions,
    actions,
    STATES,
    setState: (s) => stateMachine.transition(s),
    setAlert: (msg) => stateMachine.setAlert(msg),
    cycle: () => stateMachine.cycle(),
    invoke,
    isTauri,
    registerExtension,
    extensions: () => {
      try {
        const ext = import('./actions.js');
        return ext.then(m => m.listExtensions?.() || []);
      } catch { return []; }
    }
  };

  // window.VERONICA — public surface for Project Friday phases and tooling
  window.VERONICA = {
    version: veronicaAPI.version,
    api: veronicaAPI,
    // Register a phase at runtime (after boot, for dev/testing)
    registerPhase,
    // List all registered phases and their statuses
    phases: () => listPhases(),
  };

  console.log('[Veronica] Ready. Friday Core online. Project Friday phases loaded:', listPhases().length);
  console.log('[Veronica] Debug: window.VERONICA · window.FRIDAY');
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
