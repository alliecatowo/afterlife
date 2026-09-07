import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on('console', (msg) => {
  console.log('CONSOLE:', msg.type(), msg.text());
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

await page.goto('http://localhost:5173/src/sculpture/__smoke__/index.html', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => (window).__ready === true, { timeout: 20000 });
// Let the camera intro finish and the chunked instance build settle.
await page.waitForTimeout(1500);

const canvasCount = await page.locator('canvas').count();
console.log('canvas count:', canvasCount);

await page.screenshot({ path: '/tmp/sculpture-default.png' });

// Move the slice plane (no fog/decorations involved at all) and re-screenshot.
await page.evaluate(() => (window).__sculpture.setSlicePlane(0.5));
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/sculpture-slice-plane.png' });
await page.evaluate(() => (window).__sculpture.setSlicePlane(1));
await page.waitForTimeout(300);

// Toggle decorations off and re-screenshot.
await page.getByText('decorations').click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/sculpture-no-decorations.png' });
await page.getByText('decorations').click();

// Click on an instance to test picking -> onSliceSelected.
const box = await page.locator('canvas').first().boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
await page.waitForTimeout(200);
const lastPicked = await page.evaluate(() => (window).__lastPicked);
console.log('lastPicked:', lastPicked);

// Escape should trigger the bus close event (we can at least confirm no crash).
await page.keyboard.press('Escape');
await page.waitForTimeout(100);

console.log('console/page errors:', JSON.stringify(errors, null, 2));

await browser.close();
