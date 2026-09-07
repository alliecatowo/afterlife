import { afterEach, describe, expect, it } from 'vitest';
import type { Rect, StampPattern, StampTransform } from '@/core/types';
import type { CameraController, Viewport } from '@/render/camera';
import type { ExportImageOptions, WorldRenderer } from '@/render/renderer';
import { createEngine, transformPattern } from '@/core/engine';
import { createInput } from '@/interact/input';
import { useAppStore } from '@/ui/store';

/** Identity camera/renderer test doubles — screen pixel (x, y) IS world cell (x, y). */
function makeFakeRenderer(): WorldRenderer {
  return {
    viewport: { width: 800, height: 600 },
    attach() {},
    setCamera() {},
    setLens() {},
    draw() {},
    resize() {},
    screenToWorld(px: number, py: number) { return { x: px, y: py }; },
    worldToScreen(x: number, y: number) { return { x, y }; },
    setGhost() {},
    setSelection() {},
    setDiffOverlay() {},
    setShowGrid() {},
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
  (canvas as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  return canvas;
}

function pointerEvent(type: string, x: number, y: number, extra: Partial<PointerEvent> & { altKey?: boolean } = {}): PointerEvent {
  const ev = new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, altKey: extra.altKey ?? false, ...extra });
  Object.defineProperty(ev, 'pointerType', { value: extra.pointerType ?? 'mouse' });
  return ev;
}

/** An asymmetric L-tromino-ish shape: (0,0) (1,0) (2,0) (0,1) — unambiguous under move/rotate. */
function seedShape(engine: ReturnType<typeof createEngine>, x: number, y: number): void {
  engine.set(x, y, true);
  engine.set(x + 1, y, true);
  engine.set(x + 2, y, true);
  engine.set(x, y + 1, true);
}

describe('input: selection move / duplicate / rotate', () => {
  afterEach(() => {
    useAppStore.getState().setTool('draw');
    useAppStore.getState().setSelection(null);
  });

  it('dragging inside an existing selection moves its contents (clear source + paint destination), one atomic op', () => {
    const engine = createEngine({ width: 60, height: 60 });
    seedShape(engine, 10, 10);
    // Selection rect with a 1-cell margin around the shape, like a real marquee drag.
    const rect: Rect = { x: 9, y: 9, w: 5, h: 4 };
    useAppStore.getState().setTool('select');
    useAppStore.getState().setSelection(rect);

    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 10)); // grab the live top-left cell
    canvas.dispatchEvent(pointerEvent('pointermove', 15, 15)); // drag by (+5, +5)
    canvas.dispatchEvent(pointerEvent('pointerup', 15, 15));

    const op = input.pending;
    expect(op).not.toBeNull();
    const byKey = new Map(op!.cells.map((c) => [`${c.x},${c.y}`, c.alive]));

    // Every cell of the ORIGINAL 5x4 rect must be cleared...
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        expect(byKey.get(`${rect.x + i},${rect.y + j}`), `origin (${rect.x + i},${rect.y + j})`).toBe(false);
      }
    }
    // ...and the shape's live cells must reappear shifted by (+5, +5), alive.
    for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [0, 1]]) {
      expect(byKey.get(`${15 + dx},${15 + dy}`), `moved cell (${15 + dx},${15 + dy})`).toBe(true);
    }

    // The selection follows the moved content.
    expect(useAppStore.getState().selection).toEqual({ x: 14, y: 14, w: 5, h: 4 });

    input.dispose();
  });

  it('Alt-dragging inside a selection duplicates instead of moving (source untouched, copy painted)', () => {
    const engine = createEngine({ width: 60, height: 60 });
    seedShape(engine, 10, 10);
    const rect: Rect = { x: 9, y: 9, w: 5, h: 4 };
    useAppStore.getState().setTool('select');
    useAppStore.getState().setSelection(rect);

    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 10, { altKey: true }));
    canvas.dispatchEvent(pointerEvent('pointermove', 20, 20, { altKey: true }));
    canvas.dispatchEvent(pointerEvent('pointerup', 20, 20, { altKey: true }));

    const op = input.pending;
    expect(op).not.toBeNull();
    // A duplicate must not clear ANY of the original rect's cells.
    const clearedOriginal = op!.cells.some((c) => (
      c.x >= rect.x && c.x < rect.x + rect.w && c.y >= rect.y && c.y < rect.y + rect.h && c.alive === false
    ));
    expect(clearedOriginal, 'duplicate must not touch the source rect').toBe(false);

    const byKey = new Map(op!.cells.map((c) => [`${c.x},${c.y}`, c.alive]));
    for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [0, 1]]) {
      expect(byKey.get(`${20 + dx},${20 + dy}`), `copy cell (${20 + dx},${20 + dy})`).toBe(true);
    }

    input.dispose();
  });

  it('a plain click on a selection with no movement commits nothing (no spurious edit)', () => {
    const engine = createEngine({ width: 60, height: 60 });
    seedShape(engine, 10, 10);
    const rect: Rect = { x: 9, y: 9, w: 5, h: 4 };
    useAppStore.getState().setTool('select');
    useAppStore.getState().setSelection(rect);

    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 10));
    canvas.dispatchEvent(pointerEvent('pointerup', 10, 10));

    expect(input.pending).toBeNull();
    input.dispose();
  });

  it('an Alt-click on a selection with no movement also commits nothing (duplicate-in-place is still a no-op)', () => {
    // QA2: the old guard only skipped the plain-click case (`!moved && !duplicate`),
    // so an Alt+click with zero drag fell through and stamped the pattern back
    // onto itself at identical coordinates — a cell-for-cell no-op that still
    // burned an undo slot and a `history.record()` entry for nothing.
    const engine = createEngine({ width: 60, height: 60 });
    seedShape(engine, 10, 10);
    const rect: Rect = { x: 9, y: 9, w: 5, h: 4 };
    useAppStore.getState().setTool('select');
    useAppStore.getState().setSelection(rect);

    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    canvas.dispatchEvent(pointerEvent('pointerdown', 10, 10, { altKey: true }));
    canvas.dispatchEvent(pointerEvent('pointerup', 10, 10, { altKey: true }));

    expect(input.pending).toBeNull();
    expect(input.canUndo, 'a no-op duplicate must not push an undo entry').toBe(false);
    input.dispose();
  });

  it('pressing r rotates the selected LIVE contents in place and swaps the selection footprint', () => {
    const engine = createEngine({ width: 60, height: 60 });
    // A 3-wide, 1-tall horizontal line at (10,10)-(12,10).
    engine.set(10, 10, true);
    engine.set(11, 10, true);
    engine.set(12, 10, true);
    const rect: Rect = { x: 10, y: 10, w: 3, h: 1 };
    useAppStore.getState().setTool('select');
    useAppStore.getState().setSelection(rect);

    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera, engine });
    const canvas = makeCanvas();
    input.attach(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));

    // `input` only ever produces a pending EditOp (see ARCHITECTURE.md § Atomic
    // edit commit) — applying it to the engine is normally `session.ts`'s job.
    // Do that ourselves here to inspect the resulting world state.
    const op = input.commit();
    expect(op).not.toBeNull();
    for (const c of op!.cells) engine.set(c.x, c.y, c.alive);

    const newRect = useAppStore.getState().selection!;
    expect(newRect.w, 'rotating a 3x1 line must yield a 1x3 footprint').toBe(1);
    expect(newRect.h).toBe(3);
    let live = 0;
    for (let j = 0; j < newRect.h; j++) {
      for (let i = 0; i < newRect.w; i++) if (engine.get(newRect.x + i, newRect.y + j)) live++;
    }
    expect(live, 'rotation must be population-preserving').toBe(3);
    // The original line's ENDS must be cleared — (11,10), the pivot, is
    // legitimately shared between the old horizontal footprint and the new
    // vertical one and should stay alive.
    expect(engine.get(10, 10), '(10,10) is outside the rotated footprint').toBe(false);
    expect(engine.get(12, 10), '(12,10) is outside the rotated footprint').toBe(false);

    input.dispose();
  });

  it('pressing r while tool is stamp still rotates the ARMED PATTERN transform, not any selection', () => {
    const pattern: StampPattern = { name: 'L', w: 2, h: 3, cells: new Uint8Array([1, 0, 0, 1, 1, 1]) };
    useAppStore.getState().setTool('stamp');
    const renderer = makeFakeRenderer();
    const camera = makeFakeCamera();
    const input = createInput({ renderer, camera });
    input.setStampPattern(pattern);
    const canvas = makeCanvas();
    input.attach(canvas);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    expect(input.stampTransform).toEqual({ rotate: 1, flipX: false, flipY: false } satisfies StampTransform);
    expect(transformPattern(pattern, input.stampTransform).w).toBe(3); // swapped, 2x3 -> 3x2

    input.dispose();
  });
});
