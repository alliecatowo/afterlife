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
