import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, realGen, waitForGen, worldToScreen } from './utils';

async function fullWorldSnapshot(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { engine: { spec: { width: number; height: number }; region(r: { x: number; y: number; w: number; h: number }): Uint8Array } } }).__AFTERLIFE__;
    const { width, height } = s.engine.spec;
    return Array.from(s.engine.region({ x: 0, y: 0, w: width, h: height }));
  });
}

test.describe('time travel', () => {
  test('scrubbing the ribbon while playing pauses first (closes a real race: goto() and the sim loop must never mutate the shared engine concurrently)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 20, 15_000);
    // Confirm we're genuinely playing before scrubbing.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

    const ribbon = page.getByRole('slider', { name: 'History timeline' });
    await ribbon.focus();
    await ribbon.press('Home');

    // Scrubbing must auto-pause synchronously — the Play button (not Pause)
    // should be visible immediately, not just eventually.
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    const genAfterScrub = await realGen(page);
    await page.waitForTimeout(300);
    // Still paused: gen must not have kept climbing on its own.
    expect(await realGen(page)).toBe(genAfterScrub);
  });

  test('scrubbing backward then forward reproduces identical world state', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 30, 15_000);
    await ensurePaused(page);
    const g = await realGen(page);
    const before = await fullWorldSnapshot(page);

    const ribbon = page.getByRole('slider', { name: 'History timeline' });
    await ribbon.focus();
    await ribbon.press('Home');
    await page.waitForTimeout(300);
    expect(await realGen(page)).toBeLessThan(g);

    // This is the regression this integration pass fixed: dragging/keying the
    // ribbon forward again after a backward jump must reach the REAL maxGen,
    // not get stuck at wherever the backward jump landed.
    await ribbon.press('End');
    await page.waitForTimeout(400);
    expect(await realGen(page)).toBe(g);

    const after = await fullWorldSnapshot(page);
    expect(after).toEqual(before);
  });

  test('editing the past forks a branch; the original future is preserved; compare shows a real divergence', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 15, 15_000);
    await ensurePaused(page);
    const presentGen = await realGen(page);
    const presentSnapshot = await fullWorldSnapshot(page);

    // Scrub back, then draw — this MUST fork rather than truncate the future.
    const ribbon = page.getByRole('slider', { name: 'History timeline' });
    await ribbon.focus();
    await ribbon.press('Home');
    await page.waitForTimeout(300);
    expect(await realGen(page)).toBe(0);

    // Draw a small blinker (3 adjacent cells) rather than a single cell: the
    // opening scene's establishing view is centred on genuinely empty space
    // (the "empty southern expanse" the two travellers cross), where a lone
    // isolated cell has zero living neighbours and simply dies on the very
    // next step — a real edit, but with no lasting effect to diff against.
    // Three in a row survives as an oscillator forever, guaranteeing a
    // detectable divergence at any future generation.
    await page.keyboard.press('d');
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    for (const dx of [0, 1, 2]) {
      // +0.5: request the CELL CENTER, not its corner — a corner sits exactly
      // on the boundary with the previous cell, where float round-trip
      // through screenToWorld can floor to the wrong integer cell.
      const p = await worldToScreen(page, 128 + dx + 0.5, 80.5);
      await page.mouse.click(box.x + p.x, box.y + p.y);
    }
    await page.waitForTimeout(200);

    await expect(page.getByText('Branched — the original future is kept too.')).toBeVisible();

    // The original branch's future must still exist: switch back to it via
    // the Branches panel and confirm the present-gen state is untouched.
    await page.getByRole('button', { name: 'Branches' }).click();
    await page.getByRole('button', { name: 'Return to original' }).click();
    await page.waitForTimeout(300);

    const ribbon2 = page.getByRole('slider', { name: 'History timeline' });
    await ribbon2.focus();
    await ribbon2.press('End');
    await page.waitForTimeout(400);
    expect(await realGen(page)).toBe(presentGen);
    expect(await fullWorldSnapshot(page)).toEqual(presentSnapshot);

    // Compare view: a real, non-zero divergence from `TimelineStore.diff()`.
    await page.getByRole('button', { name: 'Compare' }).click();
    await page.getByRole('button', { name: 'branch-1' }).click();
    const diffReadout = page.locator('text=differing cells').locator('..');
    await expect(diffReadout).toBeVisible();
    await expect.poll(async () => {
      const text = (await diffReadout.textContent()) ?? '';
      return Number(text.replace(/\D+/g, ''));
    }, { timeout: 5000 }).toBeGreaterThan(0);
  });
});
