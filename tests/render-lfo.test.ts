import { describe, expect, it } from 'vitest';
import { clampLfoDepth, clampLfoRate, hash1D, lfoValue, smoothNoise1D } from '@/render/lfo';

describe('LFOs are pure functions of absolute time', () => {
  it('the same shape/time/rate always returns the same value (no hidden state)', () => {
    for (const shape of ['sine', 'triangle', 'saw', 'randomWalk'] as const) {
      const a = lfoValue(shape, 12.345, 0.2, 0.1, 7);
      const b = lfoValue(shape, 12.345, 0.2, 0.1, 7);
      expect(b).toBe(a);
    }
  });

  it('evaluating out of order gives the same result as evaluating in order (no accumulator)', () => {
    const times = [0, 1.5, 3.2, 0.7, 10, 2.1];
    const forward = times.map((t) => lfoValue('sine', t, 0.3));
    const shuffled = [...times].reverse().map((t) => lfoValue('sine', t, 0.3));
    // Same (t -> value) mapping regardless of call order.
    for (let i = 0; i < times.length; i++) {
      expect(lfoValue('sine', times[i]!, 0.3)).toBeCloseTo(forward[i]!, 10);
      expect(lfoValue('sine', times[times.length - 1 - i]!, 0.3)).toBeCloseTo(shuffled[i]!, 10);
    }
  });

  it('sine stays within [-1, 1] and hits its extremes at the expected phase', () => {
    for (let t = 0; t < 5; t += 0.13) {
      const v = lfoValue('sine', t, 1);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
    expect(lfoValue('sine', 0.25, 1)).toBeCloseTo(1, 5); // quarter cycle -> peak
    expect(lfoValue('sine', 0, 1)).toBeCloseTo(0, 5);
  });

  it('triangle is continuous, bounded, and peaks at t=rate*t=0.25/0.75', () => {
    expect(lfoValue('triangle', 0, 1)).toBeCloseTo(-1, 5);
    expect(lfoValue('triangle', 0.25, 1)).toBeCloseTo(0, 5);
    expect(lfoValue('triangle', 0.5, 1)).toBeCloseTo(1, 5);
    for (let t = 0; t < 3; t += 0.07) {
      const v = lfoValue('triangle', t, 1);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });

  it('saw ramps monotonically from -1 to 1 within one cycle then wraps', () => {
    const a = lfoValue('saw', 0.1, 1);
    const b = lfoValue('saw', 0.5, 1);
    const c = lfoValue('saw', 0.9, 1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    // Wraps: value just after a full cycle equals value just after time 0.
    expect(lfoValue('saw', 1.1, 1)).toBeCloseTo(lfoValue('saw', 0.1, 1), 5);
  });

  it('randomWalk is smooth (small time deltas produce small value deltas) and bounded', () => {
    let prev = lfoValue('randomWalk', 0, 0.5, 0, 3);
    for (let t = 0.01; t < 2; t += 0.01) {
      const v = lfoValue('randomWalk', t, 0.5, 0, 3);
      expect(v).toBeGreaterThanOrEqual(-1.0001);
      expect(v).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(v - prev)).toBeLessThan(0.3);
      prev = v;
    }
  });

  it('different seeds decorrelate randomWalk LFOs (they do not track each other)', () => {
    let same = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t = i * 0.37;
      const a = lfoValue('randomWalk', t, 0.4, 0, 1);
      const b = lfoValue('randomWalk', t, 0.4, 0, 2);
      if (Math.abs(a - b) < 0.02) same++;
    }
    expect(same).toBeLessThan(n); // not literally identical everywhere
  });

  it('hash1D is deterministic and lands in [0, 1)', () => {
    for (let n = -5; n < 5; n++) {
      const v = hash1D(n, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash1D(n, 42)).toBe(v);
    }
  });

  it('smoothNoise1D is continuous at integer boundaries', () => {
    const eps = 1e-6;
    const left = smoothNoise1D(3 - eps, 9);
    const right = smoothNoise1D(3 + eps, 9);
    expect(Math.abs(left - right)).toBeLessThan(1e-3);
  });

  it('clamps rate/depth into their documented ranges', () => {
    expect(clampLfoRate(-5)).toBeGreaterThan(0);
    expect(clampLfoRate(1000)).toBeLessThanOrEqual(4);
    expect(clampLfoDepth(-1)).toBe(0);
    expect(clampLfoDepth(5)).toBe(1);
  });
});
