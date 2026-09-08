import { expect, test } from '@playwright/test';
import { dismissTitle, openApp } from './utils';

const coachMark = (page: import('@playwright/test').Page) => page.locator('[data-tour-card]');
const spotlight = (page: import('@playwright/test').Page) => page.locator('[data-tour-spotlight]');

// Mirrors `SPOTLIGHT_PADDING` in `src/ui/tutorial/layout.ts` — kept as a
// literal here (e2e specs don't go through the app's `@/` alias) with a
// generous tolerance for sub-pixel/DPR-snapping rounding.
const SPOTLIGHT_PADDING = 8;
const TOLERANCE = 2;

test.describe('guided tour: spotlight', () => {
  test('dims the interface and cuts a hole positioned over the real target, not just pointing at it', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await expect(coachMark(page)).toBeVisible();

    // Step 3 ("Pause, step, speed") anchors to a real HUD control.
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('Pause, step, speed');
    // The spotlight EASES to its new position over `--duration-base`
    // (220ms) rather than teleporting — that's the fix, not a bug — so give
    // the transition time to finish before asserting its resting place.
    await page.waitForTimeout(350);

    const target = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(target).toBeVisible();
    const targetBox = (await target.boundingBox())!;
    const cutout = spotlight(page);
    await expect(cutout).toBeVisible();
    const cutoutBox = (await cutout.boundingBox())!;

    // The cutout is the target's own bounding box padded symmetrically —
    // not some unrelated corner of the screen.
    expect(cutoutBox.x).toBeGreaterThanOrEqual(targetBox.x - SPOTLIGHT_PADDING - TOLERANCE);
    expect(cutoutBox.x).toBeLessThanOrEqual(targetBox.x - SPOTLIGHT_PADDING + TOLERANCE);
    expect(cutoutBox.y).toBeGreaterThanOrEqual(targetBox.y - SPOTLIGHT_PADDING - TOLERANCE);
    expect(cutoutBox.y).toBeLessThanOrEqual(targetBox.y - SPOTLIGHT_PADDING + TOLERANCE);
    expect(cutoutBox.width).toBeGreaterThanOrEqual(targetBox.width + SPOTLIGHT_PADDING * 2 - TOLERANCE);
    expect(cutoutBox.height).toBeGreaterThanOrEqual(targetBox.height + SPOTLIGHT_PADDING * 2 - TOLERANCE);

    // The dimming itself is real (a visible box-shadow scrim), not an inert marker.
    const boxShadow = await cutout.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(boxShadow).toContain('9999px');
    const opacity = await cutout.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeCloseTo(1, 1);
  });

  test('has no cutout for a centered step with no real target (welcome/completion)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await expect(coachMark(page)).toContainText('1 of 12');

    const opacity = await spotlight(page).evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeCloseTo(0, 1);
  });

  test('the dimming layer never blocks a click, including on the highlighted control itself', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    // Walk to the "draw" step, whose target is the Draw tool radio — the
    // spotlight now sits directly on top of it. ("Draw" is the default
    // tool, so exercise the click via "Erase" instead, whose accessible
    // name is unambiguous either way: if the overlay were intercepting
    // pointer events — the exact regression this guards against — this
    // `click()` would fail its actionability check rather than the state
    // actually flipping.)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('Drawing and erasing');

    const eraseRadio = page.getByRole('radio', { name: 'Erase' });
    await expect(eraseRadio).toHaveAttribute('aria-checked', 'false');
    await eraseRadio.click();
    await expect(eraseRadio).toHaveAttribute('aria-checked', 'true');
    // Back to Draw so the canvas click below adds a cell rather than erasing one.
    await page.getByRole('radio', { name: 'Draw' }).click();

    // And the world canvas underneath the DIMMED (non-cutout) part of the
    // screen is still a live, drawable instrument — the regression this
    // guards against once broke RLE-import/stamping/selection-move.
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const canvas = page.locator('#world-canvas');
    const popBefore = Number(await page.getByTestId('hud-pop').textContent());
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 30, box.y + box.height - 30);
    await page.waitForTimeout(80);
    const popAfter = Number(await page.getByTestId('hud-pop').textContent());
    expect(popAfter).toBeGreaterThan(popBefore);
  });

  test('a world-coordinate target ("the encounter") still shows a live, sized spotlight', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('The living world');

    const cutout = spotlight(page);
    await expect(cutout).toBeVisible();
    const box = (await cutout.boundingBox())!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('the spotlight follows a resize instead of staying put', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('Pause, step, speed');

    const before = (await spotlight(page).boundingBox())!;
    await page.setViewportSize({ width: 800, height: 700 });
    // The HUD control itself reflows with the viewport; give the resize
    // listener a moment to recompute rather than polling in a loop here.
    await page.waitForTimeout(200);
    const after = (await spotlight(page).boundingBox())!;
    expect(after).not.toEqual(before);
  });
});
