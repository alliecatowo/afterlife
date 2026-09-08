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
import { hash01, quantizeToScale, SCALE_INTERVALS, TONIC_MIDI } from './scale';
import type { NoteRequest } from './scheduler';

/** The tonal centre + interval set a call should quantise against. Defaults
 * to the original fixed A3 pentatonic so every existing call site (and every
 * existing test) is unaffected; the audio panel's scale/root controls thread
 * a different one through `SoundscapeBrain`. */
export interface ScaleContext {
  tonic: number;
  intervals: readonly number[];
}

export const DEFAULT_SCALE_CONTEXT: ScaleContext = { tonic: TONIC_MIDI, intervals: SCALE_INTERVALS };

function q(step: number, scale: ScaleContext, lowStep?: number, highStep?: number): number {
  return quantizeToScale(
    step,
    lowStep,
    highStep,
    scale.tonic,
    scale.intervals,
  );
}

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

/** Panel-tunable drone shape. Defaults reproduce the original fixed mapping
 * exactly. `weight` is a 0..2 multiplier on the computed gain (never
 * unbounded — clamped below so the drone can be muted down or leaned into,
 * but never turned into a loud pad, preserving DESIGN's "always faint"
 * intent even at the top of the slider). `filterMinHz`/`filterMaxHz` let the
 * panel narrow or widen the cutoff sweep. */
export interface DroneShape {
  weight: number;
  filterMinHz: number;
  filterMaxHz: number;
}

export const DEFAULT_DRONE_SHAPE: DroneShape = { weight: 1, filterMinHz: 180, filterMaxHz: 2380 };

export function mapDrone(population: number, pan = 0, shape: DroneShape = DEFAULT_DRONE_SHAPE): DroneParams {
  const t = Math.min(1, population / POPULATION_KNEE);
  const lo = Math.min(shape.filterMinHz, shape.filterMaxHz);
  const hi = Math.max(shape.filterMinHz, shape.filterMaxHz);
  const cutoffHz = lo + t * (hi - lo);
  const weight = (0.05 + t * 0.35) * Math.max(0, Math.min(2, shape.weight));
  return { cutoffHz, weight, pan };
}

/** Squash an unbounded cell-space drift into a restrained pan value. Never
 * hard left/right — DESIGN.md wants restraint, not a ping-pong effect. */
export function mapCentroidDriftToPan(dx: number): number {
  return Math.tanh(dx / 8) * 0.6;
}

const CHURN_NOTE_THRESHOLDS = [1, 6, 40, 150] as const; // -> 0/1/2/3 voices (see below)

/** Density multiplier, 0.25..2.5. 1 reproduces the original thresholds
 * exactly; >1 makes the instrument speak more readily (lower effective
 * thresholds), <1 makes it more reticent. Clamped so a slider mistake can't
 * turn "sparse" into "always" or "never". */
export const MIN_DENSITY = 0.25;
export const MAX_DENSITY = 2.5;

/** How many churn voices this bucket should attempt, 0..3. Below the first
 * threshold we still only fire occasionally (silence is the default). */
function churnDensity(agg: BucketAggregate, density: number): number {
  const d = Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, density));
  const thresholds = CHURN_NOTE_THRESHOLDS.map((t) => t / d);
  const c = resolveChurn(agg);
  if (c <= 0) return 0;
  if (c < thresholds[0]!) return 0;
  if (c < thresholds[1]!) {
    // Sparse: only about 1 in 3 quiet buckets actually sounds.
    return hash01(agg.gen, 1) < 0.33 ? 1 : 0;
  }
  if (c < thresholds[2]!) return 1;
  if (c < thresholds[3]!) return 2;
  return 3;
}

export interface ChurnOptions {
  /** 0.25..2.5, default 1 — see `MIN_DENSITY`/`MAX_DENSITY`. */
  density?: number;
  /** 0.25..2.5 multiplier on note release length ("decay"), default 1. */
  decay?: number;
  scale?: ScaleContext;
}

/**
 * Map one closed bucket's aggregate activity to 0..3 churn `NoteRequest`s.
 * Pure and deterministic in `agg.gen` so the same run always plays the same
 * phrase — an instrument, not noise.
 */
export function mapChurnToNotes(agg: BucketAggregate, options: ChurnOptions = {}): NoteRequest[] {
  const { density = 1, decay = 1, scale = DEFAULT_SCALE_CONTEXT } = options;
  const count = churnDensity(agg, density);
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
    const pitch = q(step, scale);
    const velocity = 0.14 + Math.min(0.28, magnitude * 0.05);
    notes.push({
      pitch,
      velocity,
      pan: Math.max(-0.7, Math.min(0.7, pan + (hash01(agg.gen, 20 + i) - 0.5) * 0.15)),
      duration: (0.9 + hash01(agg.gen, 30 + i) * 0.9) * decay,
      timbre: hash01(agg.gen, 40 + i) < 0.35 ? 'glass' : 'mallet',
      source: 'churn',
      priority: 1,
    });
  }
  return notes;
}

/** One sparse, distinct accent per discovery. Panned from the discovery's
 * real world rect (its own data, not a fabricated value). */
export function mapDiscoveryToNotes(
  discovery: DiscoveryEvent,
  scale: ScaleContext = DEFAULT_SCALE_CONTEXT,
  decay = 1,
): NoteRequest[] {
  const cx = discovery.rect.x + discovery.rect.w / 2;
  const cy = discovery.rect.y + discovery.rect.h / 2;
  const pan = Math.max(-0.8, Math.min(0.8, (hash01(Math.round(cx), Math.round(cy)) - 0.5) * 1.6));

  switch (discovery.kind) {
    case 'extinction':
      // A slow, single low tone fading out — the lineage ending.
      return [{
        pitch: q(-5, scale),
        velocity: 0.3,
        pan,
        duration: 3.2 * decay,
        timbre: 'pad',
        source: 'discovery',
        priority: 5,
      }];
    case 'explosion':
      // A quick bright upward flurry, still capped at 3 voices by the pool.
      return [0, 1, 2].map((i) => ({
        pitch: q(4 + i * 2, scale),
        velocity: 0.32 - i * 0.04,
        pan,
        duration: 0.6 * decay,
        timbre: 'glass' as const,
        source: 'discovery' as const,
        priority: 5,
      }));
    case 'stability':
      // A warm, sustained two-note interval settling into periodicity.
      return [0, 1].map((i) => ({
        pitch: q(0 + i * 2, scale),
        velocity: 0.22,
        pan,
        duration: 4.0 * decay,
        timbre: 'pad' as const,
        source: 'discovery' as const,
        priority: 4,
      }));
    case 'oscillator':
    case 'spaceship':
      // A two-note ping matching the discovery's own period, when known.
      return [{
        pitch: q(6, scale),
        velocity: 0.26,
        pan,
        duration: Math.min(2.5, 0.5 + (discovery.period ?? 2) * 0.1) * decay,
        timbre: 'glass',
        source: 'discovery',
        priority: 4,
      }];
    case 'still-life':
    default:
      return [{
        pitch: q(2, scale),
        velocity: 0.2,
        pan,
        duration: 1.4 * decay,
        timbre: 'mallet',
        source: 'discovery',
        priority: 3,
      }];
  }
}

/** Sparse, slower rendering used only in "audition" mode while scrubbing:
 * one note per invocation, pitch quantised from the target generation so
 * scrubbing to the same place always sounds the same. */
export function mapAuditionToNote(gen: Generation, scale: ScaleContext = DEFAULT_SCALE_CONTEXT): NoteRequest {
  const step = Math.floor(hash01(gen, 99) * 10) - 5;
  return {
    pitch: q(step, scale),
    velocity: 0.18,
    pan: 0,
    duration: 1.1,
    timbre: 'glass',
    source: 'audition',
    priority: 2,
  };
}
