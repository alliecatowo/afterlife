/**
 * Re-verifies every `RULE_PRESETS[].verified` claim against the real engine.
 * If one of these fails, the fix is almost always to the prose in
 * `@/content/rules.ts`, not this test — see that module's doc.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { RULE_PRESETS, findPresetByRule, getRulePreset } from '@/content/rules';

describe('RULE_PRESETS: shape and lookups', () => {
  it('every preset has a valid, canonical rulestring and non-empty prose', () => {
    for (const p of RULE_PRESETS) {
      expect(() => createEngine({ width: 4, height: 4, rule: p.rule })).not.toThrow();
      expect(createEngine({ width: 4, height: 4, rule: p.rule }).rule).toBe(p.rule);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.verified.length).toBeGreaterThan(20);
    }
  });

  it('ids are unique', () => {
    const ids = RULE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getRulePreset finds by id', () => {
    expect(getRulePreset('conway')?.rule).toBe('B3/S23');
    expect(getRulePreset('nope')).toBeUndefined();
  });

  it('findPresetByRule matches spelling-insensitively', () => {
    expect(findPresetByRule('b36/s23')?.id).toBe('highlife');
    expect(findPresetByRule('S23/B36')?.id).toBe('highlife');
    expect(findPresetByRule('garbage')).toBeUndefined();
  });

  it('Diamoeba and Anneal/Vote were deliberately dropped, not merely forgotten', () => {
    expect(findPresetByRule('B35678/S5678')).toBeUndefined();
    expect(RULE_PRESETS.some((p) => /diamoeba/i.test(p.name))).toBe(false);
  });
});

describe('HighLife (B36/S23): the plus-pentomino makes 4 exact copies then collapses', () => {
  const SHAPE: Array<[number, number]> = [[0, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];

  /** Are all of the live cells on the board covered by exactly `count` disjoint translated copies of SHAPE, none left over? */
  function countExactCopies(engine: ReturnType<typeof createEngine>, w: number, h: number): number {
    const live = new Set<string>();
    engine.forEachLive({ x: 0, y: 0, w, h }, (x, y) => { live.add(`${x},${y}`); });
    const remaining = new Set(live);
    let copies = 0;
    for (const key of live) {
      if (!remaining.has(key)) continue;
      const [ax, ay] = key.split(',').map(Number) as [number, number];
      const ox = ax - SHAPE[0]![0];
      const oy = ay - SHAPE[0]![1];
      const cand = SHAPE.map(([dx, dy]) => `${(ox + dx + w) % w},${(oy + dy + h) % h}`);
      if (cand.every((c) => remaining.has(c))) {
        for (const c of cand) remaining.delete(c);
        copies++;
      }
    }
    return remaining.size === 0 ? copies : -1; // -1: leftover cells not covered by any exact copy
  }

  it('reproduces the exact population trajectory and 4-copy replication at generation 5', () => {
    const w = 64, h = 64;
    const engine = createEngine({ width: w, height: h, rule: 'B36/S23' });
    const ox = 30, oy = 30;
    for (const [dx, dy] of SHAPE) engine.set(ox + dx, oy + dy, true);

    const expectedPop = [5, 8, 8, 12, 12, 20, 16, 20, 24, 8, 0];
    expect(engine.population).toBe(expectedPop[0]);
    for (let g = 1; g <= 10; g++) {
      engine.step();
      expect(engine.population).toBe(expectedPop[g]);
      if (g === 5) expect(countExactCopies(engine, w, h)).toBe(4);
    }
    expect(engine.population).toBe(0); // collapsed to extinction by gen 10
  });
});

describe("Day & Night (B3678/S34678): a 3x3 block oscillates 9,9,5,5,...", () => {
  it('cycles through exactly this population sequence, repeating', () => {
    const engine = createEngine({ width: 32, height: 32, rule: 'B3678/S34678' });
    for (let y = 14; y < 17; y++) for (let x = 14; x < 17; x++) engine.set(x, y, true);
    const expected = [9, 9, 5, 5, 9, 9, 5, 5, 9, 9, 5, 5];
    expect(engine.population).toBe(expected[0]);
    for (let g = 1; g < expected.length; g++) {
      engine.step();
      expect(engine.population).toBe(expected[g]);
    }
  });
});

describe('Seeds (B2/S): a 2x2 block explodes to 128 within 12 generations', () => {
  it('matches the exact observed population trajectory', () => {
    const engine = createEngine({ width: 64, height: 64, rule: 'B2/S' });
    engine.set(30, 30, true); engine.set(31, 30, true); engine.set(30, 31, true); engine.set(31, 31, true);
    const expected = [4, 8, 12, 16, 24, 32, 52, 40, 56, 72, 72, 92, 128];
    expect(engine.population).toBe(expected[0]);
    for (let g = 1; g < expected.length; g++) {
      engine.step();
      expect(engine.population).toBe(expected[g]);
    }
  });
});

describe('Maze (B3/S12345): random soup freezes solid at population 5072', () => {
  it('locks to exactly 5072 by generation 40 and holds through generation 400', () => {
    const engine = createEngine({ width: 96, height: 96, rule: 'B3/S12345' });
    engine.seed('maze-test', 0.4);
    for (let i = 0; i < 40; i++) engine.step();
    expect(engine.population).toBe(5072);
    for (let i = 0; i < 360; i++) engine.step();
    expect(engine.population).toBe(5072);
  });
});

describe('Mazectric (B3/S1234): the SAME soup settles into a perfect period-6 cycle', () => {
  it('cycles 4591, 4597, 4593, 4597, 4591, 4599, repeating — strictly below Maze\'s 5072', () => {
    const engine = createEngine({ width: 96, height: 96, rule: 'B3/S1234' });
    engine.seed('mazectric-test', 0.4);
    for (let i = 0; i < 60; i++) engine.step();
    const cycle = [4591, 4597, 4593, 4597, 4591, 4599];
    for (let i = 0; i < 24; i++) {
      engine.step();
      expect(engine.population).toBe(cycle[i % cycle.length]);
    }
  });
});

describe("Replicator / Fredkin's parity rule (B1357/S1357): a lone cell becomes an 8-cell ring", () => {
  it('the exact ring, verified again here against the shipped preset id', () => {
    const preset = getRulePreset('replicator')!;
    const engine = createEngine({ width: 16, height: 16, rule: preset.rule });
    engine.set(8, 8, true);
    engine.step();
    expect(engine.get(8, 8)).toBe(false);
    expect(engine.population).toBe(8);
  });
});

describe('Life without Death (B3/S012345678): population is monotonically non-decreasing', () => {
  it('never drops across 60 generations from a random soup', () => {
    const preset = getRulePreset('life-without-death')!;
    const engine = createEngine({ width: 24, height: 24, rule: preset.rule });
    engine.seed('lwd-test', 0.15);
    let prev = engine.population;
    for (let i = 0; i < 60; i++) {
      engine.step();
      expect(engine.population).toBeGreaterThanOrEqual(prev);
      prev = engine.population;
    }
  });
});

describe('2x2 (B36/S125): bounded population, neither extinct nor exploding', () => {
  it('stays inside [1700, 2200] for generations 200-400 (checked every generation)', () => {
    const engine = createEngine({ width: 96, height: 96, rule: 'B36/S125' });
    engine.seed('2x2-test', 0.3);
    for (let i = 0; i < 200; i++) engine.step();
    for (let i = 0; i < 200; i++) {
      engine.step();
      expect(engine.population).toBeGreaterThanOrEqual(1700);
      expect(engine.population).toBeLessThanOrEqual(2200);
    }
  });
});

describe('Coral (B3/S45678): grows then freezes solid; sparse soup dies back then re-accretes', () => {
  it('a 16x16 block grows to a static 612-cell structure by generation 40, unchanged through 200', () => {
    const engine = createEngine({ width: 96, height: 96, rule: 'B3/S45678' });
    for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) engine.set(x, y, true);
    expect(engine.population).toBe(256);
    for (let i = 0; i < 40; i++) engine.step();
    expect(engine.population).toBe(612);
    const frozen = engine.snapshot().bits;
    for (let i = 0; i < 160; i++) engine.step();
    expect(engine.population).toBe(612);
    expect(engine.snapshot().bits).toEqual(frozen); // genuinely static, not just same count
  });

  it('a sparse random soup dies back hard (bottoming around generation 20), then steadily re-accretes', () => {
    const engine = createEngine({ width: 96, height: 96, rule: 'B3/S45678' });
    engine.seed('coral-soup', 0.4);
    expect(engine.population).toBe(3710);
    for (let i = 0; i < 20; i++) engine.step();
    const trough = engine.population;
    expect(trough).toBe(617); // the measured bottom of the die-back
    expect(trough).toBeLessThan(1000); // hard die-back from the initial 3710
    expect(trough).toBeGreaterThan(0); // but not extinct
    let prevCheckpoint = trough;
    for (let block = 0; block < 8; block++) {
      for (let i = 0; i < 10; i++) engine.step();
      expect(engine.population).toBeGreaterThan(prevCheckpoint); // steady re-accretion, checkpoint over checkpoint
      prevCheckpoint = engine.population;
    }
  });
});
