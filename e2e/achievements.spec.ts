import { expect, test } from '@playwright/test';
import { applyEditDirect, dismissTitle, ensurePaused, openApp, suppressTour, waitForGen } from './utils';

test.describe('achievements logbook', () => {
  test('opens via its quiet trigger tab, lists every achievement, and unearned ones read as honest description text (not a locked riddle)', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    const trigger = page.getByRole('button', { name: 'Logbook' });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Logbook' })).toBeVisible();
    // A fresh profile has earned nothing yet, but every entry is still
    // listed with a real description — never hidden, never a "???".
    await expect(dialog.getByText('A traveler, recognized')).toBeVisible();
    await expect(dialog.getByText(/glider was identified in the field/)).toBeVisible();
    await expect(dialog).not.toContainText('???');
    await expect(dialog).not.toContainText('locked');
  });

  test('closes on Escape and reopens via the "l" shortcut', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    await page.getByRole('button', { name: 'Logbook' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.keyboard.press('l');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('a real fork earns "A second future" with its actual generation, visible without reloading', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 20, 15_000);
    await ensurePaused(page);

    // Scrub back to a real, non-zero generation (the debug hook's `gotoGen`
    // — the same mechanism the tour's own "fork" step uses), then commit an
    // edit there. That's a real fork (`fromGen > 0`), not the automatic
    // "One Cell" experiment's sibling branch this achievement deliberately
    // excludes.
    await page.evaluate(() => {
      void (window as unknown as { __AFTERLIFE__: { gotoGen(g: number): Promise<void> } }).__AFTERLIFE__.gotoGen(10);
    });
    await page.waitForTimeout(200);
    await applyEditDirect(page, [{ x: 20, y: 20, alive: true }]);
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'Logbook' }).click();
    const dialog = page.getByRole('dialog');
    // Scoped to THIS row specifically — the opening scene's own travelers
    // are real gliders, so an ambient Field Guide scan earning "A traveler,
    // recognized" at the same coincidental generation is entirely plausible
    // and not a false positive to guard against here.
    const row = dialog.locator('li', { hasText: 'A second future' });
    await expect(row).toBeVisible();
    await expect(row.getByText(/^gen 10$/)).toBeVisible();
  });

  test('never blocks a click on the world underneath its quiet trigger tab', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();

    const canvas = page.locator('#world-canvas');
    const popBefore = Number(await page.getByTestId('hud-pop').textContent());
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 60, box.y + box.height - 40);
    await page.waitForTimeout(80);
    const popAfter = Number(await page.getByTestId('hud-pop').textContent());
    expect(popAfter).toBeGreaterThan(popBefore);
  });
});
