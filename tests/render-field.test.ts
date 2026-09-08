import { describe, expect, it } from 'vitest';
import {
  fractalNoise2D, isFieldAnimated, linearField, plasmaField, radialField,
  sampleField, sampleGridBilinear, transformFieldCoord, valueNoise2D, type SampledGrid,
} from '@/render/field';

describe('modulation field sampling is pure', () => {
  it('valueNoise2D is deterministic and bounded to [0, 1]', () => {
    for (let i = 0; i < 50; i++) {
      const x = Math.sin(i) * 20;
      const y = Math.cos(i * 1.3) * 20;
      const a = valueNoise2D(x, y, 5);
      const b = valueNoise2D(x, y, 5);
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('valueNoise2D is continuous across an integer lattice boundary', () => {
    const eps = 1e-5;
    const a = valueNoise2D(4 - eps, 2.5, 1);
    const b = valueNoise2D(4 + eps, 2.5, 1);
    expect(Math.abs(a - b)).toBeLessThan(1e-2);
  });

  it('fractalNoise2D stays bounded and differs from single-octave noise (a real second texture, not a duplicate)', () => {
    let anyDifferent = false;
    for (let i = 0; i < 30; i++) {
      const x = i * 1.7;
      const y = i * 0.9;
      const a = valueNoise2D(x, y, 2);
      const f = fractalNoise2D(x, y, 2);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      if (Math.abs(a - f) > 0.02) anyDifferent = true;
    }
    expect(anyDifferent).toBe(true);
  });

  it('radialField peaks at the centre and fades to 0 with distance', () => {
    expect(radialField(0, 0, 0, 0, 10)).toBeCloseTo(1, 5);
    expect(radialField(10, 0, 0, 0, 10)).toBeCloseTo(0, 5);
    expect(radialField(20, 0, 0, 0, 10)).toBe(0);
    expect(radialField(5, 0, 0, 0, 10)).toBeGreaterThan(radialField(9, 0, 0, 0, 10));
  });

  it('linearField wraps into [0, 1) and varies with angle', () => {
    const a = linearField(3, 4, 0);
    const b = linearField(3, 4, 90);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(a).not.toBeCloseTo(b, 5);
  });

  it('plasmaField is deterministic for a given (x, y, t) and animates over t', () => {
    const a1 = plasmaField(1, 2, 0, 0);
    const a2 = plasmaField(1, 2, 0, 0);
    expect(a1).toBe(a2);
    const b = plasmaField(1, 2, 5, 0);
    expect(a1).not.toBeCloseTo(b, 3);
  });

  it('transformFieldCoord applies scale/offset/rotation, and identity is a no-op', () => {
    const identity = transformFieldCoord(3, 4, { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 });
    expect(identity.x).toBeCloseTo(3, 10);
    expect(identity.y).toBeCloseTo(4, 10);
    const scaled = transformFieldCoord(3, 4, { scale: 2, offsetX: 0, offsetY: 0, rotationDeg: 0 });
    expect(scaled.x).toBeCloseTo(6, 10);
    expect(scaled.y).toBeCloseTo(8, 10);
    const rotated = transformFieldCoord(1, 0, { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 90 });
    expect(rotated.x).toBeCloseTo(0, 5);
    expect(rotated.y).toBeCloseTo(1, 5);
  });

  it('sampleGridBilinear interpolates and wraps at the edges (torus-friendly)', () => {
    // 2x2 grid: bright top-left, dark elsewhere.
    const grid: SampledGrid = { data: new Float32Array([1, 0, 0, 0]), w: 2, h: 2 };
    const centre = sampleGridBilinear(grid, 0.5, 0.5);
    expect(centre).toBeGreaterThan(0);
    expect(centre).toBeLessThan(1);
    // Sampling past 1.0 wraps rather than clamping/throwing.
    const wrapped = sampleGridBilinear(grid, 1.5, 0.5);
    const equivalent = sampleGridBilinear(grid, 0.5, 0.5);
    expect(wrapped).toBeCloseTo(equivalent, 10);
  });

  it('sampleField never throws and stays in [0, 1] for every source, including a missing grid', () => {
    const sources = ['none', 'perlin', 'simplex', 'radial', 'linear', 'plasma', 'image', 'video', 'webcam'] as const;
    for (const source of sources) {
      const v = sampleField(
        { source, seed: 3, transform: { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 }, grid: null },
        12, -7, 1.5,
      );
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('sampleField for an image/video/webcam source with a real grid samples that grid, not a constant', () => {
    const grid: SampledGrid = { data: new Float32Array(16).map((_, i) => i / 15), w: 4, h: 4 };
    const params = { source: 'image' as const, seed: 1, transform: { scale: 1, offsetX: 0, offsetY: 0, rotationDeg: 0 }, grid };
    const a = sampleField(params, 0, 0, 0);
    const b = sampleField(params, 40, 40, 0);
    expect(a).not.toBe(b);
  });

  it('isFieldAnimated is true only for genuinely time-varying sources', () => {
    expect(isFieldAnimated('plasma')).toBe(true);
    expect(isFieldAnimated('video')).toBe(true);
    expect(isFieldAnimated('webcam')).toBe(true);
    expect(isFieldAnimated('none')).toBe(false);
    expect(isFieldAnimated('perlin')).toBe(false);
    expect(isFieldAnimated('simplex')).toBe(false);
    expect(isFieldAnimated('radial')).toBe(false);
    expect(isFieldAnimated('linear')).toBe(false);
    expect(isFieldAnimated('image')).toBe(false);
  });
});
