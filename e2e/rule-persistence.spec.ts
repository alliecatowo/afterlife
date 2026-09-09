import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, openControl, realGen } from './utils';

/**
 * BUG: theme and art config both survive a reload, but the active simulation
 * rule didn't — switching to HighLife (B36/S23) and reloading silently
 * reverted to Conway's Life (B3/S23). The rule is documented as part of
 * world identity (the multiplayer room spec and the save format both carry
 * it), so this was a real inconsistency, not a cosmetic gap.
 *
 * Restoring a persisted rule is deliberately NOT "load the opening scene,
 * then flip the rule" — a keyframe/recorded edit is only ever valid under
 * the rule that produced it, and the opening scene is always recorded under
 * Conway (see `session.ts`'s `loadScene`, "NON-NEGOTIABLE"). So this test
 * also confirms the restored world is coherent under the new rule (empty,
 * gen 0 — a real fresh-world reset), never the Conway tableau wearing a
 * different rule's label.
 */
test.describe('rule persistence', () => {
  test('switching to HighLife survives a reload; the restored world is fresh, not Conway-recorded', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    await openControl(page, 'Rules');
    await expect(page.getByText('active rule')).toBeVisible();
    await page.getByRole('button', { name: 'Switch to HighLife (B36/S23)' }).click();

    const ruleReadout = page.locator('text=active rule').locator('..');
    await expect(ruleReadout).toContainText('B36/S23');
    // A rule switch is a fresh-world operation: the tableau is gone.
    expect(await realGen(page)).toBe(0);

    await page.reload();
    await page.locator('#world-canvas').waitFor({ state: 'attached' });
    await dismissTitle(page);
    await ensurePaused(page);

    // The regression: this used to read B3/S23 here.
    await openControl(page, 'Rules');
    await expect(page.locator('text=active rule').locator('..')).toContainText('B36/S23');

    // Coherent fresh-world restore, not a rule stapled onto Conway-recorded
    // history: nothing was ever drawn under the restored rule, so the world
    // is (and, playing an empty grid, stays) empty — the opening tableau's
    // population, which is nonzero, never got recorded under B36/S23. Gen
    // itself isn't asserted at exactly 0 here: the restored world autoplays
    // (same as a normal boot), so a couple of generations of a still-empty
    // grid may already have ticked by the time `ensurePaused` above lands.
    expect(await page.getByTestId('hud-pop').textContent()).toBe('0');

    // Clean up: switch back to Conway so this test doesn't leak a persisted
    // non-default rule into whatever runs in this browser context next.
    await page.getByRole('button', { name: /Switch to Conway/ }).click();
    await expect(page.locator('text=active rule').locator('..')).toContainText('B3/S23');
  });
});
