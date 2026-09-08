import { expect, test } from '@playwright/test';
import { applyEditDirect, dismissTitle, ensurePaused, openApp, realGen, waitForGen, worldToScreen } from './utils';

/** Real engine content (not just the generation number) — population, and one
 *  live cell's lineage hue — via the dev-only `window.__AFTERLIFE__` hook. */
async function worldFingerprint(page: import('@playwright/test').Page): Promise<{ population: number; sampleX: number; sampleY: number; sampleHue: number }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { engine: { spec: { width: number; height: number }; population: number; get(x: number, y: number): boolean; hueAt(x: number, y: number): number } } }).__AFTERLIFE__;
    const { engine } = s;
    const { width, height } = engine.spec;
    let sampleX = -1;
    let sampleY = -1;
    for (let y = 0; y < height && sampleX < 0; y++) {
      for (let x = 0; x < width; x++) {
        if (engine.get(x, y)) { sampleX = x; sampleY = y; break; }
      }
    }
    return { population: engine.population, sampleX, sampleY, sampleHue: sampleX >= 0 ? engine.hueAt(sampleX, sampleY) : -1 };
  });
}

test.describe('persistence', () => {
  test('save a named experiment, reload the page, reopen it — state is restored', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 22, 15_000);
    await ensurePaused(page);
    const savedGen = await realGen(page);
    // Real world content, not just the generation number — this is exactly
    // what a gen-0-edit-dropping replay bug (see @/core/history.ts's
    // applyBaselineEdits) would silently break: the generation number can
    // still be right while the world itself replayed as empty.
    const savedFingerprint = await worldFingerprint(page);
    expect(savedFingerprint.population).toBeGreaterThan(0);
    expect(savedFingerprint.sampleX).toBeGreaterThanOrEqual(0);

    await page.getByRole('button', { name: 'Save & export' }).click();
    const titleInput = page.getByRole('textbox').first();
    await titleInput.fill('E2E Save Test');
    await page.getByRole('button', { name: 'Save as new' }).click();
    await expect(page.getByText('Saved "E2E Save Test".')).toBeVisible();
    const savesList = page.locator('ul').filter({ hasText: 'E2E Save Test' });
    await expect(savesList).toBeVisible();

    await page.reload();
    await page.locator('#world-canvas').waitFor({ state: 'attached' });
    await dismissTitle(page);
    await ensurePaused(page);

    // Fresh boot goes straight back to the opening scene (gen resets low), not
    // the save — reload never silently restores a session.
    expect(await realGen(page)).toBeLessThan(savedGen);

    await page.getByRole('button', { name: 'Save & export' }).click();
    await expect(page.locator('ul').filter({ hasText: 'E2E Save Test' })).toBeVisible();
    await page.locator('li', { hasText: 'E2E Save Test' }).getByRole('button', { name: 'Load' }).click();
    await page.waitForTimeout(400);

    expect(await realGen(page)).toBe(savedGen);
    // The world itself — including its lineage colour, reconstructed purely
    // by deterministic replay, never a stored snapshot — must match exactly,
    // not just the generation counter.
    const reopenedFingerprint = await worldFingerprint(page);
    expect(reopenedFingerprint.population).toBe(savedFingerprint.population);
    expect(reopenedFingerprint.sampleX).toBe(savedFingerprint.sampleX);
    expect(reopenedFingerprint.sampleY).toBe(savedFingerprint.sampleY);
    expect(reopenedFingerprint.sampleHue).toBeCloseTo(savedFingerprint.sampleHue, 5);
  });

  test('RLE export -> import round-trips the same pattern through the UI', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    // A small, unambiguous region that's both empty in the opening scene AND
    // actually inside the establishing camera's visible viewport (a remote
    // world corner like (12, 148) is empty but off-screen at the default
    // zoom — `worldToScreen` would return negative/out-of-canvas pixels and
    // the drag would miss the canvas entirely).
    const rect = { x: 90, y: 120, w: 3, h: 3 };
    const glider = [
      { x: rect.x + 1, y: rect.y, alive: true },
      { x: rect.x + 2, y: rect.y + 1, alive: true },
      { x: rect.x, y: rect.y + 2, alive: true },
      { x: rect.x + 1, y: rect.y + 2, alive: true },
      { x: rect.x + 2, y: rect.y + 2, alive: true },
    ];
    await applyEditDirect(page, glider);
    await page.waitForTimeout(100);
    const before = await page.getByTestId('hud-pop').textContent();

    // Select `rect` (with a 1-cell margin so float round-trip through
    // screenToWorld can't accidentally clip a boundary row/column) through
    // the UI, via real screen coordinates. `toRLE` trims to the tight
    // live-cell bbox regardless, so the extra margin doesn't change the
    // exported shape.
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const topLeft = await worldToScreen(page, rect.x - 0.5, rect.y - 0.5);
    const bottomRight = await worldToScreen(page, rect.x + rect.w + 0.5, rect.y + rect.h + 0.5);
    await page.keyboard.press('s');
    await page.mouse.move(box.x + topLeft.x, box.y + topLeft.y);
    await page.mouse.down();
    await page.mouse.move(box.x + bottomRight.x, box.y + bottomRight.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    await page.getByRole('button', { name: 'Save & export' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export RLE' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Clear the region directly (test scaffolding — the erase tool isn't the
    // feature under test here) and confirm the import brings it back exactly.
    await applyEditDirect(page, glider.map((c) => ({ ...c, alive: false })));
    await page.waitForTimeout(100);
    expect(await page.getByTestId('hud-pop').textContent()).not.toBe(before);

    const fileInput = page.locator('input[type="file"][accept*="rle"]');
    await fileInput.setInputFiles(path!);
    await expect(page.getByText(/^Imported/)).toBeVisible();
    await page.waitForTimeout(150);

    expect(await page.getByTestId('hud-pop').textContent()).toBe(before);
  });
});
