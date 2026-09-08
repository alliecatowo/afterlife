import { describe, expect, it } from 'vitest';
import { computeFramePlan } from '@/export/pacing';

describe('export pacing: computeFramePlan', () => {
  it('spans the exact generation range, first and last frame inclusive', () => {
    const plan = computeFramePlan({ fromGen: 0, toGen: 640, fps: 30, gensPerSecond: 64 });
    expect(plan.frameGens[0]).toBe(0);
    expect(plan.frameGens[plan.frameGens.length - 1]).toBe(640);
    expect(plan.durationSeconds).toBeCloseTo(10, 5);
  });

  it('produces a non-decreasing sequence of generations', () => {
    const plan = computeFramePlan({ fromGen: 100, toGen: 200, fps: 60, gensPerSecond: 5 });
    for (let i = 1; i < plan.frameGens.length; i++) {
      expect(plan.frameGens[i]).toBeGreaterThanOrEqual(plan.frameGens[i - 1]!);
    }
  });

  it('handles a zero-length range as a single frame', () => {
    const plan = computeFramePlan({ fromGen: 50, toGen: 50, fps: 30, gensPerSecond: 10 });
    expect(plan.frameGens).toEqual([50]);
    expect(plan.frameCount).toBe(1);
    expect(plan.durationSeconds).toBe(0);
  });

  it('frameCount scales with fps and duration', () => {
    const slow = computeFramePlan({ fromGen: 0, toGen: 100, fps: 10, gensPerSecond: 10 });
    const fast = computeFramePlan({ fromGen: 0, toGen: 100, fps: 30, gensPerSecond: 10 });
    expect(fast.frameCount).toBeGreaterThan(slow.frameCount);
  });

  it('rejects non-positive fps/gensPerSecond', () => {
    expect(() => computeFramePlan({ fromGen: 0, toGen: 10, fps: 0, gensPerSecond: 10 })).toThrow();
    expect(() => computeFramePlan({ fromGen: 0, toGen: 10, fps: 10, gensPerSecond: 0 })).toThrow();
  });

  it('rejects an inverted range', () => {
    expect(() => computeFramePlan({ fromGen: 10, toGen: 5, fps: 10, gensPerSecond: 10 })).toThrow();
  });
});
