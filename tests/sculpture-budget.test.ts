import { describe, expect, it } from 'vitest';
import { describeReduction, planReduction, INSTANCE_BUDGET } from '@/sculpture/budget';

describe('sculpture budget: planReduction', () => {
  it('keeps every slice when the total is within budget', () => {
    const counts = [10, 20, 30, 40];
    const plan = planReduction(counts, 1000);
    expect(plan.reduced).toBe(false);
    expect(plan.stride).toBe(1);
    expect(plan.sliceIndices).toEqual([0, 1, 2, 3]);
    expect(plan.instanceCount).toBe(100);
    expect(plan.totalLiveCells).toBe(100);
    expect(plan.singleSliceExceedsBudget).toBe(false);
  });

  it('reduces via time stride, anchored on the present, when over budget', () => {
    // 10 slices of 100 live cells each = 1000 total; budget 350 forces a stride.
    const counts = Array.from({ length: 10 }, () => 100);
    const plan = planReduction(counts, 350);
    expect(plan.reduced).toBe(true);
    expect(plan.stride).toBeGreaterThan(1);
    // present (last index, 9) must always be included
    expect(plan.sliceIndices[plan.sliceIndices.length - 1]).toBe(9);
    // indices ascending, no duplicates
    const sorted = [...plan.sliceIndices].sort((a, b) => a - b);
    expect(plan.sliceIndices).toEqual(sorted);
    expect(new Set(plan.sliceIndices).size).toBe(plan.sliceIndices.length);
    // instance count must respect budget (unless a single slice alone can't)
    expect(plan.instanceCount).toBeLessThanOrEqual(350);
  });

  it('never shrinks the spatial region — only ever returns a subset of slice indices', () => {
    const counts = Array.from({ length: 50 }, (_, i) => 5000 + i);
    const plan = planReduction(counts, 20_000);
    for (const idx of plan.sliceIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(counts.length);
    }
  });

  it('flags when a single slice alone exceeds the budget (spatial rect must shrink)', () => {
    const counts = [500_000];
    const plan = planReduction(counts, INSTANCE_BUDGET);
    expect(plan.singleSliceExceedsBudget).toBe(true);
    expect(plan.sliceIndices).toEqual([0]);
  });

  it('handles the empty case', () => {
    const plan = planReduction([]);
    expect(plan.sliceIndices).toEqual([]);
    expect(plan.instanceCount).toBe(0);
    expect(plan.reduced).toBe(false);
  });

  it('describeReduction reports the stride and slice counts honestly', () => {
    const counts = Array.from({ length: 20 }, () => 100);
    const plan = planReduction(counts, 500);
    const text = describeReduction(plan);
    expect(text).toContain(`every ${plan.stride}`);
    expect(text).toContain(`${plan.sliceIndices.length} of ${plan.totalSlices}`);
  });

  it('describeReduction says so plainly when nothing was reduced', () => {
    const plan = planReduction([1, 2, 3], 1000);
    expect(describeReduction(plan)).toBe('showing all 3 generations recorded');
  });
});
