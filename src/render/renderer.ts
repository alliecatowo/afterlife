/**
 * Canvas2D world renderer. STUB — owned by the `render` agent (`src/render/**`).
 * Reads the engine; never mutates it. Colours come from `src/styles/tokens.css`
 * custom properties, resolved once per lens change.
 */
import type { LifeEngine } from '@/core/engine';
import type {
  CellCoord, Rect, RenderLens, RenderOverlays, StampPattern, StampTransform,
} from '@/core/types';
import type { Camera } from './camera';

export interface ExportImageOptions {
  /** Multiplier over CSS pixel size. Default 2. */
  scale?: number;
  /** Include the HUD-free world only (true) or overlays too (false). Default false. */
  bare?: boolean;
  mimeType?: 'image/png' | 'image/webp';
  /** Burn a small caption (branch + generation) into the corner. Default true. */
  caption?: boolean;
}

export interface WorldRenderer {
  /** Bind to a canvas; sets up the DPR-aware backing store. Idempotent. */
  attach(canvas: HTMLCanvasElement): void;
  setCamera(camera: Camera): void;
  setLens(lens: RenderLens): void;
  /** Draw one frame. Cheap enough to call every rAF at 60fps for 512x512 worlds. */
  draw(engine: LifeEngine, overlays?: RenderOverlays): void;
  /** Re-read the canvas' CSS size and devicePixelRatio. Call on resize. */
  resize(): void;
  /** CSS-pixel canvas coords -> fractional world cell coords. */
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** World cell coords -> CSS-pixel canvas coords. */
  worldToScreen(x: number, y: number): { x: number; y: number };
  /** Translucent pattern preview under the cursor. Pass null to clear. */
  setGhost(pattern: StampPattern | null, x: number, y: number, transform: StampTransform): void;
  setSelection(rect: Rect | null): void;
  /** Row-major diff cells over the last selection rect. 0 same / 1 A-only / 2 B-only. */
  setDiffOverlay(cells: Uint8Array | null): void;
  exportImage(opts?: ExportImageOptions): Promise<Blob>;
  /** Release GPU/canvas resources and listeners. */
  dispose(): void;
}

export function createRenderer(): WorldRenderer {
  throw new Error('not implemented');
}

/** Convenience: cell under a screen point, floored. */
export function cellAt(r: WorldRenderer, px: number, py: number): CellCoord {
  const w = r.screenToWorld(px, py);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}
