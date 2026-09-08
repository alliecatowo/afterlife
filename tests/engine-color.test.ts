import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { createTimelineStore } from '@/core/history';
import { circularMean3, quadSpeciesFromParents } from '@/core/lineage';

/**
 * Colour is inherited/derived state that rides along with cells; it must
 * NEVER influence birth, survival, or death. These tests prove that
 * invariant directly against the engine (not just by inspection of
 * `step()`'s source), and separately verify the colour bookkeeping itself
 * (inheritance math, replay/branch bit-exactness).
 */

function makeWorld(w: number, h: number, cells: Array<[number, number]>) {
  const engine = createEngine({ width: w, height: h });
  for (const [x, y] of cells) engine.set(x, y, true);
  return engine;
}

describe('B3/S23 determinism is untouched by colour bookkeeping', () => {
  it('two engines seeded identically produce byte-identical bits after many steps', () => {
    const a = createEngine({ width: 64, height: 64 });
    const b = createEngine({ width: 64, height: 64 });
    a.seed(1234, 0.35);
    b.seed(1234, 0.35);
    // seed() itself must be unaffected too, before any step() runs.
    expect(a.snapshot().bits).toEqual(b.snapshot().bits);
    for (let i = 0; i < 40; i++) { a.step(); b.step(); }
    expect(a.snapshot().bits).toEqual(b.snapshot().bits);
    expect(a.population).toBe(b.population);
  });

  it('a glider still glides exactly as it does without any colour reasoning applied (golden shape check)', () => {
    // Standard glider, period 4, drifts by (1, 1) toroidally.
    const glider: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    const engine = makeWorld(32, 32, glider.map(([x, y]) => [x + 10, y + 10]));
    for (let i = 0; i < 4; i++) engine.step();
    const expected = new Set(glider.map(([x, y]) => `${x + 11},${y + 11}`));
    const actual = new Set<string>();
    engine.forEachLive({ x: 0, y: 0, w: 32, h: 32 }, (x, y) => { actual.add(`${x},${y}`); });
    expect(actual).toEqual(expected);
  });

  it('directly poisoning colour state (via set/stamp on unrelated cells) never changes the alive/dead outcome of a step', () => {
    const glider: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    const engineA = makeWorld(32, 32, glider.map(([x, y]) => [x + 10, y + 10]));
    const engineB = makeWorld(32, 32, glider.map(([x, y]) => [x + 10, y + 10]));
    // Poison B: toggle a bunch of far-away cells on/off (touches hue/species
    // heavily) without changing the final alive set.
    for (let i = 0; i < 20; i++) {
      engineB.set(i, 25, true);
      engineB.set(i, 25, false);
    }
    for (let i = 0; i < 6; i++) { engineA.step(); engineB.step(); }
    expect(engineA.snapshot().bits).toEqual(engineB.snapshot().bits);
  });
});

describe('birth colour inheritance: exactly the 3 live parents, never the birth decision', () => {
  it('a newborn cell blends the hue of its exactly-3 live neighbours (circular mean)', () => {
    // Three isolated cells arranged so they jointly birth a 4th cell at
    // (1,1) via B3/S23 (an "L" of 3 cells), each given a distinct hue via a
    // stamp so we can compute the expected blend directly.
    const engine = createEngine({ width: 16, height: 16 });
    engine.set(0, 1, true); // left
    engine.set(1, 0, true); // top
    engine.set(2, 1, true); // right
    // Direct edits assign a spontaneous hue we don't control precisely, so
    // read back whatever they were actually assigned before computing the
    // expected blend — the point under test is the BLEND rule, not the
    // spontaneous-hue rule (covered separately in core-lineage.test.ts).
    const hLeft = engine.hueAt(0, 1);
    const hTop = engine.hueAt(1, 0);
    const hRight = engine.hueAt(2, 1);
    const sLeft = engine.speciesAt(0, 1);
    const sTop = engine.speciesAt(1, 0);
    const sRight = engine.speciesAt(2, 1);

    engine.step();

    expect(engine.get(1, 1)).toBe(true); // (1,1) has exactly the 3 neighbours above alive
    const expectedHue = circularMean3(hLeft, hTop, hRight);
    expect(engine.hueAt(1, 1)).toBeCloseTo(expectedHue, 3);
    expect(engine.speciesAt(1, 1)).toBe(quadSpeciesFromParents(sLeft, sTop, sRight));
  });

  it('a surviving cell keeps its own hue/species unchanged across a step', () => {
    // Block (still life): all 4 cells survive every generation unchanged.
    const engine = createEngine({ width: 16, height: 16 });
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) engine.set(x, y, true);
    const hues = [[4, 4], [5, 4], [4, 5], [5, 5]].map(([x, y]) => engine.hueAt(x, y));
    const species = [[4, 4], [5, 4], [4, 5], [5, 5]].map(([x, y]) => engine.speciesAt(x, y));
    engine.step();
    engine.step();
    engine.step();
    const huesAfter = [[4, 4], [5, 4], [4, 5], [5, 5]].map(([x, y]) => engine.hueAt(x, y));
    const speciesAfter = [[4, 4], [5, 4], [4, 5], [5, 5]].map(([x, y]) => engine.speciesAt(x, y));
    expect(huesAfter).toEqual(hues);
    expect(speciesAfter).toEqual(species);
  });

  it('death zeroes hue/species; the cell is reborn fresh next time it comes alive', () => {
    const engine = createEngine({ width: 16, height: 16 });
    engine.set(2, 2, true);
    expect(engine.hueAt(2, 2)).not.toBe(0); // spontaneous colour assigned
    engine.set(2, 2, false);
    expect(engine.hueAt(2, 2)).toBe(0);
    expect(engine.speciesAt(2, 2)).toBe(0);
  });
});

describe('liveNeighborCount: purely derived, agrees with a naive reference', () => {
  it('matches a brute-force count on a torus, including wraparound', () => {
    const engine = createEngine({ width: 8, height: 8 });
    engine.set(0, 0, true);
    engine.set(7, 0, true); // wraps to be a neighbour of (0,0)
    engine.set(0, 7, true); // also wraps
    expect(engine.liveNeighborCount(0, 0)).toBe(2);
  });
});

describe('snapshotColors / restoreColors: explicit round-trip, validated lengths', () => {
  it('round-trips hue/species exactly', () => {
    const engine = createEngine({ width: 8, height: 8 });
    engine.set(1, 1, true);
    engine.set(2, 2, true);
    const snap = engine.snapshotColors();
    engine.clear();
    expect(engine.hueAt(1, 1)).toBe(0);
    engine.restoreColors(snap);
    expect(engine.hueAt(1, 1)).toBe(snap.hue[1 * 8 + 1]);
    expect(engine.speciesAt(2, 2)).toBe(snap.species[2 * 8 + 2]);
  });

  it('throws on a length mismatch rather than corrupting state', () => {
    const engine = createEngine({ width: 8, height: 8 });
    expect(() => engine.restoreColors({ hue: new Float32Array(4), species: new Uint8Array(4) })).toThrow();
  });
});

describe('history.ts: colour is bit-exact across rewind and branching, exactly like bits', () => {
  it('goto() back to an earlier generation restores the EXACT hue/species that generation actually had, not a flat default', () => {
    const engine = createEngine({ width: 16, height: 16 });
    // Birth a cell with a known blend at gen 0 -> gen 1. Cells must be set
    // BEFORE the TimelineStore is constructed so its root keyframe (taken
    // at construction time) actually includes them — see `history.test.ts`'s
    // own fixtures for the same pattern.
    engine.set(0, 1, true);
    engine.set(1, 0, true);
    engine.set(2, 1, true);
    const history = createTimelineStore({ engine, keyframeInterval: 4 });
    engine.step();
    history.advance(engine.gen);
    const hueAtGen1 = engine.hueAt(1, 1);
    const speciesAtGen1 = engine.speciesAt(1, 1);
    expect(engine.get(1, 1)).toBe(true);

    // Advance further so gen 1 is no longer the live engine state, and far
    // enough to cross a keyframe boundary.
    for (let i = 0; i < 10; i++) { engine.step(); history.advance(engine.gen); }
    expect(engine.gen).toBe(11);

    return history.goto(1).then(() => {
      expect(engine.gen).toBe(1);
      expect(engine.get(1, 1)).toBe(true);
      expect(engine.hueAt(1, 1)).toBeCloseTo(hueAtGen1, 5);
      expect(engine.speciesAt(1, 1)).toBe(speciesAtGen1);
    });
  });

  it('branchFrom() carries the exact parent colour state at the fork point', async () => {
    const engine = createEngine({ width: 16, height: 16 });
    engine.set(0, 1, true);
    engine.set(1, 0, true);
    engine.set(2, 1, true);
    const history = createTimelineStore({ engine, keyframeInterval: 4 });
    engine.step();
    history.advance(engine.gen);
    const hueAtFork = engine.hueAt(1, 1);
    const speciesAtFork = engine.speciesAt(1, 1);

    const branchId = history.branchFrom(1, []);
    const branchEngine = await history.cloneBranchAt(branchId, 1);
    expect(branchEngine.get(1, 1)).toBe(true);
    expect(branchEngine.hueAt(1, 1)).toBeCloseTo(hueAtFork, 5);
    expect(branchEngine.speciesAt(1, 1)).toBe(speciesAtFork);
  });

  it('a keyframe captured mid-session (advance()) preserves colour for goto() straight to that generation', async () => {
    // A block still life: every cell survives unchanged forever, so its
    // (direct-edit, spontaneous) hue at generation 0 must still be exactly
    // the same at generation 4 (a keyframe boundary) after a goto() from
    // further ahead — a flat post-restore default would NOT reproduce it.
    const engine = createEngine({ width: 16, height: 16 });
    const history = createTimelineStore({ engine, keyframeInterval: 4 });
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) engine.set(x, y, true);
    const hueAtGen0 = engine.hueAt(4, 4);
    for (let i = 0; i < 4; i++) { engine.step(); history.advance(engine.gen); } // lands exactly on a keyframe gen (4)
    expect(engine.hueAt(4, 4)).toBeCloseTo(hueAtGen0, 5);
    for (let i = 0; i < 4; i++) { engine.step(); history.advance(engine.gen); }
    await history.goto(4);
    expect(engine.hueAt(4, 4)).toBeCloseTo(hueAtGen0, 5);
  });
});
