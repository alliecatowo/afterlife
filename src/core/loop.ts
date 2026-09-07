/**
 * Fixed-timestep simulation driver. Fully implemented, owned by the `core` agent.
 *
 * THE PERFORMANCE CONTRACT: this loop is the only thing that advances the
 * universe, and it never touches React. Each tick it steps the engine (via the
 * caller-supplied `step` callback), asks the renderer to draw (via `onFrame`
 * subscribers), and the caller is expected to emit `gen:changed` on the bus
 * from inside `step`. Consumers that need to display the number use
 * `useSimulationReadout` (throttled to 10 Hz) or write to a DOM ref. No
 * `setState` in here, ever — this module has no dependency on React or Zustand.
 *
 * Timing: accumulator-based so `speed` (generations per second) is honoured
 * independently of display refresh rate, with a max of `MAX_CATCHUP_STEPS`
 * catch-up steps per frame so a stalled/backgrounded tab cannot spiral —
 * excess accumulated time is discarded rather than run down all at once.
 */
import type { Disposable } from './types';

export interface SimLoop extends Disposable {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Target generations per second, > 0. */
  setSpeed(gensPerSecond: number): void;
  /** Advance exactly n generations while paused. */
  stepOnce(n?: number): void;
  /** Called every animation frame after stepping, for rendering. */
  onFrame(cb: () => void): Disposable;
}

export const MAX_CATCHUP_STEPS = 8;
export const MIN_SPEED = 1;
export const MAX_SPEED = 60;
export const DEFAULT_SPEED = 12;

type RafFn = (cb: (t: number) => void) => number;
type CancelRafFn = (h: number) => void;

function resolveScheduler(): { raf: RafFn; cancel: CancelRafFn } {
  const g = globalThis as unknown as {
    requestAnimationFrame?: RafFn;
    cancelAnimationFrame?: CancelRafFn;
    setTimeout: (cb: () => void, ms: number) => unknown;
    clearTimeout: (h: unknown) => void;
  };
  if (typeof g.requestAnimationFrame === 'function' && typeof g.cancelAnimationFrame === 'function') {
    return { raf: g.requestAnimationFrame.bind(g), cancel: g.cancelAnimationFrame.bind(g) };
  }
  // Fallback (older/headless environments without rAF): ~60Hz via setTimeout.
  const raf: RafFn = (cb) => g.setTimeout(() => cb(Date.now()), 16) as unknown as number;
  const cancel: CancelRafFn = (h) => g.clearTimeout(h);
  return { raf, cancel };
}

export function createSimLoop(step: () => void): SimLoop {
  const { raf, cancel } = resolveScheduler();

  let running = false;
  let speed = DEFAULT_SPEED;
  let handle: number | null = null;
  let lastTime = 0;
  let accumulator = 0;
  const frameCbs = new Set<() => void>();

  function runFrameCallbacks(): void {
    for (const cb of [...frameCbs]) cb();
  }

  function tick(now: number): void {
    if (!running) return;
    if (lastTime === 0) lastTime = now;
    let dt = (now - lastTime) / 1000;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 1) dt = 1; // guard a huge first-frame delta
    lastTime = now;
    accumulator += dt;

    const stepDuration = 1 / speed;
    let steps = 0;
    while (accumulator >= stepDuration && steps < MAX_CATCHUP_STEPS) {
      step();
      accumulator -= stepDuration;
      steps++;
    }
    if (steps === MAX_CATCHUP_STEPS) {
      // We hit the catch-up ceiling (e.g. tab was backgrounded) — drop the
      // backlog instead of spiralling through it on the next frames.
      accumulator = 0;
    }

    runFrameCallbacks();
    handle = raf(tick);
  }

  const loop: SimLoop = {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      lastTime = 0;
      accumulator = 0;
      handle = raf(tick);
    },
    stop() {
      running = false;
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
    setSpeed(gensPerSecond: number) {
      if (!Number.isFinite(gensPerSecond)) {
        throw new Error(`setSpeed: gensPerSecond must be finite, got ${gensPerSecond}`);
      }
      speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, gensPerSecond));
    },
    stepOnce(n = 1) {
      for (let i = 0; i < n; i++) step();
      runFrameCallbacks();
    },
    onFrame(cb: () => void): Disposable {
      frameCbs.add(cb);
      return { dispose: () => frameCbs.delete(cb) };
    },
    dispose() {
      loop.stop();
      frameCbs.clear();
    },
  };

  return loop;
}
