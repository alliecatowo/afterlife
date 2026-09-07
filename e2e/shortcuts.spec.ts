import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, realGen } from './utils';

test.describe('keyboard shortcuts', () => {
  test('transport, lens, grid, undo and the shortcuts sheet all do what they claim', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    // Space: play/pause.
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

    // '.': step forward one generation while paused.
    const g0 = await realGen(page);
    await page.keyboard.press('.');
    await page.waitForTimeout(80);
    expect(await realGen(page)).toBe(g0 + 1);

    // ']' / '[': speed up / down.
    await page.keyboard.press(']');
    await expect(page.getByRole('radio', { name: '30', exact: true })).toHaveAttribute('data-state', 'on');
    await page.keyboard.press('[');
    await expect(page.getByRole('radio', { name: '12', exact: true })).toHaveAttribute('data-state', 'on');

    // '1'/'2'/'3': render lens.
    await page.keyboard.press('2');
    await expect(page.getByRole('radio', { name: 'Age' })).toHaveAttribute('data-state', 'on');
    await page.keyboard.press('1');
    await expect(page.getByRole('radio', { name: 'Life' })).toHaveAttribute('data-state', 'on');

    // 'g': grid toggle reflected on the canvas.
    const canvas = page.locator('#world-canvas');
    const initialGrid = await canvas.getAttribute('data-show-grid');
    await page.keyboard.press('g');
    await expect(canvas).toHaveAttribute('data-show-grid', String(initialGrid === 'true' ? false : true));

    // 'z': undo reverts the last edit.
    await page.keyboard.press('d');
    const box = (await canvas.boundingBox())!;
    const popBefore = Number(await page.getByTestId('hud-pop').textContent());
    await page.mouse.click(box.x + 30, box.y + box.height - 30);
    await page.waitForTimeout(80);
    const popAfterDraw = Number(await page.getByTestId('hud-pop').textContent());
    expect(popAfterDraw).toBeGreaterThan(popBefore);
    await page.keyboard.press('z');
    await page.waitForTimeout(120);
    expect(Number(await page.getByTestId('hud-pop').textContent())).toBe(popBefore);

    // '?': the shortcuts sheet opens, and Escape closes it.
    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Keyboard shortcuts')).toBeHidden();
  });

  test('presentation mode hides chrome', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.keyboard.press('v');
    const hud = page.locator('#hud-top');
    const timeline = page.locator('#timeline');
    await expect(hud).toHaveCSS('height', '0px');
    await expect(timeline).toHaveCSS('height', '0px');
    await page.keyboard.press('Escape');
    await expect(hud).not.toHaveCSS('height', '0px');
  });

  test('prefers-reduced-motion zeroes the design system durations', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    const duration = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--duration-base').trim());
    expect(['0ms', '0s', '0']).toContain(duration);
  });
});
