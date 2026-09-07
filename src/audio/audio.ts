/**
 * Soundscape — sonification of the universe. STUB, owned by the `audio` agent
 * (`src/audio/**`). WebAudio only; no samples, no network.
 *
 * Aesthetic: a precision instrument, not a game. Sparse struck tones tuned to a
 * fixed pentatonic set, population mapped to a low drone's filter cutoff,
 * discoveries as distinct short motifs. Must be silent by default and
 * completely inaudible when muted (suspend the AudioContext, don't just gain to 0).
 */
import type { DiscoveryEvent, Generation } from '@/core/types';

/** Anything the soundscape can react to. */
export type AudioEvent =
  | { kind: 'tick'; gen: Generation; population: number }
  | { kind: 'birth'; count: number }
  | { kind: 'death'; count: number }
  | { kind: 'discovery'; discovery: DiscoveryEvent }
  | { kind: 'branch'; fromGen: Generation }
  | { kind: 'scrub'; gen: Generation };

export interface Soundscape {
  /**
   * Create/resume the AudioContext. MUST be called from inside a user gesture
   * handler or browsers will refuse. Idempotent; resolves once running.
   */
  init(): Promise<void>;
  /** Suspends the context when true; resumes when false. */
  setMuted(muted: boolean): void;
  /** Master gain, 0..1, applied with a short ramp to avoid clicks. */
  setVolume(volume: number): void;
  /**
   * Feed a batch of events for the current frame. Called at most once per
   * animation frame — never once per cell. Implementations must throttle
   * voice allocation (hard cap ~8 simultaneous voices).
   */
  feed(events: AudioEvent[]): void;
  /** Tear down the graph and close the context. */
  dispose(): void;
}

export function createSoundscape(): Soundscape {
  throw new Error('not implemented');
}
