import { describe, expect, it } from 'vitest';
import {
  computeTorusSeams, computeVisibleWorldRect, projectWorldToScreen,
} from '@/render/renderer';
import type { Camera, Viewport } from '@/render/camera';

/**
 * Regression coverage for the real, user-reported bug (reported TWICE): the
 * torus-boundary overlay ended up "completely not surrounding the actual
 * canvas after some moving panning zooming" — a real phone screenshot showed
 * live cells in the upper-middle of the viewport and the dashed box in the
 * lower-right, overlapping almost nothing.
 *
 * BOTH prior fixes shared the same root cause: they derived the overlay's
 * position from `camera` independently of what the cell paths actually
 * drew. The first stroked a rect fixed at literal world coords
 * `[0, width] x [0, height]`. The second (`torusBoundaryOrigin`, deleted —
 * see git history) picked whichever period-copy of the grid the camera
 * *rounded* to — a different, but equally independent, guess. Its unit
 * tests swept camera positions and all passed, because they asserted the
 * same wrong model the code implemented; they never checked the actual
 * drawn cell rect at all. That is why this file no longer tests
 * `torusBoundaryOrigin`-shaped position guesses — a passing test that
 * encodes broken behaviour is worse than no test.
 *
 * The real fix: the world is drawn ONCE per frame (never tiled) as exactly
 * `computeVisibleWorldRect(camera, viewport, spec)` — every cell path
 * (`#drawZoomedIn`/`#drawZoomedOut`/`#drawGlyphs`) blits from that exact
 * rect. So the only honest "boundary" fact is where THAT rect's own span
 * crosses a multiple of `spec.width`/`spec.height` — i.e. `computeTorusSeams
 * (rect, spec)`, a pure function of the SAME rect the pixels came from, not
 * a second, parallel computation from `camera`. These tests check that
 * derivation directly, and — since a wrap seam is a fact about `rect` and
 * `spec` only, never about the camera by itself — every case here is phrased
 * in terms of the rect actually drawn, so there is no way for the assertion
 * to encode the camera-guessing mistake again by accident.
 */

const spec = { width: 256, height: 160 };
const viewport: Viewport = { width: 1440, height: 900 };

describe('computeTorusSeams: seams are a fact about the drawn rect, never a guess from the camera', () => {
  it('reports no seam at all when the visible rect sits entirely inside one period (the common, zoomed-in case)', () => {
    // A rect comfortably inside [0, 256) x [0, 160) on both axes.
    const rect = { x: 50, y: 30, w: 40, h: 20 };
    const { xs, ys } = computeTorusSeams(rect, spec);
    expect(xs).toEqual([]);
    expect(ys).toEqual([]);
  });

  it('reports exactly one x-seam when the visible rect straddles a multiple of spec.width', () => {
    // Rect spans world x in [240, 280) — crosses x=256, the wrap seam.
    const rect = { x: 240, y: 30, w: 40, h: 20 };
    const { xs } = computeTorusSeams(rect, spec);
    expect(xs).toEqual([256]);
  });

  it('reports the correct seam after panning several world-widths away (arbitrary integer multiples, not just tile 0/1)', () => {
    // Rect spans world x in [1024 - 20, 1024 + 20) — straddles 4*256=1024,
    // the kind of long-pan-distance seam a real user drags across.
    const rect = { x: 4 * spec.width - 20, y: 0, w: 40, h: 20 };
    const { xs } = computeTorusSeams(rect, spec);
    expect(xs).toEqual([4 * spec.width]);
  });

  it('reports both x and y seams simultaneously when the rect straddles both', () => {
    const rect = { x: 246, y: 155, w: 20, h: 20 };
    const { xs, ys } = computeTorusSeams(rect, spec);
    expect(xs).toEqual([256]);
    expect(ys).toEqual([160]);
  });

  it('when fully zoomed out (rect capped to exactly one world tile), finds the single interior seam for a non-aligned camera', () => {
    const camera: Camera = { x: 37, y: 0, scale: 0.5 };
    const rect = computeVisibleWorldRect(camera, viewport, spec);
    expect(rect.w).toBe(spec.width); // clamped to one tile, per computeVisibleWorldRect's own contract
    const { xs } = computeTorusSeams(rect, spec);
    // rect.x = floor(37 - 256/2) = -91; the only multiple of 256 in
    // [-91, -91+256) = [-91, 165) is 0.
    expect(xs).toEqual([0]);
  });

  it('finds seams on both edges when the fully-zoomed-out rect happens to be exactly period-aligned', () => {
    // Camera at half the world's width: `computeVisibleWorldRect` centres
    // the clamped one-tile rect on the camera, so `rect.x = floor(128 - 128)
    // = 0` — exactly a multiple of `spec.width`, unlike the general case.
    const camera: Camera = { x: spec.width / 2, y: 0, scale: 0.5 };
    const rect = computeVisibleWorldRect(camera, viewport, spec);
    expect(rect.x % spec.width).toBe(0); // confirms the aligned premise this test relies on
    const { xs } = computeTorusSeams(rect, spec);
    expect(xs).toEqual([rect.x, rect.x + rect.w]);
  });

  it('never invents a seam outside the actual drawn span, at a long sweep of pan positions', () => {
    for (let x = -3000; x <= 3000; x += 173) {
      const camera: Camera = { x, y: 0, scale: 5 };
      const rect = computeVisibleWorldRect(camera, viewport, spec);
      const { xs } = computeTorusSeams(rect, spec);
      for (const seamX of xs) {
        expect(seamX).toBeGreaterThanOrEqual(rect.x);
        expect(seamX).toBeLessThanOrEqual(rect.x + rect.w);
      }
    }
  });
});

describe('computeTorusSeams + projectWorldToScreen: a seam line, once projected, lands inside the rendered content', () => {
  it('a reported x-seam projects to an on-screen x within the rect\'s own screen span', () => {
    const camera: Camera = { x: 246, y: 0, scale: 4 };
    const rect = computeVisibleWorldRect(camera, viewport, spec);
    const { xs } = computeTorusSeams(rect, spec);
    expect(xs.length).toBeGreaterThan(0);
    const leftScreen = projectWorldToScreen(camera, viewport, rect.x, 0).x;
    const rightScreen = projectWorldToScreen(camera, viewport, rect.x + rect.w, 0).x;
    for (const seamX of xs) {
      const sx = projectWorldToScreen(camera, viewport, seamX, 0).x;
      expect(sx).toBeGreaterThanOrEqual(Math.min(leftScreen, rightScreen) - 1e-6);
      expect(sx).toBeLessThanOrEqual(Math.max(leftScreen, rightScreen) + 1e-6);
    }
  });
});
