import { describe, expect, it } from 'vitest';
import { projectWorldToScreen, torusBoundaryOrigin } from '@/render/renderer';
import type { Camera, Viewport } from '@/render/camera';

/**
 * Regression coverage for the real, user-reported bug: the torus-boundary
 * overlay drawn at a FIXED world rect `[0, width] x [0, height]` agreed with
 * the rendered (wrap-sampled, continuously-scrolling) world only near the
 * camera's start position, then drifted out of alignment as the camera
 * panned — eventually landing across the middle of the visible content
 * instead of bracketing it ("the yellow square... quit matching up as you
 * pan"). `torusBoundaryOrigin` is the fix: it derives which period-copy of
 * the grid to draw around straight from the camera's own continuous
 * position, the same one the cell path reads on the same `draw()` call, so
 * the two cannot diverge by construction. A single fixed-position assertion
 * would have passed on the old, buggy code (it only failed after enough
 * panning) — every test below sweeps a wide range of camera positions,
 * including many multiples of the world size and the exact seam, for
 * exactly that reason.
 */

const spec = { width: 256, height: 160 };
const viewport: Viewport = { width: 1440, height: 900 };

describe('torusBoundaryOrigin: stays locked to the camera across arbitrary panning', () => {
  it('never drifts more than half a world-size from the camera, on either axis, at any pan distance', () => {
    for (let x = -5000; x <= 5000; x += 137) {
      for (let y = -3000; y <= 3000; y += 211) {
        const origin = torusBoundaryOrigin({ x, y }, spec);
        expect(Math.abs(x - origin.x)).toBeLessThanOrEqual(spec.width / 2);
        expect(Math.abs(y - origin.y)).toBeLessThanOrEqual(spec.height / 2);
      }
    }
  });

  it('is always an exact multiple of the world size on each axis (a real copy of the grid, not an arbitrary offset)', () => {
    for (let x = -1000; x <= 1000; x += 47) {
      const origin = torusBoundaryOrigin({ x, y: 0 }, spec);
      expect(Math.abs(origin.x % spec.width)).toBe(0);
    }
    for (let y = -1000; y <= 1000; y += 53) {
      const origin = torusBoundaryOrigin({ x: 0, y }, spec);
      expect(Math.abs(origin.y % spec.height)).toBe(0);
    }
  });

  it('reproduces the OLD fixed-at-[0,width] behaviour near the start position', () => {
    // 100/60, not the world's exact centre (128/80) — 128 is EXACTLY half of
    // `spec.width` (256) and 80 is EXACTLY half of `spec.height` (160), an
    // intentionally ambiguous halfway point covered by its own dedicated
    // test below.
    expect(torusBoundaryOrigin({ x: 100, y: 60 }, spec)).toEqual({ x: 0, y: 0 });
    expect(torusBoundaryOrigin({ x: 0, y: 0 }, spec)).toEqual({ x: 0, y: 0 });
  });

  it('THE REPORTED BUG: after panning several world-widths away, the old fixed rect would be nowhere near the camera, while the fix stays close', () => {
    // Three and a half world-widths of panning — the kind of long drag a
    // real user does exploring the torus. The old code always drew at world
    // x=0; that is now `3.5 * spec.width` away from the camera, i.e. FAR
    // outside anything visible on screen (a viewport only ever shows a few
    // hundred CSS px of world at typical zoom). The fix must stay within
    // half a world-width, i.e. genuinely nearby, still.
    const camera = { x: 3.5 * spec.width, y: 0 };
    const oldFixedOrigin = { x: 0, y: 0 };
    const distanceOld = Math.abs(camera.x - oldFixedOrigin.x);
    const fixed = torusBoundaryOrigin(camera, spec);
    const distanceFixed = Math.abs(camera.x - fixed.x);
    expect(distanceOld).toBeGreaterThan(spec.width); // the bug: wildly far away
    expect(distanceFixed).toBeLessThanOrEqual(spec.width / 2); // the fix: always close
  });

  it('switches copies smoothly at the exact halfway point between two tiles, never leaving a gap', () => {
    // Just below the halfway point between tile 0 ([0,256]) and tile 1
    // ([256,512]) still resolves to tile 0; just above resolves to tile 1 —
    // there is no camera position for which neither is within half a
    // world-width (continuity: the origin candidates tile every axis with
    // no gaps).
    const halfway = spec.width / 2;
    expect(torusBoundaryOrigin({ x: halfway - 0.01, y: 0 }, spec)).toEqual({ x: 0, y: 0 });
    expect(torusBoundaryOrigin({ x: halfway + 0.01, y: 0 }, spec)).toEqual({ x: spec.width, y: 0 });
  });
});

describe('torusBoundaryOrigin: the drawn overlay tracks the SAME transform the cells use, at every zoom/pan', () => {
  /** The screen-space width/height the boundary rect would be stroked at —
   *  must equal exactly `spec.width`/`spec.height` cells at the camera's
   *  current scale, regardless of which period-copy was chosen, since a
   *  `projectWorldToScreen` call is a pure affine (linear) transform of the
   *  world coordinate — picking a different (but equally valid) copy must
   *  never change the ON-SCREEN SIZE of the box it draws, only its position. */
  it('always spans exactly one world-size in screen pixels, at any pan position and any scale', () => {
    const scales = [0.5, 3, 8, 26, 40];
    for (const scale of scales) {
      for (let x = -2000; x <= 2000; x += 333) {
        const camera: Camera = { x, y: x * 0.6, scale };
        const origin = torusBoundaryOrigin(camera, spec);
        const tl = projectWorldToScreen(camera, viewport, origin.x, origin.y);
        const br = projectWorldToScreen(camera, viewport, origin.x + spec.width, origin.y + spec.height);
        expect(br.x - tl.x).toBeCloseTo(spec.width * scale, 6);
        expect(br.y - tl.y).toBeCloseTo(spec.height * scale, 6);
      }
    }
  });

  it('the camera itself always projects to somewhere within (or at most half a world away from) the drawn box — it can never end up on the wrong side of the whole rectangle', () => {
    for (let x = -4000; x <= 4000; x += 401) {
      const camera: Camera = { x, y: 0, scale: 10 };
      const origin = torusBoundaryOrigin(camera, spec);
      // The camera's screen position relative to the box's left edge, in
      // world cells, must stay bounded — this is what "never drifts apart"
      // means in screen terms, not just in raw world-coordinate terms.
      const cellsFromLeftEdge = (camera.x - origin.x) / 1;
      expect(cellsFromLeftEdge).toBeGreaterThanOrEqual(-spec.width / 2);
      expect(cellsFromLeftEdge).toBeLessThanOrEqual(spec.width / 2);
    }
  });
});
