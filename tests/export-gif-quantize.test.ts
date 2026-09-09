import { describe, expect, it } from 'vitest';
import { mapToPalette, medianCutQuantize } from '@/export/gif/quantize';

function solidRgba(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('medianCutQuantize', () => {
  it('returns exactly the distinct colours present when under the cap', () => {
    const data = new Uint8ClampedArray(4 * 4);
    // Two pixels: red, then green.
    data.set([255, 0, 0, 255], 0);
    data.set([0, 255, 0, 255], 4);
    const palette = medianCutQuantize(data, 256);
    expect(palette).toHaveLength(2);
    expect(palette).toEqual(expect.arrayContaining([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
    ]));
  });

  it('never returns more than maxColors entries for a genuinely colourful image', () => {
    // A 64x64 gradient — every pixel a distinct colour, far more than 256.
    const w = 64, h = 64;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = (x * 4) % 256;
        data[i + 1] = (y * 4) % 256;
        data[i + 2] = ((x + y) * 4) % 256;
        data[i + 3] = 255;
      }
    }
    const palette = medianCutQuantize(data, 64);
    expect(palette.length).toBeLessThanOrEqual(64);
    expect(palette.length).toBeGreaterThan(1);
    for (const c of palette) {
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(255);
    }
  });

  it('handles a fully solid frame (one colour) without crashing', () => {
    const data = solidRgba(8, 8, 12, 200, 40);
    const palette = medianCutQuantize(data, 256);
    expect(palette).toEqual([{ r: 12, g: 200, b: 40 }]);
  });

  it('skips fully transparent pixels rather than letting them bias the palette black', () => {
    const data = new Uint8ClampedArray(2 * 4);
    data.set([255, 255, 255, 255], 0); // opaque white
    data.set([0, 0, 0, 0], 4); // fully transparent black
    const palette = medianCutQuantize(data, 256);
    expect(palette).toEqual([{ r: 255, g: 255, b: 255 }]);
  });
});

describe('mapToPalette', () => {
  it('maps each pixel to its exact palette index when the colour is present', () => {
    const palette = [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }];
    const data = new Uint8ClampedArray(3 * 4);
    data.set([0, 0, 255, 255], 0);
    data.set([255, 0, 0, 255], 4);
    data.set([0, 255, 0, 255], 8);
    const indices = mapToPalette(data, palette);
    expect(Array.from(indices)).toEqual([2, 0, 1]);
  });

  it('maps an off-palette colour to its nearest neighbour', () => {
    const palette = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const data = new Uint8ClampedArray(4);
    data.set([200, 200, 200, 255], 0);
    const indices = mapToPalette(data, palette);
    expect(indices[0]).toBe(1); // closer to white
  });

  it('reuses a shared cache across calls so repeated colours are consistent', () => {
    const palette = [{ r: 10, g: 10, b: 10 }, { r: 250, g: 250, b: 250 }];
    const cache = new Map<number, number>();
    const a = mapToPalette(new Uint8ClampedArray([255, 255, 255, 255]), palette, cache);
    const b = mapToPalette(new Uint8ClampedArray([255, 255, 255, 255]), palette, cache);
    expect(a[0]).toBe(b[0]);
    expect(cache.size).toBe(1);
  });
});
