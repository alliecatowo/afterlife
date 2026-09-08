import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { RuleParseError } from '@/core/rule';

describe('LifeEngine: rule construction', () => {
  it('defaults to Conway B3/S23', () => {
    const engine = createEngine({ width: 8, height: 8 });
    expect(engine.rule).toBe('B3/S23');
  });

  it('accepts a rule option and canonicalises it', () => {
    const engine = createEngine({ width: 8, height: 8, rule: 'b63/s32' });
    expect(engine.rule).toBe('B36/S23');
  });

  it('throws RuleParseError for an invalid rule at construction', () => {
    expect(() => createEngine({ width: 8, height: 8, rule: 'nonsense' })).toThrow(RuleParseError);
  });
});

describe('LifeEngine: generic (non-Conway) step kernel', () => {
  it('births at a neighbour count Conway does not (HighLife B36/S23, n===6)', () => {
    // A "ring" of 6 live cells around a dead centre: Conway leaves the centre
    // dead (n===6 is not a Conway birth), HighLife births it.
    const engine = createEngine({ width: 16, height: 16, rule: 'B36/S23' });
    const cx = 8, cy = 8;
    const ring: Array<[number, number]> = [
      [cx - 1, cy - 1], [cx, cy - 1], [cx + 1, cy - 1],
      [cx - 1, cy], [cx + 1, cy],
      [cx - 1, cy + 1],
    ];
    for (const [x, y] of ring) engine.set(x, y, true);
    expect(engine.liveNeighborCount(cx, cy)).toBe(6);
    engine.step();
    expect(engine.get(cx, cy)).toBe(true);

    const conway = createEngine({ width: 16, height: 16 });
    for (const [x, y] of ring) conway.set(x, y, true);
    conway.step();
    expect(conway.get(cx, cy)).toBe(false);
  });

  it("Fredkin's Replicator (B1357/S1357): a lone live cell dies, its 8 neighbours are all born", () => {
    const engine = createEngine({ width: 16, height: 16, rule: 'B1357/S1357' });
    engine.set(8, 8, true);
    engine.step();
    expect(engine.get(8, 8)).toBe(false);
    expect(engine.population).toBe(8);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        expect(engine.get(8 + dx, 8 + dy)).toBe(true);
      }
    }
  });

  it('Life without Death (B3/S012345678): population never decreases', () => {
    const engine = createEngine({ width: 24, height: 24, rule: 'B3/S012345678' });
    engine.seed('life-without-death', 0.15);
    let prev = engine.population;
    for (let i = 0; i < 60; i++) {
      engine.step();
      expect(engine.population).toBeGreaterThanOrEqual(prev);
      prev = engine.population;
    }
  });

  it('Seeds (B2/S): every live cell dies every generation (no survivals)', () => {
    const engine = createEngine({ width: 24, height: 24, rule: 'B2/S' });
    engine.seed('seeds', 0.1);
    const before = new Set<string>();
    engine.forEachLive({ x: 0, y: 0, w: 24, h: 24 }, (x, y) => before.add(`${x},${y}`));
    engine.step();
    engine.forEachLive({ x: 0, y: 0, w: 24, h: 24 }, (x, y) => {
      expect(before.has(`${x},${y}`)).toBe(false);
    });
  });
});

describe('LifeEngine: setRule()', () => {
  it('changes engine.rule without touching bits/gen/population', () => {
    const engine = createEngine({ width: 8, height: 8 });
    engine.set(1, 1, true);
    engine.set(2, 2, true);
    const before = engine.snapshot();
    engine.setRule('B36/S23');
    expect(engine.rule).toBe('B36/S23');
    expect(engine.gen).toBe(before.gen);
    expect(engine.population).toBe(2);
    expect(engine.get(1, 1)).toBe(true);
    expect(engine.get(2, 2)).toBe(true);
  });

  it('affects only steps taken after the call', () => {
    const engine = createEngine({ width: 16, height: 16 });
    const cx = 8, cy = 8;
    const ring: Array<[number, number]> = [
      [cx - 1, cy - 1], [cx, cy - 1], [cx + 1, cy - 1],
      [cx - 1, cy], [cx + 1, cy],
      [cx - 1, cy + 1],
    ];
    for (const [x, y] of ring) engine.set(x, y, true);
    engine.setRule('B36/S23');
    engine.step();
    expect(engine.get(cx, cy)).toBe(true); // now uses HighLife's B36
  });

  it('throws RuleParseError and leaves the previous rule in force on invalid input', () => {
    const engine = createEngine({ width: 8, height: 8, rule: 'B36/S23' });
    expect(() => engine.setRule('garbage')).toThrow(RuleParseError);
    expect(engine.rule).toBe('B36/S23');
  });
});

describe('LifeEngine: clone() carries the active rule', () => {
  it('carries the constructor rule', () => {
    const engine = createEngine({ width: 8, height: 8, rule: 'B36/S23' });
    expect(engine.clone().rule).toBe('B36/S23');
  });

  it('carries a rule set via setRule() after construction', () => {
    const engine = createEngine({ width: 8, height: 8 });
    engine.setRule('B2/S');
    expect(engine.clone().rule).toBe('B2/S');
  });
});
