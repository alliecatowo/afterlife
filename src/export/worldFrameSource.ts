/**
 * `FrameSource` backed by a real, deterministic replay of recorded history —
 * the primary export path (see `@/export/replay.ts`'s doc for why this is
 * preferred over a realtime screen capture). Owns a SECOND, independent
 * `WorldRenderer` instance attached to a hidden canvas — exactly the pattern
 * `@/ui/session.ts`'s compare view already uses for a synchronized second
 * render — so exporting never touches the live renderer, camera, or engine
 * the user is looking at.
 *
 * Renders with whatever lens/grid/art config the caller passes in — always
 * the CURRENT live app state at the moment export starts (read by the
 * caller from `@/ui/store`/`@/render/artStore`), so "what you export is what
 * you see," including theming (theme CSS custom properties resolve globally
 * off `document.documentElement`, so this hidden canvas automatically picks
 * up the active theme with no extra wiring).
 */
import type { TimelineStore } from '@/core/history';
import type { Rect } from '@/core/types';
import { createRenderer, type ColorLens, type WorldRenderer } from '@/render/renderer';
import type { ArtConfig } from '@/render/artConfig';
import { createHiddenCanvas, type HiddenCanvasHandle } from './hiddenCanvas';
import { createReplayCursor, type ReplayCursor } from './replay';
import { fitCameraToRect } from './frameFit';
import { drawAnnotation } from './annotate';
import type { AnnotationInfo } from './filename';
import type { FrameSource } from './types';

export interface WorldFrameSourceOptions {
  history: TimelineStore;
  rect: Rect;
  width: number;
  height: number;
  frameGens: number[];
  lens: ColorLens;
  showGrid: boolean;
  artConfig: ArtConfig | null;
  annotate?: AnnotationInfo;
  signal?: AbortSignal;
}

class WorldFrameSource implements FrameSource {
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;

  #hidden: HiddenCanvasHandle;
  #renderer: WorldRenderer;
  #cursor: ReplayCursor;
  #camera: ReturnType<typeof fitCameraToRect>;
  #frameGens: number[];
  #annotate?: AnnotationInfo;
  #disposed = false;

  constructor(
    hidden: HiddenCanvasHandle,
    renderer: WorldRenderer,
    cursor: ReplayCursor,
    opts: WorldFrameSourceOptions,
  ) {
    this.#hidden = hidden;
    this.#renderer = renderer;
    this.#cursor = cursor;
    this.#frameGens = opts.frameGens;
    this.#annotate = opts.annotate;
    this.frameCount = opts.frameGens.length;
    this.width = opts.width;
    this.height = opts.height;
    this.#camera = fitCameraToRect(opts.rect, renderer.viewport.width, renderer.viewport.height);
    renderer.setLens(opts.lens);
    renderer.setShowGrid(opts.showGrid);
    renderer.setArtConfig(opts.artConfig);
  }

  async frame(index: number): Promise<HTMLCanvasElement> {
    if (this.#disposed) throw new Error('WorldFrameSource: frame() called after dispose()');
    const gen = this.#frameGens[index];
    if (gen === undefined) throw new Error(`WorldFrameSource: frame index ${index} out of range`);
    const engine = this.#cursor.advanceTo(gen);
    this.#renderer.setCamera(this.#camera);
    this.#renderer.draw(engine, { selection: null, ghost: null, diff: null, grid: undefined });

    if (this.#annotate) {
      const ctx = this.#hidden.canvas.getContext('2d');
      if (ctx) drawAnnotation(ctx, this.#hidden.canvas.width, this.#hidden.canvas.height, this.#annotate);
    }
    return this.#hidden.canvas;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#renderer.dispose();
    this.#hidden.dispose();
    this.#cursor.dispose();
  }
}

export async function createWorldFrameSource(opts: WorldFrameSourceOptions): Promise<FrameSource> {
  const hidden = createHiddenCanvas(opts.width, opts.height);
  const renderer = createRenderer();
  try {
    renderer.attach(hidden.canvas);
    // `attach()` sizes the backing store from the canvas' real (if hidden)
    // CSS box — see `createHiddenCanvas`'s doc for why that box is sized to
    // land on the exact requested pixel dimensions.
    const cursor = await createReplayCursor(opts.history, { fromGen: opts.frameGens[0] ?? 0, signal: opts.signal });
    return new WorldFrameSource(hidden, renderer, cursor, opts);
  } catch (err) {
    renderer.dispose();
    hidden.dispose();
    throw err;
  }
}
