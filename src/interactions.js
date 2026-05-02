// Interaction handler for Veronica
// Handles: click, hover, drag, context menu, keyboard shortcuts
// Bridges all user input to the state machine and Tauri backend.

import { STATES } from './state-machine.js';

/** Default options for drag detection. */
const DEFAULT_OPTIONS = {
  dragThreshold: 5,   // px of mouse movement before a drag is recognised
  dragDelayMs: 200    // ms the mouse must be held before drag initiates
};

/**
 * InteractionHandler wires every user input channel into FRIDAY Core.
 *
 * Responsibilities:
 *   - Mouse down / move / up → drag detection & position persistence
 *   - Click → state cycling
 *   - Hover → renderer glow feedback
 *   - Right-click → context menu
 *   - Keyboard (Esc) → return to IDLE
 *   - Tauri command bridge → save/load position, lock/unlock, reset, quit
 */
export class InteractionHandler {
  /**
   * @param {StateMachine} stateMachine – The state machine instance
   * @param {object} renderer           – The canvas renderer instance
   * @param {object} [options]          – Override drag defaults
   */
  /**
   * @param {StateMachine} stateMachine – The state machine instance
   * @param {object} renderer           – The canvas renderer instance
   * @param {object} [options]          – Override drag defaults
   * @param {function} [onLockChange]   – Callback(locked: boolean) when lock state changes
   */
  constructor(stateMachine, renderer, options = {}, onLockChange = null) {
    this.stateMachine = stateMachine;
    this.renderer = renderer;
    this.onLockChange = onLockChange;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Drag state
    this.isDragging = false;
    this.hasDragged = false;
    this.dragStart = { x: 0, y: 0 };
    this.windowStart = { x: 0, y: 0 };
    this.dragTimer = null;

    // Hover state
    this.isHovering = false;

    // Lock state
    this.locked = false;

    // DOM refs
    this.appEl = document.getElementById('app');
    this.canvas = document.getElementById('friday-canvas');

    // Bound event handlers (so we can remove them in destroy())
    this._onMouseDown = this.onMouseDown.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onMouseUp = this.onMouseUp.bind(this);
    this._onMouseEnter = this.onMouseEnter.bind(this);
    this._onMouseLeave = this.onMouseLeave.bind(this);
    this._onContextMenu = this.onContextMenu.bind(this);
    this._onClick = this.onClick.bind(this);
    this._onKeyDown = this.onKeyDown.bind(this);

    this.init();
  }

  /** Wire up all event listeners. */
  init() {
    if (!this.appEl) return;

    this.appEl.addEventListener('mousedown', this._onMouseDown);
    this.appEl.addEventListener('mouseenter', this._onMouseEnter);
    this.appEl.addEventListener('mouseleave', this._onMouseLeave);
    this.appEl.addEventListener('contextmenu', this._onContextMenu);
    this.appEl.addEventListener('click', this._onClick);
    document.addEventListener('keydown', this._onKeyDown);

    // Prevent text selection inside the widget
    this.appEl.addEventListener('selectstart', (e) => e.preventDefault());
  }

  /**
   * Update the visual lock state.
   * @param {boolean} locked – true disables dragging
   */
  setLocked(locked) {
    this.locked = locked;
    this.appEl?.classList.toggle('locked', locked);
    if (this.onLockChange) {
      this.onLockChange(locked);
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse event handlers
  // ---------------------------------------------------------------------------

  onMouseDown(e) {
    if (e.button !== 0) return; // Only left click
    if (this.locked) return;

    this.isDragging = false;
    this.hasDragged = false;
    this.dragStart = { x: e.clientX, y: e.clientY };

    // After a short delay, promote to a real drag operation
    this.dragTimer = setTimeout(() => {
      this.isDragging = true;
      this.appEl?.classList.add('dragging');

      // Capture window position at drag start so we can offset from it
      this.getWindowPosition().then((pos) => {
        // load_position returns [x, y] or we get [0, 0] as fallback
        this.windowStart = Array.isArray(pos)
          ? { x: pos[0], y: pos[1] }
          : pos;
      });
    }, this.options.dragDelayMs);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
  }

  onMouseMove(e) {
    if (!this.isDragging) {
      // Still in "click territory" — if the mouse moves far enough the
      // upcoming mouseup will be treated as a cancelled click.
      return;
    }

    // Active drag — compute delta from dragStart and update window position
    this.hasDragged = true;
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;

    if (this.windowStart) {
      const newX = Math.round(this.windowStart.x + dx);
      const newY = Math.round(this.windowStart.y + dy);
      this.updateDragPosition(newX, newY);
    }
  }

  onMouseUp(_e) {
    if (this.dragTimer) {
      clearTimeout(this.dragTimer);
      this.dragTimer = null;
    }

    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);

    if (this.isDragging) {
      this.isDragging = false;
      this.appEl?.classList.remove('dragging');

      // Persist the final position
      this.getWindowPosition().then((pos) => {
        const arr = Array.isArray(pos) ? pos : [pos.x, pos.y];
        this.savePosition(arr[0], arr[1]);
      });
    }
  }

  onMouseEnter(_e) {
    this.isHovering = true;
    if (this.renderer) this.renderer.setHover(true);
  }

  onMouseLeave(_e) {
    this.isHovering = false;
    if (this.renderer) this.renderer.setHover(false);
    this.hideContextMenu();
  }

  // ---------------------------------------------------------------------------
  // Click handling
  // ---------------------------------------------------------------------------

  onClick(e) {
    // Ignore clicks that followed a drag, or non-left clicks
    if (this.hasDragged) {
      this.hasDragged = false;
      return;
    }
    if (this.isDragging) return;
    if (e.button !== 0) return;

    // Don't trigger when clicking inside the context menu
    if (e.target.closest('#context-menu')) return;

    // Visual pulse feedback on the canvas
    if (this.renderer) {
      this.renderer.pulsePhase += Math.PI;
    }

    // Click → start a chat conversation (LISTENING → THINKING → SPEAKING)
    this._invoke('start_chat').catch((err) => {
      console.error('[Veronica] chat error:', err);
    });
  }

  // ---------------------------------------------------------------------------
  // Context menu (right-click)
  // ---------------------------------------------------------------------------

  onContextMenu(e) {
    e.preventDefault();
    this.showContextMenu(e.clientX, e.clientY);
  }

  showContextMenu(x, y) {
    const menu = document.getElementById('context-menu');
    if (!menu) return;

    menu.innerHTML = `
      <div class="menu-item disabled">Veronica v1.0</div>
      <div class="menu-separator"></div>
      <div class="menu-item" data-action="toggle-lock">
        ${this.locked ? '\uD83D\uDD13 Unlock Position' : '\uD83D\uDD12 Lock Position'}
      </div>
      <div class="menu-item" data-action="reset-position">\u27F2 Reset Position</div>
      <div class="menu-separator"></div>
      <div class="menu-item" data-action="state-idle">\u25CE Set Idle</div>
      <div class="menu-item" data-action="state-listening">\u25CE Set Listening</div>
      <div class="menu-item" data-action="state-thinking">\u25CE Set Thinking</div>
      <div class="menu-item" data-action="state-speaking">\u25CE Set Speaking</div>
      <div class="menu-item" data-action="state-alert">\u26A0 Set Alert</div>
      <div class="menu-separator"></div>
      <div class="menu-item" data-action="quit">\u2715 Quit</div>
    `;

    // Keep menu inside the 280x280 widget bounds
    const MENU_WIDTH = 170;
    const MENU_HEIGHT = 280;
    const WIDGET_SIZE = 280;

    let menuX = x;
    let menuY = y;
    if (menuX + MENU_WIDTH > WIDGET_SIZE) menuX = WIDGET_SIZE - MENU_WIDTH - 5;
    if (menuY + MENU_HEIGHT > WIDGET_SIZE) menuY = WIDGET_SIZE - MENU_HEIGHT - 5;

    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;
    menu.style.display = 'block';

    // Delegate click handling for menu items
    menu.querySelectorAll('.menu-item').forEach((item) => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = item.dataset.action;
        if (action) this.handleMenuAction(action);
        this.hideContextMenu();
      });
    });
  }

  hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
  }

  handleMenuAction(action) {
    switch (action) {
      case 'toggle-lock':
        this.toggleLock();
        break;
      case 'reset-position':
        this.resetPosition();
        break;
      case 'state-idle':
        this.stateMachine.transition(STATES.IDLE);
        break;
      case 'state-listening':
        this.stateMachine.transition(STATES.LISTENING);
        break;
      case 'state-thinking':
        this.stateMachine.transition(STATES.THINKING);
        break;
      case 'state-speaking':
        this.stateMachine.transition(STATES.SPEAKING);
        break;
      case 'state-alert':
        this.stateMachine.setAlert('Manual alert');
        break;
      case 'quit':
        this.quit();
        break;
      default:
        console.warn('[Veronica] Unknown menu action:', action);
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.stateMachine.transition(STATES.IDLE);
      this.hideContextMenu();
    }
  }

  // ---------------------------------------------------------------------------
  // Tauri command bridge
  // ---------------------------------------------------------------------------

  /**
   * Helper: safely invoke a Tauri command.
   * Returns fallback if __TAURI__ is unavailable (dev mode in browser).
   */
  async _invoke(command, args = {}) {
    if (typeof window !== 'undefined' && window.__TAURI__) {
      return window.__TAURI__.core.invoke(command, args);
    }
    return null;
  }

  async getWindowPosition() {
    try {
      const pos = await this._invoke('load_position');
      if (pos) return pos;
    } catch (e) {
      console.warn('[Veronica] Could not get position:', e);
    }
    return [0, 0];
  }

  async savePosition(x, y) {
    try {
      await this._invoke('save_position', { x, y });
    } catch (e) {
      console.warn('[Veronica] Could not save position:', e);
    }
  }

  async updateDragPosition(x, y) {
    try {
      await this._invoke('update_drag_position', { x, y });
    } catch (e) {
      console.warn('[Veronica] Could not update drag position:', e);
    }
  }

  async toggleLock() {
    try {
      const locked = await this._invoke('toggle_lock');
      // toggle_lock returns the new locked state; fall back to local toggle
      this.setLocked(locked !== null ? locked : !this.locked);
    } catch (e) {
      console.warn('[Veronica] Could not toggle lock:', e);
      // Local-only fallback
      this.setLocked(!this.locked);
    }
  }

  async resetPosition() {
    try {
      await this._invoke('reset_position');
    } catch (e) {
      console.warn('[Veronica] Could not reset position:', e);
    }
  }

  async loadLockState() {
    try {
      const locked = await this._invoke('is_locked');
      if (locked !== null) this.setLocked(locked);
    } catch (e) {
      console.warn('[Veronica] Could not load lock state:', e);
    }
  }

  quit() {
    try {
      this._invoke('quit_app');
    } catch (e) {
      console.warn('[Veronica] Could not quit via Tauri:', e);
      // Fallback for browser dev mode
      window.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Remove all event listeners. Call before unloading the module. */
  destroy() {
    if (this.dragTimer) clearTimeout(this.dragTimer);

    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('keydown', this._onKeyDown);

    if (this.appEl) {
      this.appEl.removeEventListener('mousedown', this._onMouseDown);
      this.appEl.removeEventListener('mouseenter', this._onMouseEnter);
      this.appEl.removeEventListener('mouseleave', this._onMouseLeave);
      this.appEl.removeEventListener('contextmenu', this._onContextMenu);
      this.appEl.removeEventListener('click', this._onClick);
    }
  }
}
