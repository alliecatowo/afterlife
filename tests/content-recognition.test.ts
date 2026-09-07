import { describe, expect, it } from 'vitest';
import { createEngine, transformPattern } from '@/core/engine';
import { scan } from '@/content/recognition';
import { SPECIMENS, toStampPattern } from '@/content/specimens';
import type { StampTransform } from '@/core/types';

const D4: StampTransform[] = [];
for (const flipX of [false, true]) {
  for (let rotate = 0 as 0 | 1 | 2 | 3; rotate < 4; rotate++) D4.push({ rotate, flipX, flipY: false });
}

describe('content: recognition', () => {
  it('exactly identifies a compact specimen (a block) scanned alone, with margin', () => {
    const engine = createEngine({ width: 40, height: 40 });
    const block = SPECIMENS.find((s) => s.name === 'block')!;
    engine.stamp(toStampPattern(block), 15, 15, { rotate: 0, flipX: false, flipY: false });

    const result = scan(engine, { x: 5, y: 5, w: 30, h: 30 });
    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0]!.status).toBe('named');
    expect(result.clusters[0]!.name).toBe('block');
    expect(result.clusters[0]!.category).toBe('still');
  });

  it('identifies a still life in every orientation and reflection', () => {
    const boat = SPECIMENS.find((s) => s.name === 'boat')!;
    const pattern = toStampPattern(boat);
    for (const t of D4) {
      const engine = createEngine({ width: 40, height: 40 });
      engine.stamp(pattern, 15, 15, t);
      const result = scan(engine, { x: 5, y: 5, w: 30, h: 30 });
      expect(result.clusters.length, JSON.stringify(t)).toBe(1);
      expect(result.clusters[0]!.name, JSON.stringify(t)).toBe('boat');
    }
  });

  it('identifies an oscillator at every phase of its period, isolated', () => {
    const toad = SPECIMENS.find((s) => s.name === 'toad')!;
    const engine = createEngine({ width: 40, height: 40 });
    engine.stamp(toStampPattern(toad), 15, 15, { rotate: 0, flipX: false, flipY: false });
    for (let phase = 0; phase < 2; phase++) {
      const result = scan(engine, { x: 5, y: 5, w: 30, h: 30 });
      expect(result.clusters.length, `phase ${phase}`).toBe(1);
      expect(result.clusters[0]!.status, `phase ${phase}`).toBe('named');
      expect(result.clusters[0]!.name, `phase ${phase}`).toBe('toad');
      expect(result.clusters[0]!.period, `phase ${phase}`).toBe(2);
      engine.step();
    }
  });

  it('identifies a spaceship (glider) while it is moving, and reports its translation', () => {
    const glider = SPECIMENS.find((s) => s.name === 'glider')!;
    const engine = createEngine({ width: 60, height: 60 });
    engine.stamp(toStampPattern(glider), 20, 20, { rotate: 0, flipX: false, flipY: false });
    for (let g = 0; g < 4; g++) engine.step();
    const result = scan(engine, { x: 5, y: 5, w: 50, h: 50 });
    expect(result.clusters.length).toBe(1);
    expect(result.clusters[0]!.name).toBe('glider');
    expect(result.clusters[0]!.translation).toEqual({ dx: 1, dy: 1 });
  });

  it('identifies a firing glider gun scanned at exactly its own footprint', () => {
    const gun = SPECIMENS.find((s) => s.name === 'gosper-glider-gun')!;
    const engine = createEngine({ width: 200, height: 150 });
    engine.stamp(toStampPattern(gun), 20, 20, { rotate: 0, flipX: false, flipY: false });
    const footprint = { x: 20, y: 20, w: gun.width, h: gun.height };
    // Just a handful of early phases, not the full 30-generation period.
    for (let phase = 0; phase < 5; phase++) {
      const result = scan(engine, footprint);
      expect(result.clusters.length, `phase ${phase}`).toBeGreaterThan(0);
      const named = result.clusters.find((c) => c.name === 'gosper-glider-gun');
      expect(named, `phase ${phase}: ${JSON.stringify(result.clusters)}`).toBeTruthy();
      engine.step();
    }
  });

  it('refuses to name a cluster with interference nearby (marks it unverified)', () => {
    const boat = SPECIMENS.find((s) => s.name === 'boat')!;
    const engine = createEngine({ width: 40, height: 40 });
    engine.stamp(toStampPattern(boat), 15, 15, { rotate: 0, flipX: false, flipY: false });
    // A single live cell just one cell away from the boat's bounding box.
    engine.set(19, 15, true);

    const result = scan(engine, { x: 5, y: 5, w: 30, h: 30 });
    // Whichever component(s) recognition finds, none may claim the name
    // "boat" — the interference means it cannot verify the isolated shape.
    const namedBoat = result.clusters.find((c) => c.status === 'named' && c.name === 'boat');
    expect(namedBoat).toBeUndefined();
  });

  it('refuses to name a genuinely unknown blob, but does not crash', () => {
    const engine = createEngine({ width: 40, height: 40 });
    // An arbitrary asymmetric splat with no relation to any curated specimen
    // and no periodicity within the observation window.
    const splat: Array<[number, number]> = [
      [15, 15], [16, 15], [18, 16], [15, 17], [19, 18], [16, 19], [20, 15],
    ];
    for (const [x, y] of splat) engine.set(x, y, true);

    const result = scan(engine, { x: 5, y: 5, w: 30, h: 30 });
    expect(result.clusters.length).toBeGreaterThan(0);
    for (const c of result.clusters) {
      expect(c.status === 'named').toBe(false);
    }
  });

  it('scan on an empty rect returns no clusters', () => {
    const engine = createEngine({ width: 20, height: 20 });
    const result = scan(engine, { x: 0, y: 0, w: 20, h: 20 });
    expect(result.clusters).toEqual([]);
  });
});
