// phase-registry.js — Project Friday phase lifecycle manager
//
// Design contract for a Project Friday phase:
//
//   export const MyPhase = {
//     name: 'my-phase',          // unique identifier
//     version: '1.0.0',          // semver
//
//     // Called once during Veronica startup. Receives the VeronicaAPI instance.
//     async init(api) { ... },
//
//     // Optional: called when the phase is explicitly disabled or app unloads.
//     destroy() { ... },
//   };
//
// Phases are isolated — an exception in one phase's init/destroy never
// propagates to other phases or to Friday Core.

export const PhaseStatus = {
  REGISTERED: 'registered',
  ACTIVE:     'active',
  DISABLED:   'disabled',
  ERROR:      'error',
};

/** @type {Map<string, { name: string, phase: object, status: string, error: string|null }>} */
const registry = new Map();

/**
 * Register a Project Friday phase.
 * Call this before initPhases() — typically at module load time.
 *
 * @param {object} phase  An object satisfying the phase contract above.
 * @returns {boolean}     True if registered; false if a phase with that name already exists.
 */
export function registerPhase(phase) {
  const name = phase?.name;
  if (!name || typeof name !== 'string') {
    console.error('[Veronica] registerPhase: phase.name is required');
    return false;
  }
  if (registry.has(name)) {
    console.warn(`[Veronica] Phase already registered: ${name}`);
    return false;
  }
  registry.set(name, { name, phase, status: PhaseStatus.REGISTERED, error: null });
  console.log(`[Veronica] Phase registered: ${name} v${phase.version ?? '?'}`);
  return true;
}

/**
 * Initialise all registered phases in registration order.
 * Each phase receives the VeronicaAPI instance.
 * Failures are caught and logged — they do not abort other phases.
 *
 * @param {import('./veronica-api.js').VeronicaAPI} api
 */
export async function initPhases(api) {
  for (const [name, entry] of registry) {
    if (entry.status !== PhaseStatus.REGISTERED) continue;
    try {
      if (typeof entry.phase.init === 'function') {
        await entry.phase.init(api);
      }
      entry.status = PhaseStatus.ACTIVE;
      console.log(`[Veronica] Phase active: ${name}`);
    } catch (err) {
      entry.status = PhaseStatus.ERROR;
      entry.error = err?.message ?? String(err);
      console.error(`[Veronica] Phase failed to init: ${name}`, err);
    }
  }
}

/**
 * Disable a phase by name, calling destroy() if available.
 * A disabled phase can be re-registered fresh if needed.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function disablePhase(name) {
  const entry = registry.get(name);
  if (!entry) return false;
  try { entry.phase.destroy?.(); } catch {}
  entry.status = PhaseStatus.DISABLED;
  console.log(`[Veronica] Phase disabled: ${name}`);
  return true;
}

/**
 * Tear down all active phases. Called on app unload.
 */
export function destroyAllPhases() {
  for (const [name, entry] of registry) {
    if (entry.status === PhaseStatus.ACTIVE) {
      disablePhase(name);
    }
  }
}

/**
 * Returns a snapshot of all registered phases and their statuses.
 * Safe to call at any time — does not mutate state.
 *
 * @returns {{ name: string, version: string, status: string, error: string|null }[]}
 */
export function listPhases() {
  return Array.from(registry.values()).map(({ name, phase, status, error }) => ({
    name,
    version: phase?.version ?? 'unknown',
    status,
    error,
  }));
}
