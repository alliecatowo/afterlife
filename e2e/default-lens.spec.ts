import { expect, test, type Page } from '@playwright/test';
import { collectConsoleErrors, dismissTitle, openApp, suppressTour } from './utils';

/**
 * Regression coverage for the default-lens fix: `life` is, by design, a
 * single fixed hue (green = alive, honestly conveying nothing else beyond
 * that), so a first-ever visit with zero configuration used to read as a
 * flat monochrome world — reported directly, twice. `@/ui/store.ts`'s
 * default is now `lineage` (ancestry hue — a newborn's hue is the circular
 * mean of its 3 parents', so distinct colours mean distinct family lines,
 * not decoration). This asserts the OPENING view specifically (generation
 * 0, no interaction, no lens switch) — not a lens switched to manually mid-
 * test, which `e2e/prod-build.spec.ts` already covers for all 8 lenses.
 */

/** Same hue-bucketing approach as `prod-build.spec.ts`'s `significantHueBuckets`
 *  — bucketed to the nearest 20 degrees and filtered to a meaningful share
 *  of coloured (non-grey, non-transparent) pixels, so anti-aliasing noise
 *  or a handful of stray pixels can't manufacture a false pass. */
async function significantHueBuckets(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map<number, number>();
    let coloredTotal = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 40) continue;
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d < 0.04) continue;
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60);
      if (h < 0) h += 360;
      const bucket = Math.floor(h / 20) * 20;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      coloredTotal++;
    }
    const threshold = Math.max(20, coloredTotal * 0.015);
    return [...buckets.entries()].filter(([, count]) => count >= threshold).map(([bucket]) => bucket);
  });
}

test.describe('default lens: colourful on first load, zero configuration', () => {
  test('a fresh boot defaults to lineage, not life', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    // The HUD's lens `Menu` trigger names the active lens in its accessible
    // name (`Hud.tsx`: `Render lens: ${lensLabel(lens)}. Open to change.`) —
    // a real, user-facing signal of the live `useAppStore` value, not an
    // internal hook.
    await expect(page.getByRole('button', { name: /Render lens: Lineage/i })).toBeVisible();
  });

  test('the opening scene (generation 0, no interaction) shows several genuinely distinct hues', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    // No camera move, no lens switch, no step — exactly what a brand new
    // visitor sees.
    await page.waitForTimeout(300);

    const buckets = await significantHueBuckets(page);
    expect(buckets.length, `hue buckets seen: ${JSON.stringify(buckets)}`).toBeGreaterThanOrEqual(3);

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});
