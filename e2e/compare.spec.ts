import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, waitForGen, worldToScreen } from './utils';

/**
 * Real-pixel verification for the Compare view (BUG: a browser-driven
 * reachability audit found `#compare-canvas` mounted, correctly sized, and
 * reporting a correct "differing cells" readout — yet with NOTHING actually
 * painted onto it, so the headline "two worlds side by side" feature looked
 * entirely broken). A DOM-presence check (`toBeVisible()`, `toHaveCount(1)`,
 * ...) can't catch this: the element is present and visible the whole time.
 * Only reading the canvas's own pixels proves a second world is genuinely
 * being drawn.
 */
async function pixelSummary(page: import('@playwright/test').Page, canvasId: string): Promise<{ w: number; h: number; nonZero: number }> {
  return page.evaluate((id) => {
    const el = document.getElementById(id) as HTMLCanvasElement;
    const ctx = el.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] || data[i + 1] || data[i + 2] || data[i + 3]) nonZero++;
    }
    return { w: el.width, h: el.height, nonZero };
  }, canvasId);
}

/** Count of byte positions where the two canvases' raw `ImageData` differ —
 *  a real pixel-level diff, not a coarse/sampled fingerprint (the drawn
 *  divergence here is exactly 3 cells out of ~87,000, so anything less than
 *  an exhaustive comparison can trivially miss it and pass by accident). */
async function pixelDiffCount(page: import('@playwright/test').Page, idA: string, idB: string): Promise<number> {
  return page.evaluate(([a, b]) => {
    const elA = document.getElementById(a) as HTMLCanvasElement;
    const elB = document.getElementById(b) as HTMLCanvasElement;
    const dataA = elA.getContext('2d')!.getImageData(0, 0, elA.width, elA.height).data;
    const dataB = elB.getContext('2d')!.getImageData(0, 0, elB.width, elB.height).data;
    if (dataA.length !== dataB.length) return Infinity;
    let diff = 0;
    for (let i = 0; i < dataA.length; i++) if (dataA[i] !== dataB[i]) diff++;
    return diff;
  }, [idA, idB] as const);
}

test.describe('compare view', () => {
  test('a second, genuinely different world is actually painted onto #compare-canvas', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 15, 15_000);
    await ensurePaused(page);

    // Scrub to generation 0, then draw a surviving 3-cell blinker — editing
    // the past forks a branch (see timeline.spec.ts), guaranteeing a real,
    // permanent divergence between the two branches at every future
    // generation, including gen 0 itself.
    const ribbon = page.getByRole('slider', { name: 'History timeline' });
    await ribbon.focus();
    await ribbon.press('Home');
    await page.waitForTimeout(300);

    await page.keyboard.press('d');
    const worldCanvas = page.locator('#world-canvas');
    const box = (await worldCanvas.boundingBox())!;
    for (const dx of [0, 1, 2]) {
      const p = await worldToScreen(page, 128 + dx + 0.5, 80.5);
      await page.mouse.click(box.x + p.x, box.y + p.y);
    }
    await expect(page.getByText('Branched — the original future is kept too.')).toBeVisible();

    // Open Compare and pick the other branch ("Original" — the pre-fork
    // branch, which never received the drawn blinker).
    await page.getByRole('button', { name: 'Compare' }).click();
    await page.getByRole('button', { name: 'Original' }).click();

    const diffReadout = page.locator('text=differing cells').locator('..');
    await expect.poll(async () => {
      const text = (await diffReadout.textContent()) ?? '';
      return Number(text.replace(/\D+/g, ''));
    }, { timeout: 5000 }).toBeGreaterThan(0);

    // The DOM check the audit's tooling already did (kept here so a future
    // regression that removes the element entirely still fails obviously) —
    // but this alone is exactly what let the real bug slip through before.
    const compareCanvas = page.locator('#compare-canvas');
    await expect(compareCanvas).toBeVisible();
    await expect(compareCanvas).toHaveJSProperty('tagName', 'CANVAS');

    // The real assertion: actual, non-empty pixels, and pixels that genuinely
    // differ from the main world's canvas (never just an empty or duplicated
    // buffer) — polled because painting is legitimately one rAF away from
    // the branch selection, not synchronous.
    await expect.poll(async () => {
      const summary = await pixelSummary(page, 'compare-canvas');
      return summary.nonZero;
    }, { timeout: 5000, message: 'compare-canvas never had any non-transparent pixels' }).toBeGreaterThan(0);

    const comparePixels = await pixelSummary(page, 'compare-canvas');
    expect(comparePixels.nonZero).toBeGreaterThan(0);
    expect(comparePixels.w).toBeGreaterThan(1);
    expect(comparePixels.h).toBeGreaterThan(1);

    // Same viewport/camera (both are 448x780 halves of the same wrap), but a
    // genuinely different world: the drawn blinker exists only on the active
    // branch's canvas ("world-canvas"), not on "Original"'s (compare-canvas).
    // A byte-exact diff, not a coarse fingerprint, since the divergence is a
    // handful of cells out of tens of thousands.
    const diffBytes = await pixelDiffCount(page, 'world-canvas', 'compare-canvas');
    expect(diffBytes).toBeGreaterThan(0);
  });
});
