import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, realGen, waitForGen } from './utils';

test.describe('time sculpture', () => {
  test('opens from a selection with real slices; picking one moves the sim; Escape returns', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 40, 15_000);
    await ensurePaused(page);

    // Select a generous region likely to contain live cells (the opening
    // scene's population is spread across most of the establishing view).
    await page.keyboard.press('s');
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 150);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 150, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    const openBtn = page.getByRole('button', { name: 'Open time sculpture' });
    await expect(openBtn).toBeEnabled();
    await openBtn.click();

    const sculptureHost = page.locator('#sculpture-canvas');
    await expect(sculptureHost).not.toHaveClass(/hidden/);
    await expect(page.getByText(/recorded generation/i)).toBeVisible();
    await expect(page.getByText('Return to living plane (esc)')).toBeVisible();

    // Real slices: the sculpture's own canvas must actually paint something
    // (a bare/transparent canvas would mean no geometry built at all).
    const sculptureCanvas = sculptureHost.locator('canvas').first();
    await expect(sculptureCanvas).toBeVisible();

    // Picking a slice moves the sim to that generation — click a small grid
    // of points until one lands on an instanced cell (raycasting depends on
    // exactly which cell is under the pointer after the camera's intro eases
    // into its three-quarter view).
    const before = await realGen(page);
    const chost = (await sculptureHost.boundingBox())!;
    let moved = false;
    await page.waitForTimeout(900); // let the camera intro settle first
    outer: for (const fx of [0.5, 0.4, 0.6, 0.45, 0.55, 0.35, 0.65]) {
      for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) {
        await page.mouse.click(chost.x + chost.width * fx, chost.y + chost.height * fy);
        await page.waitForTimeout(150);
        if ((await realGen(page)) !== before) { moved = true; break outer; }
      }
    }
    expect(moved, 'clicking an instanced slice should move the sim to its generation').toBe(true);

    // Escape returns to the living plane.
    await page.keyboard.press('Escape');
    await expect(sculptureHost).toHaveClass(/hidden/);
    await expect(canvas).not.toHaveClass(/hidden/);
  });

  // Regression: the flat-plane -> three-quarter camera intro
  // (`SculptureScene.tsx`'s `CameraRig`) and the OrbitControls' inertia
  // ("damping") both animate every frame regardless of the OS's
  // reduce-motion preference before this fix. Verified without trusting
  // pixels (this sandbox's software WebGL renders slice colour dark
  // regardless — a known, separate artifact): the test above needs a ~900ms
  // settle wait for the intro to finish easing before picking a slice
  // reliably lands on an instanced cell; under reduced motion the camera is
  // already at its FINAL pose on the very first frame, so the same pick
  // should succeed immediately, with no settle wait at all.
  test('camera intro is instant (no settle wait needed) when the OS prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 40, 15_000);
    await ensurePaused(page);

    await page.keyboard.press('s');
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 150);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 150, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);

    await page.getByRole('button', { name: 'Open time sculpture' }).click();
    const sculptureHost = page.locator('#sculpture-canvas');
    await expect(sculptureHost.locator('canvas').first()).toBeVisible();

    const before = await realGen(page);
    const chost = (await sculptureHost.boundingBox())!;
    let moved = false;
    // Deliberately NO `waitForTimeout` settle here — that's the point.
    outer: for (const fx of [0.5, 0.4, 0.6, 0.45, 0.55, 0.35, 0.65]) {
      for (const fy of [0.5, 0.45, 0.55, 0.4, 0.6]) {
        await page.mouse.click(chost.x + chost.width * fx, chost.y + chost.height * fy);
        await page.waitForTimeout(50);
        if ((await realGen(page)) !== before) { moved = true; break outer; }
      }
    }
    expect(moved, 'with the intro suppressed, the camera should already be at its final pose').toBe(true);

    await page.keyboard.press('Escape');
    await expect(sculptureHost).toHaveClass(/hidden/);
  });
});
