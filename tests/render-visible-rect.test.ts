import { describe, expect, it } from 'vitest';
import { computeRawVisibleRect, computeVisibleWorldRect, ZOOM_LOD_THRESHOLD } from '@/render/renderer';
import type { Camera, Viewport } from '@/render/camera';

const spec = { width: 256, height: 160 };
const viewport: Viewport = { width: 1440, height: 900 };

describe('BUG 3: computeVisibleWorldRect zoom/pan continuity', () => {
  it('matches the raw rect exactly whenever the raw rect already fits inside the world', () => {
    // Zoomed in enough that the raw visible rect is far smaller than the
    // 256x160 world on both axes — no clamping should occur, and the
    // returned rect must be byte-for-byte the raw one, not an
    // independently-recomputed camera-centred approximation. These specific
    // (deliberately non-round) camera positions/scales are ones where
    // `floor(tl.x)` and `floor(camera.x - w/2)` land on different integers —
    // exactly the case the old code got wrong (recomputing x/y from
    // `camera.x/y` drifted by a cell from the rect the raw screen-corner
    // computation actually produced).
    const cases: Camera[] = [
      { x: 100.3, y: 60.7, scale: 6.3 },
      { x: 40.37, y: 60.7, scale: 6.3 },
      { x: 100.3, y: 60.7, scale: 8.37 },
      { x: 40.2, y: 60.7, scale: 8.37 },
    ];
    for (const camera of cases) {
      const raw = computeRawVisibleRect(camera, viewport);
      const visible = computeVisibleWorldRect(camera, viewport, spec);
      expect(visible).toEqual(raw);
    }
  });

  it('is pixel-continuous across the zoomed-in/zoomed-out LOD threshold at a fixed camera position', () => {
    // The world (256 wide) is bigger than what's visible at both scales
    // tested here, so neither should clamp — the rect must vary smoothly
    // (not jump) as scale crosses ZOOM_LOD_THRESHOLD.
    const camera: Camera = { x: 128, y: 80, scale: ZOOM_LOD_THRESHOLD };
    const justAbove = computeVisibleWorldRect({ ...camera, scale: ZOOM_LOD_THRESHOLD + 0.01 }, viewport, spec);
    const justBelow = computeVisibleWorldRect({ ...camera, scale: ZOOM_LOD_THRESHOLD - 0.01 }, viewport, spec);
    // A hairline scale change should move each edge by at most a cell or two,
    // never a large, discontinuous jump.
    expect(Math.abs(justAbove.x - justBelow.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(justAbove.y - justBelow.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(justAbove.w - justBelow.w)).toBeLessThanOrEqual(2);
    expect(Math.abs(justAbove.h - justBelow.h)).toBeLessThanOrEqual(2);
  });

  it('panning by a small amount at a fixed (unclamped) scale never jumps the visible rect by more than the pan itself', () => {
    // This is the concrete regression BUG 3 described: recomputing the
    // rect's origin from `camera.x/y` independently of the raw
    // screen-derived rect rounds (floor vs the raw rect's own floor/ceil)
    // slightly differently, so a tiny pan could shift which edge cells are
    // included by MORE than the pan distance itself — structures popping
    // in/out that shouldn't have moved at all. At a fixed scale, nudging the
    // camera by `d` cells must never move the rect's origin by more than
    // `d` cells (rounded).
    const scale = 6; // unclamped at this viewport/world size
    let prev = computeVisibleWorldRect({ x: 0, y: 0, scale }, viewport, spec);
    for (let i = 1; i <= 40; i++) {
      const d = 0.3;
      const cur = computeVisibleWorldRect({ x: i * d, y: i * d * 0.7, scale }, viewport, spec);
      expect(Math.abs(cur.x - prev.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(cur.y - prev.y)).toBeLessThanOrEqual(1);
      prev = cur;
    }
  });

  it('fully covers the torus with no gaps or double-coverage once zoomed out past the world extent', () => {
    // Very zoomed out: the raw rect is clamped to exactly one world tile.
    const camera: Camera = { x: 0, y: 0, scale: 0.5 };
    const visible = computeVisibleWorldRect(camera, viewport, spec);
    expect(visible.w).toBe(spec.width);
    expect(visible.h).toBe(spec.height);
  });

  it('panning while fully zoomed out does not change the amount of world shown', () => {
    const far = { scale: 0.5 };
    const a = computeVisibleWorldRect({ x: 0, y: 0, ...far }, viewport, spec);
    const b = computeVisibleWorldRect({ x: 9999, y: -4321, ...far }, viewport, spec);
    expect(a.w).toBe(b.w);
    expect(a.h).toBe(b.h);
    expect(a.w).toBe(spec.width);
    expect(a.h).toBe(spec.height);
  });
});
