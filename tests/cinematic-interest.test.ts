import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMORY_RADIUS,
  DEFAULT_MEMORY_TTL_MS,
  isRecentlyVisited,
  pickSubject,
  rankRegions,
  regionScore,
  type RegionSample,
  type VisitedMemoryEntry,
} from '@/ui/cinematic/interest';

function sample(overrides: Partial<RegionSample> = {}): RegionSample {
  return { x: 0, y: 0, w: 16, h: 16, population: 0, activity: 0, ...overrides };
}

describe('cinematic interest: regionScore', () => {
  it('gives dead, empty space a score of exactly zero regardless of activity noise', () => {
    expect(regionScore(sample({ population: 0, activity: 0 }))).toBe(0);
    // Even a stray nonzero activity reading over an otherwise-empty block
    // (shouldn't happen in practice — activity only rises with a live flip —
    // but the rule is explicit: no population, no interest) is excluded.
    expect(regionScore(sample({ population: 0, activity: 0.9 }))).toBe(0);
  });

  it('prefers active regions over dead ones at equal population', () => {
    const quiet = sample({ population: 20, activity: 0.01 }); // e.g. a field of still lifes
    const busy = sample({ population: 20, activity: 0.8 }); // sustained real change
    expect(regionScore(busy)).toBeGreaterThan(regionScore(quiet));
  });

  it('activity dominates over raw population density', () => {
    const denseButStill = sample({ population: 200, activity: 0 });
    const sparseButActive = sample({ population: 5, activity: 0.9 });
    expect(regionScore(sparseButActive)).toBeGreaterThan(regionScore(denseButStill));
  });

  it('a confirmed traveller outranks an equally-active non-traveller region', () => {
    const plain = sample({ population: 10, activity: 0.5 });
    const traveller = sample({ population: 10, activity: 0.5, hasTraveller: true });
    expect(regionScore(traveller)).toBeGreaterThan(regionScore(plain));
  });

  it('a confirmed traveller outranks even a very busy non-traveller region', () => {
    const veryBusy = sample({ population: 50, activity: 1 });
    const quietTraveller = sample({ population: 3, activity: 0.1, hasTraveller: true });
    expect(regionScore(quietTraveller)).toBeGreaterThan(regionScore(veryBusy));
  });
});

describe('cinematic interest: rankRegions', () => {
  it('sorts highest score first and includes empty (zero-score) regions', () => {
    const samples = [
      sample({ x: 0, population: 0, activity: 0 }),
      sample({ x: 16, population: 10, activity: 0.9 }),
      sample({ x: 32, population: 10, activity: 0.2 }),
    ];
    const ranked = rankRegions(samples);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.x).toBe(16);
    expect(ranked[1]!.x).toBe(32);
    expect(ranked[2]!.x).toBe(0);
    expect(ranked[2]!.score).toBe(0);
  });

  it('reports the region\'s toroidal-agnostic center', () => {
    const [ranked] = rankRegions([sample({ x: 10, y: 20, w: 16, h: 16, population: 1, activity: 1 })]);
    expect(ranked!.center).toEqual({ x: 18, y: 28 });
  });
});

describe('cinematic interest: pickSubject ignores empty space', () => {
  it('never picks a region with zero population, even if it is the only one', () => {
    const samples = [sample({ population: 0, activity: 0 })];
    const picked = pickSubject(samples, { nowMs: 0, memory: [] });
    expect(picked).toBeNull();
  });

  it('picks the only non-empty region among several dead ones', () => {
    const samples = [
      sample({ x: 0, population: 0 }),
      sample({ x: 16, population: 0 }),
      sample({ x: 32, population: 4, activity: 0.4 }),
    ];
    const picked = pickSubject(samples, { nowMs: 0, memory: [] });
    expect(picked?.x).toBe(32);
  });
});

describe('cinematic interest: memory prevents immediate revisits', () => {
  it('isRecentlyVisited is true within the default radius/TTL, false outside either', () => {
    const memory: VisitedMemoryEntry[] = [{ x: 100, y: 100, visitedAtMs: 1000 }];
    // Same spot, just inside the TTL.
    expect(isRecentlyVisited({ x: 100, y: 100 }, { nowMs: 1000 + DEFAULT_MEMORY_TTL_MS - 1, memory })).toBe(true);
    // Same spot, TTL just expired.
    expect(isRecentlyVisited({ x: 100, y: 100 }, { nowMs: 1000 + DEFAULT_MEMORY_TTL_MS + 1, memory })).toBe(false);
    // Far enough away, well within the TTL.
    expect(isRecentlyVisited({ x: 100 + DEFAULT_MEMORY_RADIUS * 3, y: 100 }, { nowMs: 1000, memory })).toBe(false);
  });

  it('does not immediately re-pick the just-visited top region when a fresh alternative exists', () => {
    const samples = [
      sample({ x: 0, y: 0, population: 20, activity: 0.9 }), // the best subject, just visited
      sample({ x: 200, y: 0, population: 10, activity: 0.3 }), // a decent, unvisited alternative
    ];
    const nowMs = 5000;
    const memory: VisitedMemoryEntry[] = [{ x: 8, y: 8, visitedAtMs: nowMs - 1000 }]; // center of the first block
    const picked = pickSubject(samples, { nowMs, memory });
    expect(picked?.x).toBe(200);
  });

  it('falls back to the top scorer rather than refusing to move when EVERYTHING is recently visited', () => {
    const samples = [sample({ x: 0, y: 0, population: 20, activity: 0.9 })];
    const nowMs = 5000;
    const memory: VisitedMemoryEntry[] = [{ x: 8, y: 8, visitedAtMs: nowMs - 1000 }];
    const picked = pickSubject(samples, { nowMs, memory });
    expect(picked).not.toBeNull();
    expect(picked?.x).toBe(0);
  });

  it('a visit far enough in the past (TTL expired) is fair game again', () => {
    const samples = [sample({ x: 0, y: 0, population: 20, activity: 0.9 })];
    const nowMs = DEFAULT_MEMORY_TTL_MS + 5000;
    const memory: VisitedMemoryEntry[] = [{ x: 8, y: 8, visitedAtMs: 0 }];
    const picked = pickSubject(samples, { nowMs, memory });
    expect(picked?.x).toBe(0);
  });

  it('is toroidally aware when a `world` shape is given — the far edge can be "close" by wrapping', () => {
    const world = { width: 256, height: 160 };
    // x=250 and x=2 are only 8 cells apart going the "short way" around the torus.
    const memory: VisitedMemoryEntry[] = [{ x: 250, y: 8, visitedAtMs: 0 }];
    expect(isRecentlyVisited({ x: 2, y: 8 }, { nowMs: 0, memory, world })).toBe(true);
    // Without wrap-awareness the same points would read as ~248 cells apart (not recent).
    expect(isRecentlyVisited({ x: 2, y: 8 }, { nowMs: 0, memory })).toBe(false);
  });
});
