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

  const LEGACY = new Set(['life', 'age', 'activity']);

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

  it('does NOT push the 5 new lenses into useAppStore — Hud.tsx/HudMoreSheet.tsx index a Record<RenderLens,...> legend with no fallback for an unknown key, and indexing it with e.g. "lineage" crashes the whole app (verified against the real production build before this guard existed: the crash unmounted #world-canvas along with everything else). The renderer above is already correct regardless; only the store/HUD mirror waits for INTEGRATION-NOTES.md\'s proposed RenderLens widening.', () => {
    const engine = createEngine({ width: 16, height: 16 });
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    const before = useAppStore.getState().lens;
    for (const { key, lens } of CASES) {
      if (LEGACY.has(lens)) continue;
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(useAppStore.getState().lens, `lens should stay "${before}" after pressing "${key}" (${lens})`).toBe(before);
    }

    input.dispose();
  });

  it('bus lens:changed only fires for the 3 legacy lenses, for the same crash-avoidance reason', async () => {
    const { bus } = await import('@/ui/bus');
    const received: unknown[] = [];
    const sub = bus.on('lens:changed', (payload) => received.push(payload));

    const engine = createEngine({ width: 16, height: 16 });
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '6' })); // quadlife — must NOT emit
    expect(received).toEqual([]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })); // age — must emit
    expect(received).toEqual([{ lens: 'age' }]);

    sub.dispose();
    input.dispose();
  });
});
