/**
 * Deterministic musical event plan for offline audio export. Pure aside from
 * a real, disposable `SoundscapeBrain` (itself pure — see `brain.ts`'s own
 * doc: "no Web Audio, no timers, no globals... deterministic and
 * unit-testable") driven off a real deterministic replay cursor
 * (`@/export/replay.ts`). No Web Audio import anywhere in this file, so it's
 * fully covered by `tests/export-audioPlan.test.ts` without needing a
 * browser — only the final step (feeding this plan's cues into a real
 * `SynthGraph` bound to an `OfflineAudioContext`, in `offlineRender.ts`)
 * needs one.
 *
 * Faithfully reproduces the live soundscape's TICK-DRIVEN layers — the
 * dynamics-driven drone (`dynamics.ts`: silent when the world is
 * paused/static/extinct, alive when it's churning or its mass is moving) and
 * the churn-driven notes (`mapChurnToNotes`, purely a function of population
 * deltas) — from nothing but the replayed engine's real per-generation
 * population and (throttled, for cost) centroid, fed through the exact same
 * `SoundscapeBrain.onEvent('tick')` / `.tick()` calls `audio.ts` makes live,
 * just driven by simulated time instead of `AudioContext.currentTime`.
 *
 * Deliberately does NOT replay one-shot event notes (discoveries, paint,
 * stamp, branch): those are tied to interactive/live session state (camera
 * position for ambient discovery scanning, de-duplication history) that
 * isn't purely a function of engine state at each generation — replaying
 * them here would mean re-implementing a DIFFERENT, live-camera-relative
 * detection pass rather than "faithfully reproducing what already
 * happened," which would be less honest than leaving them out and saying
 * so. See INTEGRATION-NOTES.md's media-export entry for the full reasoning.
 */
import type { LifeEngine } from '@/core/engine';
import type { TimelineStore } from '@/core/history';
import { SoundscapeBrain } from '@/audio/brain';
import type { DroneParams } from '@/audio/mapper';
import { TICK_INTERVAL_SECONDS } from '@/audio/scheduler';
import type { ScheduledNote } from '@/audio/scheduler';
import {
  bucketSecondsFromSettings, churnTimbreWeightsFromSettings, discoveryTimbresFromSettings,
  droneShapeFromSettings, scaleContextFromSettings, type AudioSettings,
} from '@/audio/settings';
import { createReplayCursor } from '../replay';

export interface AudioCue {
  /** Simulated seconds since the export's `fromGen`, matching the
   *  `OfflineAudioContext` timeline `offlineRender.ts` schedules against. */
  atTime: number;
  notes: ScheduledNote[];
  drone: DroneParams;
}

export interface AudioPlan {
  durationSeconds: number;
  cues: AudioCue[];
}

export interface ComputeAudioPlanOptions {
  history: TimelineStore;
  fromGen: number;
  toGen: number;
  /** Simulated generations advanced per second of output — same semantic as
   *  the video pipeline's `pacing.ts`. */
  gensPerSecond: number;
  settings: AudioSettings;
  signal?: AbortSignal;
}

/** How many times, at most, the population centroid is recomputed over the
 *  whole export — `LifeEngine.forEachLive` is O(population), so this bounds
 *  cost for a long, populous export the same way `pacing.ts`'s frame caps
 *  bound video cost. Purely a performance throttle: skipped generations
 *  still get an honest population-only tick (never a fabricated centroid). */
const MAX_CENTROID_SAMPLES = 600;

function computeCentroid(engine: LifeEngine): { x: number; y: number } | undefined {
  const { width, height } = engine.spec;
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  engine.forEachLive({ x: 0, y: 0, w: width, h: height }, (x, y) => {
    sumX += x;
    sumY += y;
    count++;
  });
  return count > 0 ? { x: sumX / count, y: sumY / count } : undefined;
}

/** Push the export's audio settings snapshot into a fresh `SoundscapeBrain`
 *  — the same fields `audio.ts`'s `applySettings` pushes into the live one,
 *  minus anything meaningless for a non-interactive replay (audition-mode
 *  scrub previews). */
function applySettingsToBrain(brain: SoundscapeBrain, settings: AudioSettings): void {
  brain.setScale(scaleContextFromSettings(settings));
  brain.setBucketSeconds(bucketSecondsFromSettings(settings));
  brain.setVoiceCap(settings.voiceCap);
  brain.setDensity(settings.density);
  brain.setDroneShape(droneShapeFromSettings(settings));
  brain.setDecay(settings.decay);
  brain.setAudition(false);
  brain.setChurnTimbreWeights(churnTimbreWeightsFromSettings(settings));
  brain.setDiscoveryTimbres(discoveryTimbresFromSettings(settings));
  brain.setHarmonicMovement(settings.harmonicMovement);
  brain.setPercussion(settings.percussion);
}

/**
 * Replay `[fromGen, toGen]` and produce a deterministic, ordered list of
 * "cues" (drone parameters + any notes to sound at that instant) — the exact
 * schedule an `OfflineAudioContext` render (`offlineRender.ts`) applies to a
 * `SynthGraph`. Same `(history, fromGen, toGen, gensPerSecond, settings)`
 * always produces the same plan: everything here is a pure function of the
 * replayed engine's own state and the caller-supplied settings, nothing
 * reads real time or `Math.random()`.
 */
export async function computeAudioPlan(opts: ComputeAudioPlanOptions): Promise<AudioPlan> {
  const { history, fromGen, toGen, gensPerSecond, settings, signal } = opts;
  if (!(gensPerSecond > 0)) throw new Error(`computeAudioPlan: gensPerSecond must be > 0, got ${gensPerSecond}`);
  if (toGen < fromGen) throw new Error(`computeAudioPlan: toGen (${toGen}) must be >= fromGen (${fromGen})`);

  const totalGens = toGen - fromGen;
  const durationSeconds = totalGens / gensPerSecond;
  const centroidStride = Math.max(1, Math.ceil(totalGens / MAX_CENTROID_SAMPLES));

  const cursor = await createReplayCursor(history, { fromGen, signal });
  const startEngine = cursor.advanceTo(fromGen);
  const brain = new SoundscapeBrain();
  applySettingsToBrain(brain, settings);

  const cues: AudioCue[] = [];

  let nextTickTime = 0;
  // Flush every scheduler-tick boundary STRICTLY BEFORE `limit` — i.e. only
  // ones whose outcome can depend solely on generations already fed via
  // `onEvent`, never on the generation about to be fed. This must run
  // BEFORE each new generation's `onEvent` call, not after: at a slow
  // `gensPerSecond`, a single generation can span several scheduler ticks
  // (`TICK_INTERVAL_SECONDS`), and flushing AFTER `onEvent` would let a
  // still-pending generation's population jump leak backward into buckets
  // that, in real time, would have closed before that generation ever
  // happened — turning "silence, then a burst" into "already audible before
  // the burst." The live scheduler in `audio.ts` never has this problem
  // (ticks and bus events interleave in real wall-clock order); this
  // reproduces that ordering explicitly since replay has no wall clock.
  const flushBefore = (limit: number): void => {
    while (nextTickTime < limit) {
      const { notes, drone } = brain.tick(nextTickTime);
      cues.push({ atTime: nextTickTime, notes, drone });
      nextTickTime += TICK_INTERVAL_SECONDS;
    }
  };

  flushBefore(0);
  brain.onEvent(
    { kind: 'tick', gen: fromGen, population: startEngine.population, centroid: computeCentroid(startEngine) },
    0,
  );

  for (let gen = fromGen + 1; gen <= toGen; gen++) {
    if (signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
    const t = (gen - fromGen) / gensPerSecond;
    flushBefore(t);
    const engine = cursor.advanceTo(gen);
    const sampleCentroid = (gen - fromGen) % centroidStride === 0 || gen === toGen;
    const centroid = sampleCentroid ? computeCentroid(engine) : undefined;
    brain.onEvent({ kind: 'tick', gen, population: engine.population, centroid }, t);
  }
  // Drain every remaining bucket boundary a little past the clip's real end
  // so the final bucket's notes/drone actually flush (mirrors `LOOKAHEAD_SECONDS`
  // — a boundary right at `durationSeconds` still needs one more tick to fall
  // inside a `now + lookahead` horizon).
  flushBefore(durationSeconds + TICK_INTERVAL_SECONDS * 4);

  return { durationSeconds, cues };
}
