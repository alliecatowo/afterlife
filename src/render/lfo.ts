/**
 * Deterministic LFOs (low-frequency oscillators) for Art mode's "things will
 * shift as it goes" automation. Owned by the `render` agent (`src/render/**`).
 *
 * Every function here is PURE and takes wall-clock time (seconds) as an
 * explicit argument rather than accumulating a running phase — the renderer
 * calls `lfoValue(shape, tSeconds, ...)` fresh every frame with
 * `performance.now() / 1000`. This is deliberate: an accumulator
 * (`phase += rate * dt`) drifts under variable frame timing and is
 * impossible to unit-test without simulating a frame sequence. A pure
 * function of absolute time is trivially deterministic (same `t` always
 * yields the same value, whether it's the first frame evaluated or the
 * ten-thousandth) and cheap to test directly with plain numbers.
 */

export type LfoShape = 'sine' | 'triangle' | 'saw' | 'randomWalk';

export const LFO_SHAPES: readonly LfoShape[] = ['sine', 'triangle', 'saw', 'randomWalk'];

/** Wrap `x` into `[0, 1)`. */
function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * Cheap deterministic integer hash -> `[0, 1)`. Not cryptographic, just
 * well-mixed enough that adjacent integers don't correlate visibly. Used as
 * the value-noise lattice for `randomWalk` (see below) and reused by
 * `@/render/field.ts`'s procedural fields — kept here too (rather than a
 * shared import cycle) since it's a two-line pure primitive.
 */
export function hash1D(n: number, seed: number): number {
  let h = (n | 0) * 374761393 + (seed | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/**
 * Smooth 1D value noise: linearly interpolates the hash lattice at integer
 * points around `x`, then eases with a smoothstep so the result has no
 * visible kinks. Pure function of `x` — evaluating the same `x` twice always
 * returns the same value, so it can stand in for "a random walk" without
 * ever actually accumulating state (a real random walk drifts unboundedly
 * and can't be evaluated out-of-order or replayed for a given timestamp).
 */
export function smoothNoise1D(x: number, seed: number): number {
  const i0 = Math.floor(x);
  const i1 = i0 + 1;
  const t = x - i0;
  const a = hash1D(i0, seed);
  const b = hash1D(i1, seed);
  const s = t * t * (3 - 2 * t); // smoothstep
  return a + (b - a) * s;
}

function sineWave(phase01: number): number {
  return Math.sin(phase01 * Math.PI * 2);
}

function triangleWave(phase01: number): number {
  // 0 -> -1, 0.25 -> 0, 0.5 -> 1, 0.75 -> 0, back to -1 at 1.
  return 2 * Math.abs(2 * (phase01 - Math.floor(phase01 + 0.5))) - 1;
}

function sawWave(phase01: number): number {
  // Ramps -1 -> 1 across each cycle.
  return frac(phase01) * 2 - 1;
}

/**
 * Evaluate one LFO at absolute time `tSeconds`. Always returns a value in
 * `[-1, 1]` (undepthed, unshifted) — callers scale by their own `depth` and
 * add to a base parameter value. `rateHz` is cycles per second; `phase` is
 * an additional `[0, 1)` offset (useful for detuning several LFOs targeting
 * the same parameter). `seed` only affects `randomWalk` (distinguishes
 * multiple random-walk LFOs from tracking each other identically).
 */
export function lfoValue(
  shape: LfoShape,
  tSeconds: number,
  rateHz: number,
  phase = 0,
  seed = 0,
): number {
  const rate = Number.isFinite(rateHz) ? rateHz : 0;
  const phase01 = frac(tSeconds * rate + phase);
  switch (shape) {
    case 'sine': return sineWave(phase01);
    case 'triangle': return triangleWave(phase01);
    case 'saw': return sawWave(phase01);
    case 'randomWalk': {
      // Sampled at a coarser rate than a raw phase ramp so it reads as
      // drifting rather than buzzing at audio-ish rates; `rateHz` still
      // controls how quickly it wanders.
      return smoothNoise1D(tSeconds * rate + phase * 8, seed) * 2 - 1;
    }
    default: return 0;
  }
}

export const MIN_LFO_RATE_HZ = 0.01;
export const MAX_LFO_RATE_HZ = 4;
export const MIN_LFO_DEPTH = 0;
export const MAX_LFO_DEPTH = 1;

export function clampLfoRate(hz: number): number {
  return Math.min(MAX_LFO_RATE_HZ, Math.max(MIN_LFO_RATE_HZ, hz));
}

export function clampLfoDepth(depth: number): number {
  return Math.min(MAX_LFO_DEPTH, Math.max(MIN_LFO_DEPTH, depth));
}
