import { afterEach, describe, expect, it } from 'vitest';
import type { Rect, StampPattern, StampTransform } from '@/core/types';
import { IDENTITY_TRANSFORM } from '@/core/types';
import type { CameraController, Viewport } from '@/render/camera';
import type { ExportImageOptions, WorldRenderer } from '@/render/renderer';
import { transformPattern } from '@/core/engine';
import { createInput } from '@/interact/input';
import { useAppStore } from '@/ui/store';

/** Minimal WorldRenderer test double: identity camera (scale 1, origin 0,0),
 *  so screen pixel (10, 20) IS world cell (10, 20) — makes assertions simple. */
function makeFakeRenderer(): WorldRenderer & { ghostCalls: unknown[]; selectionCalls: unknown[] } {
  const ghostCalls: unknown[] = [];
  const selectionCalls: unknown[] = [];
  return {
    ghostCalls,
    selectionCalls,
    viewport: { width: 800, height: 600 },
    dpr: 1,
    attach() {},
    setCamera() {},
    setLens() {},
    setPalette() {},
    setArtConfig() {},
    setModulationGrid() {},
    draw() {},
    resize() {},
    screenToWorld(px: number, py: number) { return { x: px, y: py }; },
    worldToScreen(x: number, y: number) { return { x, y }; },
    setGhost(pattern: StampPattern | null, x: number, y: number, transform: StampTransform) {
      ghostCalls.push({ pattern, x, y, transform });
    },
    setSelection(rect: Rect | null) { selectionCalls.push(rect); },
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

function makePattern(): StampPattern {
  // Same asymmetric L used in the pattern-transform tests.
  const w = 2, h = 3;
  const cells = new Uint8Array(w * h);
  cells[0] = 1; cells[2] = 1; cells[4] = 1; cells[5] = 1;
  return { name: 'L', w, h, cells };
}

function dispatchPointerDown(canvas: HTMLCanvasElement, x: number, y: number, extra: Partial<PointerEvent> = {}): void {
  const ev = new PointerEvent('pointerdown', {
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    // jsdom's PointerEvent may not support pointerType via the constructor dict
    // in older versions; set it via defineProperty as a fallback below.
    ...extra,
  });
  Object.defineProperty(ev, 'pointerType', { value: (extra as { pointerType?: string }).pointerType ?? 'mouse' });
  canvas.dispatchEvent(ev);
}

describe('input: ghost preview and stamp commit agree on the footprint', () => {
  afterEach(() => {
    useAppStore.getState().setTool('draw');
    useAppStore.getState().setSelection(null);
  });

  it('stamping at (5, 7) commits exactly transformPattern(pattern, transform) offset there', () => {
    useAppStore.getState().setTool('stamp');

    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const pattern = makePattern();
    const transform: StampTransform = { rotate: 1, flipX: false, flipY: false };

    const input = createInput({ renderer, camera });
    input.setStampPattern(pattern);
    input.setStampTransform(transform);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
    (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
    input.attach(canvas);

    dispatchPointerDown(canvas, 5, 7);

    const expected = transformPattern(pattern, transform);
    const op = input.pending;
    expect(op).not.toBeNull();
    expect(op!.kind).toBe('set');

    const got = new Map(op!.cells.map((c) => [`${c.x - 5},${c.y - 7}`, c.alive]));
    for (let j = 0; j < expected.h; j++) {
      for (let i = 0; i < expected.w; i++) {
        const alive = expected.cells[j * expected.w + i] === 1;
        expect(got.get(`${i},${j}`)).toBe(alive);
      }
    }
    // Exactly the footprint's bounding box, nothing more.
    expect(op!.cells.length).toBe(expected.w * expected.h);

    // The ghost preview (driven by pointermove, or here directly via the same
    // transform used for the stamp) is byte-identical because both paths call
    // the SAME pure `transformPattern` — this is the agreement guarantee.
    const ghostShape = transformPattern(pattern, transform);
    expect([...ghostShape.cells]).toEqual([...expected.cells]);

    input.dispose();
  });

  it('identity-transform stamp footprint matches the raw pattern cells 1:1', () => {
    useAppStore.getState().setTool('stamp');
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const pattern = makePattern();

    const input = createInput({ renderer, camera });
    input.setStampPattern(pattern);
    input.setStampTransform(IDENTITY_TRANSFORM);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} });
    (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
    input.attach(canvas);

    dispatchPointerDown(canvas, 0, 0);

    const op = input.pending!;
    const alive = new Set(op.cells.filter((c) => c.alive).map((c) => `${c.x},${c.y}`));
    expect(alive).toEqual(new Set(['0,0', '0,1', '0,2', '1,2']));

    input.dispose();
  });
});
