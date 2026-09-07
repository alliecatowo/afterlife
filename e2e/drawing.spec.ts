import { expect, test } from '@playwright/test';
import { currentGen, dismissTitle, ensurePaused, openApp, realGen } from './utils';

test.describe('drawing', () => {
  test('a continuous fast diagonal stroke forms a connected line (no gaps)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page); // a static world to inspect — the stroke shouldn't have to outrun the simulation
    await page.keyboard.press('d'); // draw tool

    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const sx0 = box.width / 2 - 120;
    const sy0 = box.height / 2 - 120;
    const sx1 = box.width / 2 + 120;
    const sy1 = box.height / 2 + 120;

    await page.mouse.move(box.x + sx0, box.y + sy0);
    await page.mouse.down();
    const STEPS = 4; // sparse samples — simulates a genuinely FAST stroke
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(box.x + sx0 + ((sx1 - sx0) * i) / STEPS, box.y + sy0 + ((sy1 - sy0) * i) / STEPS);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);

    const result = await page.evaluate(
      ({ sx0, sy0, sx1, sy1 }) => {
        const session = (window as unknown as {
          __AFTERLIFE__: { renderer: { screenToWorld(x: number, y: number): { x: number; y: number } }; engine: { region(r: { x: number; y: number; w: number; h: number }): Uint8Array } };
        }).__AFTERLIFE__;
        const w0 = session.renderer.screenToWorld(sx0, sy0);
        const w1 = session.renderer.screenToWorld(sx1, sy1);
        const x0 = Math.floor(w0.x);
        const y0 = Math.floor(w0.y);
        const x1 = Math.floor(w1.x);
        const y1 = Math.floor(w1.y);
        const minX = Math.min(x0, x1) - 2;
        const maxX = Math.max(x0, x1) + 2;
        const minY = Math.min(y0, y1) - 2;
        const maxY = Math.max(y0, y1) + 2;
        const rw = maxX - minX + 1;
        const rh = maxY - minY + 1;
        const region = session.engine.region({ x: minX, y: minY, w: rw, h: rh });
        const startIdx = (y0 - minY) * rw + (x0 - minX);
        const endIdx = (y1 - minY) * rw + (x1 - minX);
        const live = region.reduce((a, b) => a + b, 0);
        if (!region[startIdx] || !region[endIdx]) return { ok: false, reason: 'an endpoint is not alive', live };
        const seen = new Uint8Array(region.length);
        const stack = [startIdx];
        seen[startIdx] = 1;
        while (stack.length) {
          const i = stack.pop()!;
          const cx = i % rw;
          const cy = (i / rw) | 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) continue;
              const ni = ny * rw + nx;
              if (region[ni] && !seen[ni]) {
                seen[ni] = 1;
                stack.push(ni);
              }
            }
          }
        }
        return { ok: seen[endIdx] === 1, reason: 'flood-fill from start to end', live };
      },
      { sx0, sy0, sx1, sy1 },
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});

test.describe('transport', () => {
  test('pause / step / play / speed all work, and the readout never jitters', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

    // Step forward while paused: exactly +1.
    const g0 = await realGen(page);
    await page.getByRole('button', { name: 'Step forward' }).click();
    await page.waitForTimeout(50);
    expect(await realGen(page)).toBe(g0 + 1);

    // Step back: exactly -1, back to g0.
    await page.getByRole('button', { name: 'Step back' }).click();
    await page.waitForTimeout(200);
    expect(await realGen(page)).toBe(g0);

    // The HUD readout (bus-driven) agrees with the real engine generation.
    await page.waitForTimeout(150);
    expect(await currentGen(page)).toBe(await realGen(page));

    // Change speed, then play: real playback, generation advances.
    await page.getByRole('radio', { name: '30', exact: true }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.waitForTimeout(600);
    const advancing = await realGen(page);
    expect(advancing).toBeGreaterThan(g0);

    // Pause actually stops it — no more ticking once paused.
    await page.getByRole('button', { name: 'Pause' }).click();
    const paused = await realGen(page);
    await page.waitForTimeout(400);
    expect(await realGen(page)).toBe(paused);

    // The readout matches the real generation at rest, never a stale/jittered value.
    await page.waitForTimeout(150);
    expect(await currentGen(page)).toBe(paused);
  });
});
