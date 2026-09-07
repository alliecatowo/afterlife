import { createSculpture } from '../sculpture';

function step(bits: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + w) % w;
          const ny = (y + dy + h) % h;
          n += bits[ny * w + nx];
        }
      }
      const alive = bits[y * w + x] === 1;
      out[y * w + x] = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
    }
  }
  return out;
}

function makeGliderSlices(count: number, w = 24, h = 24): Uint8Array[] {
  let bits: Uint8Array = new Uint8Array(w * h);
  const cells: Array<[number, number]> = [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]];
  for (const [x, y] of cells) bits[y * w + x] = 1;
  const slices: Uint8Array[] = [bits];
  for (let i = 1; i < count; i++) {
    bits = step(bits, w, h);
    slices.push(bits);
  }
  return slices;
}

const host = document.getElementById('host')!;
const sculpture = createSculpture(host);
const W = 24, H = 24, GENS = 40;
const slices = makeGliderSlices(GENS, W, H);
sculpture.open({ x: 0, y: 0, w: W, h: H }, 0, GENS - 1, slices);
sculpture.onSliceSelected((gen) => {
  (window as unknown as { __lastPicked?: number }).__lastPicked = gen;
});

(window as unknown as { __sculpture?: unknown }).__sculpture = sculpture;
(window as unknown as { __ready?: boolean }).__ready = true;
