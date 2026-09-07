import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { OPENING_SCENE, OPENING_VERIFIED } from '@/content/scenes';

/**
 * Re-simulates the Opening scene with the REAL engine and checks it against
 * the numbers verified by the scene-lab agent. If this disagrees, the bug is
 * almost certainly in the engine or in how this scene seeds it — not in the
 * verified figures.
 */
describe('content: opening scene', () => {
  function buildEngine() {
    const engine = createEngine({ width: OPENING_SCENE.world.width, height: OPENING_SCENE.world.height });
    for (const c of OPENING_SCENE.cells) engine.set(c.x, c.y, true);
    return engine;
  }

  it('seeds exactly the verified 250 live cells', () => {
    const engine = buildEngine();
    expect(engine.population).toBe(250);
    expect(OPENING_SCENE.population0).toBe(250);
  });

  it('the two travellers are the first and only thing to interact, at generation 123', () => {
    // Independently evolve gun+garden (everything except the two travellers)
    // and the two travellers alone, then compare against the composite world
    // generation by generation. The first generation where the composite
    // differs from "gun+garden XOR travellers, simulated apart" is the first
    // interaction between groups.
    const w = OPENING_SCENE.world.width;
    const h = OPENING_SCENE.world.height;

    // Each traveller must be its own independent group — simulating them
    // together as one "travellers" engine would silently model their mutual
    // collision as if it were the composite's own behaviour (they'd interact
    // identically either way), masking exactly the interaction under test.
    // Splitting every one of gun, garden and BOTH travellers apart is what
    // the scene-lab agent's own verification methodology did.
    const gliderA: ReadonlyArray<[number, number]> = [[91, 64], [92, 65], [90, 66], [91, 66], [92, 66]];
    const gliderB: ReadonlyArray<[number, number]> = [[154, 60], [153, 61], [153, 62], [154, 62], [155, 62]];
    const isTraveller = (x: number, y: number) =>
      gliderA.some(([tx, ty]) => tx === x && ty === y) || gliderB.some(([tx, ty]) => tx === x && ty === y);
    const restCells = OPENING_SCENE.cells.filter((c) => !isTraveller(c.x, c.y));
    expect(restCells.length + gliderA.length + gliderB.length).toBe(250);

    const composite = createEngine({ width: w, height: h });
    const rest = createEngine({ width: w, height: h });
    const a = createEngine({ width: w, height: h });
    const b = createEngine({ width: w, height: h });
    for (const c of OPENING_SCENE.cells) composite.set(c.x, c.y, true);
    for (const c of restCells) rest.set(c.x, c.y, true);
    for (const [x, y] of gliderA) a.set(x, y, true);
    for (const [x, y] of gliderB) b.set(x, y, true);

    let firstDivergenceGen = -1;
    let firstDivergentCell: { x: number; y: number } | null = null;

    for (let gen = 0; gen <= 200 && firstDivergenceGen === -1; gen++) {
      for (let y = 0; y < h && firstDivergenceGen === -1; y++) {
        for (let x = 0; x < w; x++) {
          const c = composite.get(x, y);
          const independentUnion = rest.get(x, y) || a.get(x, y) || b.get(x, y);
          if (c !== independentUnion) {
            firstDivergenceGen = gen;
            firstDivergentCell = { x, y };
            break;
          }
        }
      }
      if (firstDivergenceGen === -1) {
        composite.step();
        rest.step();
        a.step();
        b.step();
      }
    }

    expect(firstDivergenceGen).toBe(OPENING_VERIFIED.encounterGen);
    expect(firstDivergentCell).toEqual(OPENING_VERIFIED.firstInteractingCell);
  });

  it('no live cell touches the torus border through generation 300', () => {
    const engine = buildEngine();
    const w = engine.spec.width;
    const h = engine.spec.height;
    const margin = OPENING_VERIFIED.borderMargin;

    function touchesBorder(): boolean {
      let hit = false;
      engine.forEachLive({ x: 0, y: 0, w, h }, (x, y) => {
        if (x < margin || y < margin || x >= w - margin || y >= h - margin) {
          hit = true;
          return false;
        }
      });
      return hit;
    }

    for (let gen = 0; gen <= OPENING_VERIFIED.noBorderTouchThroughGen; gen++) {
      expect(touchesBorder(), `generation ${gen}`).toBe(false);
      if (gen < OPENING_VERIFIED.noBorderTouchThroughGen) engine.step();
    }
  });
});
