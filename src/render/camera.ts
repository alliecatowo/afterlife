/**
 * 2D world camera. Owned by the `render` agent (`src/render/**`).
 *
 * `x`/`y` are the WORLD-CELL coordinates at the centre of the viewport.
 * `scale` is device-independent (CSS) pixels per world cell (> 0).
 *
 * This module never mutates world/engine state — it only tracks where the
 * viewport is looking. All camera moves emit `camera:changed` on the bus
 * (high-frequency signal, per ARCHITECTURE.md); nothing here calls
 * React/Zustand setState.
 */
import type { CellCoord } from '@/core/types';
import { bus } from '@/ui/bus';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
}

/** Clamp bounds for zoom, in CSS pixels per cell. */
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 40;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Pure cursor-centred zoom. Returns a NEW camera such that the world point
 * currently under screen point (screenX, screenY) stays under that exact
 * screen point after `scale` changes by `factor` (> 1 zooms in). Never
 * mutates `cam`. This is the invariant the render agent must get pixel-perfect.
 */
export function zoomAt(
  cam: Readonly<Camera>,
  screenX: number,
  screenY: number,
  factor: number,
  viewport: Readonly<Viewport>,
): Camera {
  const newScale = clampScale(cam.scale * factor);
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const worldX = cam.x + (screenX - cx) / cam.scale;
  const worldY = cam.y + (screenY - cy) / cam.scale;
  if (newScale === cam.scale) return { x: cam.x, y: cam.y, scale: cam.scale };
  return {
    x: worldX - (screenX - cx) / newScale,
    y: worldY - (screenY - cy) / newScale,
    scale: newScale,
  };
}

/**
 * Critically-damped smoothing of one scalar toward `target` (Unity-style
 * "SmoothDamp" — Game Programming Gems 4 closed-form approximation of a
 * critically damped spring). `velRef` carries per-axis velocity state
 * between calls.
 */
export function smoothDamp(
  current: number,
  target: number,
  velRef: { v: number },
  smoothTimeSeconds: number,
  dtSeconds: number,
): number {
  const st = Math.max(0.0001, smoothTimeSeconds);
  const dt = Math.max(0, dtSeconds);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const diff = current - target;
  const temp = (velRef.v + omega * diff) * dt;
  velRef.v = (velRef.v - omega * temp) * exp;
  return target + (diff + temp) * exp;
}

/** A camera the renderer owns and the UI drives. */
export interface CameraController {
  readonly camera: Readonly<Camera>;
  readonly viewport: Readonly<Viewport>;
  /** True while `follow()` is actively easing toward a target. */
  readonly following: boolean;

  /** CSS-pixel size of the canvas this camera is framing. Call on resize. */
  setViewport(width: number, height: number): void;

  /** Absolute set; values are clamped to [MIN_SCALE, MAX_SCALE]. Emits `camera:changed`.
   *  Releases `follow()`, since this is a manual override. */
  set(next: Partial<Camera>): void;

  /** Pan by a delta in SCREEN pixels (drag support). Releases `follow()`. */
  panByScreen(dxPx: number, dyPx: number): void;

  /**
   * Zoom keeping the world point currently under `screenPx` pinned there.
   * `factor` > 1 zooms in. Releases `follow()`.
   */
  zoomAt(screenPx: { x: number; y: number }, factor: number): void;

  /** Smoothly track a moving world point each frame until released. */
  follow(target: CellCoord | (() => CellCoord)): void;

  /** Stop following. No-op if not following. Called automatically by any
   *  user-initiated pan/zoom/drag (`set`, `panByScreen`, `zoomAt`, `fit`). */
  releaseFollow(): void;

  /** Fit a rect of world cells into the current viewport with padding. Releases `follow()`. */
  fit(rect: { x: number; y: number; w: number; h: number }, paddingPx?: number): void;

  /** Advance follow easing. Call once per animation frame with elapsed seconds.
   *  No-op unless `follow()` is active. */
  tick(dtSeconds: number): void;
}

const DEFAULT_FOLLOW_SMOOTH_TIME = 0.28; // seconds; critically damped

class CameraControllerImpl implements CameraController {
  #camera: Camera;
  #viewport: Viewport = { width: 1, height: 1 };
  #followFn: (() => CellCoord) | null = null;
  #velX = { v: 0 };
  #velY = { v: 0 };

  constructor(initial?: Partial<Camera>) {
    this.#camera = {
      x: initial?.x ?? 0,
      y: initial?.y ?? 0,
      scale: clampScale(initial?.scale ?? 8),
    };
  }

  get camera(): Readonly<Camera> {
    return this.#camera;
  }

  get viewport(): Readonly<Viewport> {
    return this.#viewport;
  }

  get following(): boolean {
    return this.#followFn !== null;
  }

  setViewport(width: number, height: number): void {
    this.#viewport = { width: Math.max(1, width), height: Math.max(1, height) };
  }

  #emit(): void {
    bus.emit('camera:changed', { x: this.#camera.x, y: this.#camera.y, scale: this.#camera.scale });
  }

  set(next: Partial<Camera>): void {
    this.releaseFollow();
    this.#camera = {
      x: next.x ?? this.#camera.x,
      y: next.y ?? this.#camera.y,
      scale: clampScale(next.scale ?? this.#camera.scale),
    };
    this.#emit();
  }

  panByScreen(dxPx: number, dyPx: number): void {
    this.releaseFollow();
    this.#camera = {
      x: this.#camera.x - dxPx / this.#camera.scale,
      y: this.#camera.y - dyPx / this.#camera.scale,
      scale: this.#camera.scale,
    };
    this.#emit();
  }

  zoomAt(screenPx: { x: number; y: number }, factor: number): void {
    this.releaseFollow();
    this.#camera = zoomAt(this.#camera, screenPx.x, screenPx.y, factor, this.#viewport);
    this.#emit();
  }

  follow(target: CellCoord | (() => CellCoord)): void {
    this.#followFn = typeof target === 'function' ? target : () => target;
    this.#velX.v = 0;
    this.#velY.v = 0;
  }

  releaseFollow(): void {
    this.#followFn = null;
  }

  fit(rect: { x: number; y: number; w: number; h: number }, paddingPx = 32): void {
    this.releaseFollow();
    const availW = Math.max(1, this.#viewport.width - paddingPx * 2);
    const availH = Math.max(1, this.#viewport.height - paddingPx * 2);
    const scale = clampScale(Math.min(availW / Math.max(rect.w, 1e-6), availH / Math.max(rect.h, 1e-6)));
    this.#camera = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, scale };
    this.#emit();
  }

  tick(dtSeconds: number): void {
    if (!this.#followFn) return;
    const target = this.#followFn();
    const x = smoothDamp(this.#camera.x, target.x, this.#velX, DEFAULT_FOLLOW_SMOOTH_TIME, dtSeconds);
    const y = smoothDamp(this.#camera.y, target.y, this.#velY, DEFAULT_FOLLOW_SMOOTH_TIME, dtSeconds);
    this.#camera = { x, y, scale: this.#camera.scale };
    this.#emit();
  }
}

export function createCamera(initial?: Partial<Camera>): CameraController {
  return new CameraControllerImpl(initial);
}
