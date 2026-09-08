import { expect, test, type Page } from '@playwright/test';
import { applyEditDirect, dismissTitle, ensurePaused, openApp } from './utils';

/**
 * BUG 3: "the viewport is weird if you zoom out, different things get
 * revealed". Root cause: `WorldRenderer`'s visible-rect computation
 * recomputed its origin from `camera.x/y` independently of the raw,
 * screen-corner-derived rect whenever that raw rect already fit inside the
 * world — the two roundings (floor/ceil) disagreed by up to a cell right at
 * the zoom level where an axis crosses from "needs clamping" to "doesn't",
 * so a known structure could silently drop off the edge of what got
 * rendered as you zoomed, with nothing about the camera position itself
 * having changed. See `tests/render-visible-rect.test.ts` for the isolated,
 * pure-function regression test of the actual fix
 * (`computeVisibleWorldRect`); this is the end-to-end confirmation that a
 * real, known pattern stays visible in the ACTUAL rendered canvas across a
 * sweep of zoom levels and camera positions, including across the torus
 * seam.
 */

const BLOCK: { x: number; y: number } = { x: 60, y: 60 };
const BLOCK_SIZE = 8;

async function stampBlock(page: Page, x: number, y: number): Promise<void> {
  const cells: Array<{ x: number; y: number; alive: boolean }> = [];
  for (let j = 0; j < BLOCK_SIZE; j++) {
    for (let i = 0; i < BLOCK_SIZE; i++) cells.push({ x: x + i, y: y + j, alive: true });
  }
  await applyEditDirect(page, cells);
}

/** Count canvas pixels matching the life-lens colour family within a screen-space box. */
async function countLifeColouredPixels(
  page: Page,
  box: { x: number; y: number; w: number; h: number },
): Promise<number> {
  return page.evaluate((b) => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.max(0, Math.round(b.x * dpr));
    const y0 = Math.max(0, Math.round(b.y * dpr));
    const w = Math.min(canvas.width - x0, Math.round(b.w * dpr));
    const h = Math.min(canvas.height - y0, Math.round(b.h * dpr));
    if (w <= 0 || h <= 0) return 0;
    const { data } = ctx.getImageData(x0, y0, w, h);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) n++; // any non-transparent pixel — a rendered cell (or its coverage-buffer aggregate)
    }
    return n;
  }, box);
}

async function setCamera(page: Page, cam: { x: number; y: number; scale: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __AFTERLIFE__: { camera: { set(next: Partial<typeof c>): void } } })
      .__AFTERLIFE__.camera.set(c);
  }, cam);
  await page.waitForTimeout(120); // let the dirty-flag-gated render loop pick up the camera change
}

async function worldToScreenNow(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    (p) => (window as unknown as { __AFTERLIFE__: { renderer: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
      .__AFTERLIFE__.renderer.worldToScreen(p.x, p.y),
    { x, y },
  );
}

test.describe('render zoom: a known pattern stays visible across zoom levels (BUG 3)', () => {
  test('an 8x8 block remains rendered across zoomed-in, LOD-threshold, and zoomed-out scales', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await stampBlock(page, BLOCK.x, BLOCK.y);
    await page.waitForTimeout(100);

    const cx = BLOCK.x + BLOCK_SIZE / 2;
    const cy = BLOCK.y + BLOCK_SIZE / 2;

    // Spans both LOD paths: >=3 px/cell is the crisp per-cell path, <3 is
    // the aggregated coverage-buffer path (see `ZOOM_LOD_THRESHOLD`) —
    // including scales right around the threshold itself, where the old bug
    // was most visible.
    const scales = [20, 8, 3.5, 3, 2.5, 1.5, 0.8, 0.5];

    for (const scale of scales) {
      await setCamera(page, { x: cx, y: cy, scale });
      const screenCenter = await worldToScreenNow(page, cx, cy);
      // A generous box around the block's on-screen footprint — big enough
      // at every scale tested (even the smallest) to contain its rendered
      // representation, whether that's crisp per-cell pixels or a coverage
      // blob.
      const half = Math.max(20, (BLOCK_SIZE / 2) * scale + 12);
      const box = { x: screenCenter.x - half, y: screenCenter.y - half, w: half * 2, h: half * 2 };
      const litPixels = await countLifeColouredPixels(page, box);
      expect(litPixels, `scale=${scale}: expected the block to still render near its known screen position`).toBeGreaterThan(0);
    }
  });

  test('panning across the torus seam does not make the block disappear', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    const spec = await page.evaluate(() => (window as unknown as { __AFTERLIFE__: { engine: { spec: { width: number; height: number } } } }).__AFTERLIFE__.engine.spec);
    // Place the block straddling the world's right edge (the torus seam on X).
    const seamX = spec.width - BLOCK_SIZE / 2;
    await stampBlock(page, seamX, BLOCK.y);
    await page.waitForTimeout(100);

    const cx = (seamX + BLOCK_SIZE / 2) % spec.width;
    const cy = BLOCK.y + BLOCK_SIZE / 2;

    for (const scale of [10, 4, 2, 0.7]) {
      await setCamera(page, { x: cx, y: cy, scale });
      const screenCenter = await worldToScreenNow(page, cx, cy);
      const half = Math.max(24, (BLOCK_SIZE / 2) * scale + 16);
      const box = { x: screenCenter.x - half, y: screenCenter.y - half, w: half * 2, h: half * 2 };
      const litPixels = await countLifeColouredPixels(page, box);
      expect(litPixels, `scale=${scale} at the torus seam: expected the block to still render`).toBeGreaterThan(0);
    }
  });
});
