/**
 * The simulation core. STUB — owned by the `core` agent (`src/core/**`).
 *
 * Rules (non-negotiable, tested):
 *  - B3/S23 exactly. A dead cell with exactly 3 live neighbours is born; a live
 *    cell with 2 or 3 live neighbours survives; everything else dies.
 *  - Boundary is a TORUS. Neighbour lookup wraps on both axes with floor-mod.
 *  - Updates are SIMULTANEOUS: `step()` reads only the previous generation.
 *    Implement with a double buffer, never in place.
 */

import type {
  CellCoord,
  Generation,
  Rect,
  Snapshot,
  StampPattern,
  StampTransform,
  WorldSpec,
} from './types';

export interface LifeEngine {
  /** Immutable shape of this universe. */
  readonly spec: WorldSpec;
  /** Current generation index. Starts at 0, increments once per `step()`. */
  readonly gen: Generation;
  /** Count of live cells in the current generation. O(1) — maintained incrementally. */
  readonly population: number;

  /** Read a cell. Coordinates wrap toroidally, so any integer is valid. */
  get(x: number, y: number): boolean;

  /**
   * Write a cell in the CURRENT generation. Coordinates wrap.
   * Callers that want the write recorded in history must route it through an
   * `EditOp` and `TimelineStore.record()` — the engine itself keeps no history.
   */
  set(x: number, y: number, alive: boolean): void;

  /** Advance exactly one generation. Returns the new generation index. */
  step(): Generation;

  /** Deep copy of the current state. `bits` is a fresh buffer, never aliased. */
  snapshot(): Snapshot;

  /**
   * Replace the whole state from a snapshot. `s.bits.length` must equal
   * `spec.width * spec.height` or this throws. Age/activity fields reset.
   */
  restore(s: Snapshot): void;

  /** An independent engine with identical state. Used for branch previews. */
  clone(): LifeEngine;

  /**
   * Generations the cell at (x, y) has been continuously alive.
   * 0 if dead. Used by the 'age' lens.
   */
  ageAt(x: number, y: number): number;

  /**
   * Recent-change heat in [0, 1]. Set to 1 when a cell flips state, then decays
   * multiplicatively each `step()` (recommended factor 0.88). Used by the
   * 'activity' lens.
   */
  activityAt(x: number, y: number): number;

  /**
   * Visit every live cell whose coordinates fall inside `rect`. `rect` may
   * extend past world bounds; coordinates passed to `cb` are already wrapped
   * into world space. Iteration order is row-major. Return `false` from `cb`
   * to stop early.
   */
  forEachLive(rect: Rect, cb: (x: number, y: number) => void | boolean): void;

  /**
   * Deterministically fill the world with random noise.
   * @param rngSeed number or string seed, fed to `makeRng`.
   * @param density probability a given cell starts alive, in [0, 1].
   * Resets `gen` to 0 and clears age/activity.
   */
  seed(rngSeed: number | string, density: number): void;

  /** Kill everything. Resets `gen` to 0 and clears age/activity. */
  clear(): void;

  /**
   * Draw a pattern with its top-left corner at (x, y) after `transform`.
   * Pattern cells with value 0 are written as dead (a stamp is opaque, not
   * additive). Wraps toroidally.
   */
  stamp(p: StampPattern, x: number, y: number, transform: StampTransform): void;

  /**
   * Copy a rect out as a row-major `Uint8Array` of length `rect.w * rect.h`,
   * 1 = alive. Reads wrap toroidally.
   */
  region(rect: Rect): Uint8Array;
}

/** Options for constructing an engine. */
export interface EngineOptions {
  width: number;
  height: number;
  /** Multiplier applied to every cell's activity each step. Default 0.88. */
  activityDecay?: number;
}

/**
 * Factory for the default dense-array toroidal engine.
 * Implemented by the `core` agent.
 */
export function createEngine(_options: EngineOptions): LifeEngine {
  throw new Error('not implemented');
}

/** Wrap a coordinate into [0, n) with floor-mod semantics (handles negatives). */
export function wrap(v: number, n: number): number {
  const m = v % n;
  return m < 0 ? m + n : m;
}

/** Normalise a rect so `w`/`h` are positive integers. */
export function normalizeRect(r: Rect): Rect {
  const x = r.w < 0 ? r.x + r.w : r.x;
  const y = r.h < 0 ? r.y + r.h : r.y;
  return { x: Math.floor(x), y: Math.floor(y), w: Math.max(1, Math.abs(Math.round(r.w))), h: Math.max(1, Math.abs(Math.round(r.h))) };
}

/** Rect from two corner cells, inclusive of both. */
export function rectFromCorners(a: CellCoord, b: CellCoord): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
