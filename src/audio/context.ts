/**
 * The only place that touches `AudioContext` construction. Nothing at module
 * scope creates a context — browsers refuse to start one outside a user
 * gesture, and DESIGN.md/ARCHITECTURE.md require the app to work with sound
 * fully optional and silent until explicitly enabled.
 */

type LegacyWindow = typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/** Construct a new `AudioContext`. Call only from inside a user-gesture
 * handler (`Soundscape.init`). */
export function createAudioContext(): AudioContext {
  const Ctor = globalThis.AudioContext ?? (globalThis as LegacyWindow).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is not available in this environment');
  return new Ctor();
}

/** Resume `ctx` if the browser has it suspended (autoplay policy, tab
 * backgrounding, etc). Resolves once running or immediately if already so. */
export async function ensureRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}
