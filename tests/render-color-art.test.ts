import { describe, expect, it } from 'vitest';
import { rotateHueRgb, sampleStopsRgb, type RGB, type RgbStop } from '@/render/color';

// New pure helpers added for Art mode's colour controls (hue rotation /
// palette cycling, and the custom-palette-stop sampler). Kept in a separate
// file from `render-color.test.ts` (the existing 8-lens colour suite) since
// this is a distinct, additive feature area.

describe('rotateHueRgb', () => {
  it('a 0-degree rotation is a no-op', () => {
    const rgb: RGB = { r: 200, g: 80, b: 40 };
    expect(rotateHueRgb(rgb, 0)).toEqual(rgb);
    expect(rotateHueRgb(rgb, 360)).toEqual(rgb);
  });

  it('a 180-degree rotation is its own inverse', () => {
    const rgb: RGB = { r: 220, g: 60, b: 30 };
    const rotated = rotateHueRgb(rotateHueRgb(rgb, 180), 180);
    expect(rotated.r).toBeCloseTo(rgb.r, 0);
    expect(rotated.g).toBeCloseTo(rgb.g, 0);
    expect(rotated.b).toBeCloseTo(rgb.b, 0);
  });

  it('preserves greyscale colours exactly (zero saturation has no hue to rotate)', () => {
    const grey: RGB = { r: 128, g: 128, b: 128 };
    expect(rotateHueRgb(grey, 90)).toEqual(grey);
  });

  it('changes a saturated colour visibly', () => {
    const red: RGB = { r: 255, g: 0, b: 0 };
    const rotated = rotateHueRgb(red, 120);
    expect(rotated).not.toEqual(red);
    // 120 degrees from red lands near green.
    expect(rotated.g).toBeGreaterThan(rotated.r);
    expect(rotated.g).toBeGreaterThan(rotated.b);
  });

  it('negative and >360 degree rotations wrap correctly', () => {
    const rgb: RGB = { r: 10, g: 200, b: 50 };
    const a = rotateHueRgb(rgb, 45);
    const b = rotateHueRgb(rgb, 45 - 360);
    const c = rotateHueRgb(rgb, 45 + 720);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });
});

describe('sampleStopsRgb', () => {
  const stops: RgbStop[] = [
    { t: 0, rgb: { r: 0, g: 0, b: 0 } },
    { t: 1, rgb: { r: 255, g: 255, b: 255 } },
  ];

  it('returns the exact end stops at t=0 and t=1', () => {
    expect(sampleStopsRgb(stops, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(sampleStopsRgb(stops, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('interpolates linearly in between', () => {
    expect(sampleStopsRgb(stops, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it('clamps outside [0, 1] to the nearest end stop', () => {
    expect(sampleStopsRgb(stops, -5)).toEqual({ r: 0, g: 0, b: 0 });
    expect(sampleStopsRgb(stops, 5)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('handles a single-stop palette (constant colour)', () => {
    const one: RgbStop[] = [{ t: 0.5, rgb: { r: 10, g: 20, b: 30 } }];
    expect(sampleStopsRgb(one, 0)).toEqual({ r: 10, g: 20, b: 30 });
    expect(sampleStopsRgb(one, 1)).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('handles three or more stops, picking the right segment', () => {
    const three: RgbStop[] = [
      { t: 0, rgb: { r: 255, g: 0, b: 0 } },
      { t: 0.5, rgb: { r: 0, g: 255, b: 0 } },
      { t: 1, rgb: { r: 0, g: 0, b: 255 } },
    ];
    expect(sampleStopsRgb(three, 0.25)).toEqual({ r: 128, g: 128, b: 0 });
    expect(sampleStopsRgb(three, 0.75)).toEqual({ r: 0, g: 128, b: 128 });
  });
});
