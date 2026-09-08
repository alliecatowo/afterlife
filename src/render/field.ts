/**
 * The Art mode "modulation field" — a source sampled per cell in WORLD space
 * that drives appearance (glyph choice, hue, brightness, jitter). Owned by
 * the `render` agent (`src/render/**`).
 *
 * Everything in this file is PURE: given world coordinates and a time value,
 * it returns a number. It never touches the simulation's live/dead bits —
 * the field only ever feeds `renderer.ts`'s COSMETIC choices, exactly like
 * every existing colour lens. Image/video/webcam capture (genuinely impure:
 * `<video>` elements, `getUserMedia`, canvas snapshots) lives in
 * `./mediaField.ts`; this module only knows how to bilinear-sample whatever
 * luminance GRID that impure code hands it, so the sampling maths itself
 * stays unit-testable with a plain `Float32Array` and no DOM at all.
 */

import { hash1D, smoothNoise1D } from './lfo';

export type FieldSourceId =
  | 'none' | 'perlin' | 'simplex' | 'radial' | 'linear' | 'plasma' | 'image' | 'video' | 'webcam';

export const FIELD_SOURCES: readonly FieldSourceId[] = [
  'none', 'perlin', 'simplex', 'radial', 'linear', 'plasma', 'image', 'video', 'webcam',
];

/** A sampled external grid (from an image/video/webcam frame) — plain data,
 *  no DOM reference, so `sampleField` can be tested against a hand-built one. */
export interface SampledGrid {
  data: Float32Array; // luminance 0..1, row-major
  w: number;
  h: number;
}

function wrap01(v: number): number {
  const f = v - Math.floor(v);
  return f < 0 ? f + 1 : f;
}

/** Bilinear-sample a row-major grid at normalised `(u, v)`, wrapping at the
 *  edges (matches the world's own toroidal wrap, so an image/video field
 *  tiles seamlessly rather than clamping/streaking at its border). */
export function sampleGridBilinear(grid: SampledGrid, u: number, v: number): number {
  const { data, w, h } = grid;
  if (w <= 0 || h <= 0) return 0;
  const fx = wrap01(u) * w - 0.5;
  const fy = wrap01(v) * h - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const wrapIdx = (i: number, n: number) => ((i % n) + n) % n;
  const x0w = wrapIdx(x0, w);
  const x1w = wrapIdx(x0 + 1, w);
  const y0w = wrapIdx(y0, h);
  const y1w = wrapIdx(y0 + 1, h);
  const p00 = data[y0w * w + x0w] ?? 0;
  const p10 = data[y0w * w + x1w] ?? 0;
  const p01 = data[y1w * w + x0w] ?? 0;
  const p11 = data[y1w * w + x1w] ?? 0;
  const top = p00 + (p10 - p00) * tx;
  const bottom = p01 + (p11 - p01) * tx;
  return top + (bottom - top) * ty;
}

// ---------------------------------------------------------------------------
// Procedural sources. Each takes world-space (already scale/offset/rotation
// transformed) coordinates plus a time value and returns a value in [0, 1].
// All are deterministic pure functions of their inputs — no `Math.random()`
// anywhere — so a given (x, y, t) always paints the same value, and replay/
// export/screenshot tests are reproducible.
// ---------------------------------------------------------------------------

function hash2D(x: number, y: number, seed: number): number {
  return hash1D(Math.floor(x) * 668265263 + Math.floor(y) * 374761393, seed);
}

/** Smooth 2D value noise (bilinear-interpolated integer hash lattice, eased
 *  with a smoothstep). Not literal Perlin/simplex noise — a lighter, equally
 *  smooth stand-in with no dependency — but produces the same kind of
 *  organic, non-repeating blobs the "acid image behind it" brief asks for. */
export function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const h00 = hash2D(x0, y0, seed);
  const h10 = hash2D(x0 + 1, y0, seed);
  const h01 = hash2D(x0, y0 + 1, seed);
  const h11 = hash2D(x0 + 1, y0 + 1, seed);
  const top = h00 + (h10 - h00) * sx;
  const bottom = h01 + (h11 - h01) * sx;
  return top + (bottom - top) * sy;
}

/** Two-octave fractal sum of `valueNoise2D` — a busier, more turbulent
 *  texture than the single-octave `perlin` option, standing in for
 *  "simplex" in the source picker (a genuinely different visual character,
 *  not a relabelled duplicate). */
export function fractalNoise2D(x: number, y: number, seed: number): number {
  const a = valueNoise2D(x, y, seed);
  const b = valueNoise2D(x * 2.13 + 17.1, y * 2.13 - 9.7, seed + 1);
  return Math.min(1, Math.max(0, a * 0.65 + b * 0.35));
}

export function radialField(x: number, y: number, cx: number, cy: number, radius: number): number {
  const d = Math.hypot(x - cx, y - cy) / Math.max(1e-6, radius);
  return Math.max(0, 1 - d);
}

export function linearField(x: number, y: number, angleDeg: number): number {
  const a = (angleDeg * Math.PI) / 180;
  const proj = x * Math.cos(a) + y * Math.sin(a);
  return wrap01(proj * 0.05);
}

/** A classic sum-of-sines "plasma" texture, animated by `t` (seconds). */
export function plasmaField(x: number, y: number, t: number, seed: number): number {
  const s1 = Math.sin(x * 0.08 + t * 0.6 + seed);
  const s2 = Math.sin(y * 0.08 - t * 0.4 + seed * 1.3);
  const s3 = Math.sin((x + y) * 0.06 + t * 0.25);
  const s4 = Math.sin(Math.hypot(x, y) * 0.09 - t * 0.5);
  return (s1 + s2 + s3 + s4 + 4) / 8;
}

export interface FieldTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
}

/** Apply the field's own scale/offset/rotation to a world coordinate before
 *  sampling — this is what the field's own LFO-driven "pan/zoom/spin"
 *  modulation acts on, independent of the camera. */
export function transformFieldCoord(x: number, y: number, t: FieldTransform): { x: number; y: number } {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = x * t.scale + t.offsetX;
  const sy = y * t.scale + t.offsetY;
  return { x: sx * cos - sy * sin, y: sx * sin + sy * cos };
}

export interface FieldSampleParams {
  source: FieldSourceId;
  seed: number;
  transform: FieldTransform;
  grid?: SampledGrid | null;
}

/**
 * Sample the configured field at world coordinate `(wx, wy)` and time
 * `tSeconds`. Always returns a finite value in `[0, 1]`; `'none'` and a
 * missing `image`/`video`/`webcam` grid both return `0.5` (a neutral
 * midpoint) rather than throwing, so a renderer that samples this every
 * cell never needs its own try/catch.
 */
export function sampleField(params: FieldSampleParams, wx: number, wy: number, tSeconds: number): number {
  const { x, y } = transformFieldCoord(wx, wy, params.transform);
  switch (params.source) {
    case 'none': return 0.5;
    case 'perlin': return valueNoise2D(x * 0.15, y * 0.15, params.seed);
    case 'simplex': return fractalNoise2D(x * 0.15, y * 0.15, params.seed);
    case 'radial': return radialField(x, y, 0, 0, 40);
    case 'linear': return linearField(x, y, (params.seed * 37) % 360);
    case 'plasma': return plasmaField(x, y, tSeconds, params.seed);
    case 'image':
    case 'video':
    case 'webcam': {
      if (!params.grid) return 0.5;
      // A gentle fixed-frequency mapping from world cells to the sampled
      // grid's UV space, wrapping like every other field — an image tiles
      // across the torus instead of being pinned to one patch of it.
      const u = (x * 0.02) % 1;
      const v = (y * 0.02) % 1;
      return Math.min(1, Math.max(0, sampleGridBilinear(params.grid, u, v)));
    }
    default: return 0.5;
  }
}

/** Deterministic "does this field, on its own, change over time" check —
 *  used by the renderer to decide whether Art mode needs to keep redrawing
 *  every frame even when nothing else on screen changed. Procedural fields
 *  that don't reference `t` (perlin/simplex/radial/linear/none) are static;
 *  `plasma` and the three media sources are not. */
export function isFieldAnimated(source: FieldSourceId): boolean {
  return source === 'plasma' || source === 'video' || source === 'webcam';
}

/** Re-exported for callers that only need the smooth-noise primitive
 *  without pulling in the LFO vocabulary. */
export { smoothNoise1D };
