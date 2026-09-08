import { expect, test, type Page } from '@playwright/test';
import { dismissTitle, openApp } from './utils';

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
    await expect.poll(async () => (await cameraState(page)).following).toBe(true);
    await page.waitForTimeout(7000);
    const during = await cameraState(page);
    const moved = Math.abs(during.x - before.x) > 0.5 || Math.abs(during.y - before.y) > 0.5 || Math.abs(during.scale - before.scale) > 0.5;
    expect(moved, `camera should have moved: before=${JSON.stringify(before)} during=${JSON.stringify(during)}`).toBe(true);

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
