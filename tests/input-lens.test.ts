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
    attach() {},
    setCamera() {},
    setLens(lens: ColorLens) { lensCalls.push(lens); },
    setPalette() {},
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
    it(`"${key}" selects the "${lens}" lens on both the renderer and the store`, () => {
      const engine = createEngine({ width: 16, height: 16 });
      const renderer = makeFakeRenderer();
      const camera = makeFakeCamera();
      const input = createInput({ renderer, camera, engine });
      const canvas = makeCanvas();
      input.attach(canvas);

      window.dispatchEvent(new KeyboardEvent('keydown', { key }));

      expect(renderer.lensCalls).toContain(lens);
      expect(useAppStore.getState().lens).toBe(lens);

      input.dispose();
    });
  }

  it('also emits lens:changed on the bus so other subscribers (e.g. the HUD legend) stay in sync', async () => {
    const { bus } = await import('@/ui/bus');
    const received: unknown[] = [];
    const sub = bus.on('lens:changed', (payload) => received.push(payload));

    const engine = createEngine({ width: 16, height: 16 });
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '6' }));
    expect(received).toEqual([{ lens: 'quadlife' }]);

    sub.dispose();
    input.dispose();
  });
});
