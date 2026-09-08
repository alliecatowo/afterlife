/**
 * Pure scheduling primitives: the musical grid and the concurrent-voice cap
 * with voice stealing. No Web Audio, no timers — everything takes an
 * explicit `now` (seconds) so it is deterministic and unit-testable. The
 * impure layer (`synth.ts`/`audio.ts`) drives this with `AudioContext.currentTime`.
 */

/** Tempo for the quantisation grid: a slow, unhurried pulse. */
export const BPM = 72;

/** One musical "bucket" = an eighth note at BPM. Events are aggregated over
 * a bucket and resolved into at most a few notes at the bucket boundary —
 * this is what turns hundreds of births/sec into music instead of a barrage. */
export const BUCKET_SECONDS = 60 / BPM / 2;

/** Sane range for the panel's tempo control — well short of turning the
 * instrument into a barrage, well short of losing the pulse entirely. */
export const MIN_BPM = 30;
export const MAX_BPM = 160;

/** Bucket length (seconds) for a given BPM, same eighth-note relationship as
 * the fixed `BUCKET_SECONDS`/`BPM` pair above. */
export function bucketSecondsForBpm(bpm: number): number {
  const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
  return 60 / clamped / 2;
}

/** Scheduler tick cadence (wall clock) — NOT per-note timing. */
export const TICK_INTERVAL_SECONDS = 0.1;

/** How far ahead of `now` the scheduler is willing to commit notes. Notes are
 * scheduled on the Web Audio clock with sample-accurate start times, so a
 * ~100ms JS tick jitter never reaches the ear. */
export const LOOKAHEAD_SECONDS = 0.2;

/** Hard cap on simultaneously-sounding voices, across all note sources. */
export const MAX_VOICES = 8;

export type Timbre = 'mallet' | 'glass' | 'pad' | 'accent';
export type NoteSource = 'churn' | 'discovery' | 'audition';

export interface NoteRequest {
  /** MIDI note number. Callers are expected to have already quantised this
   * via `scale.ts`; the scheduler does not re-check it. */
  pitch: number;
  /** 0..1 */
  velocity: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  duration: number;
  timbre: Timbre;
  source: NoteSource;
  /** Higher wins contention for a voice slot / can steal a lower-priority
   * active voice. Discoveries > churn > audition-preview. */
  priority: number;
}

export interface ScheduledNote extends NoteRequest {
  id: number;
  /** Absolute time (same clock as `now`) the note should start. */
  time: number;
}

interface ActiveVoice {
  id: number;
  endTime: number;
  priority: number;
}

/**
 * Tracks concurrently-sounding voices and admits/steals under `MAX_VOICES`.
 * A voice is "active" from the moment it's allocated until `endTime`; the
 * caller (synth layer) doesn't need to report completion — time alone
 * expires it, which keeps this fully synchronous and test-friendly.
 */
export class VoicePool {
  #voices: ActiveVoice[] = [];
  #nextId = 1;
  #maxVoices: number;

  constructor(maxVoices: number = MAX_VOICES) {
    this.#maxVoices = Math.max(1, maxVoices);
  }

  get maxVoices(): number {
    return this.#maxVoices;
  }

  /** Live-adjust the concurrency cap (the panel's "voice cap" control).
   * Never below 1 — the instrument always keeps at least one voice. Lowering
   * the cap does not forcibly cut already-sounding voices; it only tightens
   * admission from here on, so no abrupt clicks from cutting a ringing tail. */
  setMaxVoices(maxVoices: number): void {
    this.#maxVoices = Math.max(1, Math.round(maxVoices));
  }

  /** Drop any voice whose `endTime` has passed. */
  #reap(now: number): void {
    this.#voices = this.#voices.filter((v) => v.endTime > now);
  }

  activeCount(now: number): number {
    this.#reap(now);
    return this.#voices.length;
  }

  /**
   * Try to admit a note at `now`. Returns a `ScheduledNote` with an assigned
   * id if admitted, or `null` if the pool is full and nothing could be
   * stolen (i.e. every active voice has priority >= this request).
   */
  tryAllocate(req: NoteRequest, time: number, now: number): ScheduledNote | null {
    this.#reap(now);
    if (this.#voices.length >= this.maxVoices) {
      // Voice stealing: evict the single lowest-priority active voice if it
      // is strictly lower priority than the incoming request.
      let weakest: ActiveVoice | null = null;
      for (const v of this.#voices) {
        if (!weakest || v.priority < weakest.priority) weakest = v;
      }
      if (!weakest || weakest.priority >= req.priority) return null;
      this.#voices = this.#voices.filter((v) => v.id !== weakest!.id);
    }
    const id = this.#nextId++;
    this.#voices.push({ id, endTime: time + req.duration, priority: req.priority });
    return { ...req, id, time };
  }

  reset(): void {
    this.#voices = [];
  }
}

/** Largest bucket-grid time that is <= `t`. */
export function bucketFloor(t: number, bucketSeconds: number = BUCKET_SECONDS): number {
  return Math.floor(t / bucketSeconds) * bucketSeconds;
}

/** Smallest bucket-grid time that is > `t` (the next boundary strictly ahead). */
export function nextBucketBoundary(t: number, bucketSeconds: number = BUCKET_SECONDS): number {
  return bucketFloor(t, bucketSeconds) + bucketSeconds;
}
