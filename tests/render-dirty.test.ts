import { describe, expect, it } from 'vitest';
import { createRenderer } from '@/render/renderer';
import { IDENTITY_TRANSFORM, type StampPattern } from '@/core/types';

// jsdom doesn't implement `HTMLCanvasElement`'s 2D context, so `draw()` — and
// therefore ImageData/pixel content — can't be exercised here; the point of
// this test tier is the dirty-flag BOOKKEEPING itself (BUG 4's "an idle
// paused world costs ~nothing" fix), which is pure state tracking
// independent of whether a real canvas backs it.
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => (
    { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON() {} }
  );
  return canvas;
}

function pattern(): StampPattern {
  return { name: 'p', w: 1, h: 1, cells: new Uint8Array([1]) };
}

describe('BUG 4: WorldRenderer dirty-flag gating', () => {
  it('is dirty on the very first frame after attach()', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    expect(r.consumeDirty()).toBe(true);
  });

  it('consumeDirty() clears the flag — a second call in a row is false', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    expect(r.consumeDirty()).toBe(true);
    expect(r.consumeDirty()).toBe(false);
  });

  it('an idle world (no camera/lens/overlay change) never reports dirty again', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty(); // clear the initial true
    for (let i = 0; i < 10; i++) {
      r.setCamera({ x: 0, y: 0, scale: 8 }); // identical every "frame"
      expect(r.consumeDirty()).toBe(false);
    }
  });

  it('setCamera with an actually-different value marks dirty; an identical repeat does not', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();
    r.setCamera({ x: 1, y: 0, scale: 8 });
    expect(r.consumeDirty()).toBe(true);
    r.setCamera({ x: 1, y: 0, scale: 8 });
    expect(r.consumeDirty()).toBe(false);
  });

  it('setLens only marks dirty on an actual change', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();
    r.setLens('life'); // same as the default — no-op
    expect(r.consumeDirty()).toBe(false);
    r.setLens('age');
    expect(r.consumeDirty()).toBe(true);
  });

  it('setGhost/setSelection/setDiffOverlay mark dirty on change and settle back to false', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();

    r.setGhost(pattern(), 3, 4, IDENTITY_TRANSFORM);
    expect(r.consumeDirty()).toBe(true);
    expect(r.consumeDirty()).toBe(false);

    r.setSelection({ x: 0, y: 0, w: 2, h: 2 });
    expect(r.consumeDirty()).toBe(true);
    expect(r.consumeDirty()).toBe(false);

    r.setDiffOverlay(new Uint8Array([1]));
    expect(r.consumeDirty()).toBe(true);
    expect(r.consumeDirty()).toBe(false);
  });

  it('setStrokePreview always marks dirty while a stroke is live, and clearing it marks dirty once more', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();

    r.setStrokePreview([{ x: 0, y: 0, alive: true }]);
    expect(r.consumeDirty()).toBe(true);
    r.setStrokePreview(null);
    expect(r.consumeDirty()).toBe(true);
    expect(r.consumeDirty()).toBe(false);
  });

  it('invalidate() forces the next consumeDirty() true regardless of anything else changing', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();
    expect(r.consumeDirty()).toBe(false);
    r.invalidate();
    expect(r.consumeDirty()).toBe(true);
    expect(r.consumeDirty()).toBe(false);
  });

  it('resize() marks dirty', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();
    r.resize();
    expect(r.consumeDirty()).toBe(true);
  });

  it('setLens accepts every new "lineage family" lens id and only marks dirty on an actual change', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();
    for (const lens of ['lineage', 'immigration', 'quadlife', 'velocity', 'neighbors'] as const) {
      r.setLens(lens);
      expect(r.consumeDirty()).toBe(true);
      r.setLens(lens);
      expect(r.consumeDirty()).toBe(false);
    }
  });

  it('setPalette only marks dirty on an actual change', () => {
    const r = createRenderer();
    r.attach(makeCanvas());
    r.consumeDirty();
    r.setPalette('default'); // same as the default — no-op
    expect(r.consumeDirty()).toBe(false);
    r.setPalette('cvd');
    expect(r.consumeDirty()).toBe(true);
    r.setPalette('cvd');
    expect(r.consumeDirty()).toBe(false);
  });
});
