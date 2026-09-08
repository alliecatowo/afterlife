import { expect, test } from '@playwright/test';
import { dismissTitle, openApp, openControl } from './utils';

/**
 * The theming system (`src/ui/theme/**`, `src/ui/panels/ThemePanel.tsx`).
 * Contrast/distinctness are measured and asserted in unit tests
 * (`tests/theme-*.test.ts`) — this file proves the runtime wiring: switching
 * a theme visibly repaints BOTH the chrome (a real CSS custom property) and
 * the canvas world (a real pixel, sampled from the live 2D context — this is
 * exactly the path `resolveCssColor` runs at draw time, so a pixel actually
 * changing proves that resolution still works end to end), and that the
 * choice survives a reload.
 */
async function chromeInk900(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-ink-900').trim());
}

/** Average RGB across every sufficiently-opaque (real, drawn) pixel on the
 *  world canvas — same "scan the whole canvas, ignore transparent background"
 *  approach as `e2e/default-lens.spec.ts`'s `significantHueBuckets`. A single
 *  fixed coordinate is unreliable (it may land on a dead/transparent cell,
 *  which reveals nothing about the theme), and the default lens is `lineage`
 *  (ancestry hue), whose colour ramp is only bucketed dark-vs-light — see
 *  this file's own test below for why the comparison is Observatory (dark) →
 *  Ivory Plate (light), not a same-scheme swap. */
async function averageOpaquePixel(page: import('@playwright/test').Page): Promise<[number, number, number]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('world canvas has no 2D context');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 40) continue;
      r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
    }
    if (n === 0) return [-1, -1, -1];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

test.describe('theming', () => {
  test('the Appearance panel is reachable and lists the shipped themes', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await openControl(page, 'Settings');
    await page.getByRole('button', { name: 'More appearance options' }).click();
    await expect(page.getByText('Appearance', { exact: true }).first()).toBeVisible();
    for (const name of ['Observatory', 'Ivory Plate', 'High Contrast', 'Phosphor', 'Cyanotype']) {
      await expect(page.getByRole('radio', { name: new RegExp(name) })).toBeVisible();
    }
  });

  test('switching from Observatory to Ivory Plate repaints both the chrome and the canvas world, and persists across reload', async ({ page }) => {
    // Force a deterministic starting theme: with no persisted choice yet,
    // `initTheme()` derives the default from the real OS/CI `prefers-color-
    // scheme` (see `src/ui/theme/store.ts`), which this sandbox may report
    // as light — exactly the "respect the system preference" feature this
    // suite verifies elsewhere, but this test is specifically about the
    // SWITCH, so it pins the starting scheme rather than assuming one.
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(300); // let the opening scene populate a few live cells first

    const inkBefore = await chromeInk900(page);
    const pixelBefore = await averageOpaquePixel(page);
    expect(pixelBefore, 'the opening scene should have drawn at least one live cell').not.toEqual([-1, -1, -1]);

    await openControl(page, 'Settings');
    await page.getByRole('button', { name: 'More appearance options' }).click();
    await page.getByRole('radio', { name: /Ivory Plate/ }).click();

    const inkAfter = await chromeInk900(page);
    expect(inkAfter).not.toBe(inkBefore);

    // Give the renderer a couple of frames to redraw with the new theme.
    await page.waitForTimeout(200);
    const pixelAfter = await averageOpaquePixel(page);
    expect(pixelAfter).not.toEqual(pixelBefore);

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ivory-plate');

    await page.reload();
    await page.locator('#world-canvas').waitFor({ state: 'attached' });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ivory-plate');
    expect(await chromeInk900(page)).toBe(inkAfter);
  });

  test('the theme radiogroup is keyboard-operable', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await openControl(page, 'Settings');
    await page.getByRole('button', { name: 'More appearance options' }).click();

    const highContrast = page.getByRole('radio', { name: /High Contrast/ });
    await highContrast.focus();
    await page.keyboard.press('Enter');
    await expect(highContrast).toHaveAttribute('aria-checked', 'true');
  });

  test('a custom theme with colliding accents cannot be saved', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await openControl(page, 'Settings');
    await page.getByRole('button', { name: 'More appearance options' }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();

    const life = page.getByLabel('Life colour');
    const diff = page.getByLabel('Diff colour');
    const lifeValue = await life.inputValue();
    await diff.fill(lifeValue);

    await expect(page.getByText(/Too similar to distinguish/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save theme' })).toBeDisabled();
  });

  test('resetting returns to Observatory', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await openControl(page, 'Settings');
    await page.getByRole('button', { name: 'More appearance options' }).click();
    await page.getByRole('radio', { name: /Cyanotype/ }).click();
    await expect(page.getByRole('radio', { name: /Cyanotype/ })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Reset to Observatory' }).click();
    await expect(page.getByRole('radio', { name: /Observatory/ })).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('observatory');
  });
});
