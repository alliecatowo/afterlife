import { describe, expect, it } from 'vitest';
import { createEngine, normalizeRect, transformPattern, wrap } from '@/core/engine';
import type { StampPattern, StampTransform } from '@/core/types';
import { IDENTITY_TRANSFORM } from '@/core/types';

/** Build a fresh engine and light up the given (x, y) cells. */
function makeWorld(width: number, height: number, cells: Array<[number, number]>) {
  const engine = createEngine({ width, height });
  for (const [x, y] of cells) engine.set(x, y, true);
  return engine;
}

function liveSet(engine: ReturnType<typeof createEngine>, rect = { x: 0, y: 0, w: engine.spec.width, h: engine.spec.height }): Set<string> {
  const out = new Set<string>();
  engine.forEachLive(rect, (x, y) => {
    out.add(`${x},${y}`);
  });
  return out;
}

function cellsToKeySet(cells: Array<[number, number]>): Set<string> {
  return new Set(cells.map(([x, y]) => `${x},${y}`));
}

function expectSameShape(engine: ReturnType<typeof createEngine>, cells: Array<[number, number]>): void {
  expect(liveSet(engine)).toEqual(cellsToKeySet(cells));
}

describe('wrap / normalizeRect', () => {
  it('wraps positive and negative values with floor-mod semantics', () => {
    expect(wrap(0, 10)).toBe(0);
    expect(wrap(9, 10)).toBe(9);
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(-10, 10)).toBe(0);
    expect(wrap(-11, 10)).toBe(9);
    expect(wrap(23, 10)).toBe(3);
  });

  it('normalizes negative w/h into positive rects anchored correctly', () => {
    expect(normalizeRect({ x: 5, y: 5, w: -3, h: -2 })).toEqual({ x: 2, y: 3, w: 3, h: 2 });
    expect(normalizeRect({ x: 0, y: 0, w: 4, h: 4 })).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });
});

describe('still lifes are stable', () => {
  const patterns: Record<string, Array<[number, number]>> = {
    block: [[0, 0], [1, 0], [0, 1], [1, 1]],
    beehive: [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]],
    loaf: [[1, 0], [0, 1], [2, 1], [0, 2], [3, 2], [1, 3], [2, 3]],
    boat: [[1, 0], [0, 1], [2, 1], [1, 2], [2, 2]],
    tub: [[1, 0], [0, 1], [2, 1], [1, 2]],
  };

  for (const [name, cells] of Object.entries(patterns)) {
    it(`${name} is unchanged after 10 generations (centered, away from torus seam)`, () => {
      const engine = makeWorld(32, 32, cells.map(([x, y]) => [x + 10, y + 10]));
      const before = liveSet(engine);
      for (let i = 0; i < 10; i++) engine.step();
      expect(liveSet(engine)).toEqual(before);
      expect(engine.population).toBe(cells.length);
    });
  }
});

describe('oscillators return to their exact initial state after their period', () => {
  const cases: Array<{ name: string; period: number; cells: Array<[number, number]> }> = [
    { name: 'blinker', period: 2, cells: [[0, 0], [1, 0], [2, 0]] },
    { name: 'toad', period: 2, cells: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]] },
    { name: 'beacon', period: 2, cells: [[0, 0], [1, 0], [0, 1], [3, 2], [2, 3], [3, 3]] },
    {
      name: 'pulsar',
      period: 3,
      cells: (() => {
        const tripleRows = [0, 5, 7, 12];
        const tripleCols = [2, 3, 4, 8, 9, 10];
        const singleRows = [2, 3, 4, 8, 9, 10];
        const singleCols = [0, 5, 7, 12];
        const out: Array<[number, number]> = [];
        for (const y of tripleRows) for (const x of tripleCols) out.push([x, y]);
        for (const y of singleRows) for (const x of singleCols) out.push([x, y]);
        return out;
      })(),
    },
    {
      name: 'pentadecathlon',
      period: 15,
      cells: [
        [2, 0], [7, 0],
        [0, 1], [1, 1], [3, 1], [4, 1], [5, 1], [6, 1], [8, 1], [9, 1],
        [2, 2], [7, 2],
      ],
    },
  ];

  for (const { name, period, cells } of cases) {
    it(`${name} returns to its exact initial state after ${period} generations`, () => {
      const engine = makeWorld(48, 48, cells.map(([x, y]) => [x + 15, y + 15]));
      const before = liveSet(engine);
      const beforePop = engine.population;
      for (let i = 0; i < period; i++) engine.step();
      expect(liveSet(engine)).toEqual(before);
      expect(engine.population).toBe(beforePop);
    });

    it(`${name} is NOT the same at every intermediate generation before its period elapses`, () => {
      const engine = makeWorld(48, 48, cells.map(([x, y]) => [x + 15, y + 15]));
      const before = liveSet(engine);
      let sawDifference = false;
      for (let i = 1; i < period; i++) {
        engine.step();
        if (!setsEqual(liveSet(engine), before)) sawDifference = true;
      }
      expect(sawDifference).toBe(true);
    });
  }
});

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

describe('glider', () => {
  // Canonical down-right moving glider.
  const gliderCells: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];

  it('translates by exactly (1, 1) after 4 generations', () => {
    const ox = 10;
    const oy = 10;
    const engine = makeWorld(64, 64, gliderCells.map(([x, y]) => [x + ox, y + oy]));
    for (let i = 0; i < 4; i++) engine.step();
    const expected = cellsToKeySet(gliderCells.map(([x, y]) => [x + ox + 1, y + oy + 1]));
    expect(liveSet(engine)).toEqual(expected);
    expect(engine.population).toBe(gliderCells.length);
  });

  it('returns to its exact starting position after 4 * width generations on the torus (wrap test)', () => {
    const width = 24;
    const height = 24;
    const ox = 3;
    const oy = 3;
    const engine = makeWorld(width, height, gliderCells.map(([x, y]) => [x + ox, y + oy]));
    const before = liveSet(engine);
    const gens = 4 * width;
    for (let i = 0; i < gens; i++) engine.step();
    expect(liveSet(engine)).toEqual(before);
    expect(engine.gen).toBe(gens);
  });
});

describe('toroidal wrap at edges and corners', () => {
  it('a glider crossing every edge and corner keeps constant population (bonus wrap smoke test)', () => {
    const gliderCells: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    const width = 16;
    const height = 16;
    // Place it near the top-left corner so it immediately crosses both seams.
    const engine = makeWorld(width, height, gliderCells.map(([x, y]) => [wrap(x - 1, width), wrap(y - 1, height)]));
    const pops: number[] = [];
    for (let i = 0; i < 4 * width * height; i++) {
      engine.step();
      pops.push(engine.population);
    }
    expect(pops.every((p) => p === 5)).toBe(true);
  });

  it('a still life placed exactly on the seam (spanning all four edges) is stable', () => {
    const width = 20;
    const height = 20;
    // Block straddling the top-left corner: cells at (-1,-1),(0,-1),(-1,0),(0,0) wrap to
    // (w-1,h-1),(0,h-1),(w-1,0),(0,0) — touching all four edges and the corner.
    const engine = createEngine({ width, height });
    engine.set(-1, -1, true);
    engine.set(0, -1, true);
    engine.set(-1, 0, true);
    engine.set(0, 0, true);
    const before = liveSet(engine);
    for (let i = 0; i < 5; i++) engine.step();
    expect(liveSet(engine)).toEqual(before);
  });

  it('get/set wrap for arbitrary large and negative coordinates', () => {
    const engine = createEngine({ width: 10, height: 10 });
    engine.set(23, -7, true);
    expect(engine.get(3, 3)).toBe(true);
    expect(engine.get(23, -7)).toBe(true);
    expect(engine.get(13, 13)).toBe(true);
  });
});

describe('Gosper glider gun', () => {
  const gunCells: Array<[number, number]> = [
    [24, 0],
    [22, 1], [24, 1],
    [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
    [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3],
    [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5],
    [10, 6], [16, 6], [24, 6],
    [11, 7], [15, 7],
    [12, 8], [13, 8],
  ];

  it('has 36 live cells at generation 0', () => {
    expect(gunCells.length).toBe(36);
  });

  it('produces population growth roughly every 30 generations (emits gliders) over 120 gens', () => {
    const width = 200;
    const height = 200;
    const engine = makeWorld(width, height, gunCells.map(([x, y]) => [x + 20, y + 20]));
    const startPop = engine.population;
    const pops: number[] = [startPop];
    for (let i = 0; i < 120; i++) {
      engine.step();
      pops.push(engine.population);
    }
    // The gun itself never dies out, and after emitting a few gliders the
    // population should have grown well beyond the initial 36 cells (each
    // free glider contributes 5 more live cells roughly every 30 gens).
    expect(Math.max(...pops)).toBeGreaterThan(startPop);
    expect(pops[120]).toBeGreaterThan(startPop);
    // Population should never collapse to zero or explode unboundedly for a
    // sane, bounded run — sanity bound generous enough to allow several
    // gliders in flight simultaneously.
    expect(pops.every((p) => p > 0 && p < startPop + 5 * 10)).toBe(true);
  });
});

describe('seed() reproducibility', () => {
  it('same seed + density + size gives an identical buffer', () => {
    const a = createEngine({ width: 30, height: 30 });
    const b = createEngine({ width: 30, height: 30 });
    a.seed('afterlife', 0.35);
    b.seed('afterlife', 0.35);
    expect(a.snapshot().bits).toEqual(b.snapshot().bits);
    expect(a.population).toBe(b.population);
  });

  it('different seeds give different buffers', () => {
    const a = createEngine({ width: 30, height: 30 });
    const b = createEngine({ width: 30, height: 30 });
    a.seed('seed-one', 0.35);
    b.seed('seed-two', 0.35);
    expect(a.snapshot().bits).not.toEqual(b.snapshot().bits);
  });

  it('resets gen to 0 and clears age/activity', () => {
    const engine = createEngine({ width: 10, height: 10 });
    engine.set(1, 1, true);
    engine.step();
    engine.seed(42, 0.5);
    expect(engine.gen).toBe(0);
  });
});

describe('snapshot / restore round-trip', () => {
  it('is bit-identical and restores gen', () => {
    const engine = createEngine({ width: 20, height: 20 });
    engine.seed('round-trip', 0.4);
    for (let i = 0; i < 5; i++) engine.step();
    const snap = engine.snapshot();
    const genBefore = engine.gen;

    for (let i = 0; i < 5; i++) engine.step();
    expect(engine.gen).not.toBe(genBefore);

    engine.restore(snap);
    expect(engine.gen).toBe(genBefore);
    expect(engine.snapshot().bits).toEqual(snap.bits);
    expect(engine.population).toBe([...snap.bits].filter((b) => b === 1).length);
  });

  it('snapshot bits is a fresh buffer, never aliased with live state', () => {
    const engine = createEngine({ width: 8, height: 8 });
    engine.set(1, 1, true);
    const snap = engine.snapshot();
    engine.set(2, 2, true);
    expect(snap.bits[2 * 8 + 2]).toBe(0);
  });

  it('restore throws on mismatched buffer length', () => {
    const engine = createEngine({ width: 8, height: 8 });
    expect(() => engine.restore({ gen: 0, bits: new Uint8Array(10) })).toThrow();
  });

  it('clone produces an independent engine with identical state', () => {
    const engine = createEngine({ width: 12, height: 12 });
    engine.seed('clone-me', 0.3);
    engine.step();
    const clone = engine.clone();
    expect(clone.snapshot().bits).toEqual(engine.snapshot().bits);
    expect(clone.gen).toBe(engine.gen);
    clone.set(0, 0, !clone.get(0, 0));
    // Mutating the clone must not affect the original.
    expect(clone.get(0, 0)).not.toBe(engine.get(0, 0));
  });
});

describe('age and activity lenses', () => {
  it('ageAt increments while continuously alive and resets to 0 on death', () => {
    // Block (still life): stays alive forever, age should climb.
    const engine = makeWorld(10, 10, [[1, 1], [2, 1], [1, 2], [2, 2]]);
    expect(engine.ageAt(1, 1)).toBe(1);
    engine.step();
    expect(engine.ageAt(1, 1)).toBe(2);
    engine.step();
    expect(engine.ageAt(1, 1)).toBe(3);
    // Kill it directly.
    engine.set(1, 1, false);
    expect(engine.ageAt(1, 1)).toBe(0);
  });

  it('activityAt is 1.0 immediately after a flip and decays toward 0', () => {
    const engine = createEngine({ width: 10, height: 10, activityDecay: 0.5 });
    engine.set(5, 5, true);
    expect(engine.activityAt(5, 5)).toBeCloseTo(1, 5);
    // Isolated single cell dies next step (0 neighbours) — still a flip, still 1.0.
    engine.step();
    expect(engine.activityAt(5, 5)).toBeCloseTo(1, 5);
    engine.step();
    // No further flip: decays by the configured factor.
    expect(engine.activityAt(5, 5)).toBeLessThan(1);
  });
});

describe('region / forEachLive', () => {
  it('region wraps toroidally and matches get()', () => {
    const engine = createEngine({ width: 10, height: 10 });
    engine.set(-1, -1, true);
    engine.set(5, 5, true);
    const region = engine.region({ x: -2, y: -2, w: 4, h: 4 });
    // rect covers world x in [-2,1] -> wrapped [8,9,0,1], y likewise.
    // (-1,-1) wraps to (9,9) which is at local (1,1) in this rect.
    expect(region[1 * 4 + 1]).toBe(1);
  });

  it('forEachLive stops early when the callback returns false', () => {
    const engine = makeWorld(10, 10, [[0, 0], [1, 0], [2, 0], [3, 0]]);
    let count = 0;
    engine.forEachLive({ x: 0, y: 0, w: 10, h: 10 }, () => {
      count++;
      return count < 2;
    });
    expect(count).toBe(2);
  });
});

describe('clear', () => {
  it('kills everything and resets gen', () => {
    const engine = createEngine({ width: 10, height: 10 });
    engine.seed('clear-me', 0.5);
    engine.step();
    engine.clear();
    expect(engine.population).toBe(0);
    expect(engine.gen).toBe(0);
    expect(engine.snapshot().bits.every((b) => b === 0)).toBe(true);
  });
});

describe('transformPattern', () => {
  // Asymmetric L-tromino-ish 3x2 pattern:
  // X . .
  // X X .
  const base: StampPattern = {
    name: 'test',
    w: 3,
    h: 2,
    cells: Uint8Array.from([1, 0, 0, 1, 1, 0]),
  };

  function grid(p: StampPattern): number[][] {
    const rows: number[][] = [];
    for (let y = 0; y < p.h; y++) {
      const row: number[] = [];
      for (let x = 0; x < p.w; x++) row.push(p.cells[y * p.w + x]!);
      rows.push(row);
    }
    return rows;
  }

  it('identity transform returns the same shape', () => {
    const t = transformPattern(base, IDENTITY_TRANSFORM);
    expect(t.w).toBe(3);
    expect(t.h).toBe(2);
    expect(grid(t)).toEqual(grid(base));
  });

  it('rotate 90 clockwise matches a hand-computed expectation', () => {
    const t = transformPattern(base, { rotate: 1, flipX: false, flipY: false });
    // Original:      Rotated 90 CW (3x2 -> 2x3):
    // X . .           X X
    // X X .           . X
    //                 . .
    expect(t.w).toBe(2);
    expect(t.h).toBe(3);
    expect(grid(t)).toEqual([
      [1, 1],
      [1, 0],
      [0, 0],
    ]);
  });

  it('rotate 180 matches a hand-computed expectation', () => {
    const t = transformPattern(base, { rotate: 2, flipX: false, flipY: false });
    expect(t.w).toBe(3);
    expect(t.h).toBe(2);
    expect(grid(t)).toEqual([
      [0, 1, 1],
      [0, 0, 1],
    ]);
  });

  it('rotate 270 clockwise matches a hand-computed expectation', () => {
    const t = transformPattern(base, { rotate: 3, flipX: false, flipY: false });
    expect(t.w).toBe(2);
    expect(t.h).toBe(3);
    expect(grid(t)).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('flipX (mirror across vertical axis) matches a hand-computed expectation', () => {
    const t = transformPattern(base, { rotate: 0, flipX: true, flipY: false });
    expect(grid(t)).toEqual([
      [0, 0, 1],
      [0, 1, 1],
    ]);
  });

  it('flipY (mirror across horizontal axis) matches a hand-computed expectation', () => {
    const t = transformPattern(base, { rotate: 0, flipX: false, flipY: true });
    expect(grid(t)).toEqual([
      [1, 1, 0],
      [1, 0, 0],
    ]);
  });

  it('flipX + flipY (180 point reflection) matches flipping both axes', () => {
    const t = transformPattern(base, { rotate: 0, flipX: true, flipY: true });
    expect(grid(t)).toEqual([
      [0, 1, 1],
      [0, 0, 1],
    ]);
  });

  it('flip then rotate matches a hand-computed expectation (flip applied before rotation)', () => {
    const t = transformPattern(base, { rotate: 1, flipX: true, flipY: false });
    // flipX first: 0 0 1 / 0 1 1, then rotate 90 CW (3x2 -> 2x3).
    expect(t.w).toBe(2);
    expect(t.h).toBe(3);
    expect(grid(t)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('rotating four times returns the original pattern', () => {
    let t = base;
    for (let i = 0; i < 4; i++) t = transformPattern(t, { rotate: 1, flipX: false, flipY: false });
    expect(t.w).toBe(base.w);
    expect(t.h).toBe(base.h);
    expect(grid(t)).toEqual(grid(base));
  });

  it('all 8 transforms produce a footprint stamp() actually uses (ghost matches stamp)', () => {
    const engine = createEngine({ width: 20, height: 20 });
    const transforms: StampTransform[] = [
      { rotate: 0, flipX: false, flipY: false },
      { rotate: 1, flipX: false, flipY: false },
      { rotate: 2, flipX: false, flipY: false },
      { rotate: 3, flipX: false, flipY: false },
      { rotate: 0, flipX: true, flipY: false },
      { rotate: 1, flipX: true, flipY: false },
      { rotate: 0, flipX: false, flipY: true },
      { rotate: 1, flipX: false, flipY: true },
    ];
    for (const t of transforms) {
      engine.clear();
      engine.stamp(base, 2, 2, t);
      const expected = transformPattern(base, t);
      const region = engine.region({ x: 2, y: 2, w: expected.w, h: expected.h });
      expect(region).toEqual(expected.cells);
    }
  });
});
