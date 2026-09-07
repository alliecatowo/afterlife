import { describe, expect, it } from 'vitest';
import { buildInstancePlacements, cellWorldPosition, countLive } from '@/sculpture/geometry';

/**
 * A tiny, self-contained B3/S23 stepper used ONLY to manufacture a real
 * glider trajectory as test fixture data. This intentionally does not import
 * `@/core/engine` (owned by another agent, implemented concurrently, and may
 * not compile yet) — it is a minimal reference implementation whose job is
 * just to produce a few generations of an unambiguous diagonal spaceship.
 */
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
  // Classic glider, offset away from the origin/seam so it never wraps
  // during this short run.
  const cells: Array<[number, number]> = [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]];
  for (const [x, y] of cells) bits[y * w + x] = 1;

  const slices: Uint8Array[] = [bits];
  for (let i = 1; i < count; i++) {
    bits = step(bits, w, h);
    slices.push(bits);
  }
  return slices;
}

function centroid(slice: Uint8Array, w: number, h: number): { x: number; y: number } {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (slice[y * w + x]) { sx += x; sy += y; n++; }
    }
  }
  return { x: sx / n, y: sy / n };
}

describe('sculpture geometry: a glider reads as a straight inclined beam', () => {
  const W = 24, H = 24;
  const GENS = 17; // slots 0..16
  const rect = { w: W, h: H };
  const slices = makeGliderSlices(GENS, W, H);

  it('fixture sanity: the glider stays alive and moves (not a still life)', () => {
    for (const s of slices) expect(countLive(s)).toBe(5);
    const c0 = centroid(slices[0], W, H);
    const cLast = centroid(slices[GENS - 1], W, H);
    expect(c0.x).not.toBeCloseTo(cLast.x, 1);
    expect(c0.y).not.toBeCloseTo(cLast.y, 1);
  });

  it('time (z) depends only on slot, and is monotonic with slot', () => {
    const cellSize = 1;
    const spacingZ = 2;
    const placements = buildInstancePlacements(slices, rect, cellSize, spacingZ);
    const zBySlot = new Map<number, number>();
    for (const p of placements) {
      const existing = zBySlot.get(p.slot);
      if (existing === undefined) zBySlot.set(p.slot, p.z);
      else expect(p.z).toBeCloseTo(existing, 10); // same slot -> same z, always
    }
    const slots = [...zBySlot.keys()].sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      expect(zBySlot.get(slots[i])!).toBeGreaterThan(zBySlot.get(slots[i - 1])!);
    }
    // present (last slot) sits on the z = 0 plane it grew from
    expect(zBySlot.get(GENS - 1)).toBeCloseTo(0, 10);
  });

  it('the glider instances trace a straight, inclined line through space-time', () => {
    const cellSize = 1;
    const spacingZ = 1;
    const placements = buildInstancePlacements(slices, rect, cellSize, spacingZ);

    // Per-slot centroid of the instanced cells (world space).
    const bySlot = new Map<number, { x: number; y: number }[]>();
    for (const p of placements) {
      if (!bySlot.has(p.slot)) bySlot.set(p.slot, []);
      bySlot.get(p.slot)!.push({ x: p.x, y: p.y });
    }
    const slots = [...bySlot.keys()].sort((a, b) => a - b);
    const centroids = slots.map((slot) => {
      const pts = bySlot.get(slot)!;
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      return { slot, cx, cy };
    });

    const first = centroids[0];
    const last = centroids[centroids.length - 1];
    const span = last.slot - first.slot;
    const slopeX = (last.cx - first.cx) / span;
    const slopeY = (last.cy - first.cy) / span;

    // A genuine diagonal beam: motion on BOTH space axes as time advances,
    // not a vertical column (persistent structure) or an axis-aligned beam.
    expect(Math.abs(slopeX)).toBeGreaterThan(0.1);
    expect(Math.abs(slopeY)).toBeGreaterThan(0.1);
    // The classic glider moves at 45 degrees: equal magnitude on x and y.
    expect(Math.abs(Math.abs(slopeX) - Math.abs(slopeY))).toBeLessThan(0.05);

    // Every intermediate slot's centroid lies close to the fitted line
    // (glider phase wobble is sub-cell; a real inclined beam, not scatter).
    for (const c of centroids) {
      const predictedX = first.cx + slopeX * (c.slot - first.slot);
      const predictedY = first.cy + slopeY * (c.slot - first.slot);
      expect(Math.abs(c.cx - predictedX)).toBeLessThan(0.75);
      expect(Math.abs(c.cy - predictedY)).toBeLessThan(0.75);
    }
  });

  it('cellWorldPosition preserves left-right (x) and up-down (y) orientation from the flat plane', () => {
    const opts = { rect, cellSize: 1, spacingZ: 1, sliceCount: GENS };
    const [xLeft] = cellWorldPosition(0, 0, 0, opts);
    const [xRight] = cellWorldPosition(W - 1, 0, 0, opts);
    expect(xRight).toBeGreaterThan(xLeft);

    // cell y = 0 is the top row (row-major convention); it must map to the
    // TOP in world space (larger three.js y), and increasing cell y moves down.
    const [, yTop] = cellWorldPosition(0, 0, 0, opts);
    const [, yBottom] = cellWorldPosition(0, H - 1, 0, opts);
    expect(yTop).toBeGreaterThan(yBottom);
  });
});
