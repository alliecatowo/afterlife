import { describe, expect, it } from 'vitest';
import {
  emptyAggregate, mapChurnToNotes, mapDrone, MAX_DENSITY, MIN_DENSITY,
  type BucketAggregate,
} from '@/audio/mapper';
import { isInScale, SCALES } from '@/audio/scale';
import type { DiscoveryEvent } from '@/core/types';
import { mapDiscoveryToNotes, mapAuditionToNote } from '@/audio/mapper';

function aggWithChurn(explicitChurn: number, gen = 1): BucketAggregate {
  return { ...emptyAggregate(gen, 100), explicitChurn, populationDelta: 5 };
}

describe('audio/mapper — density tuning', () => {
  it('a higher density setting produces at least as many notes as the default for the same activity', () => {
    // Use a broad sample of gens/activity levels since individual buckets
    // have deterministic-but-sparse hashed gating (see `churnDensity`).
    let higherAtLeastAsLoud = 0;
    for (let gen = 0; gen < 200; gen++) {
      const agg = aggWithChurn(3, gen);
      const base = mapChurnToNotes(agg, { density: 1 }).length;
      const boosted = mapChurnToNotes(agg, { density: MAX_DENSITY }).length;
      if (boosted >= base) higherAtLeastAsLoud++;
    }
    expect(higherAtLeastAsLoud).toBe(200);
  });

  it('clamps out-of-range density to the documented bounds rather than misbehaving', () => {
    const agg = aggWithChurn(50, 5);
    const tooLow = mapChurnToNotes(agg, { density: -10 });
    const tooHigh = mapChurnToNotes(agg, { density: 1000 });
    const atMin = mapChurnToNotes(agg, { density: MIN_DENSITY });
    const atMax = mapChurnToNotes(agg, { density: MAX_DENSITY });
    expect(tooLow).toEqual(atMin);
    expect(tooHigh).toEqual(atMax);
  });

  it('is deterministic in gen: the same aggregate always produces the same notes', () => {
    const agg = aggWithChurn(20, 42);
    const a = mapChurnToNotes(agg, { density: 1.5 });
    const b = mapChurnToNotes(agg, { density: 1.5 });
    expect(a).toEqual(b);
  });
});

describe('audio/mapper — decay scales note duration', () => {
  it('doubling decay roughly doubles churn note durations', () => {
    const agg = aggWithChurn(50, 7);
    const base = mapChurnToNotes(agg, { density: 1, decay: 1 });
    const doubled = mapChurnToNotes(agg, { density: 1, decay: 2 });
    expect(doubled.length).toBe(base.length);
    for (let i = 0; i < base.length; i++) {
      expect(doubled[i]!.duration).toBeCloseTo(base[i]!.duration * 2, 5);
    }
  });
});

describe('audio/mapper — alternate scales stay in-scale', () => {
  it('every note produced for every scale mode satisfies isInScale for that mode', () => {
    for (const [mode, intervals] of Object.entries(SCALES)) {
      const scale = { tonic: 60, intervals };
      const agg = aggWithChurn(80, 3);
      const notes = mapChurnToNotes(agg, { scale });
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(isInScale(n.pitch, 60, intervals)).toBe(true);

      const discovery: DiscoveryEvent = { id: 'd', kind: 'explosion', gen: 3, rect: { x: 0, y: 0, w: 2, h: 2 }, label: 'x' };
      for (const n of mapDiscoveryToNotes(discovery, scale)) expect(isInScale(n.pitch, 60, intervals)).toBe(true);
      expect(isInScale(mapAuditionToNote(3, scale).pitch, 60, intervals)).toBe(true);
      void mode;
    }
  });
});

describe('audio/mapper — drone shape', () => {
  it('weight multiplier scales gain and is clamped to [0, 2]', () => {
    const neutral = mapDrone(2000, 0, { weight: 1, filterMinHz: 180, filterMaxHz: 2380 });
    const doubled = mapDrone(2000, 0, { weight: 2, filterMinHz: 180, filterMaxHz: 2380 });
    const silenced = mapDrone(2000, 0, { weight: 0, filterMinHz: 180, filterMaxHz: 2380 });
    const overdriven = mapDrone(2000, 0, { weight: 99, filterMinHz: 180, filterMaxHz: 2380 });
    expect(doubled.weight).toBeCloseTo(neutral.weight * 2, 5);
    expect(silenced.weight).toBe(0);
    expect(overdriven.weight).toBeCloseTo(doubled.weight, 5); // clamped at 2x
  });

  it('respects a custom filter range and tolerates a swapped min/max', () => {
    const quiet = mapDrone(0, 0, { weight: 1, filterMinHz: 300, filterMaxHz: 3000 });
    const loud = mapDrone(2000, 0, { weight: 1, filterMinHz: 300, filterMaxHz: 3000 });
    expect(quiet.cutoffHz).toBeCloseTo(300, 0);
    expect(loud.cutoffHz).toBeCloseTo(3000, 0);

    const swapped = mapDrone(2000, 0, { weight: 1, filterMinHz: 3000, filterMaxHz: 300 });
    expect(swapped.cutoffHz).toBeCloseTo(3000, 0); // still resolves to the wider bound at full population
  });
});
