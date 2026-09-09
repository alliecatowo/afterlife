import { expect, test, type Page } from '@playwright/test';
import { applyEditDirect, dismissTitle, ensurePaused, openApp } from './utils';

/**
 * Real, user-reported bug (reported TWICE, still broken both times): "the
 * torus-boundary overlay... completely not surrounding the actual canvas
 * after some moving panning zooming" — a real-phone screenshot showed live
 * cells in the upper-middle of the viewport and the dashed box sitting in
 * the lower-right, overlapping almost nothing.
 *
 * Both prior fixes shared the same flaw: the overlay's screen position was
 * independently RE-DERIVED from `camera`, in parallel with (never sharing
 * code with) whatever the cell paths actually blitted — so the two could
 * (and, per the reports, did) disagree. `tests/render-torus-boundary.test.ts`
 * covers the new pure geometry (`computeTorusSeams`) in isolation, but a unit
 * test asserting on internal maths is exactly what let the SECOND broken
 * version ship looking green — its camera-sweep tests all passed while the
 * real thing was visibly wrong, because they encoded the same wrong model
 * the code did. This file is the antidote: it samples the REAL canvas'
 * actual pixels, not internal formulas, and checks the drawn overlay against
 * where a real, known, live pattern actually rendered.
 */

const WORLD = { width: 256, height: 160 };

async function setCamera(page: Page, cam: { x: number; y: number; scale: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __AFTERLIFE__: { camera: { set(next: Partial<typeof c>): void } } })
      .__AFTERLIFE__.camera.set(c);
  }, cam);
  await page.waitForTimeout(120); // let the dirty-flag-gated render loop pick up the camera change
}

async function setShowGrid(page: Page, show: boolean): Promise<void> {
  await page.evaluate((s) => {
    (window as unknown as { __AFTERLIFE__: { renderer: { setShowGrid(show: boolean): void } } })
      .__AFTERLIFE__.renderer.setShowGrid(s);
  }, show);
  await page.waitForTimeout(60);
}

async function worldToScreenNow(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (p) => (window as unknown as { __AFTERLIFE__: { renderer: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
      .__AFTERLIFE__.renderer.worldToScreen(p.x, p.y),
    { x, y },
  );
}

/**
 * Scans the ACTUAL `#world-canvas` pixels (device pixels, post-DPR) and
 * classifies each into two disjoint buckets, returning each bucket's
 * device-pixel bounding box:
 *  - "life": fully opaque (alpha===255 — the crisp zoomed-in path's exact
 *    per-cell alpha, see `#writeCellPixel`'s default case) AND distinctly
 *    green (the default 'life' lens's colour family) — i.e. a real rendered
 *    live cell, nothing invented.
 *  - "boundary": translucent (partial alpha — the ONLY overlay drawn at
 *    partial alpha once the grid is turned off and no selection/ghost/diff
 *    is active, per `#drawTorusBoundary`'s `withAlpha(tokLineStrong, 0.55)`)
 *    AND low-saturation (channels close together — `--color-line-strong` is
 *    a near-neutral grey, unlike the green life colour or any other lens
 *    accent) — i.e. an actual dashed seam-line pixel.
 * No internal renderer maths is used to decide what's a "cell" or a
 * "boundary" pixel here — only the raw RGBA bytes a real user's screen would
 * actually show.
 */
async function analyzeCanvas(page: Page): Promise<{
  life: { minX: number; maxX: number; minY: number; maxY: number; count: number };
  boundary: { minX: number; maxX: number; minY: number; maxY: number; count: number };
}> {
  return page.evaluate(() => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lifeMinX = Infinity; let lifeMaxX = -Infinity; let lifeMinY = Infinity; let lifeMaxY = -Infinity; let lifeCount = 0;
    let bMinX = Infinity; let bMaxX = -Infinity; let bMinY = Infinity; let bMaxY = -Infinity; let bCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i]!; const g = data[i + 1]!; const b = data[i + 2]!; const a = data[i + 3]!;
        if (a === 255) {
          if (g > r + 15 && g > b + 15) {
            lifeCount++;
            if (x < lifeMinX) lifeMinX = x;
            if (x > lifeMaxX) lifeMaxX = x;
            if (y < lifeMinY) lifeMinY = y;
            if (y > lifeMaxY) lifeMaxY = y;
          }
        } else if (a > 20 && a < 230) {
          const maxc = Math.max(r, g, b); const minc = Math.min(r, g, b);
          if (maxc - minc < 25) {
            bCount++;
            if (x < bMinX) bMinX = x;
            if (x > bMaxX) bMaxX = x;
            if (y < bMinY) bMinY = y;
            if (y > bMaxY) bMaxY = y;
          }
        }
      }
    }
    return {
      life: { minX: lifeMinX, maxX: lifeMaxX, minY: lifeMinY, maxY: lifeMaxY, count: lifeCount },
      boundary: { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY, count: bCount },
    };
  });
}

async function stampPerimeter(page: Page): Promise<void> {
  const cells: Array<{ x: number; y: number; alive: boolean }> = [];
  for (let x = 0; x < WORLD.width; x++) {
    cells.push({ x, y: 0, alive: true });
    cells.push({ x, y: WORLD.height - 1, alive: true });
  }
  for (let y = 0; y < WORLD.height; y++) {
    cells.push({ x: 0, y, alive: true });
    cells.push({ x: WORLD.width - 1, y, alive: true });
  }
  await applyEditDirect(page, cells);
}

test.describe('torus boundary overlay: real pixels, not internal maths', () => {
  test('the dashed seam box exactly brackets a perimeter pattern touching all four world edges, and survives long pans across many seams', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await setShowGrid(page, false);
    await stampPerimeter(page);
    await page.waitForTimeout(100);

    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);

    // World centre (128.5, 80.5) makes `computeVisibleWorldRect` clamp the
    // drawn tile to EXACTLY [0,256] x [0,160] (see the module's own doc on
    // rounding: `floor(128.5 - 128) = 0` exactly) — a deterministic, known
    // placement to compare pixels against. The other two cases pan by
    // large, deliberately non-round multiples of the world size in BOTH
    // directions (the "long drag" the user described) — camera.x = 128.5 +
    // N*width keeps that same exact-alignment property (`floor(128.5 + N*w
    // - w/2) === N*w`), just centred on tile copy N instead of copy 0. On a
    // torus the rendered content (and therefore this overlay) must look
    // IDENTICAL up to that shift regardless of how far the camera has
    // wandered, since `wrap()` makes every multiple-of-period offset
    // equivalent — `originX`/`originY` below is what "identical" actually
    // means in on-screen terms for each pan.
    const cameras = [
      { x: 128.5, y: 80.5, scale: 3, originX: 0, originY: 0 },
      {
        x: 128.5 + 7 * WORLD.width, y: 80.5 - 4 * WORLD.height, scale: 3,
        originX: 7 * WORLD.width, originY: -4 * WORLD.height,
      },
      {
        x: 128.5 - 11 * WORLD.width, y: 80.5 + 9 * WORLD.height, scale: 3,
        originX: -11 * WORLD.width, originY: 9 * WORLD.height,
      },
    ];

    for (const cam of cameras) {
      await setCamera(page, { x: cam.x, y: cam.y, scale: cam.scale });
      const tl = await worldToScreenNow(page, cam.originX, cam.originY);
      const br = await worldToScreenNow(page, cam.originX + WORLD.width, cam.originY + WORLD.height);
      const expected = {
        x0: tl.x * dpr, y0: tl.y * dpr, x1: br.x * dpr, y1: br.y * dpr,
      };
      const { life, boundary } = await analyzeCanvas(page);

      expect(life.count, `camera=${JSON.stringify(cam)}: expected the perimeter to render`).toBeGreaterThan(0);
      expect(boundary.count, `camera=${JSON.stringify(cam)}: expected a drawn boundary`).toBeGreaterThan(0);

      const tol = 6; // dashes, 1px hairlines, and rounding — a few device px of slack
      // The live perimeter's own bounding box must sit at the world's real
      // screen-projected corners...
      expect(life.minX).toBeGreaterThan(expected.x0 - tol);
      expect(life.maxX).toBeLessThan(expected.x1 + tol);
      expect(life.minY).toBeGreaterThan(expected.y0 - tol);
      expect(life.maxY).toBeLessThan(expected.y1 + tol);
      // ...and the drawn boundary must sit at THE SAME corners — i.e. it
      // actually brackets the live cells, not some camera-derived guess
      // floating off in an unrelated corner of the canvas (the reported bug).
      expect(Math.abs(boundary.minX - expected.x0)).toBeLessThan(tol);
      expect(Math.abs(boundary.maxX - expected.x1)).toBeLessThan(tol);
      expect(Math.abs(boundary.minY - expected.y0)).toBeLessThan(tol);
      expect(Math.abs(boundary.maxY - expected.y1)).toBeLessThan(tol);
    }
  });

  test('a live block straddling the wrap seam is bisected by the boundary line, not missed by it', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await setShowGrid(page, false);

    // An 8x8 block placed so it straddles world x = 256 (wraps to x=[252..255]+[0..3]).
    const cells: Array<{ x: number; y: number; alive: boolean }> = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        cells.push({ x: (WORLD.width - 4 + i) % WORLD.width, y: 60 + j, alive: true });
      }
    }
    await applyEditDirect(page, cells);
    await page.waitForTimeout(100);

    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    await setCamera(page, { x: WORLD.width, y: 64, scale: 10 });
    const seamScreen = await worldToScreenNow(page, WORLD.width, 64);
    const expectedSeamX = seamScreen.x * dpr;

    const { life, boundary } = await analyzeCanvas(page);
    expect(life.count).toBeGreaterThan(0);
    expect(boundary.count).toBeGreaterThan(0);

    // The seam line must fall INSIDE the live block's own on-screen span —
    // i.e. it visibly cuts through the structure it's supposed to mark, the
    // exact opposite of the reported bug (a box nowhere near the cells).
    expect(boundary.minX).toBeGreaterThanOrEqual(life.minX - 2);
    expect(boundary.maxX).toBeLessThanOrEqual(life.maxX + 2);
    expect(Math.abs((boundary.minX + boundary.maxX) / 2 - expectedSeamX)).toBeLessThan(6);
  });

  test('no boundary is drawn when no wrap seam is anywhere on screen (the honest common case)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await setShowGrid(page, false);

    const cells: Array<{ x: number; y: number; alive: boolean }> = [];
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) cells.push({ x: 124 + i, y: 76 + j, alive: true });
    }
    await applyEditDirect(page, cells);
    await page.waitForTimeout(100);

    // Camera centred on the world's own centre, zoomed in enough that the
    // visible span (±72 cells x, ±45 cells y at scale 10 in a 1440x900
    // viewport) stays well clear of every seam (multiples of 256 / 160).
    await setCamera(page, { x: 128, y: 80, scale: 10 });
    const { life, boundary } = await analyzeCanvas(page);
    expect(life.count).toBeGreaterThan(0);
    expect(boundary.count).toBe(0);
  });
});
