import type { Page } from '@playwright/test';

/** Navigate to the app and wait for the world canvas to exist. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#world-canvas').waitFor({ state: 'attached' });
}

/** The very first pointer interaction dismisses the title plate — no click-to-continue gate. */
export async function dismissTitle(page: Page): Promise<void> {
  const canvas = page.locator('#world-canvas');
  await canvas.click({ position: { x: 5, y: 5 }, force: true });
}

/** The opening scene autoplays on boot (a live observatory, not a paused
 *  diagram) — pause it for tests that need a static world to inspect. */
export async function ensurePaused(page: Page): Promise<void> {
  const pauseBtn = page.getByRole('button', { name: 'Pause' });
  if (await pauseBtn.isVisible().catch(() => false)) {
    await pauseBtn.click();
    await page.getByRole('button', { name: 'Play' }).waitFor({ state: 'visible' });
  }
}

export async function currentGen(page: Page): Promise<number> {
  const text = await page.getByTestId('hud-gen').textContent();
  return Number(text ?? '0');
}

export async function currentPopulation(page: Page): Promise<number> {
  const text = await page.getByTestId('hud-pop').textContent();
  return Number(text ?? '0');
}

/** Poll `currentGen` until it reaches at least `gen`, up to `timeoutMs`. */
export async function waitForGen(page: Page, gen: number, timeoutMs = 30_000): Promise<number> {
  const start = Date.now();
  let last = await currentGen(page);
  while (last < gen) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for gen ${gen}, last seen ${last}`);
    await page.waitForTimeout(150);
    last = await currentGen(page);
  }
  return last;
}

/** The exact engine generation, bypassing the throttled HUD readout — see
 *  `session.ts`'s dev-only `window.__AFTERLIFE__` introspection hook. */
export async function realGen(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __AFTERLIFE__?: { engine: { gen: number } } }).__AFTERLIFE__?.engine.gen ?? -1);
}

/** CSS-pixel canvas coordinates for a world cell, via the live camera/renderer. */
export async function worldToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ x, y }) => (window as unknown as { __AFTERLIFE__: { renderer: { worldToScreen(x: number, y: number): { x: number; y: number } } } }).__AFTERLIFE__.renderer.worldToScreen(x, y),
    { x, y },
  );
}

/** Directly set cells via the debug hook — test scaffolding (setup/teardown), not the feature under test. */
export async function applyEditDirect(page: Page, cells: Array<{ x: number; y: number; alive: boolean }>): Promise<void> {
  await page.evaluate((c) => {
    (window as unknown as { __AFTERLIFE__: { applyEdit(op: { kind: 'set'; cells: typeof c }): void } }).__AFTERLIFE__.applyEdit({ kind: 'set', cells: c });
  }, cells);
}

export async function regionPopulation(
  page: Page,
  rect: { x: number; y: number; w: number; h: number },
): Promise<number> {
  return page.evaluate((r) => {
    const session = (window as unknown as { __AFTERLIFE__?: { engine: { region(rect: typeof r): Uint8Array } } }).__AFTERLIFE__;
    if (!session) return -1;
    const region = session.engine.region(r);
    let n = 0;
    for (const v of region) n += v;
    return n;
  }, rect);
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}
