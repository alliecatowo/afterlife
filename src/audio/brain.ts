/**
 * The soundscape's musical brain: aggregates incoming events onto the
 * musical grid, applies the mapper, and allocates voices through the
 * concurrency cap. Pure logic — no Web Audio, no timers, no globals. Fully
 * driven by an explicit `now` (seconds), so it is deterministic and
 * unit-testable; `audio.ts` is the only module that touches `AudioContext`.
 */
import type { AudioEvent } from './events';
import {
  DEFAULT_CHURN_TIMBRE_WEIGHTS, DEFAULT_DISCOVERY_TIMBRES, DEFAULT_DRONE_SHAPE, DEFAULT_SCALE_CONTEXT,
  emptyAggregate, mapAuditionToNote, mapBranchToNotes, mapCentroidDriftToPan, mapChurnToNotes,
  mapDiscoveryToNotes, mapDrone, mapPaintToNote, mapPercussion, mapStampToNotes, resolveChurn,
  type BucketAggregate, type DiscoveryTimbreMap, type DroneParams, type DroneShape, type ScaleContext,
  type WeightedTimbre,
} from './mapper';
import {
  BUCKET_SECONDS, LOOKAHEAD_SECONDS, VoicePool, bucketFloor,
  type NoteRequest, type ScheduledNote,
} from './scheduler';
import { INITIAL_HARMONIC_STATE, updateHarmonicState, type HarmonicState } from './harmony';
import { INITIAL_DRONE_DYNAMICS, updateDroneDynamics, type DroneDynamics } from './dynamics';

/** Minimum spacing between paint (drawing/erasing) preview notes — one per
 * musical bucket at most, regardless of how fast the user drags, so a stroke
 * never turns into a machine-gun of clicks. */
const PAINT_MIN_INTERVAL_SECONDS = BUCKET_SECONDS;

/** Minimum spacing between audition-mode preview notes while scrubbing, so a
 * fast drag can't machine-gun notes even in the "preview" path. */
export const AUDITION_MIN_INTERVAL_SECONDS = BUCKET_SECONDS * 3;

/** Cap on how far behind `tick()` will replay bucket boundaries in one call
 * before snapping forward instead of looping through a huge backlog. */
const MAX_CATCHUP_SECONDS = BUCKET_SECONDS * 8;

export interface BrainOutput {
  notes: ScheduledNote[];
  drone: DroneParams;
}

export class SoundscapeBrain {
  #pool: VoicePool;
  #agg: BucketAggregate;
  #lastCentroid: { x: number; y: number } | null = null;
  #lastFlushedBoundary: number | null = null;
  #pendingDiscoveries: NoteRequest[] = [];
  #muted = false;
  #scrubbing = false;
  #audition = false;
  #lastAuditionTime = -Infinity;
  #lastDrone: DroneParams = mapDrone({ activity: 0, motion: 0, population: 0 });
  #lastDronePan = 0;
  #pendingPaint: NoteRequest | null = null;
  #lastPaintAt = -Infinity;
  #harmony: HarmonicState = INITIAL_HARMONIC_STATE;
  #dynamics: DroneDynamics = INITIAL_DRONE_DYNAMICS;

  // ---- panel-tunable parameters (all default to the original fixed
  // behaviour; see `@/audio/settingsStore` for the persisted UI state that
  // drives these via `Soundscape`). ----
  #bucketSeconds: number = BUCKET_SECONDS;
  #scale: ScaleContext = DEFAULT_SCALE_CONTEXT;
  #density = 1;
  #droneShape: DroneShape = DEFAULT_DRONE_SHAPE;
  #decay = 1;
  #churnTimbreWeights: readonly WeightedTimbre[] = DEFAULT_CHURN_TIMBRE_WEIGHTS;
  #discoveryTimbres: DiscoveryTimbreMap = DEFAULT_DISCOVERY_TIMBRES;
  #harmonicMovement = true;
  #percussion = false;
  #proximityBoost = 0;

  constructor(maxVoices?: number) {
    this.#pool = new VoicePool(maxVoices);
    this.#agg = emptyAggregate(0, 0);
  }

  get muted(): boolean {
    return this.#muted;
  }

  /** Change the musical grid's tempo. Takes effect from the next bucket
   * boundary — never retroactively rewrites already-scheduled notes. */
  setBucketSeconds(seconds: number): void {
    this.#bucketSeconds = Math.max(0.01, seconds);
  }

  setScale(scale: ScaleContext): void {
    this.#scale = scale;
  }

  setDensity(density: number): void {
    this.#density = density;
  }

  setDroneShape(shape: DroneShape): void {
    this.#droneShape = shape;
  }

  setDecay(decay: number): void {
    this.#decay = decay;
  }

  setVoiceCap(maxVoices: number): void {
    this.#pool.setMaxVoices(maxVoices);
  }

  get voiceCap(): number {
    return this.#pool.maxVoices;
  }

  /** Which synthesised voices churn notes are drawn from — see
   * `mapper.ts`'s `WeightedTimbre`/`DEFAULT_CHURN_TIMBRE_WEIGHTS`. */
  setChurnTimbreWeights(weights: readonly WeightedTimbre[]): void {
    this.#churnTimbreWeights = weights;
  }

  /** Which synthesised voice each discovery kind speaks in. */
  setDiscoveryTimbres(timbres: DiscoveryTimbreMap): void {
    this.#discoveryTimbres = timbres;
  }

  /** Enable/disable the slow, real-population-trend-driven register drift
   * (`harmony.ts`). On by default; turning it off pins the register exactly
   * where the original fixed instrument left it. */
  setHarmonicMovement(on: boolean): void {
    this.#harmonicMovement = on;
    if (!on) this.#harmony = INITIAL_HARMONIC_STATE;
  }

  /** The current harmonic drift, in scale steps — exposed for the panel's
   * informational readout and for tests. 0 when disabled or unset. */
  get harmonicShiftSteps(): number {
    return this.#harmonicMovement ? this.#harmony.shiftSteps : 0;
  }

  /** Enable/disable the generative percussion/texture layer (`mapper.ts`'s
   * `mapPercussion`). Off by default — opt-in texture, not a soundscape
   * regression. */
  setPercussion(on: boolean): void {
    this.#percussion = on;
  }

  /** 0..1, real proximity of recent local activity to the user's cursor/last
   * edit (see `audio.ts`'s sampling of `LifeEngine.activityAt` near the last
   * painted cell). Fed every scheduler tick; decays to 0 on its own as the
   * caller's own age/distance weighting fades — this class never manufactures
   * decay itself so it stays a pure function of what it's told. */
  setProximityBoost(boost: number): void {
    this.#proximityBoost = Math.max(0, Math.min(1, boost));
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (muted) {
      // Stop doing work and drop anything pending — nothing to schedule
      // while muted, and nothing left over to burst out on unmute.
      this.#pool.reset();
      this.#pendingDiscoveries = [];
      this.#pendingPaint = null;
      this.#agg = emptyAggregate(this.#agg.gen, this.#agg.population);
      // Unmuting should fade the drone back in from real silence, not
      // resume at whatever activity level happened to be measured before
      // muting — a stale reading would pop straight back to "loud."
      this.#dynamics = INITIAL_DRONE_DYNAMICS;
    }
  }

  setScrubbing(scrubbing: boolean): void {
    this.#scrubbing = scrubbing;
  }

  setAudition(on: boolean): void {
    this.#audition = on;
  }

  /** Number of voices currently sounding, per the concurrency pool. Exposed
   * for tests; real callers don't need it. */
  activeVoiceCount(now: number): number {
    return this.#pool.activeCount(now);
  }

  /** True while there is a queued discovery/paint note that hasn't been
   * flushed into an actual `ScheduledNote` yet (i.e. the next bucket
   * boundary still has real work to do). Used by `audio.ts` to decide
   * whether it's safe to suspend the `AudioContext` to save CPU — never
   * while something is about to sound. */
  get hasPendingWork(): boolean {
    return this.#pendingDiscoveries.length > 0 || this.#pendingPaint !== null;
  }

  /** The current smoothed activity/motion dynamics driving the drone (see
   * `dynamics.ts`). Exposed for tests and for the panel's informational
   * readout — never fabricated, always the same values `tick()` fed into
   * `mapDrone`. */
  get droneDynamics(): DroneDynamics {
    return this.#dynamics;
  }

  reset(): void {
    this.#pool.reset();
    this.#agg = emptyAggregate(0, 0);
    this.#lastCentroid = null;
    this.#lastFlushedBoundary = null;
    this.#pendingDiscoveries = [];
    this.#pendingPaint = null;
    this.#lastPaintAt = -Infinity;
    this.#lastAuditionTime = -Infinity;
    this.#harmony = INITIAL_HARMONIC_STATE;
    this.#dynamics = INITIAL_DRONE_DYNAMICS;
  }

  /** Feed one input event. `now` is the current audio clock time, used only
   * for audition-mode rate limiting; bucket assignment for churn notes is by
   * generation aggregation, not wall time. */
  onEvent(event: AudioEvent, now: number): void {
    if (this.#muted) return; // no work while muted

    switch (event.kind) {
      case 'tick': {
        const delta = event.population - this.#agg.population;
        this.#agg.gen = event.gen;
        this.#agg.population = event.population;
        this.#agg.populationDelta += delta;
        if (event.centroid) {
          if (this.#lastCentroid) {
            this.#agg.centroidDelta = {
              x: event.centroid.x - this.#lastCentroid.x,
              y: event.centroid.y - this.#lastCentroid.y,
            };
          }
          this.#agg.centroid = event.centroid;
          this.#lastCentroid = event.centroid;
        }
        break;
      }
      case 'birth':
        this.#agg.explicitChurn = (this.#agg.explicitChurn ?? 0) + event.count;
        break;
      case 'death':
        this.#agg.explicitChurn = (this.#agg.explicitChurn ?? 0) + event.count;
        break;
      case 'discovery':
        if (!this.#scrubbing) {
          this.#pendingDiscoveries.push(...mapDiscoveryToNotes(event.discovery, this.#scale, this.#decay, this.#discoveryTimbres));
        }
        break;
      case 'scrub':
        if (this.#audition && now - this.#lastAuditionTime >= AUDITION_MIN_INTERVAL_SECONDS) {
          this.#pendingDiscoveries.push(mapAuditionToNote(event.gen, this.#scale));
          this.#lastAuditionTime = now;
        }
        break;
      case 'branch':
        // "One future becomes two" — a rare, deliberate user action, so it
        // always gets its own distinct signature (see `mapBranchToNotes`).
        if (!this.#scrubbing) {
          this.#pendingDiscoveries.push(...mapBranchToNotes(event.fromGen, this.#scale, this.#decay));
        }
        break;
      case 'stamp':
        if (!this.#scrubbing) {
          this.#pendingDiscoveries.push(...mapStampToNotes(event.cellCount, this.#scale, this.#decay));
        }
        break;
      case 'paint':
        // At most one paint note per musical bucket, however fast the
        // stroke — the LATEST cell wins, so a fast drag never queues a burst.
        if (!this.#scrubbing && now - this.#lastPaintAt >= PAINT_MIN_INTERVAL_SECONDS) {
          this.#pendingPaint = mapPaintToNote(event.nx, event.ny, event.alive, event.localDensity, this.#scale);
          this.#lastPaintAt = now;
        }
        break;
    }
  }

  /**
   * Advance the scheduler to `now` (+ `lookahead`), flushing any bucket
   * boundaries that fall within the window and allocating voices for the
   * resulting notes. Call this on a ~100ms tick, not per note.
   */
  tick(now: number, lookahead: number = LOOKAHEAD_SECONDS): BrainOutput {
    if (this.#muted) return { notes: [], drone: { ...this.#lastDrone, weight: 0 } };

    const notes: ScheduledNote[] = [];
    const horizon = now + lookahead;

    const bucketSeconds = this.#bucketSeconds;

    if (this.#lastFlushedBoundary === null) {
      this.#lastFlushedBoundary = bucketFloor(now, bucketSeconds);
    }

    // If we've been paused/muted (or the tab was backgrounded) for a long
    // stretch, don't replay a huge backlog of empty buckets synchronously —
    // drop it and resume from just before `now`, mirroring the sim loop's
    // catch-up guard in `core/loop.ts`.
    const maxCatchupSeconds = Math.max(MAX_CATCHUP_SECONDS, bucketSeconds * 8);
    const staleness = horizon - this.#lastFlushedBoundary;
    if (staleness > maxCatchupSeconds) {
      this.#lastFlushedBoundary = bucketFloor(now, bucketSeconds) - bucketSeconds;
    }

    // Advance by direct addition, never by re-deriving from `bucketFloor`
    // each step: repeatedly doing `floor(boundary / bucketSeconds) *
    // bucketSeconds` can, under floating-point rounding, occasionally fail
    // to advance a full step and stall the loop forever. A fixed positive
    // increment is guaranteed to eventually exceed any finite `horizon`. The
    // iteration cap below is a hard backstop in case that guarantee is ever
    // violated some other way.
    let boundary = this.#lastFlushedBoundary + bucketSeconds;
    let guard = 0;
    const GUARD_MAX = Math.ceil(maxCatchupSeconds / bucketSeconds) + 4;
    while (boundary <= horizon && guard < GUARD_MAX) {
      guard++;
      // Slow harmonic drift, one real-population sample per bucket — see
      // `harmony.ts`. Runs even while scrubbing/percussion are off so the
      // trend keeps tracking real state; it just isn't audible unless churn
      // notes are actually playing.
      if (this.#harmonicMovement) {
        this.#harmony = updateHarmonicState(this.#harmony, this.#agg.population, boundary, bucketSeconds);
      }
      // Churn notes for the bucket that just closed (suppressed while
      // scrubbing unless audition mode — audition uses its own sparse path).
      if (!this.#scrubbing) {
        const churnNotes = mapChurnToNotes(this.#agg, {
          density: this.#density,
          decay: this.#decay,
          scale: this.#scale,
          timbreWeights: this.#churnTimbreWeights,
          harmonicShift: this.#harmonicMovement ? this.#harmony.shiftSteps : 0,
          proximityBoost: this.#proximityBoost,
          bucketSeconds,
        });
        for (const req of churnNotes) {
          const n = this.#pool.tryAllocate(req, boundary, now);
          if (n) notes.push(n);
        }
        if (this.#percussion) {
          const percNotes = mapPercussion(this.#agg, bucketSeconds, { scale: this.#scale, decay: this.#decay });
          for (const req of percNotes) {
            const n = this.#pool.tryAllocate(req, boundary, now);
            if (n) notes.push(n);
          }
        }
      }
      // Discoveries piggyback on the same grid so everything stays coherent,
      // but they're high priority and can steal a churn voice.
      if (this.#pendingDiscoveries.length > 0) {
        for (const req of this.#pendingDiscoveries) {
          const n = this.#pool.tryAllocate(req, boundary, now);
          if (n) notes.push(n);
        }
        this.#pendingDiscoveries = [];
      }
      // At most one "drawing is an instrument" note per bucket — the latest
      // painted/erased cell, if any, since the last boundary.
      if (this.#pendingPaint) {
        const n = this.#pool.tryAllocate(this.#pendingPaint, boundary, now);
        if (n) notes.push(n);
        this.#pendingPaint = null;
      }

      if (this.#agg.centroidDelta) {
        this.#lastDronePan = mapCentroidDriftToPan(this.#agg.centroidDelta.x);
      }
      // Drone dynamics — a REAL measured churn rate and centroid-drift
      // magnitude for the bucket that just closed (0 for either when
      // nothing happened: no churn this bucket, or no centroid delta at
      // all). This is what makes the sustained layer decay to genuine
      // silence on its own when the world is paused, static, or extinct —
      // see `dynamics.ts`. Computed from `this.#agg` BEFORE it's reset below.
      const churnRatePerSecond = resolveChurn(this.#agg) / bucketSeconds;
      const centroidDriftMagnitude = this.#agg.centroidDelta
        ? Math.hypot(this.#agg.centroidDelta.x, this.#agg.centroidDelta.y)
        : 0;
      this.#dynamics = updateDroneDynamics(this.#dynamics, churnRatePerSecond, centroidDriftMagnitude, bucketSeconds);

      this.#agg = emptyAggregate(this.#agg.gen, this.#agg.population);
      this.#lastFlushedBoundary = boundary;
      boundary = boundary + bucketSeconds;
    }

    this.#lastDrone = mapDrone(
      { activity: this.#dynamics.activity, motion: this.#dynamics.motion, population: this.#agg.population },
      this.#lastDronePan,
      this.#droneShape,
      this.#scale,
    );
    return { notes, drone: this.#lastDrone };
  }
}
