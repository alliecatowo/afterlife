import { expect, test, type Page } from '@playwright/test';
import { collectConsoleErrors, dismissTitle, ensurePaused, openApp } from './utils';

/**
 * BUG 1 closed the testing gap that let it ship: `desktop`/`mobile` run
 * against `npm run dev`, which serves source `oklch(...)` CSS verbatim —
 * never the production wire format. This project (`prod-build`, see
 * `playwright.config.ts`) is the only one that builds for real and drives
 * the actual `dist/` output through `npm run preview`, sampling real canvas
 * pixels rather than the debug `window.__AFTERLIFE__` hook (which is
 * dev-only and dead-code-eliminated from a production build — using it here
 * would test the wrong thing).
 *
 * Root cause recap: Tailwind v4 + Lightning CSS downlevel `--color-accent-*`
 * from `oklch(...)` to `lab(...)` in the production build. The renderer's
 * old colour resolver only understood a literal `oklch(...)` regex, threw on
 * `lab(...)`, and silently fell back to hardcoded white for every lens —
 * verified by temporarily reverting the fix and re-running this exact test,
 * which failed (dominant colour was pure white, indistinguishable across
 * lenses) before the fix and passes after it.
 */

interface Rgb { r: number; g: number; b: number }

/** The most frequent non-transparent RGB in `#world-canvas` — reliably the
 *  lens's cell-fill colour, since grid hairlines/the torus boundary cover far
 *  fewer pixels than a live population's cell fills. */
async function dominantCanvasColor(page: Page): Promise<Rgb> {
  return page.evaluate(() => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const counts = new Map<string, number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue; // transparent background
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size === 0) throw new Error(`no non-transparent pixels in a ${width}x${height} canvas`);
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [r, g, b] = best![0]!.split(',').map(Number);
    return { r: r!, g: g!, b: b! };
  });
}

function isGreyOrWhite(c: Rgb): boolean {
  return c.r === c.g && c.g === c.b;
}

function dist(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

async function setLens(page: Page, key: '1' | '2' | '3'): Promise<void> {
  await page.keyboard.press(key);
  // Give the dirty-flag-gated render loop one frame to pick up the change.
  await page.waitForTimeout(150);
}

test.describe('production build: real, colourful rendering (BUG 1)', () => {
  test('the built app renders zero console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(500);
    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('life lens: cells render a real, chromatic colour — never white, never grey', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(600); // let a live population accumulate before sampling
    await ensurePaused(page);
    await page.waitForTimeout(150);

    const life = await dominantCanvasColor(page);
    expect(life, JSON.stringify(life)).not.toEqual({ r: 255, g: 255, b: 255 });
    expect(isGreyOrWhite(life), JSON.stringify(life)).toBe(false);
  });

  test('life / age / activity lenses are genuinely, richly differentiated colours', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(900);
    await ensurePaused(page);
    await page.waitForTimeout(150);

    await setLens(page, '1');
    const life = await dominantCanvasColor(page);
    await setLens(page, '2');
    const age = await dominantCanvasColor(page);
    await setLens(page, '3');
    const activity = await dominantCanvasColor(page);

    for (const [name, c] of [['life', life], ['age', age], ['activity', activity]] as const) {
      expect(isGreyOrWhite(c), `${name} lens resolved to a flat white/grey: ${JSON.stringify(c)}`).toBe(false);
    }

    // Each lens has its own accent hue (green/amber/red) — they must be
    // clearly distinguishable at a glance, not three near-identical shades.
    expect(dist(life, age)).toBeGreaterThan(40);
    expect(dist(life, activity)).toBeGreaterThan(40);
    expect(dist(age, activity)).toBeGreaterThan(40);
  });
});
