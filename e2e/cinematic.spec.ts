import { expect, test, type Page } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp } from './utils';

/**
 * CINEMATIC MODE — the hands-off, full-screen auto-pan presentation.
 * See `src/ui/cinematic/**` for the implementation: interest scoring off the
 * real engine (`src/ui/cinematic/interest.ts`/`worldSample.ts`, unit-tested
 * separately), the camera choreography (`director.ts`), and this glue
 * (`index.ts`) which reuses the existing `presentation` chrome-hiding flag
 * and layers a best-effort Fullscreen request + its own minimal overlay on
 * top.
 */

type CinematicWindow = {
  __AFTERLIFE__?: {
    camera: { camera: { x: number; y: number; scale: number }; following: boolean };
    cinematic: { isActive(): boolean; enter(): void; exit(): void };
  };
};

async function cinematicActive(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as CinematicWindow).__AFTERLIFE__?.cinematic.isActive() ?? false);
}

async function cameraState(page: Page): Promise<{ x: number; y: number; scale: number; following: boolean }> {
  return page.evaluate(() => {
    const cam = (window as unknown as CinematicWindow).__AFTERLIFE__!.camera;
    return { ...cam.camera, following: cam.following };
  });
}

test.describe('cinematic mode', () => {
  test('entering hides chrome, moves the camera over time, and Esc exits cleanly', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    const hud = page.locator('#hud-top');
    const timeline = page.locator('#timeline');
    await expect(hud).not.toHaveCSS('height', '0px');

    const before = await cameraState(page);

    // 'c' is cinematic mode's entry shortcut (see `src/ui/cinematic/index.ts`).
    await page.keyboard.press('c');
    await expect.poll(() => cinematicActive(page)).toBe(true);

    // Same chrome-hiding as presentation mode (reused, not reinvented).
    await expect(hud).toHaveCSS('height', '0px');
    await expect(timeline).toHaveCSS('height', '0px');

    // The mode's own minimal, self-mounted affordance: at least an exit
    // control is present (see `CinematicOverlay.tsx`) — this is the "way
    // out" the brief requires beyond just knowing the Esc key exists.
    await expect(page.getByRole('button', { name: 'Exit cinematic mode' })).toBeVisible();

    // The camera is on continuously (following()), and — given several
    // seconds of real generations ticking (the director's first beat is a
    // deliberate wide establishing shot, then it picks a real subject) —
    // has actually moved, not just sat at its pre-cinematic framing.
    //
    // Polled, not a fixed sleep-then-check-once: the director's own timing
    // (a WIDE_HOLD_MS=4500ms establishing shot, then a real subject pick) is
    // correct by construction, but how long it takes to produce a VISIBLE
    // 0.5-unit displacement in wall-clock time also depends on the browser
    // actually getting to run animation frames promptly — true on a warm,
    // idle machine, not guaranteed on a cold dev server (first-time Vite
    // module transforms) or a loaded CI box running the suite sequentially.
    // A one-shot check at a fixed t=7s treated "hasn't moved YET" the same
    // as "will never move" and failed on the former. Polling up to a
    // generous ceiling accepts the movement whenever it genuinely happens
    // and still fails loudly if it truly never does.
    await expect.poll(
      async () => {
        const during = await cameraState(page);
        return Math.abs(during.x - before.x) > 0.5 || Math.abs(during.y - before.y) > 0.5 || Math.abs(during.scale - before.scale) > 0.5;
      },
      { timeout: 20_000, message: `camera should move within 20s of entering cinematic mode (before=${JSON.stringify(before)})` },
    ).toBe(true);

    // Esc exits the mode entirely and restores chrome — the existing
    // `App.tsx` presentation Escape handler, which cinematic mode's own
    // `presentation:toggle` listener tears itself down in response to.
    await page.keyboard.press('Escape');
    await expect.poll(() => cinematicActive(page)).toBe(false);
    await expect(hud).not.toHaveCSS('height', '0px');
    await expect(timeline).not.toHaveCSS('height', '0px');
  });

  test('real user input hands control back without exiting the mode', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    await page.keyboard.press('c');
    await expect.poll(() => cinematicActive(page)).toBe(true);
    await expect.poll(async () => (await cameraState(page)).following).toBe(true);

    // A real keyboard pan — the same shortcut `e2e/shortcuts.spec.ts` already
    // exercises for manual camera control — must release the director's grip
    // on the camera immediately, exactly like `CameraController.releaseFollow()`
    // already does for any manual `panByScreen`/`zoomAt`/`set` call.
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await cameraState(page)).following).toBe(false);

    // Handing back control is a PAUSE, not an exit — the mode stays active,
    // fullscreen/chrome-hidden, so a stray keystroke doesn't kick the user
    // all the way out of a mode they just settled into.
    expect(await cinematicActive(page)).toBe(true);
    await expect(page.locator('#hud-top')).toHaveCSS('height', '0px');

    // A little further playback shouldn't silently resume the auto-pan
    // right away — the camera should stay wherever the user left it for at
    // least a moment (the resume affordance appears; see `CinematicOverlay`).
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect.poll(() => cinematicActive(page)).toBe(false);
  });

  test('pressing c while paused still enters cinematic mode, by resuming playback — not a silent no-op', async ({ page }) => {
    // BUG (found by a browser-driven reachability audit): pressing 'c' while
    // paused appeared to do nothing — every other cinematic test in this
    // file starts from the default PLAYING state, so this exact path had no
    // coverage. `index.ts`'s `enter()` deliberately resumes playback when
    // entering from a paused state ("a static, paused world has nothing to
    // be cinematic ABOUT — the whole premise is real, ongoing activity to
    // find and hold on") rather than silently refusing or entering a
    // decorative no-op mode over a frozen world — the honest choice per the
    // brief: either make it work, or gate it with a visible, stated reason;
    // never a control that does nothing with no explanation. This test
    // locks that choice in.
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    const genBefore = await page.evaluate(() => (window as unknown as { __AFTERLIFE__?: { engine: { gen: number } } }).__AFTERLIFE__?.engine.gen ?? -1);

    await page.keyboard.press('c');
    await expect.poll(() => cinematicActive(page)).toBe(true);

    // Playback genuinely resumed — the world is no longer frozen — not just
    // the camera moving over static content.
    await expect.poll(
      async () => page.evaluate(() => (window as unknown as { __AFTERLIFE__?: { engine: { gen: number } } }).__AFTERLIFE__?.engine.gen ?? -1),
      { timeout: 10_000, message: 'generation should advance once cinematic mode resumes playback' },
    ).toBeGreaterThan(genBefore);

    // Exiting restores exactly the playback state the user actually had
    // (paused), rather than always leaving the world running afterwards.
    await page.keyboard.press('Escape');
    await expect.poll(() => cinematicActive(page)).toBe(false);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('prefers-reduced-motion still enters and exits cleanly (cuts rather than continuous animation)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await dismissTitle(page);

    await page.keyboard.press('c');
    await expect.poll(() => cinematicActive(page)).toBe(true);
    await expect(page.locator('#hud-top')).toHaveCSS('height', '0px');

    await page.waitForTimeout(1000);
    const a = await cameraState(page);
    await page.waitForTimeout(300);
    const b = await cameraState(page);
    // Within one short window the camera should be holding still (a cut
    // lands instantly, then nothing moves until the NEXT cut) rather than
    // continuously easing frame over frame the way normal motion does.
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.y).toBeCloseTo(b.y, 3);
    expect(a.scale).toBeCloseTo(b.scale, 3);

    await page.keyboard.press('Escape');
    await expect.poll(() => cinematicActive(page)).toBe(false);
  });
});
