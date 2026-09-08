import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, openControl } from './utils';

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

async function canvasPixel(page: import('@playwright/test').Page): Promise<[number, number, number, number]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('world canvas has no 2D context');
    const { width, height } = canvas;
    const d = ctx.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
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

  test('switching themes repaints both the chrome and the canvas world, and persists across reload', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    const inkBefore = await chromeInk900(page);
    const pixelBefore = await canvasPixel(page);

    await openControl(page, 'Settings');
    await page.getByRole('button', { name: 'More appearance options' }).click();
    await page.getByRole('radio', { name: /Phosphor/ }).click();

    const inkAfter = await chromeInk900(page);
    expect(inkAfter).not.toBe(inkBefore);

    // Give the renderer one frame to redraw with the new ground colour.
    await page.waitForTimeout(150);
    const pixelAfter = await canvasPixel(page);
    expect(pixelAfter).not.toEqual(pixelBefore);

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('phosphor');

    await page.reload();
    await page.locator('#world-canvas').waitFor({ state: 'attached' });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('phosphor');
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
