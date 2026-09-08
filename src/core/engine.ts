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
 *  - `hue` / `species`: cosmetic colour state for the "lineage" family of
 *    render lenses (see `@/core/lineage.ts` for the full rulebook). Neither
 *    is ever read by `step()`'s B3/S23 decision — colour rides along AFTER
 *    the alive/dead outcome is final, never influences it. `hue` is a
 *    continuous degree value blended (circular mean) from a newborn's three
 *    parents; `species` is a discrete 1..4 value chosen by the classic
 *    Immigration/QuadLife majority-of-three rule. Survivors keep both
 *    unchanged; death zeroes both.
 *
 * `snapshot()` / `restore()` only round-trip `{ gen, bits }` (see `Snapshot` in
 * `types.ts`) — `bits` is a fresh row-major `Uint8Array` copy, one byte per
 * cell, `1 = alive`, this is the entire encoding. `age`/`activity`/`hue`/
 * `species` are cosmetic per-lens data, not part of the deterministic world
 * state, and are reset on `restore()` to a deterministic position-derived
 * default (see `regionHue`/`regionSpecies` in `@/core/lineage.ts`). Unlike
 * `age` (which self-corrects as replay steps forward, since true age is
 * exactly "steps since restore + whatever `restore()` set"), a colour value
 * belonging to a long-lived SURVIVOR never gets recomputed again until that
 * cell dies and is reborn — so a flat post-restore default would NOT be
 * corrected by replay alone. `snapshotColors()`/`restoreColors()` exist so
 * `history.ts` can carry the true colour state through keyframes/branches
 * and get it bit-exact too; see that module's doc.
 */

import { makeRng } from './rng';
import { circularMean3, quadSpeciesFromParents, regionHue, regionSpecies, spontaneousHue, spontaneousSpecies } from './lineage';
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
   * Continuous lineage hue in degrees [0, 360). Meaningless (but always 0,
   * never stale garbage) when the cell is dead. See `@/core/lineage.ts`.
   * Used by the 'lineage' lens.
   */
  hueAt(x: number, y: number): number;

  /**
   * Discrete Immigration/QuadLife species: 0 = dead/none, else 1..4. See
   * `@/core/lineage.ts`. Used by the 'immigration' (coarsened to 2 buckets)
   * and 'quadlife' (full 4-colour) lenses.
   */
  speciesAt(x: number, y: number): number;

  /**
   * Count of live neighbours (0..8), wrapping toroidally. Purely derived
   * from the current bits — nothing to snapshot. Used by the 'neighbors' and
   * 'velocity' lenses. Not on the `step()` hot path (that loop tracks the sum
   * inline for performance); this is a convenience for render/tests that
   * doesn't need to be as fast since it's only ever called for cells inside
   * the visible viewport.
   */
  liveNeighborCount(x: number, y: number): number;

  /**
   * Fresh copies of the cosmetic colour buffers, for `history.ts` to fold
   * into a keyframe alongside the bits `Snapshot`. See the module doc for
   * why colour needs its own keyframe rather than being re-derivable from
   * `restore()` + replay alone.
   */
  snapshotColors(): ColorSnapshot;

  /**
   * Replace the colour buffers in place. `hue.length`/`species.length` must
   * equal `spec.width * spec.height` or this throws, matching `restore()`'s
   * validation style. Never mutates `bits`/`gen`/`age`/`activity`.
   */
  restoreColors(c: ColorSnapshot): void;

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
   * Resets `gen` to 0 and clears age/activity/hue/species.
   */
  seed(rngSeed: number | string, density: number): void;

  /** Kill everything. Resets `gen` to 0 and clears age/activity/hue/species. */
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

/**
 * The cosmetic colour buffers, snapshotted/restored as a pair (never split)
 * so a keyframe's hue and species always agree with each other. See the
 * module doc and `@/core/lineage.ts`.
 */
export interface ColorSnapshot {
  /** Degrees [0, 360), one per cell, row-major. 0 for dead cells. */
  hue: Float32Array;
  /** 0 (dead/none) or 1..4, one per cell, row-major. */
  species: Uint8Array;
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
  private hue: Float32Array;
  private species: Uint8Array;
  /** Reused scratch buffer for gathering a birth's 3 parent indices — avoids
   *  an array allocation per birth on the `step()` hot path. */
  private readonly parentScratch = new Int32Array(3);

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
    this.hue = new Float32Array(n);
    this.species = new Uint8Array(n);
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
    if (nv === 1) {
      // Spontaneous creation (a direct edit or `stamp()`) has no simulated
      // parents to inherit from — assign a deterministic starter colour from
      // position + the current generation (see `@/core/lineage.ts`), so
      // replaying the same `EditOp` at the same generation always reproduces
      // the same colour.
      this.hue[idx] = spontaneousHue(x, y, this._gen);
      this.species[idx] = spontaneousSpecies(x, y, this._gen);
    } else {
      this.hue[idx] = 0;
      this.species[idx] = 0;
    }
  }

  /**
   * Birth-only colour bookkeeping. `i0..i7` are the 8 neighbour buffer
   * indices already read by the caller for the B3/S23 sum, `v0..v7` their
   * `cur[]` values (0/1) at those same indices — a birth always has exactly
   * 3 alive among them (`n === 3` is `step()`'s own birth precondition, and
   * the only place this is called from). Takes 16 scalar args rather than
   * two arrays deliberately: this runs once per BIRTH, which in a dense
   * random soup's early generations can be a large fraction of a 512x512
   * world's cells, and array-literal allocation there was measurably
   * wasteful GC pressure on the `step()` hot path. Reads `hue`/`species` at
   * the 3 alive neighbours found and writes the newborn's blended hue /
   * majority-vote species at `idx`. Pure bookkeeping — this NEVER
   * influences `nv` (already decided by the caller); colour rides along
   * strictly after the fact. See `@/core/lineage.ts`.
   */
  private inheritColor(
    idx: number,
    i0: number, i1: number, i2: number, i3: number, i4: number, i5: number, i6: number, i7: number,
    v0: number, v1: number, v2: number, v3: number, v4: number, v5: number, v6: number, v7: number,
  ): void {
    const scratch = this.parentScratch;
    let pc = 0;
    if (v0 === 1) scratch[pc++] = i0;
    if (pc < 3 && v1 === 1) scratch[pc++] = i1;
    if (pc < 3 && v2 === 1) scratch[pc++] = i2;
    if (pc < 3 && v3 === 1) scratch[pc++] = i3;
    if (pc < 3 && v4 === 1) scratch[pc++] = i4;
    if (pc < 3 && v5 === 1) scratch[pc++] = i5;
    if (pc < 3 && v6 === 1) scratch[pc++] = i6;
    if (pc < 3 && v7 === 1) scratch[pc++] = i7;
    const p0 = scratch[0]!;
    const p1 = scratch[1]!;
    const p2 = scratch[2]!;
    this.hue[idx] = circularMean3(this.hue[p0]!, this.hue[p1]!, this.hue[p2]!);
    this.species[idx] = quadSpeciesFromParents(this.species[p0]!, this.species[p1]!, this.species[p2]!);
  }

  step(): Generation {
    const w = this.spec.width;
    const h = this.spec.height;
    const cur = this.current;
    const nxt = this.next;
    const age = this.age;
    const activity = this.activity;
    const hue = this.hue;
    const species = this.species;
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
        const iUL = rowUp + x - 1, iU = rowUp + x, iUR = rowUp + x + 1;
        const iL = row + x - 1, iR = row + x + 1;
        const iDL = rowDown + x - 1, iD = rowDown + x, iDR = rowDown + x + 1;
        const vUL = cur[iUL]!, vU = cur[iU]!, vUR = cur[iUR]!;
        const vL = cur[iL]!, vR = cur[iR]!;
        const vDL = cur[iDL]!, vD = cur[iD]!, vDR = cur[iDR]!;
        const n = vUL + vU + vUR + vL + vR + vDL + vD + vDR;
        const was = cur[idx]!;
        const nv = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        nxt[idx] = nv;
        if (nv === 1) {
          pop++;
          if (was === 1) {
            age[idx] = age[idx]! < MAX_AGE ? age[idx]! + 1 : MAX_AGE;
          } else {
            age[idx] = 1;
            this.inheritColor(
              idx,
              iUL, iU, iUR, iL, iR, iDL, iD, iDR,
              vUL, vU, vUR, vL, vR, vDL, vD, vDR,
            );
          }
        } else {
          age[idx] = 0;
          hue[idx] = 0;
          species[idx] = 0;
        }
        activity[idx] = nv !== was ? 255 : Math.floor(activity[idx]! * decay);
      }

      // Border column x = 0 (left neighbour wraps to x = w - 1).
      {
        const x = 0;
        const xL = w - 1;
        const xR = w === 1 ? 0 : 1;
        const idx = row + x;
        const iUL = rowUp + xL, iU = rowUp + x, iUR = rowUp + xR;
        const iL = row + xL, iR = row + xR;
        const iDL = rowDown + xL, iD = rowDown + x, iDR = rowDown + xR;
        const vUL = cur[iUL]!, vU = cur[iU]!, vUR = cur[iUR]!;
        const vL = cur[iL]!, vR = cur[iR]!;
        const vDL = cur[iDL]!, vD = cur[iD]!, vDR = cur[iDR]!;
        const n = vUL + vU + vUR + vL + vR + vDL + vD + vDR;
        const was = cur[idx]!;
        const nv = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        nxt[idx] = nv;
        if (nv === 1) {
          pop++;
          if (was === 1) {
            age[idx] = age[idx]! < MAX_AGE ? age[idx]! + 1 : MAX_AGE;
          } else {
            age[idx] = 1;
            this.inheritColor(
              idx,
              iUL, iU, iUR, iL, iR, iDL, iD, iDR,
              vUL, vU, vUR, vL, vR, vDL, vD, vDR,
            );
          }
        } else {
          age[idx] = 0;
          hue[idx] = 0;
          species[idx] = 0;
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
        const iUL = rowUp + xL, iU = rowUp + x, iUR = rowUp + xR;
        const iL = row + xL, iR = row + xR;
        const iDL = rowDown + xL, iD = rowDown + x, iDR = rowDown + xR;
        const vUL = cur[iUL]!, vU = cur[iU]!, vUR = cur[iUR]!;
        const vL = cur[iL]!, vR = cur[iR]!;
        const vDL = cur[iDL]!, vD = cur[iD]!, vDR = cur[iDR]!;
        const n = vUL + vU + vUR + vL + vR + vDL + vD + vDR;
        const was = cur[idx]!;
        const nv = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        nxt[idx] = nv;
        if (nv === 1) {
          pop++;
          if (was === 1) {
            age[idx] = age[idx]! < MAX_AGE ? age[idx]! + 1 : MAX_AGE;
          } else {
            age[idx] = 1;
            this.inheritColor(
              idx,
              iUL, iU, iUR, iL, iR, iDL, iD, iDR,
              vUL, vU, vUR, vL, vR, vDL, vD, vDR,
            );
          }
        } else {
          age[idx] = 0;
          hue[idx] = 0;
          species[idx] = 0;
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
    const w = this.spec.width;
    let pop = 0;
    for (let i = 0; i < n; i++) {
      const alive = this.current[i] === 1;
      if (alive) {
        pop++;
        this.age[i] = 1;
        // Best-effort deterministic default — true history (if any) is
        // restored on top of this by `history.ts` via `restoreColors()`
        // immediately after calling this method. See the module doc.
        const x = i % w;
        const y = (i - x) / w;
        this.hue[i] = regionHue(x, y);
        this.species[i] = regionSpecies(x, y);
      } else {
        this.hue[i] = 0;
        this.species[i] = 0;
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
    copy.hue.set(this.hue);
    copy.species.set(this.species);
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

  hueAt(x: number, y: number): number {
    return this.hue[this.indexOf(x, y)]!;
  }

  speciesAt(x: number, y: number): number {
    return this.species[this.indexOf(x, y)]!;
  }

  liveNeighborCount(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.current[this.indexOf(x + dx, y + dy)] === 1) n++;
      }
    }
    return n;
  }

  snapshotColors(): ColorSnapshot {
    return { hue: this.hue.slice(), species: this.species.slice() };
  }

  restoreColors(c: ColorSnapshot): void {
    const n = this.spec.width * this.spec.height;
    if (c.hue.length !== n || c.species.length !== n) {
      throw new Error(
        `restoreColors: buffer length mismatch (hue=${c.hue.length}, species=${c.species.length}) !== width*height ${n}`,
      );
    }
    this.hue.set(c.hue);
    this.species.set(c.species);
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
    const w = this.spec.width;
    let pop = 0;
    // IMPORTANT: exactly one `rng()` draw per cell, in row-major order, and
    // ONLY for the alive/dead decision — this is the entire determinism
    // contract existing golden seed tests rely on. Colour is assigned from a
    // position hash below, deliberately NOT drawn from `rng`, so adding it
    // can never shift which cells end up alive for a given seed.
    for (let i = 0; i < this.current.length; i++) {
      const alive = rng() < density;
      this.current[i] = alive ? 1 : 0;
      if (alive) {
        pop++;
        this.age[i] = 1;
        const x = i % w;
        const y = (i - x) / w;
        this.hue[i] = regionHue(x, y);
        this.species[i] = regionSpecies(x, y);
      } else {
        this.hue[i] = 0;
        this.species[i] = 0;
      }
    }
    this._population = pop;
  }

  clear(): void {
    this.current.fill(0);
    this.next.fill(0);
    this.age.fill(0);
    this.activity.fill(0);
    this.hue.fill(0);
    this.species.fill(0);
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
