import { expect, test } from '@playwright/test';
import {
  applyEditDirect, dismissTitle, ensurePaused, openApp, openControl, regionPopulation, suppressTour,
} from './utils';

/**
 * Two features that were fully built, unit-tested, and committed, but never
 * mounted anywhere the running app could reach them — see
 * INTEGRATION-NOTES.md's "rules" and "multiplayer foundation" entries. This
 * file proves both are now genuinely reachable and functional, not just
 * present in the bundle.
 */

test.describe('Rules panel', () => {
  test('opens on desktop (via the HUD\'s "More tools" menu), defaults to Conway, and switching to Seeds visibly changes simulation behaviour', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    await openControl(page, 'Rules');
    await expect(page.locator('#panel-right')).toContainText('Rules');

    const panel = page.locator('#panel-right');

    // Conway is the default; the "leaving Conway" warning must not show yet.
    await expect(panel.getByRole('status')).toHaveCount(0);
    await expect(page.getByTestId('hud-rule')).toHaveText('B3/S23');

    const seedsCard = page.getByRole('listitem').filter({ has: page.getByText('Seeds', { exact: true }) });
    await expect(seedsCard).toBeVisible();
    const seedsButton = seedsCard.getByRole('button', { name: /^Switch to Seeds/ });
    await seedsButton.click();

    // The honest warning actually surfaces once you leave Conway.
    await expect(panel.getByRole('status')).toContainText(/verified under Conway/i);
    // The button's `aria-label` names the action ("Switch to Seeds..."), not
    // the current state, so its accessible name doesn't change — the
    // visible label flips to "Active" and it becomes disabled instead.
    await expect(seedsButton).toBeDisabled();
    await expect(seedsButton).toHaveText('Active');
    await expect(page.getByTestId('hud-rule')).toHaveText('B2/S');

    // Switching rules is a fresh-world operation (Session.setRule's own
    // doc) — draw the EXACT pattern content-rules.ts's own verified claim
    // for Seeds uses: a single 2x2 block. Under Conway that's a permanently
    // static "block" still-life; Seeds (no survivals, birth at exactly 2
    // neighbours) is supposed to make it explode instead.
    await applyEditDirect(page, [
      { x: 32, y: 32, alive: true }, { x: 33, y: 32, alive: true },
      { x: 32, y: 33, alive: true }, { x: 33, y: 33, alive: true },
    ]);
    expect(await regionPopulation(page, { x: 0, y: 0, w: 64, h: 64 })).toBe(4);

    const stepForward = page.getByRole('button', { name: 'Step forward' });
    for (let i = 0; i < 12; i++) await stepForward.click();

    const pop = await regionPopulation(page, { x: 0, y: 0, w: 64, h: 64 });
    expect(pop, 'a 2x2 block under Seeds should have exploded well past its starting 4 cells').toBeGreaterThan(20);
  });
});

test.describe('Multiplayer', () => {
  test('stays completely inert until the user opens it, then a room can actually be created', async ({ page }) => {
    // Prove the offline guarantee at the browser level, not just via
    // tests/net-guard.test.tsx's module-import checks: a fresh page load
    // never constructs a BroadcastChannel, even though the feature is now
    // mounted (`@/ui/hud/multiplayerLazy.tsx`'s dynamic import gate).
    await page.addInitScript(() => {
      (window as unknown as { __bcCount: number }).__bcCount = 0;
      const OriginalBC = window.BroadcastChannel;
      class CountingBC extends OriginalBC {
        constructor(name: string) {
          super(name);
          (window as unknown as { __bcCount: number }).__bcCount++;
        }
      }
      // @ts-expect-error -- test-only global stand-in
      window.BroadcastChannel = CountingBC;
    });
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __bcCount: number }).__bcCount)).toBe(0);

    await openControl(page, 'Multiplayer');
    const dialog = page.getByRole('dialog', { name: 'Multiplayer' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Host a new room' }).click();

    // Hosting actually opens a real BroadcastChannel-backed room — the
    // panel flips from the host/join form to the in-room view with a real
    // room code once it does.
    await expect(dialog.getByText(/^[A-Z2-9]{6}$/)).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { __bcCount: number }).__bcCount)).toBeGreaterThan(0);
    await expect(dialog.getByText(/Alice|Observer \d+/)).toBeVisible();
  });
});
