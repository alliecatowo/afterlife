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

    // '1'-'8': render lens. The digit shortcuts drive the SAME store/bus
    // path the HUD's lens `Menu` does (`@/ui/hud/Hud.tsx`) — checked via the
    // menu's own trigger button, whose accessible name always states the
    // current lens, rather than a `radio` role: that role only exists while
    // the popover itself is open, which a keyboard shortcut deliberately
    // does not do (pressing '2' picks a lens without forcing a menu open).
    await page.keyboard.press('2');
    await expect(page.getByRole('button', { name: /^Render lens: Age\b/ })).toBeVisible();
    await page.keyboard.press('1');
    await expect(page.getByRole('button', { name: /^Render lens: Life\b/ })).toBeVisible();

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

  // Regression: `@/interact/input.ts`'s window-level keydown listener has no
  // knowledge of React dialog state, so before `globalShortcutGuard.ts` it
  // kept processing Space/g/arrows underneath an OPEN dialog — pressing Space
  // to dismiss a focused control inside the shortcuts sheet, say, would also
  // toggle playback and pan the camera behind it, invisibly.
  test('the shortcuts sheet swallows world shortcuts while it is open, not just the ones App.tsx knows about', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    const initialGrid = await page.locator('#world-canvas').getAttribute('data-show-grid');
    const camX = () => page.evaluate(
      () => (window as unknown as { __AFTERLIFE__: { camera: { camera: { x: number } } } }).__AFTERLIFE__.camera.camera.x,
    );
    const xBefore = await camX();

    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();

    // Space would normally toggle play/pause; g would toggle the grid;
    // ArrowRight would pan the camera. None of that should happen while the
    // dialog owns the keyboard.
    await page.keyboard.press('Space');
    await page.keyboard.press('g');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible(); // still paused
    await expect(page.locator('#world-canvas')).toHaveAttribute('data-show-grid', String(initialGrid));
    expect(await camX()).toBe(xBefore);

    // Sanity: closing the dialog restores normal shortcut handling — this
    // isn't a guard that got stuck on.
    await page.keyboard.press('Escape');
    await expect(page.getByText('Keyboard shortcuts')).toBeHidden();
    await page.keyboard.press('g');
    await expect(page.locator('#world-canvas')).toHaveAttribute('data-show-grid', String(initialGrid === 'true' ? 'false' : 'true'));
  });

  // Regression: Radix's roving-focus widgets (ToggleGroup) call
  // `preventDefault()` on arrow keys to stop the PAGE from scrolling, but
  // that doesn't stop propagation — without the guard, arrow-key navigation
  // between toggle options (e.g. moving focus across the lens toggle) also
  // panned the world camera underneath it on every press.
  test('arrow-key navigation inside a focused toggle group does not also pan the camera', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    const camX = () => page.evaluate(
      () => (window as unknown as { __AFTERLIFE__: { camera: { camera: { x: number } } } }).__AFTERLIFE__.camera.camera.x,
    );
    const xBefore = await camX();

    // The render lens is now a `Menu` (a Radix DropdownMenu popover), not a
    // `Toggle`/ToggleGroup — its own roving-focus arrow keys only exist
    // while the popover is OPEN, and `isMenuOpen()` (see
    // `globalShortcutGuard.ts`) already blanket-suppresses every global
    // shortcut while any menu is open, camera panning included, so that
    // specific combination can't regress the way it used to. The playback
    // SPEED control is still exactly the `Toggle`/ToggleGroup this
    // regression test was written against (a focused, always-mounted
    // roving-focus `radiogroup`), so it's exercised there instead — same
    // underlying Radix mechanism, same "arrow key moves focus, not camera"
    // guarantee.
    const speed1 = page.getByRole('radio', { name: '1', exact: true });
    await speed1.focus();
    await page.keyboard.press('ArrowRight'); // moves roving focus to "4", NOT the camera
    await expect(page.getByRole('radio', { name: '4', exact: true })).toBeFocused();
    expect(await camX()).toBe(xBefore);
  });
});
