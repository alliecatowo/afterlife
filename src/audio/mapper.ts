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
import type { NoteRequest, Timbre } from './scheduler';

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

/** A timbre and its selection weight (need not sum to 1 — normalised
 * internally). Lets a preset (`settings.ts`'s `TIMBRE_SETS`) reshape which
 * voices churn notes draw from without touching the selection algorithm. */
export type WeightedTimbre = readonly [Timbre, number];

/** Reproduces the original fixed churn palette exactly: about 65% mallet,
 * 35% glass — the same ratio the old `hash01(...) < 0.35 ? 'glass' : 'mallet'`
 * produced, just expressed generically so other presets can supply their own
 * weighted palette through the same code path. */
export const DEFAULT_CHURN_TIMBRE_WEIGHTS: readonly WeightedTimbre[] = [['mallet', 0.65], ['glass', 0.35]];

/** Deterministic weighted pick from `[timbre, weight]` pairs using a `hash01`
 * value already computed by the caller. Falls back to the first entry (or
 * `'mallet'`) if `weights` is empty — never throws on a malformed preset. */
export function pickWeightedTimbre(h: number, weights: readonly WeightedTimbre[]): Timbre {
  if (weights.length === 0) return 'mallet';
  const total = weights.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) return weights[0]![0];
  let target = h * total;
  for (const [timbre, w] of weights) {
    target -= Math.max(0, w);
    if (target <= 0) return timbre;
  }
  return weights[weights.length - 1]![0];
}

export interface ChurnOptions {
  /** 0.25..2.5, default 1 — see `MIN_DENSITY`/`MAX_DENSITY`. */
  density?: number;
  /** 0.25..2.5 multiplier on note release length ("decay"), default 1. */
  decay?: number;
  scale?: ScaleContext;
  /** Which synthesised voices churn notes are drawn from, and how often.
   * Default reproduces the original mallet/glass palette. */
  timbreWeights?: readonly WeightedTimbre[];
  /** Slow, real-population-trend-driven register drift in SCALE STEPS (not
   * semitones), from `harmony.ts`'s `HarmonicState.shiftSteps`. Added to
   * every churn note's pitch intent; 0 reproduces the original behaviour
   * exactly. Never changes the scale/mode itself. */
  harmonicShift?: number;
  /** 0..1. How strongly REAL recent activity near the user's cursor/last
   * edit (see `brain.ts`'s proximity sampling) should read this bucket — 0
   * (the default: no data, or nothing recent nearby) reproduces the original
   * velocity/pan exactly. Higher values make churn read louder and pull its
   * pan toward centre, "your own actions feel connected to their
   * consequences." Never fabricated: the caller only raises this when a real
   * edit happened recently and real per-cell activity near it is elevated. */
  proximityBoost?: number;
}

/**
 * Map one closed bucket's aggregate activity to 0..3 churn `NoteRequest`s.
 * Pure and deterministic in `agg.gen` so the same run always plays the same
 * phrase — an instrument, not noise.
 */
export function mapChurnToNotes(agg: BucketAggregate, options: ChurnOptions = {}): NoteRequest[] {
  const {
    density = 1, decay = 1, scale = DEFAULT_SCALE_CONTEXT,
    timbreWeights = DEFAULT_CHURN_TIMBRE_WEIGHTS, harmonicShift = 0, proximityBoost = 0,
  } = options;
  const count = churnDensity(agg, density);
  if (count === 0) return [];

  const growing = agg.populationDelta >= 0;
  const magnitude = Math.log2(1 + Math.abs(agg.populationDelta));
  const baseStep = (growing ? 1 : -1) * Math.min(10, Math.round(magnitude)) + harmonicShift;
  const pan = agg.centroidDelta
    ? mapCentroidDriftToPan(agg.centroidDelta.x)
    : (hash01(agg.gen, 7) - 0.5) * 0.4; // gentle, deterministic, honestly "no data" fallback
  const boost = Math.max(0, Math.min(1, proximityBoost));

  const notes: NoteRequest[] = [];
  for (let i = 0; i < count; i++) {
    const variation = Math.floor(hash01(agg.gen, 11 + i) * 7) - 3; // -3..+3 steps
    const step = baseStep + variation;
    const pitch = q(step, scale);
    const velocity = (0.14 + Math.min(0.28, magnitude * 0.05)) * (1 + boost * 0.6);
    const rawPan = pan + (hash01(agg.gen, 20 + i) - 0.5) * 0.15;
    notes.push({
      pitch,
      velocity,
      pan: Math.max(-0.7, Math.min(0.7, rawPan * (1 - boost * 0.5))),
      duration: (0.9 + hash01(agg.gen, 30 + i) * 0.9) * decay,
      timbre: pickWeightedTimbre(hash01(agg.gen, 40 + i), timbreWeights),
      source: 'churn',
      priority: 1,
    });
  }
  return notes;
}

/** Which synthesised voice each discovery kind speaks in. Default reproduces
 * the original fixed choices exactly; a preset (`settings.ts`) may supply a
 * brighter/warmer palette for the same semantic roles — "still-life" is
 * always the quiet single-note kind, whichever timbre plays it. */
export interface DiscoveryTimbreMap {
  extinction: Timbre;
  extinctionEcho: Timbre;
  explosion: Timbre;
  explosionImpact: Timbre;
  stability: Timbre;
  oscillator: Timbre;
  stillLife: Timbre;
}

export const DEFAULT_DISCOVERY_TIMBRES: DiscoveryTimbreMap = {
  extinction: 'pad',
  extinctionEcho: 'breath',
  explosion: 'glass',
  explosionImpact: 'accent',
  stability: 'pad',
  oscillator: 'glass',
  stillLife: 'mallet',
};

/** One sparse, distinct accent per discovery. Panned from the discovery's
 * real world rect (its own data, not a fabricated value). */
export function mapDiscoveryToNotes(
  discovery: DiscoveryEvent,
  scale: ScaleContext = DEFAULT_SCALE_CONTEXT,
  decay = 1,
  timbres: DiscoveryTimbreMap = DEFAULT_DISCOVERY_TIMBRES,
): NoteRequest[] {
  const cx = discovery.rect.x + discovery.rect.w / 2;
  const cy = discovery.rect.y + discovery.rect.h / 2;
  const pan = Math.max(-0.8, Math.min(0.8, (hash01(Math.round(cx), Math.round(cy)) - 0.5) * 1.6));

  switch (discovery.kind) {
    case 'extinction':
      // A quiet, genuine emotional beat: a slow low tone fading out, with a
      // hushed high fifth blended under it (never a solo bleep) — the
      // lineage ending. Priority 6, one above every other discovery, so a
      // busy voice pool can never steal the one moment that most deserves to
      // be heard.
      return [
        { pitch: q(-5, scale), velocity: 0.3, pan, duration: 3.2 * decay, timbre: timbres.extinction, source: 'discovery', priority: 6 },
        { pitch: q(2, scale), velocity: 0.12, pan, duration: 2.6 * decay, timbre: timbres.extinctionEcho, source: 'discovery', priority: 6 },
      ];
    case 'explosion':
      // A quick bright upward flurry plus one low, punchy "impact" voice so
      // the collision actually lands instead of just sparkling — still
      // bounded (4 notes) by the same 8-voice pool as everything else.
      return [
        ...[0, 1, 2].map((i) => ({
          pitch: q(4 + i * 2, scale),
          velocity: 0.32 - i * 0.04,
          pan,
          duration: 0.6 * decay,
          timbre: timbres.explosion,
          source: 'discovery' as const,
          priority: 5,
        })),
        { pitch: q(-9, scale), velocity: 0.42, pan, duration: 0.22 * decay, timbre: timbres.explosionImpact, source: 'discovery' as const, priority: 5.5 },
      ];
    case 'stability':
      // A warm, sustained two-note interval settling into periodicity.
      return [0, 1].map((i) => ({
        pitch: q(0 + i * 2, scale),
        velocity: 0.22,
        pan,
        duration: 4.0 * decay,
        timbre: timbres.stability,
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
        timbre: timbres.oscillator,
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
        timbre: timbres.stillLife,
        source: 'discovery',
        priority: 3,
      }];
  }
}

/** Sparse, slower rendering used only in "audition" mode while scrubbing:
 * one note per invocation, pitch quantised from the target generation so
 * scrubbing to the same place always sounds the same. Uses the `bow` timbre
 * (slow attack, gentle vibrato) — a deliberately distinct signature from
 * churn/discovery voices, so "moving through time" has its own sound. */
export function mapAuditionToNote(gen: Generation, scale: ScaleContext = DEFAULT_SCALE_CONTEXT): NoteRequest {
  const step = Math.floor(hash01(gen, 99) * 10) - 5;
  return {
    pitch: q(step, scale),
    velocity: 0.18,
    pan: 0,
    duration: 1.1,
    timbre: 'bow',
    source: 'audition',
    priority: 2,
  };
}

/**
 * A distinct, satisfying confirmation for stamping a specimen — reflects the
 * pattern's real size/complexity via `cellCount` (the exact bounding-box
 * cell count of the committed `EditOp`, from `edit:committed`'s real payload,
 * never estimated). A short bell arpeggio: bigger/more complex patterns get
 * more notes and a wider spread. Deterministic in `cellCount` alone — a
 * confirmation sound should be recognisable every time, not randomised.
 */
export function mapStampToNotes(cellCount: number, scale: ScaleContext = DEFAULT_SCALE_CONTEXT, decay = 1): NoteRequest[] {
  const n = cellCount <= 4 ? 1 : cellCount <= 16 ? 2 : cellCount <= 64 ? 3 : 4;
  const notes: NoteRequest[] = [];
  for (let i = 0; i < n; i++) {
    notes.push({
      pitch: q(2 + i * 2, scale),
      velocity: 0.26 - i * 0.02,
      pan: (i - (n - 1) / 2) * 0.18,
      duration: (0.5 + i * 0.18) * decay,
      timbre: 'bell',
      source: 'stamp',
      priority: 4,
    });
  }
  return notes;
}

/**
 * "One future becomes two" — the sonic signature for forking a branch by
 * editing behind the playhead. Two notes, opposite pan, a real third apart:
 * distinct from every other event class, and unconditional (priority 5, like
 * a rare discovery) so a deliberate, rare user action always lands. Varies
 * gently (but deterministically) with the real generation branched from.
 */
export function mapBranchToNotes(fromGen: Generation, scale: ScaleContext = DEFAULT_SCALE_CONTEXT, decay = 1): NoteRequest[] {
  const root = Math.floor(hash01(fromGen, 61) * 3); // 0..2, gentle variety
  return [
    { pitch: q(root, scale), velocity: 0.26, pan: -0.55, duration: 1.6 * decay, timbre: 'pluck', source: 'branch', priority: 5 },
    { pitch: q(root + 2, scale), velocity: 0.24, pan: 0.55, duration: 1.9 * decay, timbre: 'bell', source: 'branch', priority: 5 },
  ];
}

/** Register window for the drawing/erasing "instrument" mapping — narrower
 * than the full churn register so painting stays a coherent, playable range
 * rather than sprawling across the whole board. */
const PAINT_REGISTER_STEPS = 9;

/**
 * Turn one real painted/erased cell into a soft, immediate "playing an
 * instrument" note. `ny`/`nx` are the cell's position normalised to the real
 * world dimensions (0..1) — never fabricated, supplied by the caller from
 * the actual `EditOp` cell and `LifeEngine.spec`. `localDensity` (0..1), when
 * supplied, is the real fraction of live neighbours around that cell,
 * brightening the velocity a little — honestly degrades to a flat velocity
 * without it. Deterministic in position: drawing the same spot always plays
 * the same note, which is what makes it feel like an instrument rather than
 * noise.
 */
export function mapPaintToNote(
  nx: number,
  ny: number,
  alive: boolean,
  localDensity: number | undefined,
  scale: ScaleContext = DEFAULT_SCALE_CONTEXT,
): NoteRequest {
  const clampedNy = Math.max(0, Math.min(1, ny));
  const clampedNx = Math.max(0, Math.min(1, nx));
  const step = Math.round((0.5 - clampedNy) * PAINT_REGISTER_STEPS * 2);
  const density = Math.max(0, Math.min(1, localDensity ?? 0.3));
  return {
    pitch: q(step, scale),
    velocity: 0.1 + density * 0.12,
    pan: Math.max(-0.75, Math.min(0.75, (clampedNx - 0.5) * 1.5)),
    duration: alive ? 0.32 : 0.5,
    // Planting a cell plucks; clearing one exhales — a gentle, legible
    // distinction between the two gestures.
    timbre: alive ? 'pluck' : 'breath',
    source: 'paint',
    priority: 0.8, // below churn/discovery — never steals a musical voice
  };
}

/** Minimum sustained churn RATE (churn units per second) before the
 * generative percussion texture is even considered. Comfortably above what
 * ordinary background activity produces, so this is felt only during real
 * bursts. */
const PERCUSSION_RATE_THRESHOLD = 40;

export interface PercussionOptions {
  scale?: ScaleContext;
  decay?: number;
}

/**
 * Generative percussion/texture, derived from a REAL churn rate (this
 * bucket's resolved churn divided by the bucket length) — heavily rate-
 * limited on two axes: a threshold well above ordinary activity, AND a
 * further 1-in-4 deterministic gate (via `hash01`) so even a sustained flood
 * doesn't turn into a metronome. Returns at most one `NoteRequest`.
 */
export function mapPercussion(agg: BucketAggregate, bucketSeconds: number, options: PercussionOptions = {}): NoteRequest[] {
  const { scale = DEFAULT_SCALE_CONTEXT, decay = 1 } = options;
  if (bucketSeconds <= 0) return [];
  const rate = resolveChurn(agg) / bucketSeconds;
  if (rate < PERCUSSION_RATE_THRESHOLD) return [];
  if (hash01(agg.gen, 71) >= 0.25) return [];
  return [{
    pitch: q(-7, scale),
    velocity: 0.16,
    pan: (hash01(agg.gen, 72) - 0.5) * 0.5,
    duration: 0.12 * decay,
    timbre: 'perc',
    source: 'percussion',
    priority: 0.5, // lowest priority — pure texture, never displaces melody
  }];
}
