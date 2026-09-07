// AFTERLIFE scene lab engine. Conway B3/S23, toroidal wrap, x right / y down, origin top-left.
export const W = 256, H = 160;

export class World {
  constructor(w = W, h = H) {
    this.w = w; this.h = h;
    this.a = new Uint8Array(w * h);
    this.b = new Uint8Array(w * h);
    this.gen = 0;
  }
  idx(x, y) { return ((y % this.h) + this.h) % this.h * this.w + (((x % this.w) + this.w) % this.w); }
  get(x, y) { return this.a[this.idx(x, y)]; }
  set(x, y, v = 1) { this.a[this.idx(x, y)] = v ? 1 : 0; return this; }
  toggle(x, y) { const i = this.idx(x, y); this.a[i] = this.a[i] ? 0 : 1; return this; }
  clear() { this.a.fill(0); this.gen = 0; return this; }
  clone() { const n = new World(this.w, this.h); n.a.set(this.a); n.gen = this.gen; return n; }
  cells() { const out = []; for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.a[y * this.w + x]) out.push([x, y]); return out; }
  setCells(list) { for (const [x, y] of list) this.set(x, y, 1); return this; }
  population() { let p = 0; for (let i = 0; i < this.a.length; i++) p += this.a[i]; return p; }
  step() {
    const { w, h, a, b } = this;
    for (let y = 0; y < h; y++) {
      const yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const ro = y * w, ruo = yu * w, rdo = yd * w;
      for (let x = 0; x < w; x++) {
        const xl = (x - 1 + w) % w, xr = (x + 1) % w;
        const n = a[ruo + xl] + a[ruo + x] + a[ruo + xr]
                + a[ro + xl]              + a[ro + xr]
                + a[rdo + xl] + a[rdo + x] + a[rdo + xr];
        b[ro + x] = (n === 3 || (n === 2 && a[ro + x])) ? 1 : 0;
      }
    }
    this.a.set(b); this.gen++; return this;
  }
  run(n) { for (let i = 0; i < n; i++) this.step(); return this; }
  bbox(rect) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, n = 0;
    const x0 = rect ? rect.x0 : 0, y0 = rect ? rect.y0 : 0, x1 = rect ? rect.x1 : this.w - 1, y1 = rect ? rect.y1 : this.h - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.a[y * this.w + x]) { n++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    if (!n) return null;
    return { x0: minx, y0: miny, x1: maxx, y1: maxy, w: maxx - minx + 1, h: maxy - miny + 1, pop: n };
  }
  popIn(r) { let p = 0; for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) p += this.get(x, y); return p; }
  hash(r) {
    let h1 = 0x811c9dc5;
    const x0 = r ? r.x0 : 0, y0 = r ? r.y0 : 0, x1 = r ? r.x1 : this.w - 1, y1 = r ? r.y1 : this.h - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { h1 ^= (this.get(x, y) + 1) * (x * 31 + y * 17 + 7); h1 = Math.imul(h1, 16777619) >>> 0; }
    return h1 >>> 0;
  }
  render(r, chars = '.#') {
    const x0 = r ? r.x0 : 0, y0 = r ? r.y0 : 0, x1 = r ? r.x1 : this.w - 1, y1 = r ? r.y1 : this.h - 1;
    const rows = [];
    for (let y = y0; y <= y1; y++) { let s = ''; for (let x = x0; x <= x1; x++) s += chars[this.get(x, y)]; rows.push(s); }
    return rows.join('\n');
  }
}

// ---- transforms ----
// t in: identity, r90, r180, r270, flipx, flipy, transpose, antitranspose
export function transform(cells, t = 'identity') {
  const f = {
    identity: ([x, y]) => [x, y],
    r90:      ([x, y]) => [-y, x],
    r180:     ([x, y]) => [-x, -y],
    r270:     ([x, y]) => [y, -x],
    flipx:    ([x, y]) => [-x, y],
    flipy:    ([x, y]) => [x, -y],
    transpose:([x, y]) => [y, x],
    antitranspose: ([x, y]) => [-y, -x],
  }[t];
  if (!f) throw new Error('bad transform ' + t);
  const m = cells.map(f);
  const mnx = Math.min(...m.map(c => c[0])), mny = Math.min(...m.map(c => c[1]));
  return m.map(([x, y]) => [x - mnx, y - mny]);
}

export function place(world, cells, x, y, t = 'identity') {
  for (const [cx, cy] of transform(cells, t)) world.set(x + cx, y + cy, 1);
  return world;
}
export function offset(cells, x, y, t = 'identity') {
  return transform(cells, t).map(([cx, cy]) => [x + cx, y + cy]);
}

// ---- RLE ----
export function parseRLE(str) {
  const lines = str.split('\n').filter(l => !l.startsWith('#'));
  const body = lines.filter(l => !/^\s*x\s*=/.test(l)).join('');
  const cells = []; let x = 0, y = 0, num = '';
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    const n = num ? parseInt(num, 10) : 1; num = '';
    if (ch === 'b') x += n;
    else if (ch === 'o') { for (let i = 0; i < n; i++) cells.push([x++, y]); }
    else if (ch === '$') { y += n; x = 0; }
    else if (ch === '!') break;
  }
  return cells;
}
export function toRLE(cells) {
  if (!cells.length) return '!';
  const mnx = Math.min(...cells.map(c => c[0])), mny = Math.min(...cells.map(c => c[1]));
  const mxx = Math.max(...cells.map(c => c[0])), mxy = Math.max(...cells.map(c => c[1]));
  const w = mxx - mnx + 1, h = mxy - mny + 1;
  const g = Array.from({ length: h }, () => new Array(w).fill(0));
  for (const [x, y] of cells) g[y - mny][x - mnx] = 1;
  let out = '', runs = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    let i = 0;
    while (i < w) { let j = i; while (j < w && g[y][j] === g[y][i]) j++; const n = j - i; row += (n > 1 ? n : '') + (g[y][i] ? 'o' : 'b'); i = j; }
    row = row.replace(/(\d*)b$/, '');
    runs.push(row);
  }
  out = runs.join('$') + '!';
  return { rle: out, w, h };
}

// ---- normalized cell array helper ----
export function norm(cells) {
  const mnx = Math.min(...cells.map(c => c[0])), mny = Math.min(...cells.map(c => c[1]));
  return cells.map(([x, y]) => [x - mnx, y - mny]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
export function key(cells) { return norm(cells).map(c => c.join(',')).join(';'); }

// ---- period / spaceship detection on an isolated world ----
export function analyze(cells, maxGen = 2000, pad = 60) {
  // place pattern in a large empty torus so wrap doesn't interfere for small patterns
  const n = norm(cells);
  const w = Math.max(...n.map(c => c[0])) + 1, h = Math.max(...n.map(c => c[1])) + 1;
  const WW = Math.max(200, w + pad * 2), HH = Math.max(200, h + pad * 2);
  const world = new World(WW, HH);
  place(world, n, pad, pad);
  const seen = new Map();
  seen.set(key(world.cells()), { gen: 0, bbox: world.bbox() });
  for (let g = 1; g <= maxGen; g++) {
    world.step();
    const cs = world.cells();
    if (!cs.length) return { type: 'dies', gen: g, pop: 0 };
    const k = key(cs);
    if (seen.has(k)) {
      const prev = seen.get(k);
      const period = g - prev.gen;
      const bb = world.bbox();
      const dx = bb.x0 - prev.bbox.x0, dy = bb.y0 - prev.bbox.y0;
      return { type: (dx || dy) ? 'spaceship' : (period === 1 ? 'still' : 'oscillator'),
               period, dx, dy, startGen: prev.gen, pop: cs.length, bbox: bb };
    }
    seen.set(k, { gen: g, bbox: world.bbox() });
  }
  return { type: 'unresolved', maxGen };
}

// stabilization on a big (effectively infinite for a while) grid
export function stabilize(cells, size = 400, maxGen = 3000) {
  const world = new World(size, size);
  place(world, norm(cells), (size >> 1) - 5, (size >> 1) - 5);
  const seen = new Map();
  let lastPop = -1;
  for (let g = 1; g <= maxGen; g++) {
    world.step();
    const cs = world.cells();
    const k = key(cs) + '|' + cs.length;
    // detect: state repeats modulo translation
    const kk = key(cs);
    if (seen.has(kk)) {
      const prev = seen.get(kk);
      return { stabilizedAt: prev.gen, period: g - prev.gen, pop: cs.length };
    }
    seen.set(kk, { gen: g });
  }
  return { unresolved: true, pop: world.population() };
}
