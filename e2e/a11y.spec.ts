import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp } from './utils';

/**
 * Automated accessibility sweep across the main screens, on top of the
 * manual keyboard/reduced-motion/colour-independence work verified
 * throughout the rest of this suite. `wcag2a`/`wcag2aa`/`wcag21aa` are axe's
 * standard WCAG rule bundles; `best-practice` catches a few extra
 * commonly-flagged issues axe considers worth surfacing even though they
 * aren't a WCAG failure per se.
 *
 * Known, deliberately-dismissed findings (documented here so a future
 * agent doesn't "fix" something that isn't broken):
 *  - none currently — see the report for what was checked and ruled out.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'];

async function runAxe(page: Parameters<typeof AxeBuilder>[0]['page']) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

function describeViolations(results: Awaited<ReturnType<typeof runAxe>>): string {
  return results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.description}\n  nodes: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
    .join('\n');
}

test.describe('accessibility: automated axe sweep', () => {
  test('opening screen (title plate visible)', async ({ page }) => {
    await openApp(page);
    const results = await runAxe(page);
    expect(results.violations, describeViolations(results)).toEqual([]);
  });

  test('main observatory: drawer + right panel open, playing', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Branches' }).click();
    const results = await runAxe(page);
    expect(results.violations, describeViolations(results)).toEqual([]);
  });

  test('settings panel (sliders, checkboxes, readouts)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const results = await runAxe(page);
    expect(results.violations, describeViolations(results)).toEqual([]);
  });

  test('field guide panel', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Field guide' }).click();
    const results = await runAxe(page);
    expect(results.violations, describeViolations(results)).toEqual([]);
  });

  test('keyboard shortcuts dialog (focus trap / dialog semantics)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();
    const results = await runAxe(page);
    expect(results.violations, describeViolations(results)).toEqual([]);
  });

  test('presentation mode (minimal chrome)', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.keyboard.press('v');
    const results = await runAxe(page);
    expect(results.violations, describeViolations(results)).toEqual([]);
  });
});
