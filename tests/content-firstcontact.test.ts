import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { FIRST_CONTACT_SCENE, FIRST_CONTACT_VERIFIED } from '@/content/scenes';
import { evaluateFirstContact, firstContactBaselineOutcome, simulateSceneOutcome } from '@/content/experiments';

describe('content: first contact scene', () => {
  it('seeds exactly the verified glider + LWSS, population 14', () => {
    expect(FIRST_CONTACT_SCENE.population0).toBe(14);
    const engine = createEngine({ width: FIRST_CONTACT_SCENE.world.width, height: FIRST_CONTACT_SCENE.world.height });
    for (const c of FIRST_CONTACT_SCENE.cells) engine.set(c.x, c.y, true);
    expect(engine.population).toBe(14);
  });

  it('the two travellers are visibly separated through generation 115 and collide at generation 116', () => {
    const w = FIRST_CONTACT_SCENE.world.width;
    const h = FIRST_CONTACT_SCENE.world.height;
    const glider = FIRST_CONTACT_SCENE.cells.slice(0, 5);
    const lwss = FIRST_CONTACT_SCENE.cells.slice(5);

    const composite = createEngine({ width: w, height: h });
    const a = createEngine({ width: w, height: h });
    const b = createEngine({ width: w, height: h });
    for (const c of FIRST_CONTACT_SCENE.cells) composite.set(c.x, c.y, true);
    for (const c of glider) a.set(c.x, c.y, true);
    for (const c of lwss) b.set(c.x, c.y, true);

    let firstDivergenceGen = -1;
    for (let gen = 0; gen <= 130 && firstDivergenceGen === -1; gen++) {
      for (let y = 0; y < h && firstDivergenceGen === -1; y++) {
        for (let x = 0; x < w; x++) {
          if (composite.get(x, y) !== (a.get(x, y) || b.get(x, y))) {
            firstDivergenceGen = gen;
            break;
          }
        }
      }
      if (firstDivergenceGen === -1) { composite.step(); a.step(); b.step(); }
    }
    expect(firstDivergenceGen).toBe(FIRST_CONTACT_VERIFIED.collisionGen);
  });

  it('settles into the verified traffic light (population 12) by generation 400', () => {
    const engine = createEngine({ width: FIRST_CONTACT_SCENE.world.width, height: FIRST_CONTACT_SCENE.world.height });
    for (const c of FIRST_CONTACT_SCENE.cells) engine.set(c.x, c.y, true);
    for (let g = 0; g < 400; g++) engine.step();
    expect(engine.population).toBe(FIRST_CONTACT_VERIFIED.outcomeAtGen400.population);
  });

  it('the verified intervention prevents the collision (population 5 by generation 400, no traffic light)', () => {
    const { intervention } = FIRST_CONTACT_VERIFIED;
    const engine = createEngine({ width: FIRST_CONTACT_SCENE.world.width, height: FIRST_CONTACT_SCENE.world.height });
    for (const c of FIRST_CONTACT_SCENE.cells) engine.set(c.x, c.y, true);
    engine.set(intervention.x, intervention.y, intervention.to);
    for (let g = 0; g < 400; g++) engine.step();
    expect(engine.population).toBe(5);
  });

  it('evaluateFirstContact: the untouched timeline does not count as changed', () => {
    const baseline = firstContactBaselineOutcome();
    const verdict = evaluateFirstContact(baseline, baseline);
    expect(verdict.changedOutcome).toBe(false);
  });

  it('evaluateFirstContact: the verified intervention changes the outcome', () => {
    const { intervention, outcomeCompareGen, outcomeCompareRect } = FIRST_CONTACT_VERIFIED;
    const candidate = simulateSceneOutcome(
      FIRST_CONTACT_SCENE.cells,
      FIRST_CONTACT_SCENE.world,
      [{ kind: 'set', cells: [{ x: intervention.x, y: intervention.y, alive: intervention.to }] }],
      outcomeCompareGen,
      outcomeCompareRect,
    );
    const verdict = evaluateFirstContact(candidate);
    expect(verdict.changedOutcome).toBe(true);
  });
});
