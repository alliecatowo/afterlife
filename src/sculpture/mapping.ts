/**
 * Generation <-> render-slot mapping.
 *
 * `sliceStack(rect, fromGen, toGen)` returns one buffer per generation,
 * ascending, so slice `k` is generation `fromGen + k`. The budget policy
 * (`./budget.ts`) may then keep only a subset of those indices (a time
 * stride) as "rendered slots", ascending, always including the present
 * (the last original index). These helpers convert between the three
 * coordinate systems: absolute generation, original slice index, and
 * rendered slot index — used by the slicing plane, click-to-select, and the
 * axis tick labels.
 */
import type { Generation } from '@/core/types';

/** Absolute generation -> index into the original (unreduced) slice array. */
export function genToSliceIndex(gen: Generation, fromGen: Generation): number {
  return gen - fromGen;
}

/** Index into the original (unreduced) slice array -> absolute generation. */
export function sliceIndexToGen(index: number, fromGen: Generation): Generation {
  return fromGen + index;
}

/**
 * Rendered slot (0..sliceIndices.length-1, what the InstancedMesh actually
 * draws at z-position `slot`) -> absolute generation.
 */
export function slotToGen(slot: number, sliceIndices: readonly number[], fromGen: Generation): Generation {
  const index = sliceIndices[slot];
  if (index === undefined) throw new RangeError(`slot ${slot} out of range [0, ${sliceIndices.length})`);
  return sliceIndexToGen(index, fromGen);
}

/**
 * Absolute generation -> rendered slot, or -1 if that exact generation isn't
 * one of the rendered slices (it was thinned out by the time stride).
 */
export function genToSlot(gen: Generation, sliceIndices: readonly number[], fromGen: Generation): number {
  return sliceIndices.indexOf(genToSliceIndex(gen, fromGen));
}

/**
 * Map a normalised plane position `t` in [0, 1] (0 = fromGen, 1 = toGen) to
 * the nearest rendered slot. Used by `setSlicePlane(t)`.
 */
export function planeTToSlot(t: number, sliceIndices: readonly number[]): number {
  if (sliceIndices.length === 0) return -1;
  const clamped = Math.min(1, Math.max(0, t));
  const target = clamped * (sliceIndices.length - 1);
  return Math.round(target);
}
