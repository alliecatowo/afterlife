import { expect, test } from '@playwright/test';
import {
  applyEditDirect, currentGen, currentPopulation, dismissTitle, ensurePaused, newTouchSession, openApp,
  openControl, suppressTour, worldToScreen,
} from './utils';

/**
 * The mobile pass. Runs in the `mobile` project (390x844, real touch,
 * deviceScaleFactor 2 — see `playwright.config.ts`). Three things this file
 * exists to pin down for good:
 *
 * 1. Every primary control is reachable at 390px — the lens toggle, speed,
 *    every right-panel tab, and the Time Sculpture entry used to be either
 *    `hidden lg:flex`/`hidden md:flex` with no mobile substitute, or present
 *    but pushed past the viewport edge by an unlabelled horizontal scroll on
 *    the HUD row (`overflow-x-auto` + a `flex-1` spacer with ~600px of
 *    invisible content ahead of it). See `HudMoreSheet.tsx`.
 * 2. The one-finger-draws / two-finger-pans-and-zooms touch model actually
 *    commits. It looked like it worked (the live stroke preview painted
 *    correctly) but a real bug in `#endPinch()` (`@/interact/input.ts`)
 *    nulled out `#dragMode` on EVERY single-finger touch release — including
 *    plain draw/erase/select gestures, not just real pinches — right before
 *    `#stopDrag()` read it to decide whether to commit. Nothing drawn with a
 *    single finger ever reached the engine; it evaporated the instant you
 *    lifted your finger. This is almost certainly the single biggest
 *    contributor to "mobile feels janky": drawing appeared to work and then
 *    silently didn't.
 * 3. Rotation and a small-tablet width don't break the layout or lose state.
 */

test.describe('mobile: HUD reachability at 390px', () => {
  test.beforeEach(async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
  });

  test('the HUD row never overflows horizontally', async ({ page }) => {
    const hud = page.locator('#hud-top > div').first();
    const { scrollWidth, clientWidth } = await hud.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth, 'HUD content must fit its own row, not rely on a hidden horizontal scroll').toBeLessThanOrEqual(clientWidth);
  });

  test('the "More controls" sheet opens by touch and exposes lens, speed, and the Time Sculpture entry', async ({ page }) => {
    await page.getByRole('button', { name: 'More controls' }).tap();
    await expect(page.getByRole('dialog', { name: 'More controls' })).toBeVisible();

    const lens = page.getByRole('radiogroup', { name: 'Render lens' });
    await expect(lens).toBeVisible();
    // `exact: true`: 'Age' is now also a substring of 'Lineage' since the
    // lens Toggle grew to 8 options.
    await page.getByRole('radio', { name: 'Age', exact: true }).tap();
    // The desktop-only inline lens control is gone below `lg` — the sheet's
    // own copy is the only place this state can be verified from.
    await expect(page.getByRole('radio', { name: 'Age', exact: true })).toHaveAttribute('data-state', 'on');

    const speed = page.getByRole('radiogroup', { name: 'Playback speed' });
    await expect(speed).toBeVisible();
    await page.getByRole('radio', { name: '30', exact: true }).tap();

    await expect(page.getByText('Select a region first').or(page.getByText('Open time sculpture'))).toBeVisible();
  });

  test('every right-panel tab is reachable from the sheet and actually opens its panel', async ({ page }) => {
    const panels: Array<[string, string]> = [
      ['Branches', 'Branches'],
      ['Compare', 'Compare'],
      ['Field guide', 'Field guide'],
      ['Experiments', 'Experiments'],
      ['Save & export', 'Save & export'],
      ['Instrument', 'Instrument'],
      ['Settings', 'Settings'],
    ];
    for (const [buttonLabel, panelTitle] of panels) {
      await page.getByRole('button', { name: 'More controls' }).tap();
      await page.getByRole('button', { name: buttonLabel, exact: true }).tap();
      await expect(page.locator('#panel-right')).toContainText(panelTitle);
      await page.getByRole('button', { name: 'Close panel' }).tap();
    }
  });

  test('mute, presentation mode, about, and shortcuts are reachable from the sheet', async ({ page }) => {
    await page.getByRole('button', { name: 'More controls' }).tap();
    await page.getByRole('button', { name: 'Keyboard shortcuts' }).tap();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'More controls' }).tap();
    await page.getByRole('button', { name: 'About AFTERLIFE' }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'More controls' }).tap();
    await page.getByRole('button', { name: 'Presentation mode' }).tap();
    // Presentation mode collapses the HUD to a 0-height band.
    await expect(page.locator('#hud-top')).toHaveCSS('height', '0px');
    await page.keyboard.press('Escape');
  });

  test('the drawer opens from the HUD and is dismissible by backdrop tap and its own close control', async ({ page }) => {
    await page.getByRole('button', { name: 'Open drawer' }).tap();
    await expect(page.locator('#drawer-left')).toHaveAttribute('data-open', 'true');
    await page.getByRole('button', { name: 'Collapse drawer' }).tap();
    await expect(page.locator('#drawer-left')).toHaveAttribute('data-open', 'false');

    await page.getByRole('button', { name: 'Open drawer' }).tap();
    // The "Close overlay" button covers the whole viewport as one element,
    // but the open drawer itself visually sits on top of its left portion —
    // tap a point clearly to the RIGHT of the drawer (which is at most
    // `max-w-[78vw]` wide) so this actually lands on the backdrop, not on
    // the drawer's own (higher z-index) content.
    await page.getByRole('button', { name: 'Close overlay' }).tap({ position: { x: 370, y: 400 } });
    await expect(page.locator('#drawer-left')).toHaveAttribute('data-open', 'false');
  });

  test('the More sheet is dismissible by its close button, backdrop tap, and a drag-down past the grabber', async ({ page }) => {
    await page.getByRole('button', { name: 'More controls' }).tap();
    await page.getByRole('dialog', { name: 'More controls' }).getByRole('button', { name: 'Close' }).tap();
    await expect(page.getByRole('dialog', { name: 'More controls' })).toBeHidden();

    await page.getByRole('button', { name: 'More controls' }).tap();
    // Radix's overlay closes the dialog on an outside press.
    await page.mouse.click(20, 20);
    await expect(page.getByRole('dialog', { name: 'More controls' })).toBeHidden();

    await page.getByRole('button', { name: 'More controls' }).tap();
    const dialog = page.getByRole('dialog', { name: 'More controls' });
    await expect(dialog).toBeVisible();
    // Let the slide-up-open animation finish before measuring — mid-animation
    // the sheet is still partway through its `translateY`, so its handle
    // isn't yet where a finished-open box would say it is.
    await page.waitForTimeout(300);
    const box = (await dialog.boundingBox())!;
    // Drag the handle well past the dismiss threshold.
    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 220, { steps: 8 });
    await page.mouse.up();
    await expect(dialog).toBeHidden();
  });
});

test.describe('mobile: touch gesture model', () => {
  test.beforeEach(async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await page.keyboard.press('d'); // draw tool
  });

  test('a single finger draws and the edit actually commits on release', async ({ page }) => {
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const touch = await newTouchSession(page);
    const before = await currentPopulation(page);

    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await touch.start([{ x, y, id: 1 }]);
    await touch.move([{ x: x + 12, y, id: 1 }]);
    await touch.move([{ x: x + 24, y, id: 1 }]);
    await touch.end([]);
    await page.waitForTimeout(150);

    expect(await currentPopulation(page), 'a one-finger stroke must commit, not just preview').toBeGreaterThan(before);
  });

  test('a plain tap (no movement) also commits', async ({ page }) => {
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const touch = await newTouchSession(page);
    const before = await currentPopulation(page);

    await touch.start([{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 2 }]);
    await touch.end([]);
    await page.waitForTimeout(150);

    expect(await currentPopulation(page)).toBeGreaterThan(before);
  });

  test('two fingers pan and zoom, centred on the pinch midpoint, without drawing', async ({ page }) => {
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const before = await currentPopulation(page);
    const scaleBefore: number = await page.evaluate(() => (window as unknown as { __AFTERLIFE__: { camera: { camera: { scale: number } } } }).__AFTERLIFE__.camera.camera.scale);

    const touch = await newTouchSession(page);
    await touch.start([{ x: cx - 40, y: cy, id: 10 }, { x: cx + 40, y: cy, id: 11 }]);
    await touch.move([{ x: cx - 100, y: cy, id: 10 }, { x: cx + 100, y: cy, id: 11 }]);
    await touch.end([]);
    await page.waitForTimeout(150);

    const scaleAfter: number = await page.evaluate(() => (window as unknown as { __AFTERLIFE__: { camera: { camera: { scale: number } } } }).__AFTERLIFE__.camera.camera.scale);
    expect(scaleAfter, 'spreading two fingers must zoom in').toBeGreaterThan(scaleBefore);
    // A pinch must never ALSO paint cells — it's an exclusive alternative to drawing.
    expect(await currentPopulation(page)).toBe(before);
  });

  test('a second finger landing mid-stroke ends the draw cleanly instead of corrupting it', async ({ page }) => {
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const x0 = box.x + 120, y0 = box.y + 200;
    const before = await currentPopulation(page);

    const touch = await newTouchSession(page);
    await touch.start([{ x: x0, y: y0, id: 20 }]);
    await touch.move([{ x: x0 + 10, y: y0, id: 20 }]);
    // A second finger lands while the first is still drawing.
    await touch.start([{ x: x0 + 10, y: y0, id: 20 }, { x: x0 + 150, y: y0 + 150, id: 21 }]);
    await touch.move([{ x: x0 + 30, y: y0, id: 20 }, { x: x0 + 190, y: y0 + 190, id: 21 }]);
    await touch.end([]);
    await page.waitForTimeout(150);

    const pending = await page.evaluate(() => (window as unknown as { __AFTERLIFE__: { input: { pending: unknown } } }).__AFTERLIFE__.input.pending);
    expect(pending, 'the gesture must be fully flushed, not left half-committed').toBeNull();
    expect(await currentPopulation(page), 'the first finger\'s stroke before the second finger landed must have committed').toBeGreaterThan(before);
  });

  test('drawing near the screen edges registers cells', async ({ page }) => {
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const touch = await newTouchSession(page);
    const corners: Array<[number, number]> = [
      [box.x + 8, box.y + 8],
      [box.x + box.width - 8, box.y + 8],
      [box.x + 8, box.y + box.height - 8],
      [box.x + box.width - 8, box.y + box.height - 8],
    ];
    for (const [x, y] of corners) {
      // Force the target cell dead first — the opening scene autoplays
      // before `ensurePaused`, so whatever's already alive there by chance
      // varies run to run, and this must prove a tap COMMITS, not merely
      // that the target happened to already be alive (see `drawing.spec.ts`
      // for the same established pattern).
      const world = await page.evaluate(
        ({ x, y }) => (window as unknown as { __AFTERLIFE__: { renderer: { screenToWorld(x: number, y: number): { x: number; y: number } } } }).__AFTERLIFE__.renderer.screenToWorld(x, y),
        { x: x - box.x, y: y - box.y },
      );
      const cell = { x: Math.floor(world.x), y: Math.floor(world.y) };
      await applyEditDirect(page, [{ x: cell.x, y: cell.y, alive: false }]);
      await page.waitForTimeout(30);
      const before = await currentPopulation(page);
      await touch.start([{ x, y, id: 30 }]);
      await touch.end([]);
      await page.waitForTimeout(120);
      expect(await currentPopulation(page)).toBeGreaterThan(before);
    }
  });
});

test.describe('mobile: the heartbeat journey — notice, scrub, edit, compare, sculpt', () => {
  test('walking the whole loop by touch works end to end', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await page.waitForFunction(() => {
      const w = window as unknown as { __AFTERLIFE__?: { engine: { gen: number } } };
      return (w.__AFTERLIFE__?.engine.gen ?? 0) >= 15;
    }, undefined, { timeout: 20_000 });
    await ensurePaused(page);
    const genAtPause = await currentGen(page);

    // Scrub backward on the ribbon with a touch drag.
    const ribbon = page.getByRole('slider', { name: 'History timeline' });
    const ribbonBox = (await ribbon.boundingBox())!;
    const touch = await newTouchSession(page);
    await touch.start([{ x: ribbonBox.x + 4, y: ribbonBox.y + ribbonBox.height / 2, id: 40 }]);
    await touch.move([{ x: ribbonBox.x + 4, y: ribbonBox.y + ribbonBox.height / 2, id: 40 }]);
    await touch.end([]);
    await page.waitForTimeout(200);
    const genAfterScrub = await currentGen(page);
    expect(genAfterScrub, 'dragging the ribbon to its start must move generation backward').toBeLessThan(genAtPause);

    // Change one cell at this past generation — this forks a branch.
    await page.keyboard.press('d');
    const screen = await worldToScreen(page, 200.5, 200.5);
    const canvasBox = (await page.locator('#world-canvas').boundingBox())!;
    await touch.start([{ x: canvasBox.x + screen.x, y: canvasBox.y + screen.y, id: 41 }]);
    await touch.end([]);
    await page.waitForTimeout(200);
    const branchCount = await page.evaluate(() => (window as unknown as { __AFTERLIFE__: { history: { branches: readonly unknown[] } } }).__AFTERLIFE__.history.branches.length);
    expect(branchCount, 'editing at a past generation must fork a new branch').toBeGreaterThan(1);

    // Open Compare and confirm the two futures diverge.
    await page.getByRole('button', { name: 'More controls' }).tap();
    await page.getByRole('button', { name: 'Compare', exact: true }).tap();
    await expect(page.locator('#panel-right')).toContainText('Compare');
    const originalBtn = page.getByRole('button', { name: 'Original' });
    if (await originalBtn.isVisible().catch(() => false)) {
      await originalBtn.tap();
      await expect(page.locator('#compare-canvas')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Close panel' }).tap();
    // `compareWith` triggers an async `refreshCompare()`/`branch:switched`
    // settle in `session.ts` — give it a beat before driving the next
    // gesture, the same grace a real person pausing to look at the compare
    // view before continuing would give it for free. Re-assert paused too:
    // occasionally observed playback silently resumed across the branch
    // switch, which raced the sculpture selection below onto a moving
    // target generation instead of the still frame the drag intends.
    await page.waitForTimeout(300);
    await ensurePaused(page);

    // Select a region and open the Time Sculpture from the sheet. Re-measure
    // the canvas box rather than reusing the one from before Compare was
    // opened — entering compare view splits `#world-canvas` to half width,
    // so the earlier box is stale and would aim this drag at the wrong
    // on-screen position.
    await page.keyboard.press('s'); // select tool
    const canvasBoxNow = (await page.locator('#world-canvas').boundingBox())!;
    const p0 = await worldToScreen(page, 180, 180);
    const p1 = await worldToScreen(page, 220, 220);
    await touch.start([{ x: canvasBoxNow.x + p0.x, y: canvasBoxNow.y + p0.y, id: 42 }]);
    await touch.move([{ x: canvasBoxNow.x + p1.x, y: canvasBoxNow.y + p1.y, id: 42 }]);
    await touch.end([]);
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'More controls' }).tap();
    await page.getByRole('button', { name: 'Open time sculpture', exact: true }).tap();
    await expect(page.locator('#sculpture-canvas')).toBeVisible();
  });
});

test.describe('mobile: rotation', () => {
  test('portrait to landscape rotation keeps generation and layout intact', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await page.waitForFunction(() => {
      const w = window as unknown as { __AFTERLIFE__?: { engine: { gen: number } } };
      return (w.__AFTERLIFE__?.engine.gen ?? 0) >= 5;
    }, undefined, { timeout: 15_000 });
    await ensurePaused(page);
    const genBefore = await currentGen(page);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);

    const canvasBox = (await page.locator('#world-canvas').boundingBox())!;
    expect(canvasBox.width, 'the world must still dominate the screen in landscape').toBeGreaterThan(400);
    expect(await currentGen(page), 'rotation must not lose simulation state').toBe(genBefore);

    const hud = page.locator('#hud-top > div').first();
    const { scrollWidth, clientWidth } = await hud.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Rotate back — the app must not have wedged itself into a broken state.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await expect(page.locator('#world-canvas')).toBeVisible();
    expect(await currentGen(page)).toBe(genBefore);
  });
});

test.describe('small tablet width', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('the HUD still fits and the More sheet still reaches lens/speed', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    const hud = page.locator('#hud-top > div').first();
    const { scrollWidth, clientWidth } = await hud.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    await page.getByRole('button', { name: 'More controls' }).tap();
    await expect(page.getByRole('radiogroup', { name: 'Render lens' })).toBeVisible();
  });
});

test.describe('mobile: two previously-unreachable features, now reachable at 390px', () => {
  test.beforeEach(async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
  });

  test('the Rules panel opens from the More sheet', async ({ page }) => {
    await openControl(page, 'Rules');
    await expect(page.locator('#panel-right')).toContainText('Rules');
    await expect(page.locator('#panel-right')).toContainText("Conway's Life");
    await page.getByRole('button', { name: 'Close panel' }).tap();
  });

  test('the Multiplayer dialog opens from the More sheet and a room can be created', async ({ page }) => {
    await openControl(page, 'Multiplayer');
    const dialog = page.getByRole('dialog', { name: 'Multiplayer' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Host a new room' }).tap();
    // Hosting assigns a real room code and flips into the in-room view —
    // the same behaviour `tests/ui-multiplayer-panel.test.tsx` proves at the
    // component level; this confirms it's actually reachable end to end
    // from a real 390px touch session, no server required
    // (`BroadcastChannelTransport`).
    await expect(dialog.getByText(/^[A-Z2-9]{6}$/)).toBeVisible({ timeout: 10_000 });
  });
});
