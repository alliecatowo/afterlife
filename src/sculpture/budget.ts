/**
 * Instance-budget policy for the Time Sculpture.
 *
 * Pure, headlessly-testable logic — no three.js, no DOM. Given the live-cell
 * count of every slice `sliceStack()` returned (ascending generation order,
 * one count per slice), decide which slices actually get an InstancedMesh
 * instance so the total instance count stays under budget.
 *
 * Policy (per DESIGN brief): reduce by INCREASING THE TIME STRIDE (show fewer
 * generations) before ever touching the spatial region — the caller owns the
 * rect and we never silently crop it. We always anchor the kept slices on the
 * PRESENT (the last slice, i.e. `toGen`) and step backward, so the live plane
 * the user just came from is always part of what's shown.
 */

/** Hard cap on live-cell instances drawn at once. */
export const INSTANCE_BUDGET = 200_000;

export interface ReductionPlan {
  /** 1 = every slice shown. >1 = every Nth slice shown (time stride). */
  stride: number;
  /** Indices into the original `liveCounts` array that will be rendered, ascending. */
  sliceIndices: number[];
  /** Sum of live cells across `sliceIndices` — the actual instance count. */
  instanceCount: number;
  /** Sum of live cells across every slice in the original request. */
  totalLiveCells: number;
  /** Number of slices in the original (pre-reduction) request. */
  totalSlices: number;
  /** True if any slices were dropped to stay under budget. */
  reduced: boolean;
  /**
   * True if even a single slice (the present, alone) exceeds the budget.
   * Stride can't help here — the caller must shrink the spatial rect instead.
   */
  singleSliceExceedsBudget: boolean;
}

export function planReduction(liveCounts: readonly number[], budget = INSTANCE_BUDGET): ReductionPlan {
  const n = liveCounts.length;
  const totalLiveCells = liveCounts.reduce((a, b) => a + b, 0);

  if (n === 0) {
    return {
      stride: 1,
      sliceIndices: [],
      instanceCount: 0,
      totalLiveCells: 0,
      totalSlices: 0,
      reduced: false,
      singleSliceExceedsBudget: false,
    };
  }

  if (totalLiveCells <= budget) {
    return {
      stride: 1,
      sliceIndices: liveCounts.map((_, i) => i),
      instanceCount: totalLiveCells,
      totalLiveCells,
      totalSlices: n,
      reduced: false,
      singleSliceExceedsBudget: liveCounts[n - 1] > budget,
    };
  }

  // Increase stride, anchored at the present (index n - 1), stepping into the past,
  // until the kept slices fit the budget (or we're down to one slice).
  for (let stride = 2; stride <= n; stride++) {
    const indices: number[] = [];
    let sum = 0;
    for (let i = n - 1; i >= 0; i -= stride) {
      indices.push(i);
      sum += liveCounts[i];
    }
    if (sum <= budget || stride === n) {
      indices.reverse();
      return {
        stride,
        sliceIndices: indices,
        instanceCount: sum,
        totalLiveCells,
        totalSlices: n,
        reduced: true,
        singleSliceExceedsBudget: sum > budget && indices.length === 1,
      };
    }
  }

  // Unreachable — the loop above always terminates at stride === n.
  return {
    stride: n,
    sliceIndices: [n - 1],
    instanceCount: liveCounts[n - 1],
    totalLiveCells,
    totalSlices: n,
    reduced: true,
    singleSliceExceedsBudget: liveCounts[n - 1] > budget,
  };
}

/** Human-readable summary for the "what was reduced, and by how much" affordance. */
export function describeReduction(plan: ReductionPlan): string {
  if (!plan.reduced) return `showing all ${plan.totalSlices} generations recorded`;
  const shown = plan.sliceIndices.length;
  return (
    `instance budget exceeded — showing every ${plan.stride}${ordinal(plan.stride)} generation ` +
    `(${shown} of ${plan.totalSlices} slices, ${plan.instanceCount.toLocaleString()} instances)`
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
