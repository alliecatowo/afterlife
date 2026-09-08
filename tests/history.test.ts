import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { createTimelineStore, HistoryWindowError, KEYFRAME_INTERVAL } from '@/core/history';
import type { EditOp } from '@/core/types';

/** Drive `engine` forward one generation at a time to `targetGen`, applying any
 * scheduled edits at their exact generation via `history.record()` (so the
 * live-apply fast path exercises the same code as a real interaction layer),
 * and calling `history.advance()` every generation like the render loop would.
 */
async function driveForward(
  engine: ReturnType<typeof createEngine>,
  history: ReturnType<typeof createTimelineStore>,
  targetGen: number,
  edits: Map<number, EditOp[]>,
): Promise<void> {
  const g0edits = edits.get(engine.gen);
  if (g0edits) history.record(engine.gen, g0edits);
  while (engine.gen < targetGen) {
    engine.step();
    history.advance(engine.gen);
    const ops = edits.get(engine.gen);
    if (ops) history.record(engine.gen, ops);
  }
}

/** Independent ground truth: simulate from scratch applying the same edits at
 * the same generations, entirely outside history.ts. */
function freshSimulate(width: number, height: number, edits: Map<number, EditOp[]>, targetGen: number): Uint8Array {
  const engine = createEngine({ width, height });
  const g0 = edits.get(0);
  if (g0) for (const op of g0) for (const c of op.cells) engine.set(c.x, c.y, c.alive);
  for (let g = 1; g <= targetGen; g++) {
    engine.step();
    const ops = edits.get(g);
    if (ops) for (const op of ops) for (const c of op.cells) engine.set(c.x, c.y, c.alive);
  }
  return engine.snapshot().bits;
}

function set(x: number, y: number, alive: boolean): EditOp {
  return { kind: 'set', cells: [{ x, y, alive }] };
}

describe('TimelineStore determinism', () => {
  it('replaying the same recorded history via goto() in scrambled order is always bit-identical to an independent fresh simulation', async () => {
    const width = 24;
    const height = 24;
    const engine = createEngine({ width, height });
    // Seed a glider-ish mess deterministically.
    engine.seed('history-determinism', 0.25);
    const history = createTimelineStore({ engine });

    const edits = new Map<number, EditOp[]>([
      [10, [set(1, 1, true), set(2, 1, true)]],
      [37, [set(5, 5, false)]],
      [90, [set(0, 0, true), set(23, 23, true)]],
      [150, [set(10, 10, false), set(10, 11, false)]],
      [201, [set(3, 3, true)]],
    ]);

    const finalGen = 220;
    await driveForward(engine, history, finalGen, edits);
    expect(history.maxGen).toBe(finalGen);

    // Independent reference computed from a completely separate engine.
    function referenceAt(gen: number): Uint8Array {
      const ref = createEngine({ width, height });
      ref.seed('history-determinism', 0.25);
      const g0 = edits.get(0);
      if (g0) for (const op of g0) for (const c of op.cells) ref.set(c.x, c.y, c.alive);
      for (let g = 1; g <= gen; g++) {
        ref.step();
        const ops = edits.get(g);
        if (ops) for (const op of ops) for (const c of op.cells) ref.set(c.x, c.y, c.alive);
      }
      return ref.snapshot().bits;
    }

    const targets = [220, 5, 150, 0, 90, 201, 37, 100, 220, 1, 219];
    // Run the scrambled goto sequence twice; every visit must land on the
    // exact same bits both times and must match the independent reference.
    for (let pass = 0; pass < 2; pass++) {
      for (const g of targets) {
        await history.goto(g);
        expect(engine.gen).toBe(g);
        expect(engine.snapshot().bits).toEqual(referenceAt(g));
      }
    }
  });

  it('goto() rejects a superseded call with AbortError while the newer one resolves', async () => {
    const width = 40;
    const height = 40;
    const engine = createEngine({ width, height });
    engine.seed('cancel-test', 0.3);
    const history = createTimelineStore({ engine });

    // Advance the live engine WITHOUT calling history.advance(), so no
    // intermediate keyframes get materialised — only `record()`s bump maxGen.
    // This forces goto(500) to replay all 500 generations from the gen-0
    // keyframe (well past the 64-step chunk size), guaranteeing it is still
    // in flight — genuinely suspended at a yield point — when the second
    // goto() call aborts it.
    for (let i = 0; i < 500; i++) engine.step();
    history.record(500, [set(0, 0, engine.get(0, 0))]);
    expect(history.maxGen).toBe(500);

    const p1 = history.goto(500);
    const p2 = history.goto(10);

    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    await expect(p2).resolves.toBeUndefined();
    expect(engine.gen).toBe(10);
  });

  it('goto() rejects with HistoryWindowError below windowStart', async () => {
    const engine = createEngine({ width: 8, height: 8 });
    const history = createTimelineStore({ engine, historyWindow: 64 });
    await driveForward(engine, history, 200, new Map());
    expect(history.windowStart).toBeGreaterThan(0);
    await expect(history.goto(0)).rejects.toBeInstanceOf(HistoryWindowError);
  });

  it('a long goto() leaves engine.gen at a genuinely intermediate value the moment it is called — demonstrating why a caller must never read engine.gen synchronously without awaiting settled() first (see @/ui/session.ts\'s edit-commit/undo paths and INTEGRATION-NOTES.md\'s session.ts race entry)', () => {
    const engine = createEngine({ width: 40, height: 40 });
    engine.seed('settle-demo', 0.3);
    const history = createTimelineStore({ engine });

    // Same setup as the "rejects a superseded call" test above: advance the
    // live engine WITHOUT history.advance(), so only the gen-0 keyframe
    // exists and goto(500) must replay all 500 generations — far past the
    // 64-step chunk size.
    for (let i = 0; i < 500; i++) engine.step();
    history.record(500, [set(0, 0, engine.get(0, 0))]);

    // Deliberately UNAWAITED: an async function's body runs SYNCHRONOUSLY up
    // to its first internal `await`, so by the time this line returns,
    // goto()'s first 64-step chunk has already run for real.
    void history.goto(500);
    expect(engine.gen).toBeGreaterThan(0);
    expect(engine.gen).toBeLessThan(500); // genuinely mid-flight, not yet settled
  });

  it('settled() resolves only once the most recent goto() has truly finished, giving a caller the correct final engine.gen', async () => {
    const engine = createEngine({ width: 40, height: 40 });
    engine.seed('settle-demo-2', 0.3);
    const history = createTimelineStore({ engine });

    for (let i = 0; i < 500; i++) engine.step();
    history.record(500, [set(0, 0, engine.get(0, 0))]);

    void history.goto(500);
    expect(engine.gen).toBeLessThan(500); // mid-flight, as above

    await history.settled();
    expect(engine.gen).toBe(500); // now genuinely settled

    // Call settled() BEFORE the goto() it needs to wait for even exists yet
    // (both are unawaited, synchronous calls back to back): settled()'s
    // internal loop must notice `goto(1000)` reassigning the tracked promise
    // and follow it, rather than resolving early against a stale reference.
    for (let i = 0; i < 500; i++) engine.step();
    history.record(1000, [set(1, 1, engine.get(1, 1))]);
    const settledPromise = history.settled();
    void history.goto(1000);
    await settledPromise;
    expect(engine.gen).toBe(1000);
  });
});

describe('branching', () => {
  it('fork at gen N leaves the parent future untouched and diverges the child; diff matches a hand-computed expectation', async () => {
    const width = 10;
    const height = 10;
    const engine = createEngine({ width, height });
    // A stable block, away from the seam, so the root branch is trivially predictable.
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) engine.set(x, y, true);
    const history = createTimelineStore({ engine });

    await driveForward(engine, history, 10, new Map());
    const rootId = history.activeBranch;
    const rootAt10 = engine.snapshot().bits.slice();

    // Fork at gen 5 with one extra cell lit that the block pattern doesn't touch.
    const childId = history.branchFrom(5, [set(0, 0, true)]);
    await history.switchBranch(childId);
    expect(engine.gen).toBe(5);
    expect(engine.get(0, 0)).toBe(true);

    // Advance the child a bit further; the isolated (0,0) cell dies next step
    // (0 neighbours), the block remains stable.
    await driveForward(engine, history, 10, new Map());
    const childAt10 = engine.snapshot().bits.slice();

    // Parent's future must be exactly what it was before the fork.
    await history.switchBranch(rootId, 10);
    expect(engine.snapshot().bits).toEqual(rootAt10);
    expect(engine.get(0, 0)).toBe(false);

    // Child must differ from parent (transiently, while (0,0) was alive) —
    // check at gen 5 exactly, right after the fork edit, before (0,0) dies.
    const rect = { x: 0, y: 0, w: width, h: height };
    const diffAt5 = await history.diff(rootId, childId, 5, rect);
    // Hand-computed: only (0,0) differs (alive in child only) at gen 5.
    expect(diffAt5.count).toBe(1);
    expect(diffAt5.cells[0 * width + 0]).toBe(2); // 2 = alive only in B (child)

    // At gen 10 the extra cell has died on both sides (isolated cell can't
    // survive), so the branches should be identical again.
    const diffAt10 = await history.diff(rootId, childId, 10, rect);
    expect(diffAt10.count).toBe(0);
    expect(diffAt10.cells.every((v) => v === 0)).toBe(true);
  });

  it('renamed and active branches are never evicted even past the branch cap', async () => {
    const engine = createEngine({ width: 8, height: 8 });
    const history = createTimelineStore({ engine });
    const keep = history.branchFrom(0, [set(1, 1, true)]);
    history.renameBranch(keep, 'keep-me');

    for (let i = 0; i < 10; i++) {
      history.branchFrom(0, [set(2, 2, true)]);
    }

    const ids = history.branches.map((b) => b.id);
    expect(ids).toContain('root');
    expect(ids).toContain(keep);
    expect(ids.length).toBeLessThanOrEqual(8);
  });
});

describe('sliceStack', () => {
  it('returns real recorded history, cross-checked against fresh replay, and reports the stride used', async () => {
    const width = 12;
    const height = 12;
    const engine = createEngine({ width, height });
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) engine.set(x, y, true); // stable block
    const history = createTimelineStore({ engine });

    const edits = new Map<number, EditOp[]>([[10, [set(0, 0, true)]]]);
    await driveForward(engine, history, 40, edits);

    const rect = { x: 0, y: 0, w: width, h: height };
    const slices = await history.sliceStack(rect, 0, 40, 5);
    // span 41 gens over maxSlices=5 -> stride = ceil(41/5) = 9.
    expect(history.lastSliceStride).toBe(9);
    // gens visited: 0, 9, 18, 27, 36 (fromGen + k*stride while <= toGen).
    expect(slices.length).toBe(5);

    // Cross-check slice 0 (gen 0, before the edit) and a later slice (gen 36,
    // after the edit at gen 10) against independent goto()-based replay.
    await history.goto(0);
    expect(engine.region(rect)).toEqual(slices[0]);

    await history.goto(36);
    expect(engine.region(rect)).toEqual(slices[4]);
    // (0,0) was set alive at gen 10 and is isolated, so it should be dead
    // again by gen 36, while the block persists.
    expect(engine.get(4, 4)).toBe(true);
  });

  it('rejects when fromGen has fallen out of the retained window', async () => {
    const engine = createEngine({ width: 8, height: 8 });
    const history = createTimelineStore({ engine, historyWindow: 32 });
    await driveForward(engine, history, 200, new Map());
    await expect(history.sliceStack({ x: 0, y: 0, w: 8, h: 8 }, 0, 10)).rejects.toBeInstanceOf(HistoryWindowError);
  });
});

describe('keyframes', () => {
  it('advance() materialises a keyframe every KEYFRAME_INTERVAL generations, keeping deep gotos fast without extra correctness cost', async () => {
    const engine = createEngine({ width: 16, height: 16 });
    engine.seed('keyframe-test', 0.3);
    const history = createTimelineStore({ engine });
    await driveForward(engine, history, KEYFRAME_INTERVAL * 3, new Map());
    // Sanity: goto back to an exact keyframe boundary and a non-boundary gen.
    await history.goto(KEYFRAME_INTERVAL * 2);
    const atBoundary = engine.snapshot().bits.slice();
    await history.goto(KEYFRAME_INTERVAL * 2 + 5);
    await history.goto(KEYFRAME_INTERVAL * 2);
    expect(engine.snapshot().bits).toEqual(atBoundary);
  });
});
