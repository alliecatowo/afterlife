import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { KEEP_ALIVE_SCENE, KEEP_ALIVE_VERIFIED } from '@/content/scenes';
import { evaluateKeepAlive, runKeepAliveSeries, withinEditBudget } from '@/content/experiments';
import type { EditOp } from '@/core/types';

/**
 * The most important property here: a challenge that can be passed by doing
 * nothing is broken. Both directions are tested explicitly —
 *  - the untouched baseline must be PROVEN to fail (activity, defined as
 *    "cells inside the rect that changed state over the last 8
 *    generations", permanently hits 0 well before generation 150), and
 *  - the verified single-cell solution must be PROVEN to succeed all the
 *    way through generation 150 under that exact same definition.
 *
 * Note: `baselineDeathGen` (85) is the raw last-change generation — the last
 * point at which any cell inside the rect flips state at all — which is a
 * different, finer-grained fact than the 8-generation-checkpoint activity
 * curve (whose first zero checkpoint is naturally the next multiple of 8,
 * generation 88). Both are checked, each against its own precise definition.
 */
describe('content: keep something alive', () => {
  const { measurementRect: rect, targetGen, activityWindow } = KEEP_ALIVE_VERIFIED;

  it('seeds exactly the verified 65 cells', () => {
    expect(KEEP_ALIVE_SCENE.population0).toBe(65);
    const engine = createEngine({ width: KEEP_ALIVE_SCENE.world.width, height: KEEP_ALIVE_SCENE.world.height });
    for (const c of KEEP_ALIVE_SCENE.cells) engine.set(c.x, c.y, true);
    expect(engine.population).toBe(65);
  });

  it('FAILS untouched: the rect goes fully static at generation 77 (last cell-state change), 8 gens before the death generation', () => {
    const engine = createEngine({ width: KEEP_ALIVE_SCENE.world.width, height: KEEP_ALIVE_SCENE.world.height });
    for (const c of KEEP_ALIVE_SCENE.cells) engine.set(c.x, c.y, true);

    let prev = engine.region(rect);
    let lastChangeGen = 0;
    for (let gen = 1; gen <= targetGen; gen++) {
      engine.step();
      const now = engine.region(rect);
      let changed = false;
      for (let i = 0; i < now.length; i++) if (now[i] !== prev[i]) { changed = true; break; }
      if (changed) lastChangeGen = gen;
      prev = now;
    }
    // "Activity" is a union of flips over the trailing 8 generations, so the
    // window is entirely quiet exactly `activityWindow` generations after the
    // last real change — which is exactly the verified death generation, 85.
    expect(lastChangeGen).toBe(77);
    expect(lastChangeGen + activityWindow).toBe(KEEP_ALIVE_VERIFIED.baselineDeathGen);
  });

  it('FAILS untouched: the exact verified activity curve holds at every 8-gen checkpoint, activity is 0 from the death generation on, and evaluateKeepAlive reports failure', () => {
    const curveGen = Math.max(targetGen, ...KEEP_ALIVE_VERIFIED.baselineActivityCurve.gens);
    const series = runKeepAliveSeries(KEEP_ALIVE_SCENE.cells, KEEP_ALIVE_SCENE.world, [], rect, curveGen, activityWindow);
    const byGen = new Map(series.map((s) => [s.gen, s.activity]));

    const { gens, activity } = KEEP_ALIVE_VERIFIED.baselineActivityCurve;
    for (let i = 0; i < gens.length; i++) {
      expect(byGen.get(gens[i]!), `generation ${gens[i]}`).toBe(activity[i]);
    }

    // Finer-grained than the 8-gen checkpoints: activity is still positive the
    // generation before death, and exactly 0 from the death generation on.
    expect(byGen.get(KEEP_ALIVE_VERIFIED.baselineDeathGen - 1)!).toBeGreaterThan(0);
    expect(byGen.get(KEEP_ALIVE_VERIFIED.baselineDeathGen)).toBe(0);

    const verdict = evaluateKeepAlive(series, targetGen, activityWindow);
    expect(verdict.success).toBe(false);
    // First checkpoint that is a multiple of `activityWindow`, per the
    // experiment's own every-8-generation evaluation.
    expect(verdict.failedAtGen).toBe(88);
    expect(verdict.minActivity).toBe(0);
  });

  it('SUCCEEDS with the verified solution: the exact verified activity curve holds, and evaluateKeepAlive reports success through generation 150', () => {
    const edits: EditOp[] = [{ kind: 'set', cells: KEEP_ALIVE_VERIFIED.solution.edits.map((e) => ({ x: e.x, y: e.y, alive: e.to })) }];
    expect(withinEditBudget(KEEP_ALIVE_VERIFIED.solution.edits.length, KEEP_ALIVE_VERIFIED.editBudget)).toBe(true);

    const curveGen = Math.max(targetGen, ...KEEP_ALIVE_VERIFIED.solutionActivityCurve.gens);
    const series = runKeepAliveSeries(KEEP_ALIVE_SCENE.cells, KEEP_ALIVE_SCENE.world, edits, rect, curveGen, activityWindow);
    const byGen = new Map(series.map((s) => [s.gen, s.activity]));

    const { gens, activity } = KEEP_ALIVE_VERIFIED.solutionActivityCurve;
    for (let i = 0; i < gens.length; i++) {
      expect(byGen.get(gens[i]!), `generation ${gens[i]}`).toBe(activity[i]);
    }

    const verdict = evaluateKeepAlive(series, targetGen, activityWindow);
    expect(verdict.success).toBe(true);
    expect(verdict.failedAtGen).toBeNull();
    expect(verdict.minActivity).toBe(KEEP_ALIVE_VERIFIED.solutionMinActivity);
  });

  it('the edit budget of 3 is enforced by withinEditBudget (a 1-edit solution fits comfortably)', () => {
    expect(withinEditBudget(0, KEEP_ALIVE_VERIFIED.editBudget)).toBe(true);
    expect(withinEditBudget(1, KEEP_ALIVE_VERIFIED.editBudget)).toBe(true);
    expect(withinEditBudget(3, KEEP_ALIVE_VERIFIED.editBudget)).toBe(true);
    expect(withinEditBudget(4, KEEP_ALIVE_VERIFIED.editBudget)).toBe(false);
  });
});
