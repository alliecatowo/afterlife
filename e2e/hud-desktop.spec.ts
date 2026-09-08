import { expect, test } from '@playwright/test';
import { dismissTitle, openApp, suppressTour } from './utils';

/**
 * Regression coverage for the desktop lens-discoverability bug: a `Toggle`
 * group capped to `max-w-[210px]` with no scrollbar/chevron/gradient hint
 * left 4 of the 8 render lenses (Immigration, QuadLife, Velocity, Neighbors)
 * entirely unreachable at 1440x900 for a normal mouse user — confirmed on
 * the live production site, not just in dev. `Hud.tsx` now uses a `Menu`
 * (Radix DropdownMenu) instead: a fixed-width trigger plus a popover that
 * lists every lens.
 *
 * `e2e/mobile.spec.ts`'s existing "the HUD row never overflows horizontally"
 * assertion only checks `#hud-top`'s OUTER row, and only runs under the
 * `mobile` project (390px) — it never actually exercised the desktop
 * project's own, differently-composed icon row, which is exactly how the
 * capped-`Toggle` regression shipped unnoticed. This file targets the
 * `desktop` project (1440x900, the default for any spec not explicitly
 * routed elsewhere — see `playwright.config.ts`) and checks the REAL nested
 * control, not just the outer row's `scrollWidth`.
 */
test.describe('HUD lens picker at 1440x900 (desktop)', () => {
  test('all 8 lenses are visible and clickable without manual scrolling, and the trailing icon row stays fully on-screen', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });

    const trigger = page.getByRole('button', { name: /^Render lens:/ });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Every lens must be independently visible AND actionable by ordinary
    // Playwright rules (no forced clicks, no manual scroll container
    // handling) — this is precisely the property the old capped `Toggle`
    // violated for 4 of the 8.
    const lensLabels = ['Life', 'Age', 'Activity', 'Lineage', 'Immigration', 'QuadLife', 'Velocity', 'Neighbors'];
    for (const label of lensLabels) {
      const option = page.getByRole('menuitemradio', { name: new RegExp(`^${label}\\b`) });
      await expect(option, `${label} should be visible in the lens menu`).toBeVisible();
      await expect(option, `${label} should be within the viewport, not scrolled off`).toBeInViewport();
    }

    // Actually select the LAST one — the one that was furthest off-screen
    // (unreachable even by scrolling, since there was no scroll affordance
    // at all) under the old layout — and confirm the selection really took.
    await page.getByRole('menuitemradio', { name: /^Neighbors\b/ }).click();
    await expect(page.getByRole('button', { name: /^Render lens: Neighbors\b/ })).toBeVisible();

    // The trailing icon row (Settings/Mute/Presentation/About/Shortcuts) is
    // the control set the original overflow bug hid entirely at 1440x900.
    // The lens-discoverability fix must not re-break it: every one of these
    // must both be visible and fully within the 1440px viewport width.
    // The app boots muted by default (`useAppStore`'s initial state), so the
    // speaker control's accessible name starts as "Unmute", not "Mute".
    for (const name of ['Settings', 'Unmute', 'Presentation mode', 'About AFTERLIFE', 'Keyboard shortcuts']) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control, `${name} should be visible`).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `${name} should have a measurable box`).not.toBeNull();
      expect(box!.x + box!.width, `${name} must be within the 1440px viewport`).toBeLessThanOrEqual(1440);
    }
  });

  test('a lens can be chosen entirely by keyboard, and the current one is announced in the trigger', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    const trigger = page.getByRole('button', { name: /^Render lens:/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: /^Velocity\b/ })).toBeVisible();

    // Radix's own built-in type-ahead (not a pointer, not a guessed arrow-key
    // count): the first letter unique to "Velocity" among the 8 options
    // moves roving focus straight to it, then Enter activates it — a
    // genuinely keyboard-only path with no assumption about which item
    // starts focused on open.
    const velocityOption = page.getByRole('menuitemradio', { name: /^Velocity\b/ });
    await page.keyboard.press('v');
    // Wait for the REAL effect of type-ahead — focus actually landing on
    // "Velocity" — before confirming with Enter, rather than chaining the
    // two keypresses blindly. Radix moves focus asynchronously (its keydown
    // handler resolves the type-ahead match, then a follow-up effect moves
    // real DOM focus); pressing Enter immediately after 'v' raced ahead of
    // that on a loaded machine (observed failing inside the full sequential
    // suite while passing every time in isolation) and landed on whichever
    // item was ACTUALLY focused at that instant instead.
    await expect(velocityOption).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: /^Render lens: Velocity\b/ })).toBeVisible();
  });
});

/**
 * This session mounted two previously-unreachable features (Rules,
 * Multiplayer) plus wired up two more that other concurrent agents had
 * self-mounted or left as a proposed diff (Acid Art, Appearance) — on top of
 * a row already measured with ZERO spare width at 1440px (see the comments
 * in `Hud.tsx` this file's earlier test guards). Rather than re-tuning exact
 * breakpoints again — which is how this HUD regressed twice before — every
 * one of those four now lands in a single "More tools" overflow menu
 * (`Hud.tsx`'s `MoreToolsMenu`) instead of claiming a new dedicated icon.
 * This is the regression test for THAT choice: every existing control must
 * still be on-screen, and all four new entries must be genuinely reachable
 * through the new menu, by ordinary Playwright actionability.
 */
test.describe('HUD "More tools" overflow at 1440x900 (desktop)', () => {
  test('every existing top-level control plus the new "More tools" trigger fit on-screen with no overflow', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    for (const name of [
      'Branches', 'Compare', 'Field guide', 'Experiments', 'Save & export', 'Instrument', 'Settings',
      'Unmute', 'Presentation mode', 'About AFTERLIFE', 'Logbook', 'Keyboard shortcuts', 'More tools',
    ]) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control, `${name} should be visible`).toBeVisible();
      await expect(control, `${name} should be within the viewport`).toBeInViewport();
      const box = await control.boundingBox();
      expect(box, `${name} should have a measurable box`).not.toBeNull();
      expect(box!.x + box!.width, `${name} must be within the 1440px viewport`).toBeLessThanOrEqual(1440);
    }

    const hudRow = page.locator('#hud-top > div').first();
    const { scrollWidth, clientWidth } = await hudRow.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth, 'the HUD row must fit its own content, not rely on a hidden horizontal scroll').toBeLessThanOrEqual(clientWidth);
  });

  test('Rules, Appearance and Acid Art are all reachable from "More tools" and actually open their panel', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    // All three toggle the SAME right panel (mutually exclusive, and unlike
    // Cinematic/Multiplayer below, opening one never hides the HUD or
    // `aria-hidden`s it behind a dialog) — safe to click through in
    // sequence, re-measuring reachability freshly each time.
    for (const label of ['Rules', 'Appearance', 'Acid Art']) {
      await page.getByRole('button', { name: 'More tools' }).click();
      const item = page.getByRole('menuitem', { name: new RegExp('^' + label) });
      await expect(item, `${label} should be visible in the More tools menu`).toBeVisible();
      await expect(item, `${label} should be within the viewport`).toBeInViewport();
      await item.click();
      await expect(page.locator('#panel-right'), `${label} should have opened its panel`).toContainText(label);
    }
  });

  test('Multiplayer is reachable from "More tools" and opens its dialog', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    await page.getByRole('button', { name: 'More tools' }).click();
    const item = page.getByRole('menuitem', { name: /^Multiplayer/ });
    await expect(item).toBeVisible();
    await expect(item).toBeInViewport();
    await item.click();
    await expect(page.getByRole('dialog', { name: 'Multiplayer' })).toBeVisible();
  });

  test('Cinematic mode is reachable from "More tools" and actually enters the mode', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    await page.getByRole('button', { name: 'More tools' }).click();
    const item = page.getByRole('menuitem', { name: /^Cinematic mode/ });
    await expect(item).toBeVisible();
    await expect(item).toBeInViewport();
    await item.click();

    await expect.poll(() =>
      page.evaluate(() => (window as unknown as { __AFTERLIFE__?: { cinematic: { isActive(): boolean } } }).__AFTERLIFE__?.cinematic.isActive() ?? false),
    ).toBe(true);
  });
});
