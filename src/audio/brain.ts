/**
 * The soundscape's musical brain: aggregates incoming events onto the
 * musical grid, applies the mapper, and allocates voices through the
 * concurrency cap. Pure logic — no Web Audio, no timers, no globals. Fully
 * driven by an explicit `now` (seconds), so it is deterministic and
 * unit-testable; `audio.ts` is the only module that touches `AudioContext`.
 */
import type { AudioEvent } from './events';
import {
  emptyAggregate, mapAuditionToNote, mapCentroidDriftToPan, mapChurnToNotes,
  mapDiscoveryToNotes, mapDrone,
  type BucketAggregate, type DroneParams,
} from './mapper';
import {
  BUCKET_SECONDS, LOOKAHEAD_SECONDS, VoicePool, bucketFloor, nextBucketBoundary,
  type NoteRequest, type ScheduledNote,
} from './scheduler';

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
  #lastDrone: DroneParams = { cutoffHz: 180, weight: 0, pan: 0 };
  #lastDronePan = 0;

  constructor(maxVoices?: number) {
    this.#pool = new VoicePool(maxVoices);
    this.#agg = emptyAggregate(0, 0);
  }

  get muted(): boolean {
    return this.#muted;
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (muted) {
      // Stop doing work and drop anything pending — nothing to schedule
      // while muted, and nothing left over to burst out on unmute.
      this.#pool.reset();
      this.#pendingDiscoveries = [];
      this.#agg = emptyAggregate(this.#agg.gen, this.#agg.population);
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

  reset(): void {
    this.#pool.reset();
    this.#agg = emptyAggregate(0, 0);
    this.#lastCentroid = null;
    this.#lastFlushedBoundary = null;
    this.#pendingDiscoveries = [];
    this.#lastAuditionTime = -Infinity;
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
          this.#pendingDiscoveries.push(...mapDiscoveryToNotes(event.discovery));
        }
        break;
      case 'scrub':
        if (this.#audition && now - this.#lastAuditionTime >= AUDITION_MIN_INTERVAL_SECONDS) {
          this.#pendingDiscoveries.push(mapAuditionToNote(event.gen));
          this.#lastAuditionTime = now;
        }
        break;
      case 'branch':
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

    if (this.#lastFlushedBoundary === null) {
      this.#lastFlushedBoundary = bucketFloor(now);
    }

    // If we've been paused/muted (or the tab was backgrounded) for a long
    // stretch, don't replay a huge backlog of empty buckets synchronously —
    // drop it and resume from just before `now`, mirroring the sim loop's
    // catch-up guard in `core/loop.ts`.
    const staleness = horizon - this.#lastFlushedBoundary;
    if (staleness > MAX_CATCHUP_SECONDS) {
      this.#lastFlushedBoundary = bucketFloor(now) - BUCKET_SECONDS;
    }

    let boundary = nextBucketBoundary(this.#lastFlushedBoundary);
    while (boundary <= horizon) {
      // Churn notes for the bucket that just closed (suppressed while
      // scrubbing unless audition mode — audition uses its own sparse path).
      if (!this.#scrubbing) {
        const churnNotes = mapChurnToNotes(this.#agg);
        for (const req of churnNotes) {
          const n = this.#pool.tryAllocate(req, boundary, now);
          if (n) notes.push(n);
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

      if (this.#agg.centroidDelta) {
        this.#lastDronePan = mapCentroidDriftToPan(this.#agg.centroidDelta.x);
      }
      this.#agg = emptyAggregate(this.#agg.gen, this.#agg.population);
      this.#lastFlushedBoundary = boundary;
      boundary = nextBucketBoundary(boundary);
    }

    this.#lastDrone = mapDrone(this.#agg.population, this.#lastDronePan);
    return { notes, drone: this.#lastDrone };
  }
}
