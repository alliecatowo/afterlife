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

/** 1-3 are life/age/activity; 4-8 are the "lineage family" added for the
 *  colourful rewrite (`@/interact/input.ts`'s `#setLens` — see
 *  INTEGRATION-NOTES.md's "colourful lenses" entry for why these keyboard
 *  shortcuts, not the HUD `Toggle`, are the reliable way to reach them: the
 *  HUD picker's own `Toggle` options are owned by a different agent and may
 *  not be wired up yet). */
async function setLens(page: Page, key: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8'): Promise<void> {
  await page.keyboard.press(key);
  // Give the dirty-flag-gated render loop one frame to pick up the change.
  await page.waitForTimeout(150);
}

/**
 * Every hue present in `#world-canvas`, bucketed to the nearest 20 degrees
 * and filtered to buckets covering a meaningful share of the coloured
 * (non-grey, non-transparent) pixels — this is what lets a test assert
 * "several distinct HUES are present", the thing a single hue rendered at
 * different LIGHTNESSES would fail (every pixel would fall in one bucket
 * regardless of how much its lightness varies, since HSL hue is lightness-
 * independent). Near-grey pixels (hairlines, the torus boundary dash, the
 * ivory "undefined direction" fill) are excluded via the saturation-proxy
 * `max - min < 0.04` check, so chrome/overlay pixels can't manufacture a
 * false pass.
 */
async function significantHueBuckets(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.getElementById('world-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map<number, number>();
    let coloredTotal = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 40) continue; // near-transparent
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      if (d < 0.04) continue; // near-grey: no meaningful hue
      let h: number;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = Math.round(h * 60);
      if (h < 0) h += 360;
      const bucket = Math.floor(h / 20) * 20;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      coloredTotal++;
    }
    const threshold = Math.max(30, coloredTotal * 0.02);
    return [...buckets.entries()].filter(([, count]) => count >= threshold).map(([bucket]) => bucket);
  });
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

  test('lineage/quadlife/velocity/neighbors lenses are genuinely multi-hued, not one hue at different lightnesses', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    // A denser, longer-running world gives lineage families more chance to
    // diverge, more live neighbour-count variety, and more structures
    // travelling in different directions to sample.
    await page.waitForTimeout(2500);
    await ensurePaused(page);
    await page.waitForTimeout(150);

    for (const [name, key] of [['lineage', '4'], ['quadlife', '6'], ['velocity', '7'], ['neighbors', '8']] as const) {
      await setLens(page, key);
      const buckets = await significantHueBuckets(page);
      expect(buckets.length, `${name} lens: only found hue buckets ${JSON.stringify(buckets)} — expected several distinct hues, not one hue at different lightnesses`).toBeGreaterThanOrEqual(3);
    }
  });

  test('immigration lens renders exactly two clearly separated populations, not two shades of one hue', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(2500);
    await ensurePaused(page);
    await page.waitForTimeout(150);

    await setLens(page, '5');
    const buckets = await significantHueBuckets(page);
    expect(buckets.length, `immigration lens: found hue buckets ${JSON.stringify(buckets)}`).toBeGreaterThanOrEqual(2);
    // Confirm the two dominant hues are genuinely far apart on the wheel
    // (branch-a/branch-b are ~105 degrees apart design tokens), not two
    // near-adjacent buckets an anti-aliased single hue could produce.
    const sorted = [...buckets].sort((a, b) => a - b);
    const gap = Math.min(sorted[sorted.length - 1]! - sorted[0]!, 360 - (sorted[sorted.length - 1]! - sorted[0]!));
    expect(gap).toBeGreaterThan(40);
  });

  test('colour lenses survive a lens switch with zero new console errors in the real production bundle', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(600);
    await ensurePaused(page);
    for (const key of ['4', '5', '6', '7', '8', '1'] as const) await setLens(page, key);
    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});
