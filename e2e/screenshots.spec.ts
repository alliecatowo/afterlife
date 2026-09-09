import { test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, openControl, waitForGen, worldToScreen } from './utils';
import { OPENING_VERIFIED } from '../src/content/scenes';

/**
 * Visual verification screenshots, at both required viewports (see
 * `playwright.config.ts`'s `desktop` / `mobile` projects — this file is the
 * only one the `mobile` project runs). Judged by eye afterward, not asserted
 * on here; failures in these six flows are already covered by the other
 * spec files.
 */
async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  const project = test.info().project.name;
  await page.screenshot({ path: `screenshots/${name}-${project}.png` });
}

test.describe('screenshots', () => {
  test('opening scene', async ({ page }) => {
    await openApp(page);
    await page.waitForTimeout(400);
    await shot(page, '01-opening');
  });

  test('mid-encounter', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, OPENING_VERIFIED.encounterGen, 25_000);
    await ensurePaused(page);
    // Frame the encounter tightly for the screenshot — scene beats deliberately
    // never move the camera during ordinary play (see `session.ts`'s
    // `checkBeats` doc), so this test frames it manually instead.
    await page.evaluate((bbox) => {
      (window as unknown as { __AFTERLIFE__: { camera: { fit(r: typeof bbox, pad?: number): void } } }).__AFTERLIFE__.camera.fit(bbox, 60);
    }, OPENING_VERIFIED.encounterBbox);
    await page.waitForTimeout(150);
    await shot(page, '02-mid-encounter');
  });

  test('compare view', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await waitForGen(page, 15, 15_000);
    await ensurePaused(page);
    await page.keyboard.press('d');
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const ribbon = page.getByRole('slider', { name: 'History timeline' });
    await ribbon.focus();
    await ribbon.press('Home');
    await page.waitForTimeout(200);
    // A small blinker, not a single cell — see timeline.spec.ts for why a
    // lone cell in this empty region leaves no lasting divergence to show.
    for (const dx of [0, 1, 2]) {
      const p = await worldToScreen(page, 128 + dx + 0.5, 80.5); // cell centre, not its corner
      await page.mouse.click(box.x + p.x, box.y + p.y);
    }
    await page.waitForTimeout(150);
    // The edit above forked AND SWITCHED TO branch-1 (recordOrFork's normal
    // behaviour) — so from here the available comparison target is
    // "Original" (root), not "branch-1" (which is now the active branch and
    // therefore excluded from its own compare-target list).
    await openControl(page, 'Compare');
    await page.getByRole('button', { name: 'Original' }).click();
    await page.waitForTimeout(400);
    await shot(page, '03-compare');
  });

  test('time sculpture', async ({ page }) => {
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
    await openControl(page, 'Open time sculpture');
    await page.waitForTimeout(1200); // let the flat -> three-quarter camera intro settle
    await shot(page, '04-sculpture');
  });

  test('field guide', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(6000); // give ambient scanning a couple of passes
    await openControl(page, 'Field guide');
    await page.waitForTimeout(200);
    await shot(page, '05-field-guide');
  });

  test('an experiment', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await openControl(page, 'Experiments');
    await page.getByRole('button', { name: 'Start' }).first().click();
    await page.waitForTimeout(600);
    await shot(page, '06-experiment');
  });
});
