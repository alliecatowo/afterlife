import { describe, expect, it } from 'vitest';
import { hashSeed, makeRng, mulberry32, pick, randInt, sfc32, shuffle } from '@/core/rng';

describe('rng', () => {
  it('mulberry32 is deterministic for a seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('mulberry32 differs across seeds', () => {
    const a = Array.from({ length: 8 }, mulberry32(1));
    const b = Array.from({ length: 8 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('produces values in [0, 1)', () => {
    const r = makeRng('afterlife');
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('makeRng is deterministic for string and numeric seeds', () => {
    const a = makeRng('glider');
    const b = makeRng('glider');
    expect(Array.from({ length: 32 }, () => a())).toEqual(Array.from({ length: 32 }, () => b()));
    const c = makeRng(99);
    const d = makeRng(99);
    expect(Array.from({ length: 32 }, () => c())).toEqual(Array.from({ length: 32 }, () => d()));
  });

  it('hashSeed is stable and unsigned', () => {
    expect(hashSeed('a')).toBe(hashSeed('a'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed('afterlife')).toBeGreaterThanOrEqual(0);
  });

  it('sfc32 has a roughly uniform mean', () => {
    const r = sfc32(1, 2, 3, 4);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += r();
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.02);
  });

  it('randInt stays in range and hits both bounds', () => {
    const r = makeRng(7);
    let lo = false;
    let hi = false;
    for (let i = 0; i < 2000; i++) {
      const v = randInt(r, 3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      expect(Number.isInteger(v)).toBe(true);
      if (v === 3) lo = true;
      if (v === 6) hi = true;
    }
    expect(lo && hi).toBe(true);
  });

  it('pick and shuffle preserve membership', () => {
    const r = makeRng('shuffle');
    const src = [1, 2, 3, 4, 5];
    expect(src).toContain(pick(r, src));
    const shuffled = shuffle(r, [...src]);
    expect([...shuffled].sort()).toEqual(src);
    expect(() => pick(r, [])).toThrow();
  });
});
