import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { ONE_CELL_SCENE, ONE_CELL_VERIFIED } from '@/content/scenes';
import { evaluateOneCell, simulateSceneOutcome } from '@/content/experiments';

describe('content: one cell scene', () => {
  it('seeds exactly 11 cells (a glider and a clock)', () => {
    expect(ONE_CELL_SCENE.population0).toBe(11);
    const engine = createEngine({ width: ONE_CELL_SCENE.world.width, height: ONE_CELL_SCENE.world.height });
    for (const c of ONE_CELL_SCENE.cells) engine.set(c.x, c.y, true);
    expect(engine.population).toBe(11);
  });

  it('the base future reaches population 221 at generation 200 inside the measurement rect', () => {
    const rect = ONE_CELL_VERIFIED.measurementRect;
    const region = simulateSceneOutcome(ONE_CELL_SCENE.cells, ONE_CELL_SCENE.world, [], 200, rect);
    const pop = region.reduce((a, b) => a + b, 0);
    expect(pop).toBe(ONE_CELL_VERIFIED.gen200.basePopInRect);
  });

  it('the flipped future is extinct from generation 54 onward', () => {
    const { flip } = ONE_CELL_VERIFIED;
    const engine = createEngine({ width: ONE_CELL_SCENE.world.width, height: ONE_CELL_SCENE.world.height });
    for (const c of ONE_CELL_SCENE.cells) engine.set(c.x, c.y, true);
    engine.set(flip.x, flip.y, flip.to);

    for (let gen = 0; gen <= ONE_CELL_VERIFIED.flippedExtinctFromGen + 10; gen++) {
      if (gen >= ONE_CELL_VERIFIED.flippedExtinctFromGen) {
        expect(engine.population, `generation ${gen}`).toBe(0);
      }
      engine.step();
    }
  });

  it('evaluateOneCell reports the verified divergence at generation 200', () => {
    const rect = ONE_CELL_VERIFIED.measurementRect;
    const { flip } = ONE_CELL_VERIFIED;
    const baseRegion = simulateSceneOutcome(ONE_CELL_SCENE.cells, ONE_CELL_SCENE.world, [], 200, rect);
    const flippedRegion = simulateSceneOutcome(
      ONE_CELL_SCENE.cells,
      ONE_CELL_SCENE.world,
      [{ kind: 'set', cells: [{ x: flip.x, y: flip.y, alive: flip.to }] }],
      200,
      rect,
    );
    const verdict = evaluateOneCell(baseRegion, flippedRegion);
    expect(verdict.baseAlive).toBe(ONE_CELL_VERIFIED.gen200.basePopInRect);
    expect(verdict.flippedAlive).toBe(ONE_CELL_VERIFIED.gen200.flippedPopInRect);
    expect(verdict.flippedExtinct).toBe(true);
  });

  it('divergence inside the rect is flat through generation 42 and first reaches >= 10 at generation 43', () => {
    const rect = ONE_CELL_VERIFIED.measurementRect;
    const { flip } = ONE_CELL_VERIFIED;
    const base = createEngine({ width: ONE_CELL_SCENE.world.width, height: ONE_CELL_SCENE.world.height });
    const flipped = createEngine({ width: ONE_CELL_SCENE.world.width, height: ONE_CELL_SCENE.world.height });
    for (const c of ONE_CELL_SCENE.cells) { base.set(c.x, c.y, true); flipped.set(c.x, c.y, true); }
    flipped.set(flip.x, flip.y, flip.to);

    function divergentCount(): number {
      const a = base.region(rect);
      const b = flipped.region(rect);
      let n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
      return n;
    }

    let firstAtLeastTen = -1;
    for (let gen = 0; gen <= 43; gen++) {
      const d = divergentCount();
      if (gen <= 42) expect(d, `generation ${gen}`).toBeLessThan(10);
      if (d >= 10 && firstAtLeastTen === -1) firstAtLeastTen = gen;
      base.step();
      flipped.step();
    }
    expect(firstAtLeastTen).toBe(ONE_CELL_VERIFIED.firstVisibleDivergenceGen);
  });
});
