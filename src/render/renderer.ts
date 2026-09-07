/**
 * Canvas2D world renderer. Owned by the `render` agent (`src/render/**`).
 * Reads the engine; never mutates it. Colours come from `src/styles/tokens.css`
 * custom properties, resolved once at `attach()` (token values are static;
 * only which lens is active changes at runtime).
 *
 * Two-path LOD strategy (see `ZOOM_LOD_THRESHOLD`):
 *  - Zoomed IN (scale >= ZOOM_LOD_THRESHOLD px/cell): a 1-pixel-per-cell
 *    `ImageData` covering only the visible world rect, blitted with
 *    `imageSmoothingEnabled = false` for crisp cells.
 *  - Zoomed OUT (scale < ZOOM_LOD_THRESHOLD px/cell): a coverage buffer sized
 *    to the on-screen footprint of the visible rect (so each output pixel
 *    aggregates several world cells), mapped through a curve that keeps
 *    sparse structures faintly visible instead of vanishing.
 */
import type { LifeEngine } from '@/core/engine';
import { transformPattern, wrap } from '@/core/engine';
import type {
  CellCoord, Rect, RenderLens, RenderOverlays, StampPattern, StampTransform,
} from '@/core/types';
import type { Camera, Viewport } from './camera';
import { resolveToken, withAlpha, type TokenColor } from './color';

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
  /** Show/hide the world grid when the zoom level allows (default true). */
  setShowGrid(show: boolean): void;
  /** Current CSS-pixel viewport size, for wiring the camera controller. */
  readonly viewport: Readonly<Viewport>;
  exportImage(opts?: ExportImageOptions): Promise<Blob>;
  /** Release GPU/canvas resources and listeners. */
  dispose(): void;
}

/** Below this CSS px/cell, switch from crisp per-cell rendering to aggregated coverage. */
export const ZOOM_LOD_THRESHOLD = 3;
/** Grid hairlines only appear once cells are large enough to read. */
export const GRID_MIN_SCALE = 8;
/** A stronger rule line every N cells, for orientation. */
export const GRID_MAJOR_EVERY = 10;
/** Generations to reach full intensity on the age ramp. */
export const AGE_RAMP_GENERATIONS = 32;

/** Pure: CSS-pixel screen point -> fractional world coords. No canvas needed — testable in isolation. */
export function projectScreenToWorld(
  camera: Readonly<Camera>,
  viewport: Readonly<Viewport>,
  px: number,
  py: number,
): { x: number; y: number } {
  return {
    x: camera.x + (px - viewport.width / 2) / camera.scale,
    y: camera.y + (py - viewport.height / 2) / camera.scale,
  };
}

/** Pure: world coords -> CSS-pixel screen point. Exact inverse of `projectScreenToWorld`. */
export function projectWorldToScreen(
  camera: Readonly<Camera>,
  viewport: Readonly<Viewport>,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - camera.x) * camera.scale + viewport.width / 2,
    y: (y - camera.y) * camera.scale + viewport.height / 2,
  };
}

interface GhostState {
  pattern: StampPattern;
  x: number;
  y: number;
  transform: StampTransform;
}

function coverageAlpha(fraction: number): number {
  if (fraction <= 0) return 0;
  // Floor + sub-linear curve: a single live cell in a mostly-dead block still
  // reads as a faint presence rather than rounding away to nothing.
  return Math.min(1, 0.26 + 0.74 * Math.pow(fraction, 0.45));
}

class WorldRendererImpl implements WorldRenderer {
  #canvas: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;
  #dpr = 1;
  #cssW = 1;
  #cssH = 1;

  #camera: Camera = { x: 0, y: 0, scale: 8 };
  #lens: RenderLens = 'life';
  #showGrid = true;

  #selection: Rect | null = null;
  #ghost: GhostState | null = null;
  #diffCells: Uint8Array | null = null;
  #diffRect: Rect | null = null;

  // Offscreen buffer reused across frames for the per-cell / coverage paths.
  #cellCanvas: HTMLCanvasElement | null = null;
  #cellCtx: CanvasRenderingContext2D | null = null;

  // Tokens resolved once (values are static; only which lens is *used* varies per draw).
  #tokLife!: TokenColor;
  #tokAge!: TokenColor;
  #tokActivity!: TokenColor;
  #tokDiff!: TokenColor;
  #tokWarn!: TokenColor;
  #tokLine!: TokenColor;
  #tokLineStrong!: TokenColor;
  #tokIvory!: TokenColor;

  get viewport(): Readonly<Viewport> {
    return { width: this.#cssW, height: this.#cssH };
  }

  attach(canvas: HTMLCanvasElement): void {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#resolveTokens();
    this.resize();
  }

  #resolveTokens(): void {
    this.#tokLife = resolveToken('--color-accent-life', 'oklch(0.87 0.155 155)');
    this.#tokAge = resolveToken('--color-accent-age', 'oklch(0.79 0.130 78)');
    this.#tokActivity = resolveToken('--color-accent-activity', 'oklch(0.72 0.185 25)');
    this.#tokDiff = resolveToken('--color-accent-diff', 'oklch(0.85 0.170 330)');
    this.#tokWarn = resolveToken('--color-accent-warn', 'oklch(0.80 0.150 60)');
    this.#tokLine = resolveToken('--color-line', 'oklch(0.32 0.018 198)');
    this.#tokLineStrong = resolveToken('--color-line-strong', 'oklch(0.44 0.020 199)');
    this.#tokIvory = resolveToken('--color-ivory-100', 'oklch(0.96 0.014 92)');
  }

  setCamera(camera: Camera): void {
    this.#camera = { ...camera };
  }

  setLens(lens: RenderLens): void {
    this.#lens = lens;
  }

  setShowGrid(show: boolean): void {
    this.#showGrid = show;
  }

  setGhost(pattern: StampPattern | null, x: number, y: number, transform: StampTransform): void {
    this.#ghost = pattern ? { pattern, x, y, transform } : null;
  }

  setSelection(rect: Rect | null): void {
    this.#selection = rect;
  }

  setDiffOverlay(cells: Uint8Array | null): void {
    this.#diffCells = cells;
    this.#diffRect = cells ? this.#selection : null;
  }

  resize(): void {
    if (!this.#canvas) return;
    const rect = this.#canvas.getBoundingClientRect();
    this.#dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.#cssW = Math.max(1, rect.width || this.#canvas.clientWidth || 1);
    this.#cssH = Math.max(1, rect.height || this.#canvas.clientHeight || 1);
    const dw = Math.max(1, Math.round(this.#cssW * this.#dpr));
    const dh = Math.max(1, Math.round(this.#cssH * this.#dpr));
    if (this.#canvas.width !== dw) this.#canvas.width = dw;
    if (this.#canvas.height !== dh) this.#canvas.height = dh;
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    return projectScreenToWorld(this.#camera, this.viewport, px, py);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return projectWorldToScreen(this.#camera, this.viewport, x, y);
  }

  /** Visible world rect (cells), padded by one cell, NOT wrapped or bounds-clamped. */
  #rawVisibleRect(): Rect {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.#cssW, this.#cssH);
    const pad = 1;
    const x = Math.floor(Math.min(tl.x, br.x)) - pad;
    const y = Math.floor(Math.min(tl.y, br.y)) - pad;
    const w = Math.ceil(Math.abs(br.x - tl.x)) + pad * 2;
    const h = Math.ceil(Math.abs(br.y - tl.y)) + pad * 2;
    return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
  }

  /** Visible rect capped to at most one world-tile per axis (the torus repeats beyond that),
   *  centred on the camera so zooming out past the world's extent doesn't blow up iteration cost. */
  #visibleWorldRect(spec: { width: number; height: number }): Rect {
    const raw = this.#rawVisibleRect();
    const w = Math.min(raw.w, spec.width);
    const h = Math.min(raw.h, spec.height);
    const x = Math.floor(this.#camera.x - w / 2);
    const y = Math.floor(this.#camera.y - h / 2);
    return { x, y, w, h };
  }

  draw(engine: LifeEngine, overlays?: RenderOverlays): void {
    this.#lastEngine = engine;
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const spec = engine.spec;
    const rect = this.#visibleWorldRect(spec);

    if (this.#camera.scale >= ZOOM_LOD_THRESHOLD) {
      this.#drawZoomedIn(engine, rect);
    } else {
      this.#drawZoomedOut(engine, rect);
    }

    const showGrid = overlays?.grid ?? this.#showGrid;
    if (showGrid && this.#camera.scale >= GRID_MIN_SCALE) {
      this.#drawGrid(rect);
    }

    this.#drawTorusBoundary(spec);

    const diff = overlays && 'diff' in overlays
      ? overlays.diff
      : (this.#diffCells && this.#diffRect ? { rect: this.#diffRect, cells: this.#diffCells } : null);
    if (diff) this.#drawDiff(diff.rect, diff.cells);

    const selection = overlays && 'selection' in overlays ? overlays.selection : this.#selection;
    if (selection) this.#drawSelection(selection);

    const ghost = overlays && 'ghost' in overlays ? overlays.ghost : this.#ghost;
    if (ghost) this.#drawGhost(ghost);
  }

  #ensureCellCanvas(w: number, h: number): CanvasRenderingContext2D {
    if (!this.#cellCanvas) {
      this.#cellCanvas = document.createElement('canvas');
    }
    if (this.#cellCanvas.width !== w) this.#cellCanvas.width = w;
    if (this.#cellCanvas.height !== h) this.#cellCanvas.height = h;
    if (!this.#cellCtx) this.#cellCtx = this.#cellCanvas.getContext('2d');
    return this.#cellCtx!;
  }

  #lensToken(): TokenColor {
    switch (this.#lens) {
      case 'age': return this.#tokAge;
      case 'activity': return this.#tokActivity;
      default: return this.#tokLife;
    }
  }

  #writeCellPixel(engine: LifeEngine, x: number, y: number, data: Uint8ClampedArray, idx: number): void {
    if (this.#lens === 'activity') {
      const heat = engine.activityAt(x, y);
      if (heat > 0.01) {
        const alpha = Math.round(Math.pow(Math.min(1, heat), 0.6) * 255);
        data[idx] = this.#tokActivity.rgb.r;
        data[idx + 1] = this.#tokActivity.rgb.g;
        data[idx + 2] = this.#tokActivity.rgb.b;
        data[idx + 3] = alpha;
      }
      return;
    }
    if (!engine.get(x, y)) return;
    if (this.#lens === 'age') {
      const age = engine.ageAt(x, y);
      const t = Math.min(1, age / AGE_RAMP_GENERATIONS);
      data[idx] = this.#tokAge.rgb.r;
      data[idx + 1] = this.#tokAge.rgb.g;
      data[idx + 2] = this.#tokAge.rgb.b;
      data[idx + 3] = Math.round((0.35 + 0.65 * t) * 255);
      return;
    }
    data[idx] = this.#tokLife.rgb.r;
    data[idx + 1] = this.#tokLife.rgb.g;
    data[idx + 2] = this.#tokLife.rgb.b;
    data[idx + 3] = 255;
  }

  #drawZoomedIn(engine: LifeEngine, rect: Rect): void {
    const spec = engine.spec;
    const cellCtx = this.#ensureCellCanvas(rect.w, rect.h);
    const img = cellCtx.createImageData(rect.w, rect.h);
    const data = img.data;

    for (let j = 0; j < rect.h; j++) {
      const wy = wrap(rect.y + j, spec.height);
      for (let i = 0; i < rect.w; i++) {
        const wx = wrap(rect.x + i, spec.width);
        this.#writeCellPixel(engine, wx, wy, data, (j * rect.w + i) * 4);
      }
    }
    cellCtx.putImageData(img, 0, 0);

    const dst = this.worldToScreen(rect.x, rect.y);
    const dx = Math.round(dst.x * this.#dpr);
    const dy = Math.round(dst.y * this.#dpr);
    const dw = Math.round(rect.w * this.#camera.scale * this.#dpr);
    const dh = Math.round(rect.h * this.#camera.scale * this.#dpr);

    const ctx = this.#ctx!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.#cellCanvas!, 0, 0, rect.w, rect.h, dx, dy, dw, dh);
  }

  #drawZoomedOut(engine: LifeEngine, rect: Rect): void {
    const spec = engine.spec;
    const scale = this.#camera.scale;
    const bufW = Math.max(1, Math.round(rect.w * scale));
    const bufH = Math.max(1, Math.round(rect.h * scale));
    const cellsPerPxX = rect.w / bufW;
    const cellsPerPxY = rect.h / bufH;

    const n = bufW * bufH;
    const area = new Float32Array(n);
    const liveCount = new Float32Array(n);
    const ageSum = this.#lens === 'age' ? new Float32Array(n) : null;
    const heatMax = this.#lens === 'activity' ? new Float32Array(n) : null;

    for (let j = 0; j < rect.h; j++) {
      const wy = wrap(rect.y + j, spec.height);
      const by = Math.min(bufH - 1, Math.floor(j / cellsPerPxY));
      for (let i = 0; i < rect.w; i++) {
        const wx = wrap(rect.x + i, spec.width);
        const bx = Math.min(bufW - 1, Math.floor(i / cellsPerPxX));
        const bidx = by * bufW + bx;
        area[bidx]! += 1;

        if (this.#lens === 'activity') {
          const heat = engine.activityAt(wx, wy);
          if (heat > heatMax![bidx]!) heatMax![bidx] = heat;
          if (heat > 0.01) liveCount[bidx]! += 1;
        } else if (engine.get(wx, wy)) {
          liveCount[bidx]! += 1;
          if (this.#lens === 'age') ageSum![bidx]! += engine.ageAt(wx, wy);
        }
      }
    }

    const cellCtx = this.#ensureCellCanvas(bufW, bufH);
    const img = cellCtx.createImageData(bufW, bufH);
    const data = img.data;
    const token = this.#lensToken();

    for (let p = 0; p < n; p++) {
      const a = area[p] || 1;
      const frac = liveCount[p]! / a;
      const heat = heatMax ? heatMax[p]! : 0;
      if (frac <= 0 && heat <= 0) continue;

      let alpha = this.#lens === 'activity' ? Math.pow(Math.min(1, heat), 0.6) : coverageAlpha(frac);
      if (this.#lens === 'age' && liveCount[p]! > 0) {
        const avgAge = ageSum![p]! / liveCount[p]!;
        const t = Math.min(1, avgAge / AGE_RAMP_GENERATIONS);
        alpha = Math.min(1, alpha * (0.5 + 0.5 * t));
      }

      const idx = p * 4;
      data[idx] = token.rgb.r;
      data[idx + 1] = token.rgb.g;
      data[idx + 2] = token.rgb.b;
      data[idx + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
    cellCtx.putImageData(img, 0, 0);

    const dst = this.worldToScreen(rect.x, rect.y);
    const dx = Math.round(dst.x * this.#dpr);
    const dy = Math.round(dst.y * this.#dpr);
    const dw = Math.round(rect.w * scale * this.#dpr);
    const dh = Math.round(rect.h * scale * this.#dpr);

    const ctx = this.#ctx!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.#cellCanvas!, 0, 0, bufW, bufH, dx, dy, dw, dh);
  }

  #drawGrid(rect: Rect): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const canvas = this.#canvas!;
    const startX = rect.x;
    const endX = rect.x + rect.w;
    const startY = rect.y;
    const endY = rect.y + rect.h;

    ctx.save();
    ctx.lineWidth = 1;

    ctx.strokeStyle = this.#tokLine.css;
    ctx.beginPath();
    for (let gx = Math.ceil(startX); gx <= endX; gx++) {
      if (gx % GRID_MAJOR_EVERY === 0) continue;
      const sx = Math.round(this.worldToScreen(gx, 0).x * dpr) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    for (let gy = Math.ceil(startY); gy <= endY; gy++) {
      if (gy % GRID_MAJOR_EVERY === 0) continue;
      const sy = Math.round(this.worldToScreen(0, gy).y * dpr) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = this.#tokLineStrong.css;
    ctx.beginPath();
    const firstMajorX = Math.ceil(startX / GRID_MAJOR_EVERY) * GRID_MAJOR_EVERY;
    for (let gx = firstMajorX; gx <= endX; gx += GRID_MAJOR_EVERY) {
      const sx = Math.round(this.worldToScreen(gx, 0).x * dpr) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
    }
    const firstMajorY = Math.ceil(startY / GRID_MAJOR_EVERY) * GRID_MAJOR_EVERY;
    for (let gy = firstMajorY; gy <= endY; gy += GRID_MAJOR_EVERY) {
      const sy = Math.round(this.worldToScreen(0, gy).y * dpr) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  #drawTorusBoundary(spec: { width: number; height: number }): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const tl = this.worldToScreen(0, 0);
    const br = this.worldToScreen(spec.width, spec.height);
    ctx.save();
    ctx.strokeStyle = withAlpha(this.#tokWarn, 0.55);
    ctx.lineWidth = 1;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeRect(
      Math.round(tl.x * dpr) + 0.5,
      Math.round(tl.y * dpr) + 0.5,
      Math.round((br.x - tl.x) * dpr),
      Math.round((br.y - tl.y) * dpr),
    );
    ctx.restore();
  }

  #drawSelection(rect: Rect): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const tl = this.worldToScreen(rect.x, rect.y);
    const br = this.worldToScreen(rect.x + rect.w, rect.y + rect.h);
    // Snap to device-pixel cell boundaries — never fractional pixels.
    const x0 = Math.round(tl.x * dpr);
    const y0 = Math.round(tl.y * dpr);
    const x1 = Math.round(br.x * dpr);
    const y1 = Math.round(br.y * dpr);

    ctx.save();
    ctx.fillStyle = withAlpha(this.#tokIvory, 0.08);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = withAlpha(this.#tokIvory, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.restore();
  }

  #drawGhost(ghost: GhostState): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    const { pattern, x, y, transform } = ghost;
    const { w, h, cells } = transformPattern(pattern, transform);

    ctx.save();
    ctx.fillStyle = withAlpha(this.#tokLife, 0.4);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!cells[j * w + i]) continue;
        const p0 = this.worldToScreen(x + i, y + j);
        const p1 = this.worldToScreen(x + i + 1, y + j + 1);
        const rx = Math.round(p0.x * dpr);
        const ry = Math.round(p0.y * dpr);
        ctx.fillRect(rx, ry, Math.max(1, Math.round(p1.x * dpr) - rx), Math.max(1, Math.round(p1.y * dpr) - ry));
      }
    }

    const tl = this.worldToScreen(x, y);
    const br = this.worldToScreen(x + w, y + h);
    ctx.strokeStyle = this.#tokIvory.css;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(tl.x * dpr) + 0.5,
      Math.round(tl.y * dpr) + 0.5,
      Math.round((br.x - tl.x) * dpr) - 1,
      Math.round((br.y - tl.y) * dpr) - 1,
    );
    ctx.restore();
  }

  #drawDiff(rect: Rect, cells: Uint8Array): void {
    const ctx = this.#ctx!;
    const dpr = this.#dpr;
    ctx.save();
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const v = cells[j * rect.w + i];
        if (!v) continue;
        const p0 = this.worldToScreen(rect.x + i, rect.y + j);
        const p1 = this.worldToScreen(rect.x + i + 1, rect.y + j + 1);
        const rx = Math.round(p0.x * dpr);
        const ry = Math.round(p0.y * dpr);
        const rw = Math.max(1, Math.round(p1.x * dpr) - rx);
        const rh = Math.max(1, Math.round(p1.y * dpr) - ry);
        if (v === 1) {
          // A-only: solid fill.
          ctx.fillStyle = withAlpha(this.#tokDiff, 0.6);
          ctx.fillRect(rx, ry, rw, rh);
        } else {
          // B-only: diagonal hatch, so it reads without colour too.
          ctx.fillStyle = withAlpha(this.#tokDiff, 0.22);
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeStyle = withAlpha(this.#tokDiff, 0.9);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(rx, ry + rh);
          ctx.lineTo(rx + rw, ry);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  async exportImage(opts: ExportImageOptions = {}): Promise<Blob> {
    if (!this.#canvas) throw new Error('exportImage: renderer not attached');
    const scale = opts.scale ?? 2;
    const bare = opts.bare ?? false;
    const mimeType = opts.mimeType ?? 'image/png';
    const caption = opts.caption ?? true;

    // Render through the same pipeline at a higher-resolution offscreen target
    // by temporarily redirecting internal canvas/ctx/dpr, then restoring them.
    const engineRef = this.#lastEngine;
    if (!engineRef) throw new Error('exportImage: nothing has been drawn yet');

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = Math.max(1, Math.round(this.#cssW * scale));
    exportCanvas.height = Math.max(1, Math.round(this.#cssH * scale));
    const exportCtx = exportCanvas.getContext('2d')!;

    const savedCanvas = this.#canvas;
    const savedCtx = this.#ctx;
    const savedDpr = this.#dpr;
    this.#canvas = exportCanvas;
    this.#ctx = exportCtx;
    this.#dpr = scale;

    try {
      this.draw(engineRef, bare ? { selection: null, ghost: null, diff: null, grid: false } : undefined);
    } finally {
      this.#canvas = savedCanvas;
      this.#ctx = savedCtx;
      this.#dpr = savedDpr;
    }

    if (caption) {
      const fontPx = Math.max(10, Math.round(12 * scale));
      exportCtx.save();
      exportCtx.font = `${fontPx}px "JetBrains Mono Variable", ui-monospace, monospace`;
      exportCtx.fillStyle = this.#tokIvory.css;
      exportCtx.textBaseline = 'bottom';
      const text = `gen ${engineRef.gen} · B3/S23`;
      exportCtx.fillText(text, 8 * scale, exportCanvas.height - 8 * scale);
      exportCtx.restore();
    }

    return new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('exportImage: toBlob failed'));
      }, mimeType);
    });
  }

  #lastEngine: LifeEngine | null = null;

  dispose(): void {
    this.#canvas = null;
    this.#ctx = null;
    this.#cellCanvas = null;
    this.#cellCtx = null;
    this.#lastEngine = null;
  }
}

export function createRenderer(): WorldRenderer {
  return new WorldRendererImpl();
}

/** Convenience: cell under a screen point, floored. */
export function cellAt(r: WorldRenderer, px: number, py: number): CellCoord {
  const w = r.screenToWorld(px, py);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}
