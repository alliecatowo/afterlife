import { describe, expect, it } from 'vitest';
import { computeLuminanceGrid, thresholdToBits } from '@/render/mediaField';

function rgba(...pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  });
  return out;
}

describe('media field pure helpers (no DOM/canvas involved)', () => {
  it('computeLuminanceGrid maps white to ~1 and black to 0', () => {
    const data = rgba([255, 255, 255, 255], [0, 0, 0, 255]);
    const grid = computeLuminanceGrid(data, 2, 1);
    expect(grid[0]).toBeCloseTo(1, 3);
    expect(grid[1]).toBe(0);
  });

  it('computeLuminanceGrid weights green highest (Rec. 601)', () => {
    const red = computeLuminanceGrid(rgba([255, 0, 0, 255]), 1, 1)[0]!;
    const green = computeLuminanceGrid(rgba([0, 255, 0, 255]), 1, 1)[0]!;
    const blue = computeLuminanceGrid(rgba([0, 0, 255, 255]), 1, 1)[0]!;
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it('thresholdToBits produces 1 = alive exactly where luminance clears the threshold', () => {
    const data = rgba([255, 255, 255, 255], [10, 10, 10, 255], [128, 128, 128, 255]);
    const bits = thresholdToBits(data, 3, 1, 0.5);
    // white -> lum 1 (alive); near-black -> lum ~0.04 (dead);
    // mid-grey 128/255 ~= 0.502 clears a 0.5 threshold -> alive.
    expect(Array.from(bits)).toEqual([1, 0, 1]);
  });

  it('thresholdToBits respects an exact 0.5 boundary and the invert flag', () => {
    const data = rgba([255, 255, 255, 255], [0, 0, 0, 255]);
    const normal = thresholdToBits(data, 2, 1, 0.5);
    const inverted = thresholdToBits(data, 2, 1, 0.5, true);
    expect(Array.from(normal)).toEqual([1, 0]);
    expect(Array.from(inverted)).toEqual([0, 1]);
  });

  it('thresholdToBits output length always matches w*h', () => {
    const data = rgba([1, 1, 1, 255], [2, 2, 2, 255], [3, 3, 3, 255], [4, 4, 4, 255]);
    const bits = thresholdToBits(data, 2, 2, 0.1);
    expect(bits.length).toBe(4);
  });
});
