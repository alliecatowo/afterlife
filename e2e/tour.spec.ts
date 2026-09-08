import { expect, test } from '@playwright/test';
import { dismissTitle, openApp } from './utils';

const coachMark = (page: import('@playwright/test').Page) => page.locator('[data-tour-card]');

test.describe('guided tour', () => {
  test('auto-shows on a fresh profile, right after the title is dismissed', async ({ page }) => {
    await openApp(page);
    await expect(coachMark(page)).toBeHidden();
    await dismissTitle(page);
    await expect(coachMark(page)).toBeVisible();
    await expect(coachMark(page)).toContainText('Afterlife');
    await expect(coachMark(page)).toContainText('1 of 12');
  });

  test('does not auto-show again on a second visit', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await expect(coachMark(page)).toBeVisible();

    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(coachMark(page)).toBeHidden();

    // A fresh navigation in the same profile — localStorage persists, so
    // this is genuinely "reload the app", not a new browser.
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(300); // give the auto-start effect a chance to (not) fire
    await expect(coachMark(page)).toBeHidden();
  });

  test('is always re-runnable from the shortcuts sheet, and from the About dialog', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(coachMark(page)).toBeHidden();

    // The shortcuts sheet's own replay control.
    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();
    await page.getByRole('button', { name: 'Replay the guided tour' }).click();
    await expect(page.getByText('Keyboard shortcuts')).toBeHidden();
    await expect(coachMark(page)).toBeVisible();
    await expect(coachMark(page)).toContainText('1 of 12');
    await page.getByRole('button', { name: 'Skip tour' }).click();

    // The compact "What is this?" entry point, reachable at any time.
    await page.getByRole('button', { name: 'About AFTERLIFE' }).click();
    await expect(page.getByText('What is this')).toBeVisible();
    await page.getByRole('button', { name: 'Take the guided tour' }).click();
    await expect(page.getByText('What is this')).toBeHidden();
    await expect(coachMark(page)).toBeVisible();
    await expect(coachMark(page)).toContainText('1 of 12');
  });

  test('is skippable at any moment, and never blocks the live world underneath it', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await expect(coachMark(page)).toBeVisible();

    // The world is still a live, drawable instrument WHILE the coach mark is
    // showing — this is a guided tour of a real instrument, not a modal
    // slideshow gating interaction. Pause first (also a real, tour-external
    // control) so the population reading isn't confounded by the ordinary
    // churn of a still-running simulation.
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const canvas = page.locator('#world-canvas');
    const popBefore = Number(await page.getByTestId('hud-pop').textContent());
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + box.height - 20);
    await page.waitForTimeout(80);
    const popAfter = Number(await page.getByTestId('hud-pop').textContent());
    expect(popAfter).toBeGreaterThan(popBefore);

    await page.getByRole('button', { name: 'Skip tour' }).click();
    await expect(coachMark(page)).toBeHidden();
  });

  test('a step advances on the real action it teaches, not only on "Next"', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await expect(coachMark(page)).toContainText('1 of 12');

    // Advance by clicking through to the transport step (index 3 of 12) —
    // "Next" always works, tour or no tour, per the "never a jail" rule.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('2 of 12');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('3 of 12');
    await expect(coachMark(page)).toContainText('Pause, step, speed');

    // The real action: press space to actually pause the simulation. This
    // must advance the tour on its own — the step listens on the bus for
    // the same `playback:pause` event the HUD button and the keyboard
    // shortcut both emit, not a click on any tour-owned control.
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible(); // really paused
    await expect(coachMark(page)).toContainText('4 of 12');
  });

  test('lays out fully on-screen at 390x844, connected to a real control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await dismissTitle(page);
    await expect(coachMark(page)).toBeVisible();

    const box = (await coachMark(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);

    // Walk to a step with a real DOM anchor (not the centered welcome card)
    // and confirm the connector line + card both still land on-screen.
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(coachMark(page)).toContainText('Pause, step, speed');
    const anchoredBox = (await coachMark(page).boundingBox())!;
    expect(anchoredBox.x).toBeGreaterThanOrEqual(0);
    expect(anchoredBox.y).toBeGreaterThanOrEqual(0);
    expect(anchoredBox.x + anchoredBox.width).toBeLessThanOrEqual(390);
    expect(anchoredBox.y + anchoredBox.height).toBeLessThanOrEqual(844);
  });
});
