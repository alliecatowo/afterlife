import { expect, test } from '@playwright/test';
import { dismissTitle, openApp } from './utils';

/**
 * Regression for a QA2-found MAJOR bug: `<main>` used a STATIC
 * `grid-cols-[var(--size-drawer)_1fr_var(--size-panel)]` template. CSS Grid
 * tracks with an explicit length never shrink to fit a narrower child, so
 * collapsing the drawer or closing the right panel changed each `<aside>`'s
 * OWN width classes but had zero effect on the actual rendered canvas size —
 * the world stayed permanently squeezed by both a 240px and a 304px column
 * regardless of what was actually open. Nothing in the previous 217 unit +
 * 27 e2e tests asserted on real layout geometry, so it shipped unnoticed.
 *
 * `App.tsx` now drives the grid TRACKS themselves (`--col-drawer`/
 * `--col-panel`) from the same open/collapsed state, so this test asserts on
 * the one thing that actually proves the fix: the world canvas's measured
 * width must genuinely differ between states.
 */
test.describe('layout: the world canvas actually resizes with drawer/panel state', () => {
  test('collapsing the drawer and closing the panel both give the canvas real width back', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    const canvasWidth = () => page.locator('#world-canvas').evaluate((el) => el.getBoundingClientRect().width);

    // Default desktop state: drawer open, no right panel.
    const wDefault = await canvasWidth();

    // Collapsing the drawer must WIDEN the canvas, not just uncover a dead
    // column — this is the exact scenario QA2 measured as a no-op (canvas
    // stuck at 896px in every state at 1440x900).
    await page.getByRole('button', { name: 'Collapse drawer' }).click();
    const wDrawerCollapsed = await canvasWidth();
    expect(wDrawerCollapsed, 'collapsing the drawer should widen the canvas').toBeGreaterThan(wDefault);

    // Opening a right panel must narrow the canvas back down.
    await page.getByRole('button', { name: 'Branches' }).click();
    const wPanelOpen = await canvasWidth();
    expect(wPanelOpen, 'opening a right panel should narrow the canvas').toBeLessThan(wDrawerCollapsed);

    // Re-expanding the drawer while the panel is open narrows it further —
    // both tracks are independently live, not just one or the other.
    await page.getByRole('button', { name: 'Expand drawer' }).click();
    const wBothOpen = await canvasWidth();
    expect(wBothOpen, 'both open should be the narrowest state').toBeLessThan(wPanelOpen);

    // Closing the panel again must restore (not just approximate) the
    // original default-state width — the drawer track alone reproduces it.
    await page.getByRole('button', { name: 'Close panel' }).click();
    const wBackToDefault = await canvasWidth();
    expect(wBackToDefault).toBeCloseTo(wDefault, 0);
  });

  test('presentation mode reclaims the drawer/panel columns too, not just the HUD/timeline bands', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    const canvasWidth = () => page.locator('#world-canvas').evaluate((el) => el.getBoundingClientRect().width);

    const wBefore = await canvasWidth();
    await page.keyboard.press('v');
    const wPresentation = await canvasWidth();
    expect(wPresentation, 'presentation mode should also collapse the drawer column').toBeGreaterThan(wBefore);
  });
});
