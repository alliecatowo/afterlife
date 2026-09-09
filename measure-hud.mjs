import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2200, height: 900 } });
await page.goto('http://localhost:5173/');
await page.waitForTimeout(1500);
try { await page.getByRole('button', { name: /skip|begin|enter/i }).first().click({ timeout: 3000 }); } catch {}
await page.waitForTimeout(300);
try { await page.keyboard.press('Escape'); } catch {}
await page.waitForTimeout(300);

for (const width of [2200, 1600, 1536, 1500, 1440, 1400, 1280, 1200, 1024, 700, 390]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => {
    const h1 = Array.from(document.querySelectorAll('h1')).find((e) => e.textContent === 'AFTERLIFE');
    const row = h1?.closest('.overflow-x-auto');
    const moreBtn = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'More controls');
    if (!row) return null;
    return {
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      overflow: row.scrollWidth > row.clientWidth,
      moreControlsVisible: moreBtn ? getComputedStyle(moreBtn.closest('div')).display !== 'none' : null,
    };
  });
  console.log(width, JSON.stringify(info));
}
await browser.close();
