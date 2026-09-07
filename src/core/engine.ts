/**
 * The simulation core. Fully implemented — owned by the `core` agent (`src/core/**`).
 *
 * Rules (non-negotiable, tested):
 *  - B3/S23 exactly. A dead cell with exactly 3 live neighbours is born; a live
 *    cell with 2 or 3 live neighbours survives; everything else dies.
 *  - Boundary is a TORUS. Neighbour lookup wraps on both axes with floor-mod.
 *  - Updates are SIMULTANEOUS: `step()` reads only the previous generation.
 *    Implemented with a double buffer, never in place.
 *
 * Storage
 * -------
 *  - `current` / `next`: row-major `Uint8Array`, one byte per cell, `1 = alive`.
 *    Index of (x, y) in a w-wide buffer is `y * w + x`. Double-buffered: `step()`
 *    computes the whole of `next` from `current` then SWAPS the two references
 *    (never copies, never allocates). `get`/`set`/`region`/etc. always read the
 *    current buffer.
 *  - `age`: `Uint16Array`, generations a cell has been continuously alive,
 *    clamped at 65535, reset to 0 the instant a cell dies.
 *  - `activity`: `Uint8Array` 0..255, recent-change heat. Set to 255 on any
 *    state flip (whether from `step()` or a direct `set()`/`stamp()`), otherwise
 *    multiplied by `activityDecay` (default 0.88) every step. `activityAt`
 *    normalises this to [0, 1].
 *
 * `snapshot()` / `restore()` only round-trip `{ gen, bits }` (see `Snapshot` in
 * `types.ts`) — `bits` is a fresh row-major `Uint8Array` copy, one byte per
 * cell, `1 = alive`, this is the entire encoding. `age`/`activity` are
 * cosmetic per-lens data, not part of the deterministic world state, and are
 * reset on `restore()`.
 */

import { makeRng } from './rng';
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

const DEFAULT_ACTIVITY_DECAY = 0.88;
const MAX_AGE = 65535;

/** Wrap a coordinate into [0, n) with floor-mod semantics (handles negatives). */
export function wrap(v: number, n: number): number {
  return ((v % n) + n) % n;
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

/**
 * Pure transform helper shared by `stamp()` and the render/UI ghost preview —
 * both MUST use this exact function so the ghost always matches where a stamp
 * actually lands. `flipX`/`flipY` are applied first (mirroring the source
 * pattern), then the result is rotated `rotate` quarter-turns clockwise.
 * Rotation swaps width/height on odd quarter-turns.
 */
export function transformPattern(p: StampPattern, t: StampTransform): StampPattern {
  const { w, h } = p;
  const flipped = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = t.flipY ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const sx = t.flipX ? w - 1 - x : x;
      flipped[y * w + x] = p.cells[sy * w + sx]!;
    }
  }

  let curW = w;
  let curH = h;
  let cur = flipped;
  const turns = (((t.rotate % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  for (let i = 0; i < turns; i++) {
    const rotW = curH;
    const rotH = curW;
    const rotated = new Uint8Array(rotW * rotH);
    for (let y = 0; y < curH; y++) {
      for (let x = 0; x < curW; x++) {
        const nx = curH - 1 - y;
        const ny = x;
        rotated[ny * rotW + nx] = cur[y * curW + x]!;
      }
    }
    cur = rotated;
    curW = rotW;
    curH = rotH;
  }

  return { name: p.name, w: curW, h: curH, cells: cur };
}

class DenseTorusEngine implements LifeEngine {
  readonly spec: WorldSpec;
  private readonly decay: number;

  private current: Uint8Array;
  private next: Uint8Array;
  private age: Uint16Array;
  private activity: Uint8Array;

  private _gen: Generation = 0;
  private _population = 0;

  constructor(options: EngineOptions) {
    const { width, height, activityDecay } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`createEngine: width/height must be positive integers, got ${width}x${height}`);
    }
    this.spec = { width, height, boundary: 'torus' };
    this.decay = activityDecay ?? DEFAULT_ACTIVITY_DECAY;
    const n = width * height;
    this.current = new Uint8Array(n);
    this.next = new Uint8Array(n);
    this.age = new Uint16Array(n);
    this.activity = new Uint8Array(n);
  }

  get gen(): Generation {
    return this._gen;
  }

  get population(): number {
    return this._population;
  }

  private indexOf(x: number, y: number): number {
    const w = this.spec.width;
    const h = this.spec.height;
    return wrap(y, h) * w + wrap(x, w);
  }

  get(x: number, y: number): boolean {
    return this.current[this.indexOf(x, y)] === 1;
  }

  set(x: number, y: number, alive: boolean): void {
    const idx = this.indexOf(x, y);
    const nv = alive ? 1 : 0;
    if (this.current[idx] === nv) return;
    this.current[idx] = nv;
    this._population += nv === 1 ? 1 : -1;
    this.age[idx] = nv === 1 ? 1 : 0;
    this.activity[idx] = 255;
  }

  step(): Generation {
    const w = this.spec.width;
    const h = this.spec.height;
    const cur = this.current;
    const nxt = this.next;
    const age = this.age;
    const activity = this.activity;
    const decay = this.decay;
    let pop = 0;

    for (let y = 0; y < h; y++) {
      const yUp = y === 0 ? h - 1 : y - 1;
      const yDown = y === h - 1 ? 0 : y + 1;
      const rowUp = yUp * w;
      const row = y * w;
      const rowDown = yDown * w;

      // Interior columns: plain integer offsets, no wrap arithmetic.
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const n =
          cur[rowUp + x - 1]! + cur[rowUp + x]! + cur[rowUp + x + 1]! +
          cur[row + x - 1]! + cur[row + x + 1]! +
          cur[rowDown + x - 1]! + cur[rowDown + x]! + cur[rowDown + x + 1]!;
        const was = cur[idx]!;
        const nv = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        nxt[idx] = nv;
        if (nv === 1) {
          pop++;
          age[idx] = was === 1 ? (age[idx]! < MAX_AGE ? age[idx]! + 1 : MAX_AGE) : 1;
        } else {
          age[idx] = 0;
        }
        activity[idx] = nv !== was ? 255 : Math.floor(activity[idx]! * decay);
      }

      // Border column x = 0 (left neighbour wraps to x = w - 1).
      {
        const x = 0;
        const xL = w - 1;
        const xR = w === 1 ? 0 : 1;
        const idx = row + x;
        const n =
          cur[rowUp + xL]! + cur[rowUp + x]! + cur[rowUp + xR]! +
          cur[row + xL]! + cur[row + xR]! +
          cur[rowDown + xL]! + cur[rowDown + x]! + cur[rowDown + xR]!;
        const was = cur[idx]!;
        const nv = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        nxt[idx] = nv;
        if (nv === 1) {
          pop++;
          age[idx] = was === 1 ? (age[idx]! < MAX_AGE ? age[idx]! + 1 : MAX_AGE) : 1;
        } else {
          age[idx] = 0;
        }
        activity[idx] = nv !== was ? 255 : Math.floor(activity[idx]! * decay);
      }

      // Border column x = w - 1 (right neighbour wraps to x = 0). Skipped for
      // w === 1, where it is the same cell already handled above.
      if (w > 1) {
        const x = w - 1;
        const xL = x - 1;
        const xR = 0;
        const idx = row + x;
        const n =
          cur[rowUp + xL]! + cur[rowUp + x]! + cur[rowUp + xR]! +
          cur[row + xL]! + cur[row + xR]! +
          cur[rowDown + xL]! + cur[rowDown + x]! + cur[rowDown + xR]!;
        const was = cur[idx]!;
        const nv = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        nxt[idx] = nv;
        if (nv === 1) {
          pop++;
          age[idx] = was === 1 ? (age[idx]! < MAX_AGE ? age[idx]! + 1 : MAX_AGE) : 1;
        } else {
          age[idx] = 0;
        }
        activity[idx] = nv !== was ? 255 : Math.floor(activity[idx]! * decay);
      }
    }

    this.current = nxt;
    this.next = cur;
    this._population = pop;
    this._gen += 1;
    return this._gen;
  }

  snapshot(): Snapshot {
    return { gen: this._gen, bits: this.current.slice() };
  }

  restore(s: Snapshot): void {
    const n = this.spec.width * this.spec.height;
    if (s.bits.length !== n) {
      throw new Error(`restore: bits.length ${s.bits.length} !== width*height ${n}`);
    }
    this.current.set(s.bits);
    this._gen = s.gen;
    this.age.fill(0);
    this.activity.fill(0);
    let pop = 0;
    for (let i = 0; i < n; i++) {
      const alive = this.current[i] === 1;
      if (alive) {
        pop++;
        this.age[i] = 1;
      }
    }
    this._population = pop;
  }

  clone(): LifeEngine {
    const copy = new DenseTorusEngine({ width: this.spec.width, height: this.spec.height, activityDecay: this.decay });
    copy.current.set(this.current);
    copy.next.set(this.next);
    copy.age.set(this.age);
    copy.activity.set(this.activity);
    copy._gen = this._gen;
    copy._population = this._population;
    return copy;
  }

  ageAt(x: number, y: number): number {
    return this.age[this.indexOf(x, y)]!;
  }

  activityAt(x: number, y: number): number {
    return this.activity[this.indexOf(x, y)]! / 255;
  }

  forEachLive(rect: Rect, cb: (x: number, y: number) => void | boolean): void {
    const r = normalizeRect(rect);
    const w = this.spec.width;
    const h = this.spec.height;
    for (let j = 0; j < r.h; j++) {
      const wy = wrap(r.y + j, h);
      const rowBase = wy * w;
      for (let i = 0; i < r.w; i++) {
        const wx = wrap(r.x + i, w);
        if (this.current[rowBase + wx] === 1) {
          const res = cb(wx, wy);
          if (res === false) return;
        }
      }
    }
  }

  seed(rngSeed: number | string, density: number): void {
    const rng = makeRng(rngSeed);
    this._gen = 0;
    this.age.fill(0);
    this.activity.fill(0);
    let pop = 0;
    for (let i = 0; i < this.current.length; i++) {
      const alive = rng() < density;
      this.current[i] = alive ? 1 : 0;
      if (alive) {
        pop++;
        this.age[i] = 1;
      }
    }
    this._population = pop;
  }

  clear(): void {
    this.current.fill(0);
    this.next.fill(0);
    this.age.fill(0);
    this.activity.fill(0);
    this._gen = 0;
    this._population = 0;
  }

  stamp(p: StampPattern, x: number, y: number, transform: StampTransform): void {
    const t = transformPattern(p, transform);
    for (let j = 0; j < t.h; j++) {
      for (let i = 0; i < t.w; i++) {
        const alive = t.cells[j * t.w + i] === 1;
        this.set(x + i, y + j, alive);
      }
    }
  }

  region(rect: Rect): Uint8Array {
    const r = normalizeRect(rect);
    const w = this.spec.width;
    const h = this.spec.height;
    const out = new Uint8Array(r.w * r.h);
    for (let j = 0; j < r.h; j++) {
      const wy = wrap(r.y + j, h);
      const rowBase = wy * w;
      const outRow = j * r.w;
      for (let i = 0; i < r.w; i++) {
        const wx = wrap(r.x + i, w);
        out[outRow + i] = this.current[rowBase + wx]!;
      }
    }
    return out;
  }
}

/**
 * Factory for the default dense-array toroidal engine.
 */
export function createEngine(options: EngineOptions): LifeEngine {
  return new DenseTorusEngine(options);
}
