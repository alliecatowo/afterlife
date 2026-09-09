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

/**
 * Regression coverage for the intermediate-width overflow bug: a browser-
 * driven reachability audit at 1024x700 found 13 top-bar controls (Compare
 * through "More tools") sitting past the right edge of the viewport, reached
 * only via this row's `overflow-x-auto` with no visible scrollbar — and the
 * mobile "More controls" fallback didn't appear either, because it switched
 * off at the same `lg` (1024px) breakpoint that caused the overflow. The
 * row's real content needed ~1433px; anything from 1024px up to just under
 * 1440px got neither a fitting row nor the sheet.
 *
 * `Hud.tsx` now switches from the compact "More controls" layout to the full
 * inline row at an explicit 1440px (this project's own `desktop` viewport,
 * the one width the row is deliberately measured to fit — see the "BUG" note
 * in `Hud.tsx` above its `return`), so 1024x700 and 1280x800 both stay in
 * compact mode. This test asserts the property directly, at BOTH widths: no
 * control is reachable ONLY by an invisible scroll — every one is genuinely
 * in-viewport and actionable by ordinary Playwright rules, which fail (not
 * silently auto-scroll) when a target isn't actually visible on screen.
 */
test.describe('HUD reachability at intermediate widths (1024x700, 1280x800)', () => {
  for (const viewport of [{ width: 1024, height: 700 }, { width: 1280, height: 800 }]) {
    test(`every HUD control is in-viewport and hittable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await suppressTour(page);
      await openApp(page);
      await dismissTitle(page);

      // The row itself must never rely on a hidden horizontal scroll.
      const hudRow = page.locator('#hud-top > div').first();
      const { scrollWidth, clientWidth } = await hudRow.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(scrollWidth, 'the HUD row must fit its own content at this width').toBeLessThanOrEqual(clientWidth);

      // The always-inline controls, present regardless of breakpoint. The
      // drawer toggle's accessible name flips between "Open drawer" and
      // "Close drawer" depending on whether it starts open at this viewport.
      const drawerToggle = page.getByRole('button', { name: /^(Open|Close) drawer$/ });
      await expect(drawerToggle, 'the drawer toggle should be visible').toBeVisible();
      await expect(drawerToggle, 'the drawer toggle should be within the viewport (no scroll needed)').toBeInViewport();
      const playToggle = page.getByRole('button', { name: /^(Play|Pause)$/ });
      await expect(playToggle, 'the play/pause toggle should be visible').toBeVisible();
      await expect(playToggle, 'the play/pause toggle should be within the viewport (no scroll needed)').toBeInViewport();
      for (const name of ['More controls']) {
        const control = page.getByRole('button', { name, exact: true });
        await expect(control, `${name} should be visible`).toBeVisible();
        await expect(control, `${name} should be within the viewport (no scroll needed)`).toBeInViewport();
      }

      // The full desktop row must NOT be present at these widths — if it
      // were, this test would just be re-proving the 1440x900 case above,
      // not the actual intermediate-width gap the audit found.
      await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeHidden();

      // Every control that lives in the "More controls" sheet at this width
      // must be independently reachable. Scoped to the sheet's own dialog
      // (not just `getByRole('button', {name})` globally): the full desktop
      // row's SAME-LABELLED buttons still exist in the DOM at this width
      // (CSS `hidden`, not unmounted), so an unscoped lookup would hit
      // Playwright's strict-mode "multiple elements" error the instant the
      // sheet opens.
      //
      // NOT asserted here: `toBeInViewport()` for each entry. The sheet is a
      // `max-h-[85vh]`, `overflow-y-auto` bottom sheet with a real, visible
      // scrollbar and a drag handle (`Sheet.tsx`) — at a short 700-800px
      // viewport height its own content legitimately needs vertical
      // scrolling to reach every one of ~17 entries, same as the existing,
      // already-shipped 390x844 mobile sheet (`e2e/mobile.spec.ts` verifies
      // that one the same way: `.tap()` on an item directly, no in-viewport
      // check). That is a normal, DISCOVERABLE scroll — a visible scrollbar
      // and a "drag to see more" affordance — not the invisible, no-hint
      // horizontal overflow this whole fix targets. `toBeVisible()` plus a
      // real click (below) is the right bar: every item must actually be
      // findable in the DOM and clickable via Playwright's own
      // auto-scroll-the-nearest-scrollable-ancestor actionability, which is
      // exactly how a real user would reach it too.
      await page.getByRole('button', { name: 'More controls' }).click();
      const sheet = page.getByRole('dialog', { name: 'More controls' });
      for (const name of [
        'Branches', 'Compare', 'Field guide', 'Experiments', 'Save & export', 'Instrument', 'Settings',
        'Appearance', 'Rules', 'Acid Art', 'Unmute', 'Presentation mode', 'Cinematic mode', 'About AFTERLIFE',
        'Logbook', 'Keyboard shortcuts', 'Multiplayer',
      ]) {
        const control = sheet.getByRole('button', { name, exact: true });
        await expect(control, `${name} should be visible in the More controls sheet`).toBeVisible();
      }

      // Actually use one of the entries that sat furthest down the old,
      // now-nonexistent "invisible scroll" — confirms this isn't just a
      // geometry check, the control genuinely works.
      await sheet.getByRole('button', { name: 'Compare', exact: true }).click();
      await expect(page.locator('#panel-right')).toContainText('Compare');
    });
  }
});
