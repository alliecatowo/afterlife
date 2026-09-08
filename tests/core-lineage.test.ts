import { describe, expect, it } from 'vitest';
import {
  circularMean3, circularMeanHue, normalizeHue, quadSpeciesFromParents,
  regionHue, regionSpecies, spontaneousHue, spontaneousSpecies,
} from '@/core/lineage';

describe('normalizeHue', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeHue(0)).toBe(0);
    expect(normalizeHue(359)).toBe(359);
    expect(normalizeHue(360)).toBe(0);
    expect(normalizeHue(361)).toBe(1);
    expect(normalizeHue(-1)).toBe(359);
    expect(normalizeHue(-361)).toBe(359);
  });
});

describe('circularMeanHue / circularMean3: blending families', () => {
  it('the mean of three identical hues is that hue', () => {
    expect(circularMeanHue([40, 40, 40])).toBeCloseTo(40, 5);
    expect(circularMean3(40, 40, 40)).toBeCloseTo(40, 5);
  });

  it('averages two close hues sensibly, unweighted by a third identical one', () => {
    // 10, 10, 30 -> pulled toward 10 (majority), not the naive arithmetic mean.
    const mean = circularMean3(10, 10, 30);
    expect(mean).toBeGreaterThan(10);
    expect(mean).toBeLessThan(20);
  });

  it('wraps correctly across the 0/360 seam (350, 10 average to 0, not 180)', () => {
    const mean = circularMeanHue([350, 10]);
    expect(mean === 0 || Math.abs(mean - 360) < 1e-6).toBe(true);
  });

  it('is symmetric under input order', () => {
    const a = circularMean3(10, 200, 300);
    const b = circularMean3(300, 10, 200);
    const c = circularMean3(200, 300, 10);
    expect(a).toBeCloseTo(b, 5);
    expect(b).toBeCloseTo(c, 5);
  });

  it('falls back deterministically (never NaN) when vectors exactly cancel', () => {
    // 0 and 180 exactly cancel; circularMean3 always has a 3rd argument so
    // test the general array version directly for the degenerate 2-hue case.
    const mean = circularMeanHue([0, 180]);
    expect(Number.isNaN(mean)).toBe(false);
  });

  it('empty input returns 0, not NaN', () => {
    expect(circularMeanHue([])).toBe(0);
  });
});

describe('quadSpeciesFromParents: the classic Immigration/QuadLife birth rule', () => {
  it('a strict majority (2 of 3) wins', () => {
    expect(quadSpeciesFromParents(1, 1, 2)).toBe(1);
    expect(quadSpeciesFromParents(1, 2, 1)).toBe(1);
    expect(quadSpeciesFromParents(2, 1, 1)).toBe(1);
  });

  it('unanimous parents win outright', () => {
    expect(quadSpeciesFromParents(3, 3, 3)).toBe(3);
  });

  it('three pairwise-distinct parents produce the ONE species absent from {1,2,3,4}', () => {
    expect(quadSpeciesFromParents(1, 2, 3)).toBe(4);
    expect(quadSpeciesFromParents(2, 3, 4)).toBe(1);
    expect(quadSpeciesFromParents(1, 3, 4)).toBe(2);
    expect(quadSpeciesFromParents(1, 2, 4)).toBe(3);
  });

  it('with only species {1,2} ever present (Immigration-style seeding), the "missing 4th colour" branch never triggers', () => {
    // Every combination of 3 values drawn from {1,2} always has a majority.
    for (const a of [1, 2]) for (const b of [1, 2]) for (const c of [1, 2]) {
      const result = quadSpeciesFromParents(a, b, c);
      expect([1, 2]).toContain(result);
    }
  });
});

describe('regionHue / regionSpecies: deterministic, spatially-coherent seeding defaults', () => {
  it('is a pure function of position (same input -> same output, every call)', () => {
    expect(regionHue(5, 5)).toBe(regionHue(5, 5));
    expect(regionSpecies(5, 5)).toBe(regionSpecies(5, 5));
  });

  it('nearby cells in the same block share a hue/species ("distinct regions have distinct lineages")', () => {
    expect(regionHue(0, 0)).toBe(regionHue(1, 1));
    expect(regionSpecies(0, 0)).toBe(regionSpecies(1, 1));
  });

  it('distant regions differ (not a constant)', () => {
    const hues = new Set<number>();
    for (let b = 0; b < 20; b++) hues.add(regionHue(b * 24, b * 24));
    expect(hues.size).toBeGreaterThan(5);
  });

  it('hue is always in [0, 360) and species always in [1, 4]', () => {
    for (let i = 0; i < 50; i++) {
      const h = regionHue(i * 7, i * 13);
      const s = regionSpecies(i * 7, i * 13);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(4);
    }
  });
});

describe('spontaneousHue / spontaneousSpecies: replay-safe direct-edit colouring', () => {
  it('is a pure function of (x, y, gen) — replaying the same edit at the same generation reproduces the same colour', () => {
    expect(spontaneousHue(3, 4, 10)).toBe(spontaneousHue(3, 4, 10));
    expect(spontaneousSpecies(3, 4, 10)).toBe(spontaneousSpecies(3, 4, 10));
  });

  it('differs across generations for the same cell (not just position-derived)', () => {
    const hues = new Set([spontaneousHue(1, 1, 0), spontaneousHue(1, 1, 1), spontaneousHue(1, 1, 2), spontaneousHue(1, 1, 3)]);
    expect(hues.size).toBeGreaterThan(1);
  });
});
