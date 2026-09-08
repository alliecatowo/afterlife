/**
 * Determinism under a NON-Conway rule: rewind/replay/branching must stay
 * bit-identical no matter which rule is in force — the rule is fixed for a
 * `LifeEngine`'s whole life (see `@/core/engine.ts`'s `setRule()` doc for why
 * a rule CHANGE is deliberately a fresh-world operation, never a mid-history
 * edit), so `TimelineStore`'s existing replay machinery (which only ever
 * calls the SAME engine's `step()`) is already rule-agnostic — this suite
 * proves that holds for a real non-Conway rule, not just asserts it by
 * reading the code.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { createTimelineStore } from '@/core/history';
import type { EditOp } from '@/core/types';

const RULE = 'B36/S23'; // HighLife

function set(x: number, y: number, alive: boolean): EditOp {
  return { kind: 'set', cells: [{ x, y, alive }] };
}

/** Independent ground truth: simulate from scratch under `RULE`, entirely outside history.ts. */
function freshSimulate(width: number, height: number, edits: Map<number, EditOp[]>, targetGen: number): Uint8Array {
  const engine = createEngine({ width, height, rule: RULE });
  const g0 = edits.get(0);
  if (g0) for (const op of g0) for (const c of op.cells) engine.set(c.x, c.y, c.alive);
  for (let g = 1; g <= targetGen; g++) {
    engine.step();
    const ops = edits.get(g);
    if (ops) for (const op of ops) for (const c of op.cells) engine.set(c.x, c.y, c.alive);
  }
  return engine.snapshot().bits;
}

describe('determinism under a non-Conway rule (HighLife B36/S23)', () => {
  const width = 24;
  const height = 24;
  const edits = new Map<number, EditOp[]>([
    [0, [set(5, 5, true), set(5, 6, true), set(6, 5, true)]],
    [10, [set(1, 1, true), set(2, 1, true)]],
    [37, [set(5, 5, false)]],
    [90, [set(0, 0, true), set(23, 23, true)]],
  ]);
  const targetGen = 140;

  function makeStore() {
    const engine = createEngine({ width, height, rule: RULE });
    const history = createTimelineStore({ engine });
    return { engine, history };
  }

  async function driveForward(engine: ReturnType<typeof createEngine>, history: ReturnType<typeof createTimelineStore>, target: number) {
    const g0 = edits.get(0);
    if (g0) history.record(0, g0);
    while (engine.gen < target) {
      engine.step();
      history.advance(engine.gen);
      const ops = edits.get(engine.gen);
      if (ops) history.record(engine.gen, ops);
    }
  }

  it('engine.rule is preserved across the whole run and matches the ground truth', async () => {
    const { engine, history } = makeStore();
    await driveForward(engine, history, targetGen);
    expect(engine.rule).toBe(RULE);
    const expected = freshSimulate(width, height, edits, targetGen);
    expect(engine.snapshot().bits).toEqual(expected);
  });

  it('goto() rewind then replay forward is bit-identical to fresh simulation at every checkpoint', async () => {
    const { engine, history } = makeStore();
    await driveForward(engine, history, targetGen);

    for (const checkpoint of [0, 37, 64, 90, 128, targetGen]) {
      await history.goto(checkpoint);
      expect(engine.gen).toBe(checkpoint);
      expect(engine.rule).toBe(RULE);
      expect(engine.snapshot().bits).toEqual(freshSimulate(width, height, edits, checkpoint));
    }
    // Forward again to the end — still exact.
    await history.goto(targetGen);
    expect(engine.snapshot().bits).toEqual(freshSimulate(width, height, edits, targetGen));
  });

  it('branchFrom() forks a bit-identical child under the same rule', async () => {
    const { engine, history } = makeStore();
    await driveForward(engine, history, targetGen);

    const forkGen = 64;
    const forkEdits = [set(12, 12, true)];
    const branchId = history.branchFrom(forkGen, forkEdits);

    // branchFrom() only records the fork point itself (maxGen === forkGen) —
    // per `cloneBranchAt`'s own doc, it clamps to "that branch's own maxGen",
    // never fabricating generations nothing ever actually stepped through.
    // Make the branch live and drive it forward for real, exactly like
    // `session.ts` does after a branch switch, before asking for a later gen.
    await history.switchBranch(branchId);
    while (engine.gen < forkGen + 30) {
      engine.step();
      history.advance(engine.gen);
    }
    expect(engine.rule).toBe(RULE);

    const branchGroundTruth = new Map(edits);
    for (const g of [...branchGroundTruth.keys()]) if (g > forkGen) branchGroundTruth.delete(g);
    branchGroundTruth.set(forkGen, [...(branchGroundTruth.get(forkGen) ?? []), ...forkEdits]);
    const expected = freshSimulate(width, height, branchGroundTruth, forkGen + 30);
    expect(engine.snapshot().bits).toEqual(expected);

    // And cloneBranchAt(), now that the branch really has been driven that far.
    const branchEngine = await history.cloneBranchAt(branchId, forkGen + 30);
    expect(branchEngine.rule).toBe(RULE);
    expect(branchEngine.snapshot().bits).toEqual(expected);
  });

  it('keyframe-driven replay across a window prune is still bit-identical (crosses several 64-gen keyframes)', async () => {
    const { engine, history } = makeStore();
    const longTarget = 260; // crosses 4 keyframe boundaries under HighLife's generic step kernel
    await driveForward(engine, history, longTarget);
    expect(engine.snapshot().bits).toEqual(freshSimulate(width, height, edits, longTarget));
    await history.goto(200);
    expect(engine.snapshot().bits).toEqual(freshSimulate(width, height, edits, 200));
  });
});
