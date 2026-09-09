import { test, type Page } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, suppressTour } from './utils';

async function setTheme(page: Page, themeId: string): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem('afterlife:v1:theme', JSON.stringify({ themeId: id, explicit: true, customThemes: [] }));
  }, themeId);
}

async function setCamera(page: Page, cam: { x: number; y: number; scale: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __AFTERLIFE__: { camera: { set(next: Partial<typeof c>): void } } })
      .__AFTERLIFE__.camera.set(c);
  }, cam);
  await page.evaluate(() => {
    const s = (window as unknown as { __AFTERLIFE__: { renderer: { draw(e: unknown): void }; engine: unknown } }).__AFTERLIFE__;
    s.renderer.draw(s.engine);
  });
}

test('SHOTS: boundary + trigger', async ({ page }, testInfo) => {
  for (const theme of ['observatory', 'phosphor']) {
    for (const vp of [{ w: 390, h: 844, name: 'mobile' }, { w: 1440, h: 900, name: 'desktop' }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await setTheme(page, theme);
      await suppressTour(page);
      await openApp(page);
      await dismissTitle(page);
      await page.waitForTimeout(700);
      await ensurePaused(page);

      // Right at the canonical [0,width]x[0,height] corner (below
      // GRID_MIN_SCALE so the boundary hairline isn't visually crowded by
      // the regular cell grid).
      await setCamera(page, { x: 3, y: 3, scale: 5 });
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${vp.name}-near-origin.png`) });

      // Panned FAR across several world-widths (256 wide), but landed close
      // to the NEXT tile's edge (1024 = 4 * 256) — the bug: the old
      // fixed-at-[0,256] rect would be many screens away from here and
      // never show up. The fix must show an edge right nearby, still.
      await setCamera(page, { x: 1010, y: 60, scale: 5 });
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${vp.name}-panned-far.png`) });

      // Zoomed way out (whole world roughly visible) — sanity check the
      // overall look is still quiet/correct.
      await setCamera(page, { x: 128, y: 80, scale: 3 });
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${vp.name}-zoomed-out.png`) });
    }
  }
});
