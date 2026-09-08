import { describe, expect, it } from 'vitest';
import {
  computeBands, computeCentroid, computeLevel, OnsetDetector, reactiveDensity,
  reactiveFilterRange, reactiveSpeedMultiplier, smooth,
} from '@/audio/reactivity';

function silentTimeDomain(n = 256): Uint8Array {
  return new Uint8Array(n).fill(128); // AnalyserNode's "silence" midpoint
}

function loudTimeDomain(n = 256): Uint8Array {
  const buf = new Uint8Array(n);
  for (let i = 0; i < n; i++) buf[i] = i % 2 === 0 ? 0 : 255; // max-amplitude square wave
  return buf;
}

describe('audio/reactivity — feature extraction (pure, no Web Audio)', () => {
  it('computeLevel reads exactly 0 for silence and > 0 for a loud signal', () => {
    expect(computeLevel(silentTimeDomain())).toBe(0);
    expect(computeLevel(loudTimeDomain())).toBeGreaterThan(0.9);
  });

  it('computeLevel is bounded in [0, 1] and handles an empty buffer', () => {
    expect(computeLevel(new Uint8Array(0))).toBe(0);
    for (let trial = 0; trial < 20; trial++) {
      const buf = new Uint8Array(64).map(() => Math.floor(Math.random() * 256));
      const level = computeLevel(buf);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it('computeBands returns three 0..1 values that never exceed the buffer\'s own max', () => {
    const freq = new Uint8Array(300).fill(200);
    const { bass, mid, treble } = computeBands(freq);
    for (const v of [bass, mid, treble]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeCloseTo(200 / 255, 5);
    }
  });

  it('computeBands degrades honestly to all-zero for an empty buffer', () => {
    expect(computeBands(new Uint8Array(0))).toEqual({ bass: 0, mid: 0, treble: 0 });
  });

  it('computeCentroid is near 0 for energy concentrated at low bins, near 1 for high bins', () => {
    const low = new Uint8Array(100);
    low[0] = 255;
    const high = new Uint8Array(100);
    high[99] = 255;
    expect(computeCentroid(low)).toBeLessThan(0.1);
    expect(computeCentroid(high)).toBeGreaterThan(0.9);
  });

  it('computeCentroid returns the neutral 0.5 for total silence rather than dividing by zero', () => {
    expect(computeCentroid(new Uint8Array(50))).toBe(0.5);
    expect(Number.isFinite(computeCentroid(new Uint8Array(50)))).toBe(true);
  });

  it('smooth moves monotonically from previous toward next and never overshoots', () => {
    const result = smooth(0, 1, 0.25);
    expect(result).toBeCloseTo(0.25, 10);
    expect(smooth(1, 1, 0.5)).toBe(1);
  });
});

describe('audio/reactivity — OnsetDetector', () => {
  it('does not fire on a flat, quiet signal', () => {
    const detector = new OnsetDetector();
    let fired = false;
    for (let t = 0; t < 2; t += 0.05) fired ||= detector.update(0.01, t);
    expect(fired).toBe(false);
  });

  it('fires on a sudden jump from quiet to loud', () => {
    const detector = new OnsetDetector();
    for (let t = 0; t < 1; t += 0.05) detector.update(0.02, t);
    const onset = detector.update(0.9, 1.0);
    expect(onset).toBe(true);
  });

  it('debounces — does not fire again within the minimum interval', () => {
    const detector = new OnsetDetector(1.5, 0.2);
    for (let t = 0; t < 1; t += 0.05) detector.update(0.02, t);
    expect(detector.update(0.9, 1.0)).toBe(true);
    expect(detector.update(0.9, 1.02)).toBe(false); // 20ms later, inside the 200ms floor
  });

  it('reset() clears history so a later loud reading can fire again immediately', () => {
    const detector = new OnsetDetector();
    for (let t = 0; t < 1; t += 0.05) detector.update(0.02, t);
    detector.update(0.9, 1.0);
    detector.reset();
    expect(detector.update(0.9, 1.0)).toBe(true);
  });
});

describe('audio/reactivity — mapping functions stay bounded', () => {
  it('reactiveDensity increases with level and never goes negative', () => {
    expect(reactiveDensity(1, 0, 0.6)).toBe(1);
    expect(reactiveDensity(1, 1, 0.6)).toBeGreaterThan(1);
    expect(reactiveDensity(0, 0, 0.6)).toBeGreaterThanOrEqual(0);
  });

  it('reactiveFilterRange preserves the baseline window width and stays within sane floors', () => {
    const { minHz, maxHz } = reactiveFilterRange(200, 2000, 0.9, 0.6);
    expect(maxHz - minHz).toBeCloseTo(1800, 0);
    expect(minHz).toBeGreaterThanOrEqual(20);
    expect(maxHz).toBeGreaterThanOrEqual(40);
  });

  it('reactiveFilterRange is a no-op shift at the neutral centroid (0.5)', () => {
    const { minHz, maxHz } = reactiveFilterRange(200, 2000, 0.5, 1);
    expect(minHz).toBeCloseTo(200, 5);
    expect(maxHz).toBeCloseTo(2000, 5);
  });

  it('reactiveSpeedMultiplier is always within [1 - amount/2, 1 + amount/2] regardless of amount', () => {
    for (const amount of [0, 0.25, 0.6, 1, 5, -3]) {
      const bounded = Math.max(0, Math.min(1, amount));
      for (const onset of [true, false]) {
        const m = reactiveSpeedMultiplier(onset, amount);
        expect(m).toBeGreaterThanOrEqual(1 - bounded * 0.5 - 1e-9);
        expect(m).toBeLessThanOrEqual(1 + bounded * 0.5 + 1e-9);
      }
    }
  });
});
