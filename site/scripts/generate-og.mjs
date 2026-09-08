#!/usr/bin/env node
// Renders the OG/Twitter card image as an actual frame of the B3/S23
// simulation (a Gosper glider gun, a pulsar, and two gliders converging —
// the same seed vocabulary as the app's own default scene and specimen
// drawer), stepped forward, then screenshotted with chromium via
// Playwright (already a devDependency — no new tooling). One-off script,
// not part of the build: run it manually and commit the resulting PNG to
// `site/guide/assets/og.png` whenever the look needs to change.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'site', 'guide', 'assets', 'og.png');

const FRAUNCES = pathToFileURL(
  join(ROOT, 'node_modules', '@fontsource-variable', 'fraunces', 'files', 'fraunces-latin-wght-normal.woff2'),
).href;
const INTER = pathToFileURL(
  join(ROOT, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'),
).href;

const W = 1200;
const H = 630;

const html = `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @font-face { font-family: 'Fraunces'; src: url('${FRAUNCES}') format('woff2-variations'); font-weight: 100 900; }
  @font-face { font-family: 'Inter'; src: url('${INTER}') format('woff2-variations'); font-weight: 100 900; }
  html,body { margin:0; padding:0; width:${W}px; height:${H}px; background:#12181a; overflow:hidden; }
  canvas { position:absolute; inset:0; }
  .overlay {
    position:absolute; inset:0;
    background: linear-gradient(180deg, rgba(18,24,26,0) 35%, rgba(18,24,26,0.94) 78%);
  }
  .type {
    position:absolute; left:64px; bottom:56px; right:64px;
    font-family:'Fraunces', serif; font-weight:440; font-variation-settings:'SOFT' 28,'WONK' 1,'opsz' 88;
    color:#f7f3ea; font-size:88px; letter-spacing:-0.02em; line-height:1;
  }
  .tag {
    font-family:'Inter', sans-serif; font-weight:440; color:#cdd6d4;
    font-size:26px; margin-top:14px; letter-spacing:0;
  }
</style></head>
<body>
  <canvas id="c" width="${W}" height="${H}"></canvas>
  <div class="overlay"></div>
  <div class="type">AFTERLIFE<div class="tag">Every future leaves a trace.</div></div>
</body></html>`;

// --- B3/S23 on a toroidal grid, seeded with real specimens ---------------
const CELL = 9;
const GW = Math.ceil(W / CELL);
const GH = Math.ceil(H / CELL);

function place(cells, w, rle, ox, oy) {
  let x = 0, y = 0, count = 0;
  for (const ch of rle) {
    if (ch >= '0' && ch <= '9') { count = count * 10 + Number(ch); continue; }
    const n = count || 1;
    if (ch === 'b') x += n;
    else if (ch === 'o') { for (let i = 0; i < n; i++) { cells[(oy + y) * w + (ox + x)] = 1; x++; } }
    else if (ch === '$') { y += n; x = 0; }
    count = 0;
  }
}

function step(cells, w, h) {
  const next = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        n += cells[((y + dy + h) % h) * w + ((x + dx + w) % w)];
      }
      const alive = cells[y * w + x] === 1;
      next[y * w + x] = alive ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
    }
  }
  return next;
}

let cells = new Uint8Array(GW * GH);
// Gosper glider gun, top-left — the same emitter as the specimen drawer.
place(cells, GW, '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!', 3, 3);
// Pulsar, upper-right — kept clear of the bottom gradient/type band.
place(cells, GW, '2b3o3b3o$$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o$$2b3o3b3o$o4bobo4bo$o4bobo4bo$o4bobo4bo$$2b3o3b3o!', GW - 24, 6);
// A small still-life garden, middle-right.
place(cells, GW, '2o$2o!', GW - 30, 24); // block
place(cells, GW, 'b2o$o2bo$b2o!', GW - 20, 26); // beehive
place(cells, GW, '2o$obo$bo!', GW - 12, 22); // boat
// A lone glider crossing the lower field.
place(cells, GW, 'bo$2bo$3o!', 16, Math.floor(GH / 2) + 2);

for (let i = 0; i < 92; i++) cells = step(cells, GW, GH);

const cellsJson = JSON.stringify(Array.from(cells));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(
  ({ cellsJson, GW, GH, CELL, W, H }) => {
    const cells = Uint8Array.from(JSON.parse(cellsJson));
    const ctx = document.getElementById('c').getContext('2d');
    ctx.fillStyle = '#12181a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i <= GW; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, H); ctx.stroke(); }
    for (let j = 0; j <= GH; j++) { ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(W, j * CELL); ctx.stroke(); }
    ctx.fillStyle = '#7fe0a8';
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (cells[y * GW + x]) ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
    }
  },
  { cellsJson, GW, GH, CELL, W, H },
);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT });
await browser.close();

writeFileSync(join(ROOT, 'site', 'scripts', '.og-generated'), new Date().toISOString());
console.log('wrote', OUT);
