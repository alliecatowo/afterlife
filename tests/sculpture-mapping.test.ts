import { describe, expect, it } from 'vitest';
import {
  genToSliceIndex,
  genToSlot,
  planeTToSlot,
  sliceIndexToGen,
  slotToGen,
} from '@/sculpture/mapping';

describe('sculpture mapping: generation <-> slice index round trip', () => {
  it('round-trips generation -> index -> generation for a full (unreduced) stack', () => {
    const fromGen = 128;
    for (let gen = fromGen; gen < fromGen + 50; gen++) {
      const index = genToSliceIndex(gen, fromGen);
      expect(sliceIndexToGen(index, fromGen)).toBe(gen);
    }
  });

  it('index -> generation -> index round-trips too', () => {
    const fromGen = 40;
    for (let index = 0; index < 30; index++) {
      const gen = sliceIndexToGen(index, fromGen);
      expect(genToSliceIndex(gen, fromGen)).toBe(index);
    }
  });

  it('slot <-> generation round-trips through a thinned (strided) slice-index list', () => {
    const fromGen = 1000;
    const sliceIndices = [0, 4, 8, 12, 16, 19]; // stride 4, anchored on the present at 19
    for (let slot = 0; slot < sliceIndices.length; slot++) {
      const gen = slotToGen(slot, sliceIndices, fromGen);
      expect(genToSlot(gen, sliceIndices, fromGen)).toBe(slot);
    }
    expect(slotToGen(0, sliceIndices, fromGen)).toBe(1000);
    expect(slotToGen(sliceIndices.length - 1, sliceIndices, fromGen)).toBe(1019);
  });

  it('genToSlot returns -1 for a generation thinned out by the stride', () => {
    const fromGen = 0;
    const sliceIndices = [0, 4, 8];
    expect(genToSlot(2, sliceIndices, fromGen)).toBe(-1);
  });

  it('slotToGen throws on an out-of-range slot', () => {
    expect(() => slotToGen(5, [0, 1, 2], 0)).toThrow(RangeError);
  });

  it('planeTToSlot maps 0 and 1 to the first and last rendered slot', () => {
    const sliceIndices = [0, 3, 6, 9, 12];
    expect(planeTToSlot(0, sliceIndices)).toBe(0);
    expect(planeTToSlot(1, sliceIndices)).toBe(4);
    expect(planeTToSlot(0.5, sliceIndices)).toBe(2);
  });

  it('planeTToSlot clamps out-of-range t', () => {
    const sliceIndices = [0, 1, 2];
    expect(planeTToSlot(-3, sliceIndices)).toBe(0);
    expect(planeTToSlot(9, sliceIndices)).toBe(2);
  });

  it('planeTToSlot returns -1 for an empty stack', () => {
    expect(planeTToSlot(0.5, [])).toBe(-1);
  });
});
