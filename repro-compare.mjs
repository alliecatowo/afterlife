import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (err) => console.log('PAGEERROR:', err));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(1500);
try { await page.getByRole('button', { name: /skip|begin|enter/i }).first().click({ timeout: 3000 }); } catch {}
await page.waitForTimeout(500);
try { await page.keyboard.press('Escape'); } catch {}
await page.waitForTimeout(500);
try { await page.getByRole('button', { name: 'Pause' }).click({ timeout: 2000 }); } catch {}
await page.waitForTimeout(200);

const ribbon = page.getByRole('slider', { name: 'History timeline' });
await ribbon.focus();
await ribbon.press('Home');
await page.waitForTimeout(500);

await page.keyboard.press('d');
const canvas = page.locator('#world-canvas');
const box = await canvas.boundingBox();
for (const dx of [0,1,2]) {
  await page.mouse.click(box.x + box.width/2 + dx*8, box.y + box.height/2);
}
await page.waitForTimeout(200);

// Immediately: Branches -> Compare -> pick branch, minimal wait (mirrors audit not doing extra settle waits)
await page.getByRole('button', { name: 'Branches' }).click();
await page.waitForTimeout(100);
await page.getByRole('button', { name: 'Compare' }).click();
await page.waitForTimeout(100);
await page.getByRole('button', { name: /Original/i }).first().click();
// zero wait -- snapshot immediately after the click resolves

function sample() {
  return page.evaluate(() => {
    const el = document.getElementById('compare-canvas');
    const ctx = el.getContext('2d');
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]||data[i+1]||data[i+2]||data[i+3]) nonZero++;
    return { width: el.width, height: el.height, nonZero };
  });
}
let total = 0;
for (const delta of [0, 20, 30, 50, 100, 200, 300, 400]) {
  await page.waitForTimeout(delta);
  total += delta;
  console.log('t=' + total, JSON.stringify(await sample()));
}

const diffText = await page.locator('text=differing cells').locator('..').textContent().catch(() => null);
console.log('diff readout', diffText);

const histo = await page.evaluate(() => {
  function hist(id) {
    const el = document.getElementById(id);
    const ctx = el.getContext('2d');
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = data[i] + ',' + data[i+1] + ',' + data[i+2] + ',' + data[i+3];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 8);
  }
  return { world: hist('world-canvas'), compare: hist('compare-canvas') };
});
console.log('world histogram', histo.world);
console.log('compare histogram', histo.compare);

await browser.close();
