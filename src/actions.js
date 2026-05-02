// Actions system — placeholder scaffolding for future FRIDAY AI integration
//
// Every action accepts a StateMachine instance so it can drive visual state
// transitions. When the real AI backend is wired in, swap the placeholder
// implementations below for actual API calls.

import { STATES } from './state-machine.js';

/**
 * Placeholder actions that drive state transitions.
 * Each action is an async function that returns a result object.
 *
 * Future integration points:
 *   - listen()   → Web Speech API or native macOS SpeechRecognizer
 *   - process()  → FRIDAY AI backend (WebSocket / HTTP)
 *   - respond()  → Web Speech API TTS or native macOS say(1)
 *   - alert()    → NSUserNotification or notify-rust
 */
export const actions = {
  /**
   * Start listening for voice input.
   * Future: Connect to speech-to-text engine.
   */
  async listen(stateMachine) {
    stateMachine.transition(STATES.LISTENING);
    console.log('[FRIDAY] Voice listening started...');

    // TODO: Connect to Web Speech API SpeechRecognition
    // const recognition = new SpeechRecognition();
    // recognition.onresult = (e) => actions.process(stateMachine, e.results[0][0].transcript);

    return { status: 'listening', transcript: null };
  },

  /**
   * Process user input through the AI backend.
   * Future: Send to FRIDAY AI backend.
   * @param {string} input – The text to process
   */
  async process(stateMachine, input) {
    stateMachine.transition(STATES.THINKING);
    console.log('[FRIDAY] Processing input:', input);

    // TODO: Send to AI backend via WebSocket or HTTP
    // const response = await fetch('http://localhost:8080/ai/process', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ input })
    // });
    // const data = await response.json();
    // return actions.respond(stateMachine, data.reply);

    // Placeholder: simulate network + processing delay
    await new Promise((r) => setTimeout(r, 2000));

    return {
      status: 'processed',
      result: 'Placeholder response for: ' + input
    };
  },

  /**
   * Speak a response via text-to-speech.
   * Future: Connect to TTS engine.
   * @param {string} text – The text to speak
   */
  async respond(stateMachine, text) {
    stateMachine.transition(STATES.SPEAKING);
    console.log('[FRIDAY] Speaking:', text);

    // TODO: Connect to TTS
    // const utterance = new SpeechSynthesisUtterance(text);
    // window.speechSynthesis.speak(utterance);

    return { status: 'speaking', text };
  },

  /**
   * Show an alert / notification.
   * Future: Connect to system notification API.
   * @param {string} message – The alert message
   */
  async alert(stateMachine, message) {
    stateMachine.setAlert(message);
    console.log('[FRIDAY] Alert:', message);
    return { status: 'alert', message };
  },

  /**
   * Check system status (CPU, memory, uptime).
   * Future: Connect to system monitoring via Tauri command.
   */
  async checkSystem(_stateMachine) {
    console.log('[FRIDAY] Checking system status...');

    // TODO: Use sysinfo via Tauri command
    // const info = await __TAURI__.core.invoke('system_info');
    // return info;

    return {
      status: 'ok',
      cpu: 'N/A',
      memory: 'N/A',
      uptime: 'N/A'
    };
  },

  /**
   * Handle an incoming message from the AI backend.
   * Future: WebSocket onmessage handler.
   * @param {object} message – { type: string, data: object }
   */
  async handleBackendMessage(stateMachine, message) {
    const { type, data } = message;

    switch (type) {
      case 'transcript':
        // User speech transcript received → process it
        return actions.process(stateMachine, data.text);

      case 'ai_response':
        // AI generated a response → speak it
        return actions.respond(stateMachine, data.text);

      case 'notification':
        // Backend notification → show alert
        return actions.alert(stateMachine, data.message);

      case 'status_update':
        // System status update
        console.log('[FRIDAY] Status:', data);
        return { status: 'ok', data };

      default:
        console.warn('[FRIDAY] Unknown message type:', type);
        return { status: 'unknown_type', type };
    }
  }
};

// ---------------------------------------------------------------------------
// Extension API — for connecting external modules at runtime
// ---------------------------------------------------------------------------

const extensions = new Map();

/**
 * Register an extension under a unique name.
 * @param {string} name – Unique extension identifier
 * @param {object} api  – The extension's public API
 */
export function registerExtension(name, api) {
  extensions.set(name, api);
  console.log(`[FRIDAY] Extension registered: ${name}`);
}

/**
 * Retrieve a previously registered extension.
 * @param {string} name – Extension identifier
 * @returns {object|undefined}
 */
export function getExtension(name) {
  return extensions.get(name);
}

/**
 * List all registered extension names.
 * @returns {string[]}
 */
export function listExtensions() {
  return Array.from(extensions.keys());
}
