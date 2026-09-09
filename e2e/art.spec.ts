import { expect, test, type Page } from '@playwright/test';
import { applyEditDirect, collectConsoleErrors, dismissTitle, ensurePaused, openApp, suppressTour } from './utils';

/**
 * ACID ART / Art mode end-to-end coverage. Reached in the real app today via
 * the self-mounted trigger tab (`@/render/artMount.ts` — see that file's doc
 * for why it isn't a `Hud.tsx` button yet) and the `a` keyboard shortcut,
 * both of which are exercised directly here rather than only driving the
 * renderer's API — so this also proves the actual reachability path works,
 * not just the underlying `setArtConfig` contract.
 */

const GLYPH_SCALE = 16; // comfortably above GLYPH_MIN_DEVICE_PX (8 device px; this project runs at dpr=1, so 16 CSS px/cell == 16 device px/cell)

async function setCamera(page: Page, cam: { x: number; y: number; scale: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __AFTERLIFE__: { camera: { set(next: Partial<typeof c>): void } } })
      .__AFTERLIFE__.camera.set(c);
  }, cam);
  await page.waitForTimeout(150);
}

/** A tiled grid of real, stable 2x2 "block" still lifes (spaced apart so
 *  they never interact) rather than one solid filled square — a solid
 *  square is not a Game of Life still life, so it changes shape/dies within
 *  a couple of generations under B3/S23, while a block survives forever.
 *  That matters here specifically because Art mode's default (`Classic
 *  ASCII`) glyph driver is `age`, and a cell's age is 0 the instant it's
 *  stamped — with the `ascii` ramp's first character being a literal space,
 *  a just-stamped, never-stepped world would render as entirely blank
 *  glyphs (correct honest behaviour, but useless for asserting "the canvas
 *  visibly changed"). Stepping the paused world forward a few generations
 *  after stamping gives these cells a real, nonzero age. */
async function stampBlockGrid(page: Page, x0: number, y0: number, count: number, spacing: number): Promise<void> {
  const cells: Array<{ x: number; y: number; alive: boolean }> = [];
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const bx = x0 + i * spacing;
      const by = y0 + j * spacing;
      cells.push({ x: bx, y: by, alive: true }, { x: bx + 1, y: by, alive: true }, { x: bx, y: by + 1, alive: true }, { x: bx + 1, y: by + 1, alive: true });
    }
  }
  await applyEditDirect(page, cells);
  await page.waitForTimeout(100);
}

async function stepPaused(page: Page, n: number): Promise<void> {
  await page.evaluate((count) => {
    (window as unknown as { __AFTERLIFE__: { loop: { stepOnce(k: number): void } } }).__AFTERLIFE__.loop.stepOnce(count);
  }, n);
  await page.waitForTimeout(150);
}

/**
 * Force one synchronous `draw()` call through the exact same public API the
 * app's own persistent `requestAnimationFrame` loop uses
 * (`@/ui/session.ts`'s `frame()`), rather than waiting on that ambient loop
 * to happen to tick and pick up the dirty flag. This sandbox's headless
 * Chromium throttles/suspends `requestAnimationFrame` unpredictably for a
 * backgrounded page (confirmed by instrumenting `consumeDirty()`/`draw()`
 * directly: identical keyboard-driven repro steps sometimes produced one
 * more real frame within 400ms and sometimes produced zero, with no
 * uncaught exception either way) — a real, focused browser tab does not
 * have this problem, and 96 other specs already tolerate it with plain
 * waits for less timing-sensitive assertions. For a byte-exact
 * before/after pixel comparison, removing that source of flakiness by
 * calling the renderer directly is more honest than a longer timeout that
 * would still occasionally fail.
 */
async function forceDraw(page: Page): Promise<void> {
  await page.evaluate(() => {
    const session = (window as unknown as { __AFTERLIFE__: { renderer: { draw(e: unknown): void }; engine: unknown } }).__AFTERLIFE__;
    session.renderer.draw(session.engine);
  });
}

async function canvasSnapshot(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return Array.from(data);
  });
}

async function mockWebcam(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __fakeTrackStops__: number }).__fakeTrackStops__ = 0;
    const fakeTrack = {
      kind: 'video',
      stop: () => { (window as unknown as { __fakeTrackStops__: number }).__fakeTrackStops__ += 1; },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    // `HTMLMediaElement.play()` on a real-but-trackless `MediaStream` (see
    // below) never resolves in headless Chromium — there's no actual frame
    // source to reach a "playing" state. `MediaFieldSource.startWebcam()`
    // awaits `video.play()` before it ever sets its own state to `'webcam'`,
    // so an unresolved `play()` would hang the whole test forever; this
    // test cares about the JS-level start/stop lifecycle (are tracks
    // stopped correctly), never actual decoded video frames, so bypassing
    // real playback entirely is the right fake here.
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: () => Promise.resolve(),
    });
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          // A REAL `MediaStream` (empty — no hardware involved) rather than
          // a plain object: `HTMLVideoElement.srcObject =` type-checks its
          // argument against the `MediaStream`/`MediaSourceHandle` WebIDL
          // interfaces and throws `TypeError` on anything else, which
          // `MediaFieldSource.startWebcam()` surfaces as its own "Camera
          // access was denied or unavailable" error state — a plain mock
          // object silently broke the very state transition this test
          // exists to check. Overriding `getTracks`/`getVideoTracks` as own
          // properties on the real instance is enough for our own code
          // (which only ever calls those, never touches the browser's
          // internal empty track list) to see the fake, stoppable track.
          const stream = new MediaStream();
          Object.defineProperty(stream, 'getTracks', { value: () => [fakeTrack] });
          Object.defineProperty(stream, 'getVideoTracks', { value: () => [fakeTrack] });
          return stream;
        },
      },
    });
  });
}

test.describe('Art mode', () => {
  test('renders glyphs above the legibility threshold with no console errors, and turning it off restores the honest lens exactly', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await stampBlockGrid(page, 40, 40, 6, 6);
    await stepPaused(page, 8); // give these cells a real, nonzero age
    await setCamera(page, { x: 55, y: 55, scale: GLYPH_SCALE });

    await forceDraw(page);
    const before = await canvasSnapshot(page);

    // Turn Art mode on via the real, reachable UI (the self-mounted trigger
    // tab's keyboard shortcut), not just the renderer API directly.
    await page.keyboard.press('a');
    await page.waitForTimeout(100);
    await forceDraw(page);

    const during = await canvasSnapshot(page);
    expect(during).not.toEqual(before); // glyph rendering visibly changed the canvas

    // Turn it back off the same way.
    await page.keyboard.press('a');
    await page.waitForTimeout(100);
    await forceDraw(page);

    const after = await canvasSnapshot(page);
    expect(after).toEqual(before); // exactly restored — no residue, no drift

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('the trigger tab and settings dialog are reachable and keyboard-operable', async ({ page }) => {
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    const toggle = page.getByRole('button', { name: /Art mode/ }).first();
    await expect(toggle).toBeVisible();

    const settings = page.getByRole('button', { name: 'Art mode settings' });
    await settings.click();
    await expect(page.getByRole('dialog', { name: 'Acid Art' })).toBeVisible();
    await expect(page.getByText('Classic ASCII (one click)')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Acid Art' })).toBeHidden();
  });

  test('webcam source starts and tears down cleanly (Stop button, and on close)', async ({ page }) => {
    await mockWebcam(page);
    await suppressTour(page);
    await openApp(page);
    await dismissTitle(page);

    await page.getByRole('button', { name: 'Art mode settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Acid Art' });
    await expect(dialog).toBeVisible();

    // Reach the field source control (a single-select `Toggle`, exposed as
    // radio items per Radix's `ToggleGroup` single-type semantics) and pick
    // 'webcam' so that section renders (it's conditionally shown).
    await dialog.getByRole('radio', { name: 'Webcam' }).click();
    await dialog.getByRole('button', { name: 'Start webcam' }).click();
    await expect(dialog.getByText(/Active: webcam/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Stop' }).click();
    const stopsAfterButton = await page.evaluate(() => (window as unknown as { __fakeTrackStops__: number }).__fakeTrackStops__);
    expect(stopsAfterButton).toBeGreaterThanOrEqual(1);
    // Stopping also resets the field source to 'none' (an inactive field
    // has no active source), which unmounts this whole section — re-select
    // 'Webcam' to bring the Start/Stop controls back before starting again.
    await expect(dialog.getByRole('button', { name: 'Start webcam' })).toBeHidden();
    await dialog.getByRole('radio', { name: 'Webcam' }).click();

    // Start it again, then close the dialog entirely (unmount) instead of
    // clicking Stop — teardown must happen either way.
    await dialog.getByRole('button', { name: 'Start webcam' }).click();
    await expect(dialog.getByText(/Active: webcam/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.waitForTimeout(150);
    const stopsAfterClose = await page.evaluate(() => (window as unknown as { __fakeTrackStops__: number }).__fakeTrackStops__);
    expect(stopsAfterClose).toBeGreaterThan(stopsAfterButton);
  });
});
