import { test } from '@playwright/test';
import { applyEditDirect, dismissTitle, ensurePaused, openApp, suppressTour } from './utils';

test('screenshot ascii', async ({ page }) => {
  await suppressTour(page);
  await openApp(page);
  await dismissTitle(page);
  await ensurePaused(page);

  // A denser field of blocks (immortal still lifes) so the glyph ramp has
  // plenty of live cells to show, tiled closely enough to look deliberate.
  const cells: Array<{x:number;y:number;alive:boolean}> = [];
  for (let j=0;j<10;j++) {
    for (let i=0;i<14;i++) {
      const bx=20+i*4, by=20+j*4;
      cells.push({x:bx,y:by,alive:true},{x:bx+1,y:by,alive:true},{x:bx,y:by+1,alive:true},{x:bx+1,y:by+1,alive:true});
    }
  }
  await applyEditDirect(page, cells);
  await page.waitForTimeout(150);
  // Step far enough that ages spread across the whole ramp (some regions
  // will be seeded again partway through to vary age, so the ramp reads as
  // more than a single uniform character).
  await page.evaluate((n) => { (window as any).__AFTERLIFE__.loop.stepOnce(n); }, 28);
  await page.waitForTimeout(150);

  // Close the drawer for a clean, full-width shot and give the world more
  // room to fill the frame.
  await page.getByLabel('Close drawer').click();
  await page.waitForTimeout(150);
  await page.evaluate((c) => { (window as any).__AFTERLIFE__.camera.set(c); }, {x:47,y:37,scale:34});
  await page.waitForTimeout(200);

  await page.keyboard.press('a');
  await page.waitForTimeout(150);
  await page.evaluate(() => { const s=(window as any).__AFTERLIFE__; s.renderer.draw(s.engine); });
  await page.waitForTimeout(200);
  const fullCheck = await page.evaluate(() => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0,0,canvas.width, canvas.height).data;
    let sum = 0;
    for (let k=3;k<data.length;k+=4) sum += data[k];
    const style = getComputedStyle(canvas);
    return { sum, w: canvas.width, h: canvas.height, opacity: style.opacity, display: style.display, visibility: style.visibility, zIndex: style.zIndex };
  });
  console.log('FULLCHECK', JSON.stringify(fullCheck));
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/ascii-mode-1440x900.png' });
});
