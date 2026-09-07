/**
 * Time Sculpture — a 3D extrusion of REAL recorded history. STUB, owned by the
 * `sculpture` agent (`src/sculpture/**`). Built with @react-three/fiber and
 * drei's OrbitControls, mounted into `#sculpture-canvas`.
 *
 * Geometry: slice `k` of `slices` is the world rect at generation
 * `fromGen + k`, drawn at z = k * spacing. Live cells become instanced boxes on
 * a single InstancedMesh (one per slice at most — never one mesh per cell).
 * Colour ramps along z with `--accent-time`.
 *
 * The slices come from `TimelineStore.sliceStack()` — actual replayed history,
 * never a re-simulation from scratch.
 */
import type { Generation, Rect } from '@/core/types';

/** Hard cap; beyond this the caller must subsample. */
export const MAX_SLICES = 256;

export interface SculptureProps {
  rect: Rect;
  fromGen: Generation;
  toGen: Generation;
  /** One row-major `rect.w * rect.h` buffer per generation, ascending. */
  slices: Uint8Array[];
  onSliceSelected?: (gen: Generation) => void;
}

export interface TimeSculpture {
  /** Mount and populate. Safe to call again with new data (replaces contents). */
  open(rect: Rect, fromGen: Generation, toGen: Generation, slices: Uint8Array[]): void;
  /** Unmount and free geometry/materials/textures. */
  close(): void;
  /**
   * Move the highlighted cutting plane. `t` in [0, 1] maps linearly across
   * `[fromGen, toGen]`. Slices behind the plane fade to `--ink-600`.
   */
  setSlicePlane(t: number): void;
  /** How many slices behind the plane stay visible. 0 = only the plane. */
  setHistoryDepth(n: number): void;
  /** Nudge the orbit camera. Angles in radians, `dolly` is a scale factor. */
  orbit(deltaAzimuth: number, deltaPolar: number, dolly?: number): void;
  /**
   * Register a click handler; receives the Generation of the picked slice.
   * The UI turns that into `bus.emit('sculpture:sliceSelected', { gen })`.
   * Returns an unsubscribe function.
   */
  onSliceSelected(cb: (gen: Generation) => void): () => void;
}

export function createSculpture(_host: HTMLElement): TimeSculpture {
  throw new Error('not implemented');
}
