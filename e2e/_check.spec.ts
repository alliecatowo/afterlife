import { expect, test } from '@playwright/test';
import { dismissTitle, openApp, suppressTour } from './utils';

test('CHECK: art trigger visible at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await suppressTour(page);
  await openApp(page);
  await dismissTitle(page);
  await page.waitForTimeout(500);
  const btn = page.getByRole('button', { name: 'Turn on Art mode' });
  await expect(btn).toBeVisible({ timeout: 5000 });
  const box = await btn.boundingBox();
  console.log('Art trigger box:', box);
});
