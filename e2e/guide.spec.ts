import { expect, test } from '@playwright/test';
import { openApp, suppressTour } from './utils';

/**
 * The marketing/guide/wiki site under `/guide/` (source: `site/**`, built
 * by `site/scripts/build-pages.mjs`). Runs against the same dev server the
 * rest of the `desktop` project uses (see `vite.config.ts`'s
 * `guideDevAliasPlugin`, which rewrites `/guide/*` to the real
 * `/site/guide/*` source path only in dev — the production build instead
 * physically relocates the output via `site/scripts/postbuild-flatten.mjs`).
 *
 * Vite's dev server falls back to serving the app's own `index.html` for
 * any unmatched path (default `appType: 'spa'`), so a request for a
 * genuinely missing guide page would still come back with an HTTP 200 —
 * checking status codes alone can't tell a real page from that fallback.
 * Every real guide/wiki page carries `id="main"` (from `renderLayout` in
 * `site/scripts/content.mjs`) and `site-footer`, which the app's own shell
 * never does; that's the marker these checks look for instead.
 */

const GUIDE_MARKER = 'id="main"';

const WIKI_PAGES = [
  '/guide/wiki/',
  '/guide/wiki/getting-started/',
  '/guide/wiki/fundamentals/',
  '/guide/wiki/specimens/',
  '/guide/wiki/features/',
  '/guide/wiki/shortcuts/',
  '/guide/wiki/how-it-works/',
  '/guide/wiki/verification/',
];

test.describe('guide + wiki', () => {
  test('the app root still loads (unaffected by the guide build)', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#world-canvas')).toBeAttached();
  });

  test('the landing page loads and mounts the glider diagram', async ({ page }) => {
    await page.goto('/guide/');
    await expect(page.locator('h1')).toContainText('AFTERLIFE');
    await expect(page.getByRole('link', { name: 'Open the app' }).first()).toHaveAttribute('href', '/afterlife/');
    // The inline B3/S23 diagram mounts onto this canvas (site/shared/glider.ts).
    await expect(page.locator('#glider-diagram')).toBeAttached();
  });

  for (const path of WIKI_PAGES) {
    test(`wiki page loads: ${path}`, async ({ page, request }) => {
      const res = await request.get(path);
      expect(res.status(), `${path} should respond 200`).toBe(200);
      const body = await res.text();
      expect(body, `${path} should be a real guide page, not the app's SPA fallback`).toContain(GUIDE_MARKER);

      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
    });
  }

  test('every nav / sidebar / footer link on the wiki home resolves (no 404s)', async ({ page, request }) => {
    await page.goto('/guide/wiki/');
    const hrefs = await page
      .locator('.site-nav a, .wiki-sidebar a, .site-footer a, .wiki-index-card a')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')).filter((h): h is string => !!h));

    const internal = [...new Set(hrefs)].filter((h) => h.startsWith('/afterlife/guide') || h === '/afterlife/');
    expect(internal.length).toBeGreaterThan(5);

    for (const href of internal) {
      if (href === '/afterlife/') continue; // the app itself; covered above.
      const res = await request.get(href);
      expect(res.status(), `${href} should respond 200`).toBe(200);
      const body = await res.text();
      expect(body, `${href} should be a real guide page, not the app's SPA fallback`).toContain(GUIDE_MARKER);
    }
  });

  test('the specimen catalogue renders all 24 specimens with no invented entries', async ({ page }) => {
    await page.goto('/guide/wiki/specimens/');
    const cards = page.locator('.specimen-card');
    await expect(cards).toHaveCount(24);
    await expect(page.getByText('There is deliberately no puffer.')).toBeVisible();
  });

  test('the keyboard shortcuts page lists the Space and ? bindings', async ({ page }) => {
    await page.goto('/guide/wiki/shortcuts/');
    await expect(page.getByRole('cell', { name: 'Play / pause' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'This sheet' })).toBeVisible();
  });

  test('the app\'s "About" dialog links to the guide (nothing in the app pointed at it before this)', async ({ page, request }) => {
    await suppressTour(page);
    await openApp(page);
    await page.getByRole('button', { name: 'About AFTERLIFE' }).click();
    const link = page.getByRole('link', { name: 'Read the guide' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe('/guide/'); // dev base is '/', aliased to the real guide by guideDevAliasPlugin
    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(GUIDE_MARKER);
  });
});
