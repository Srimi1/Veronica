// State Machine for FRIDAY Core
// Manages the 5 visual states: IDLE, LISTENING, THINKING, SPEAKING, ALERT

export const STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  ALERT: 'ALERT'
};

/**
 * Configuration for each state.
 * - label:     Text shown in the center of the widget
 * - status:    Subtitle text shown below the label
 * - autoReturnMs: Timeout before automatically returning to IDLE (null = never)
 * - clickCyclesTo: Next state when the widget is clicked (used by cycle())
 */
const STATE_CONFIG = {
  [STATES.IDLE]: {
    label: 'FRIDAY',
    status: 'System Online',
    autoReturnMs: null, // No auto-return — stays idle until user interacts
    clickCyclesTo: STATES.LISTENING
  },
  [STATES.LISTENING]: {
    label: '\u25CF \u25CF \u25CF',
    status: 'Listening...',
    autoReturnMs: 8000,
    clickCyclesTo: STATES.THINKING
  },
  [STATES.THINKING]: {
    label: 'Processing',
    status: 'Analyzing input...',
    autoReturnMs: 6000,
    clickCyclesTo: STATES.SPEAKING
  },
  [STATES.SPEAKING]: {
    label: 'FRIDAY',
    status: 'Responding...',
    autoReturnMs: 5000,
    clickCyclesTo: STATES.IDLE
  },
  [STATES.ALERT]: {
    label: '!',
    status: '', // Set dynamically via setAlert(message)
    autoReturnMs: 10000,
    clickCyclesTo: STATES.IDLE
  }
};

/**
 * StateMachine manages FRIDAY Core's visual and logical states.
 *
 * Responsibilities:
 *   - Enforce valid state transitions
 *   - Update renderer visual state
 *   - Update UI text (label + status) with fade animation
 *   - Auto-return to IDLE after configurable timeouts
 *   - Notify external listeners on every transition
 */
export class StateMachine {
  /**
   * @param {object} renderer      – The canvas renderer instance (optional)
   * @param {function} onStateChange – Callback(newState, config) fired on every transition
   */
  constructor(renderer, onStateChange) {
    this.currentState = STATES.IDLE;
    this.renderer = renderer;
    this.onStateChange = onStateChange;
    this.autoReturnTimer = null;
    this.alertMessage = 'System Alert';
    this._cycleOrder = [
      STATES.IDLE,
      STATES.LISTENING,
      STATES.THINKING,
      STATES.SPEAKING,
      STATES.ALERT
    ];
  }

  /** @returns {string} Current state name */
  get state() {
    return this.currentState;
  }

  /** @returns {object} Configuration object for the current state */
  get config() {
    return STATE_CONFIG[this.currentState];
  }

  /**
   * Transition to a new state.
   * @param {string} newState    – Target state name (key of STATES)
   * @param {string} [alertMessage] – Optional alert message when targeting ALERT
   * @returns {boolean} True if the transition was valid and applied
   */
  transition(newState, alertMessage) {
    if (!STATES[newState]) return false;

    this.clearAutoReturn();
    this.currentState = newState;

    if (newState === STATES.ALERT && alertMessage) {
      this.alertMessage = alertMessage;
    }

    // Sync renderer visual state
    if (this.renderer) {
      this.renderer.setState(newState);
    }

    // Sync DOM text with cross-fade
    this.updateUI();

    // Notify external listeners
    if (this.onStateChange) {
      this.onStateChange(newState, this.config);
    }

    // Schedule auto-return if this state has a timeout
    this.scheduleAutoReturn();

    return true;
  }

  /**
   * Advance one step through the state cycle:
   * IDLE → LISTENING → THINKING → SPEAKING → ALERT → IDLE
   */
  cycle() {
    const currentIndex = this._cycleOrder.indexOf(this.currentState);
    const nextIndex = (currentIndex + 1) % this._cycleOrder.length;
    this.transition(this._cycleOrder[nextIndex]);
  }

  /**
   * Set the ALERT state with a custom message.
   * @param {string} message – The alert text to display
   */
  setAlert(message) {
    this.transition(STATES.ALERT, message || 'Notification');
  }

  /**
   * Update the DOM text elements (main-text + status-text) with a
   * cross-fade animation (200 ms fade out → swap text → 200 ms fade in).
   */
  updateUI() {
    const mainText = document.getElementById('main-text');
    const statusText = document.getElementById('status-text');
    if (!mainText || !statusText) return;

    const config = this.config;

    // Fade out
    mainText.style.transition = 'opacity 0.2s ease';
    statusText.style.transition = 'opacity 0.2s ease';
    mainText.style.opacity = '0';
    statusText.style.opacity = '0';

    setTimeout(() => {
      mainText.textContent =
        this.currentState === STATES.ALERT ? '!' : config.label;
      statusText.textContent =
        this.currentState === STATES.ALERT ? this.alertMessage : config.status;

      // Fade in
      mainText.style.opacity = '1';
      statusText.style.opacity = '1';
    }, 200);
  }

  /**
   * Schedule the auto-return timer for the current state.
   * Only non-IDLE states with autoReturnMs set will trigger a timer.
   */
  scheduleAutoReturn() {
    const timeout = this.config.autoReturnMs;
    if (timeout && this.currentState !== STATES.IDLE) {
      this.autoReturnTimer = setTimeout(() => {
        this.transition(STATES.IDLE);
      }, timeout);
    }
  }

  /** Clear any pending auto-return timer. */
  clearAutoReturn() {
    if (this.autoReturnTimer) {
      clearTimeout(this.autoReturnTimer);
      this.autoReturnTimer = null;
    }
  }

  /** Reset to IDLE and clear all pending timers. */
  reset() {
    this.clearAutoReturn();
    this.transition(STATES.IDLE);
  }

  /** Cleanup — call before unloading the module. */
  destroy() {
    this.clearAutoReturn();
  }
}
