import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraController, Viewport } from '@/render/camera';
import type { ExportImageOptions, WorldRenderer } from '@/render/renderer';
import type { ColorLens } from '@/render/color';
import { createEngine } from '@/core/engine';
import { createInput } from '@/interact/input';
import { useAppStore } from '@/ui/store';

/**
 * Number keys 1-8 are the fully-functional way to reach every lens today,
 * independent of whether the HUD `Toggle` picker has been extended yet (see
 * INTEGRATION-NOTES.md's "colourful lenses" entry) — 1-3 already existed for
 * life/age/activity; this covers the 5 new ones (4-8).
 */
function makeFakeRenderer(): WorldRenderer & { lensCalls: ColorLens[] } {
  const lensCalls: ColorLens[] = [];
  return {
    lensCalls,
    viewport: { width: 800, height: 600 },
    dpr: 1,
    attach() {},
    setCamera() {},
    setLens(lens: ColorLens) { lensCalls.push(lens); },
    setPalette() {},
    setArtConfig() {},
    setModulationGrid() {},
    draw() {},
    resize() {},
    screenToWorld(px: number, py: number) { return { x: px, y: py }; },
    worldToScreen(x: number, y: number) { return { x, y }; },
    setGhost() {},
    setSelection() {},
    setDiffOverlay() {},
    setStrokePreview() {},
    setShowGrid() {},
    invalidate() {},
    consumeDirty() { return false; },
    async exportImage(_opts?: ExportImageOptions) { return new Blob(); },
    dispose() {},
  };
}

function makeFakeCamera(): CameraController {
  let vp: Viewport = { width: 800, height: 600 };
  return {
    camera: { x: 0, y: 0, scale: 1 },
    get viewport() { return vp; },
    following: false,
    setViewport(w: number, h: number) { vp = { width: w, height: h }; },
    set() {},
    panByScreen() {},
    zoomAt() {},
    follow() {},
    releaseFollow() {},
    fit() {},
    tick() {},
  };
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
  return canvas;
}

const CASES: Array<{ key: string; lens: ColorLens }> = [
  { key: '1', lens: 'life' },
  { key: '2', lens: 'age' },
  { key: '3', lens: 'activity' },
  { key: '4', lens: 'lineage' },
  { key: '5', lens: 'immigration' },
  { key: '6', lens: 'quadlife' },
  { key: '7', lens: 'velocity' },
  { key: '8', lens: 'neighbors' },
];

describe('keyboard shortcuts 1-8 reach every colour lens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const { key, lens } of CASES) {
    it(`"${key}" always drives the RENDERER to the "${lens}" lens`, () => {
      // The renderer is what actually paints the canvas — this must work for
      // every lens regardless of the store/HUD guard below.
      const engine = createEngine({ width: 16, height: 16 });
      const renderer = makeFakeRenderer();
      const camera = makeFakeCamera();
      const input = createInput({ renderer, camera, engine });
      const canvas = makeCanvas();
      input.attach(canvas);

      window.dispatchEvent(new KeyboardEvent('keydown', { key }));

      expect(renderer.lensCalls).toContain(lens);

      input.dispose();
    });
  }

  it('mirrors the ORIGINAL 3 lenses into useAppStore (Hud.tsx\'s legend record already knows these)', () => {
    const engine = createEngine({ width: 16, height: 16 });
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })); // age
    expect(useAppStore.getState().lens).toBe('age');

    input.dispose();
  });

  it('ALSO mirrors the 5 new colour lenses into useAppStore — RenderLens has been widened and Hud.tsx/HudMoreSheet.tsx index their legend through a safe fallback (`LENS_LEGEND[lens] ?? LENS_LEGEND.life`), so an unrecognised id can never crash the app again (see INTEGRATION-NOTES.md\'s "colourful lenses" entry for the crash this used to cause before that fallback existed).', () => {
    const engine = createEngine({ width: 16, height: 16 });
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    for (const { key, lens } of CASES) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(useAppStore.getState().lens, `lens should become "${lens}" after pressing "${key}"`).toBe(lens);
    }

    input.dispose();
  });

  it('bus lens:changed fires for every lens now that the HUD can legend all 8 safely', async () => {
    const { bus } = await import('@/ui/bus');
    const received: unknown[] = [];
    const sub = bus.on('lens:changed', (payload) => received.push(payload));

    const engine = createEngine({ width: 16, height: 16 });
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '6' })); // quadlife — must emit
    expect(received).toEqual([{ lens: 'quadlife' }]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })); // age — must emit
    expect(received).toEqual([{ lens: 'quadlife' }, { lens: 'age' }]);

    sub.dispose();
    input.dispose();
  });
});
