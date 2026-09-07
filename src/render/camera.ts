/**
 * 2D world camera. STUB — owned by the `render` agent (`src/render/**`).
 *
 * `x`/`y` are the WORLD-CELL coordinates at the centre of the viewport.
 * `scale` is device-independent pixels per world cell (> 0).
 */
import type { CellCoord } from '@/core/types';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** Clamp bounds for zoom, in pixels per cell. */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 64;

/** A camera the renderer owns and the UI drives. */
export interface CameraController {
  readonly camera: Readonly<Camera>;
  /** Absolute set; values are clamped to [MIN_SCALE, MAX_SCALE]. Emits `camera:changed`. */
  set(next: Partial<Camera>): void;
  /** Pan by a delta in SCREEN pixels (drag support). */
  panByScreen(dxPx: number, dyPx: number): void;
  /**
   * Zoom keeping the world point currently under `screenPx` pinned there.
   * `factor` > 1 zooms in.
   */
  zoomAt(screenPx: { x: number; y: number }, factor: number): void;
  /** Smoothly track a moving world point each frame until released. */
  follow(target: CellCoord | (() => CellCoord)): void;
  /** Stop following. No-op if not following. */
  releaseFollow(): void;
  /** Fit a rect of world cells into the current viewport with padding. */
  fit(rect: { x: number; y: number; w: number; h: number }, paddingPx?: number): void;
}

export function createCamera(_initial?: Partial<Camera>): CameraController {
  throw new Error('not implemented');
}
