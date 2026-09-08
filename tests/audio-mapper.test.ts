import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRONE_SHAPE, emptyAggregate, mapChurnToNotes, mapDrone, MAX_DENSITY, MIN_DENSITY,
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

describe('audio/mapper — drone is a function of real measured dynamics, not raw population', () => {
  it('is fully silent when nothing is happening, regardless of how large the population is', () => {
    // This is the core "paused/static/extinct -> silence" guarantee: a
    // world can be enormous, but with zero measured activity and motion the
    // drone must produce exactly zero gain — never a population-only floor.
    const idle = mapDrone({ activity: 0, motion: 0, population: 50000 });
    expect(idle.weight).toBe(0);
  });

  it('weight rises with activity and with motion independently', () => {
    const still = mapDrone({ activity: 0, motion: 0, population: 500 });
    const churning = mapDrone({ activity: 0.6, motion: 0, population: 500 });
    const travelling = mapDrone({ activity: 0, motion: 0.6, population: 500 });
    expect(churning.weight).toBeGreaterThan(still.weight);
    expect(travelling.weight).toBeGreaterThan(still.weight);
  });

  it('weight multiplier scales gain and is clamped to [0, 2]', () => {
    const inputs = { activity: 0.8, motion: 0.4, population: 2000 };
    const neutral = mapDrone(inputs, 0, { weight: 1, filterMinHz: 180, filterMaxHz: 2380 });
    const doubled = mapDrone(inputs, 0, { weight: 2, filterMinHz: 180, filterMaxHz: 2380 });
    const silenced = mapDrone(inputs, 0, { weight: 0, filterMinHz: 180, filterMaxHz: 2380 });
    const overdriven = mapDrone(inputs, 0, { weight: 99, filterMinHz: 180, filterMaxHz: 2380 });
    expect(doubled.weight).toBeCloseTo(neutral.weight * 2, 5);
    expect(silenced.weight).toBe(0);
    expect(overdriven.weight).toBeCloseTo(doubled.weight, 5); // clamped at 2x
  });

  it('respects a custom filter range and tolerates a swapped min/max', () => {
    const quiet = mapDrone({ activity: 0, motion: 0, population: 0 }, 0, { weight: 1, filterMinHz: 300, filterMaxHz: 3000 });
    const loud = mapDrone({ activity: 1, motion: 0, population: 2000 }, 0, { weight: 1, filterMinHz: 300, filterMaxHz: 3000 });
    expect(quiet.cutoffHz).toBeCloseTo(300, 0);
    expect(loud.cutoffHz).toBeCloseTo(3000, 0);

    const swapped = mapDrone({ activity: 1, motion: 0, population: 2000 }, 0, { weight: 1, filterMinHz: 3000, filterMaxHz: 300 });
    expect(swapped.cutoffHz).toBeCloseTo(3000, 0); // still resolves to the wider bound at full activity
  });

  it('motion widens the detune spread and population fills in the fifth partial', () => {
    const stillSparse = mapDrone({ activity: 0, motion: 0, population: 0 });
    const movingFull = mapDrone({ activity: 0, motion: 1, population: 5000 });
    expect(movingFull.spreadCents).toBeGreaterThan(stillSparse.spreadCents);
    expect(movingFull.fifthLevel).toBeGreaterThan(stillSparse.fifthLevel);
  });

  it('the fifth partial is always drawn from the same scale as the foreground notes', () => {
    for (const [, intervals] of Object.entries(SCALES)) {
      const scale = { tonic: 60, intervals };
      const { rootHz, fifthHz } = mapDrone({ activity: 1, motion: 0, population: 1000 }, 0, DEFAULT_DRONE_SHAPE, scale);
      const rootMidi = Math.round(69 + 12 * Math.log2(rootHz / 440));
      const fifthMidi = Math.round(69 + 12 * Math.log2(fifthHz / 440));
      expect(isInScale(rootMidi, scale.tonic, scale.intervals)).toBe(true);
      expect(isInScale(fifthMidi, scale.tonic, scale.intervals)).toBe(true);
    }
  });
});

describe('audio/mapper — tempo actually changes the churn rate, not just bucket length', () => {
  it('a shorter bucket (faster tempo) does not, by itself, make the SAME real churn read as quieter/sparser', () => {
    // Before the rate-based rewrite, a fixed count of births/deaths spread
    // over a shorter bucket produced strictly less "churn" per bucket,
    // which could cancel out — or even invert — the audible effect of
    // raising the tempo. Compare the same real per-second churn rate at two
    // very different bucket lengths (i.e. genuinely different tempos): both
    // should classify activity the same way, because the classifier now
    // reasons in units/second.
    const slowBucket = 60 / 40 / 2; // ~0.75s, a slow tempo
    const fastBucket = 60 / 160 / 2; // 0.1875s, the fastest tempo
    const churnPerSecond = 20;
    let slowNotes = 0;
    let fastNotes = 0;
    for (let gen = 0; gen < 300; gen++) {
      const slowAgg: BucketAggregate = { ...emptyAggregate(gen, 100), explicitChurn: churnPerSecond * slowBucket, populationDelta: 5 };
      const fastAgg: BucketAggregate = { ...emptyAggregate(gen, 100), explicitChurn: churnPerSecond * fastBucket, populationDelta: 5 };
      slowNotes += mapChurnToNotes(slowAgg, { bucketSeconds: slowBucket }).length;
      fastNotes += mapChurnToNotes(fastAgg, { bucketSeconds: fastBucket }).length;
    }
    // Same real activity rate -> same rough note density per bucket
    // (allowing for hashed-gate sampling noise), NOT the fast tempo reading
    // dramatically sparser just because its buckets are shorter.
    expect(fastNotes).toBeGreaterThan(0);
    expect(slowNotes).toBeGreaterThan(0);
    expect(Math.abs(fastNotes - slowNotes) / Math.max(fastNotes, slowNotes)).toBeLessThan(0.5);
  });

  it('at a fixed real churn RATE, a faster tempo produces more notes per second of wall time', () => {
    // This is the actual user-facing fix: raising the tempo should make the
    // instrument speak more often for the same amount of real activity,
    // because there are more (equally-likely-to-sound) buckets per second.
    const churnPerSecond = 8;
    const slowBucket = 60 / 40 / 2;
    const fastBucket = 60 / 160 / 2;
    let slowNotesPerSecond = 0;
    let fastNotesPerSecond = 0;
    const sampleGens = 400;
    for (let gen = 0; gen < sampleGens; gen++) {
      const slowAgg: BucketAggregate = { ...emptyAggregate(gen, 100), explicitChurn: churnPerSecond * slowBucket, populationDelta: 5 };
      const fastAgg: BucketAggregate = { ...emptyAggregate(gen, 100), explicitChurn: churnPerSecond * fastBucket, populationDelta: 5 };
      slowNotesPerSecond += mapChurnToNotes(slowAgg, { bucketSeconds: slowBucket }).length / slowBucket;
      fastNotesPerSecond += mapChurnToNotes(fastAgg, { bucketSeconds: fastBucket }).length / fastBucket;
    }
    expect(fastNotesPerSecond).toBeGreaterThan(slowNotesPerSecond);
  });
});
