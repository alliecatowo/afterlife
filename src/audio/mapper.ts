/**
 * Pure musical mapping: turns aggregated simulation activity into
 * `NoteRequest`s and drone parameters. No Web Audio, no timers — a straight
 * function of data, fully unit-testable.
 *
 * Event -> sound mapping (see DESIGN.md "precision musical instrument"):
 *  - Birth/death churn this bucket -> note DENSITY (how many voices, 0-3) and
 *    REGISTER (growth reaches upward, decline settles downward), quantised to
 *    the fixed pentatonic scale. Silence is the default; only real, sustained
 *    churn produces more than an occasional single note.
 *  - Population level -> a continuous drone's low-pass filter cutoff and
 *    gain weight (more life = brighter, fuller; a quiet world is near-silent).
 *  - Population-centroid drift (when the integration layer supplies it via a
 *    `tick` event's optional `centroid`) -> stereo pan of the churn voices.
 *    Without centroid data the mapping degrades honestly to a centred pan
 *    rather than fabricating movement.
 *  - A `DiscoveryEvent` -> exactly one sparse, distinct accent motif, panned
 *    from the discovery's real world rect, timbre varying by kind.
 */
import type { DiscoveryEvent, Generation } from '@/core/types';
import { hash01, quantizeToScale } from './scale';
import type { NoteRequest } from './scheduler';

export interface BucketAggregate {
  gen: Generation;
  population: number;
  /** population(gen) - population(gen at start of previous flushed bucket),
   * from the always-present `gen:changed` bus signal. */
  populationDelta: number;
  /** Sum of explicit birth+death counts fed for this bucket, when the
   * integration layer supplies them (`feed()`). `undefined` if not fed —
   * `resolveChurn` then falls back to `|populationDelta|` so churn is never
   * double-counted from both sources at once. */
  explicitChurn?: number;
  /** Optional real centroid-of-life position in world cells, if supplied. */
  centroid?: { x: number; y: number };
  /** Centroid drift since the last bucket that had a centroid, in cells. */
  centroidDelta?: { x: number; y: number };
}

export function emptyAggregate(gen: Generation, population: number): BucketAggregate {
  return { gen, population, populationDelta: 0 };
}

/** The magnitude of activity to sound this bucket: explicit birth+death
 * counts if fed, else the honest fallback of net population change. Never
 * sums both — that would double-count the same underlying churn. */
export function resolveChurn(agg: BucketAggregate): number {
  return agg.explicitChurn ?? Math.abs(agg.populationDelta);
}

export interface DroneParams {
  /** Low-pass cutoff in Hz. Quiet worlds are dark/muffled; dense worlds open up. */
  cutoffHz: number;
  /** 0..1 drone gain weight. */
  weight: number;
  /** -1..1 stereo pan, driven by population-centroid drift when available. */
  pan: number;
}

/** Population is unbounded in principle; we only need a sane knee so the
 * mapping is stable for both a handful of cells and a dense 256x160 world. */
const POPULATION_KNEE = 2000;

export function mapDrone(population: number, pan = 0): DroneParams {
  const t = Math.min(1, population / POPULATION_KNEE);
  const cutoffHz = 180 + t * 2200; // 180Hz (muffled) .. 2380Hz (open)
  const weight = 0.05 + t * 0.35; // always faint, never a loud pad
  return { cutoffHz, weight, pan };
}

/** Squash an unbounded cell-space drift into a restrained pan value. Never
 * hard left/right — DESIGN.md wants restraint, not a ping-pong effect. */
export function mapCentroidDriftToPan(dx: number): number {
  return Math.tanh(dx / 8) * 0.6;
}

const CHURN_NOTE_THRESHOLDS = [1, 6, 40, 150] as const; // -> 0/1/2/3 voices (see below)

/** How many churn voices this bucket should attempt, 0..3. Below the first
 * threshold we still only fire occasionally (silence is the default). */
function churnDensity(agg: BucketAggregate): number {
  const c = resolveChurn(agg);
  if (c <= 0) return 0;
  if (c < CHURN_NOTE_THRESHOLDS[0]!) return 0;
  if (c < CHURN_NOTE_THRESHOLDS[1]!) {
    // Sparse: only about 1 in 3 quiet buckets actually sounds.
    return hash01(agg.gen, 1) < 0.33 ? 1 : 0;
  }
  if (c < CHURN_NOTE_THRESHOLDS[2]!) return 1;
  if (c < CHURN_NOTE_THRESHOLDS[3]!) return 2;
  return 3;
}

/**
 * Map one closed bucket's aggregate activity to 0..3 churn `NoteRequest`s.
 * Pure and deterministic in `agg.gen` so the same run always plays the same
 * phrase — an instrument, not noise.
 */
export function mapChurnToNotes(agg: BucketAggregate): NoteRequest[] {
  const count = churnDensity(agg);
  if (count === 0) return [];

  const growing = agg.populationDelta >= 0;
  const magnitude = Math.log2(1 + Math.abs(agg.populationDelta));
  const baseStep = (growing ? 1 : -1) * Math.min(10, Math.round(magnitude));
  const pan = agg.centroidDelta
    ? mapCentroidDriftToPan(agg.centroidDelta.x)
    : (hash01(agg.gen, 7) - 0.5) * 0.4; // gentle, deterministic, honestly "no data" fallback

  const notes: NoteRequest[] = [];
  for (let i = 0; i < count; i++) {
    const variation = Math.floor(hash01(agg.gen, 11 + i) * 7) - 3; // -3..+3 steps
    const step = baseStep + variation;
    const pitch = quantizeToScale(step);
    const velocity = 0.14 + Math.min(0.28, magnitude * 0.05);
    notes.push({
      pitch,
      velocity,
      pan: Math.max(-0.7, Math.min(0.7, pan + (hash01(agg.gen, 20 + i) - 0.5) * 0.15)),
      duration: 0.9 + hash01(agg.gen, 30 + i) * 0.9,
      timbre: hash01(agg.gen, 40 + i) < 0.35 ? 'glass' : 'mallet',
      source: 'churn',
      priority: 1,
    });
  }
  return notes;
}

/** One sparse, distinct accent per discovery. Panned from the discovery's
 * real world rect (its own data, not a fabricated value). */
export function mapDiscoveryToNotes(discovery: DiscoveryEvent): NoteRequest[] {
  const cx = discovery.rect.x + discovery.rect.w / 2;
  const cy = discovery.rect.y + discovery.rect.h / 2;
  const pan = Math.max(-0.8, Math.min(0.8, (hash01(Math.round(cx), Math.round(cy)) - 0.5) * 1.6));

  switch (discovery.kind) {
    case 'extinction':
      // A slow, single low tone fading out — the lineage ending.
      return [{
        pitch: quantizeToScale(-5),
        velocity: 0.3,
        pan,
        duration: 3.2,
        timbre: 'pad',
        source: 'discovery',
        priority: 5,
      }];
    case 'explosion':
      // A quick bright upward flurry, still capped at 3 voices by the pool.
      return [0, 1, 2].map((i) => ({
        pitch: quantizeToScale(4 + i * 2),
        velocity: 0.32 - i * 0.04,
        pan,
        duration: 0.6,
        timbre: 'glass' as const,
        source: 'discovery' as const,
        priority: 5,
      }));
    case 'stability':
      // A warm, sustained two-note interval settling into periodicity.
      return [0, 1].map((i) => ({
        pitch: quantizeToScale(0 + i * 2),
        velocity: 0.22,
        pan,
        duration: 4.0,
        timbre: 'pad' as const,
        source: 'discovery' as const,
        priority: 4,
      }));
    case 'oscillator':
    case 'spaceship':
      // A two-note ping matching the discovery's own period, when known.
      return [{
        pitch: quantizeToScale(6),
        velocity: 0.26,
        pan,
        duration: Math.min(2.5, 0.5 + (discovery.period ?? 2) * 0.1),
        timbre: 'glass',
        source: 'discovery',
        priority: 4,
      }];
    case 'still-life':
    default:
      return [{
        pitch: quantizeToScale(2),
        velocity: 0.2,
        pan,
        duration: 1.4,
        timbre: 'mallet',
        source: 'discovery',
        priority: 3,
      }];
  }
}

/** Sparse, slower rendering used only in "audition" mode while scrubbing:
 * one note per invocation, pitch quantised from the target generation so
 * scrubbing to the same place always sounds the same. */
export function mapAuditionToNote(gen: Generation): NoteRequest {
  const step = Math.floor(hash01(gen, 99) * 10) - 5;
  return {
    pitch: quantizeToScale(step),
    velocity: 0.18,
    pan: 0,
    duration: 1.1,
    timbre: 'glass',
    source: 'audition',
    priority: 2,
  };
}
