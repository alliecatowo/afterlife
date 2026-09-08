import { describe, expect, it } from 'vitest';
import { computeFramePlan } from '@/export/pacing';
import { capDimensions, capFramePlan } from '@/export/limits';

describe('export limits: capFramePlan', () => {
  it('leaves a plan under budget untouched', () => {
    const plan = computeFramePlan({ fromGen: 0, toGen: 100, fps: 10, gensPerSecond: 10 });
    const result = capFramePlan(plan, 1000);
    expect(result.reduced).toBe(false);
    expect(result.value).toBe(plan);
  });

  it('stride-samples a too-large plan, always keeping first and last frame', () => {
    const plan = computeFramePlan({ fromGen: 0, toGen: 10_000, fps: 60, gensPerSecond: 10 });
    const result = capFramePlan(plan, 50);
    expect(result.reduced).toBe(true);
    expect(result.value.frameCount).toBeLessThanOrEqual(51);
    expect(result.value.frameGens[0]).toBe(plan.frameGens[0]);
    expect(result.value.frameGens[result.value.frameGens.length - 1]).toBe(plan.frameGens[plan.frameGens.length - 1]);
    expect(result.note).toMatch(/exceeds/);
  });
});

describe('export limits: capDimensions', () => {
  it('leaves in-budget dimensions untouched', () => {
    const result = capDimensions(640, 480, 2560);
    expect(result.reduced).toBe(false);
    expect(result.value).toEqual({ width: 640, height: 480 });
  });

  it('scales down proportionally when the longest side exceeds the cap', () => {
    const result = capDimensions(4000, 2000, 2560);
    expect(result.reduced).toBe(true);
    expect(result.value.width).toBe(2560);
    expect(result.value.height).toBe(1280);
  });
});
