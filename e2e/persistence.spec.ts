import { expect, test } from '@playwright/test';
import { applyEditDirect, dismissTitle, ensurePaused, openApp, realGen, waitForGen, worldToScreen } from './utils';

test.describe('persistence', () => {
  test('save a named experiment, reload the page, reopen it — state is restored', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 22, 15_000);
    await ensurePaused(page);
    const savedGen = await realGen(page);

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
