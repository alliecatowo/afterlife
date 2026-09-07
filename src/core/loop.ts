/**
 * Fixed-timestep simulation driver. STUB, owned by the `core` agent.
 *
 * THE PERFORMANCE CONTRACT: this loop is the only thing that advances the
 * universe, and it never touches React. Each tick it steps the engine, asks the
 * renderer to draw, and emits `gen:changed` on the bus. Consumers that need to
 * display the number use `useSimulationReadout` (throttled to 10 Hz) or write
 * to a DOM ref. No `setState` in here, ever.
 *
 * Timing: accumulator-based so `speed` (generations per second) is honoured
 * independently of display refresh rate, with a max of 8 catch-up steps per
 * frame so a stalled tab cannot spiral.
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

export function createSimLoop(_step: () => void): SimLoop {
  throw new Error('not implemented');
}
