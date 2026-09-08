/**
 * Soundscape — sonification of the universe. Owned by the `audio` agent
 * (`src/audio/**`). WebAudio only; no samples, no network, no libraries.
 *
 * This file is the only impure, stateful entry point: it owns the
 * `AudioContext` lifecycle and bus wiring. All musical *decisions* live in
 * the pure `brain.ts`/`mapper.ts`/`scheduler.ts`/`scale.ts` modules, which
 * have no Web Audio imports and are covered by `tests/audio-*.test.ts`.
 *
 * Aesthetic: a quiet, tuned observatory — soft mallet/glass tones over a
 * faint filtered-noise drone, one fixed pentatonic scale, long decays, lots
 * of silence. Silent by default (`useAppStore`'s `muted` defaults `true`);
 * `init()` only ever runs from a real user gesture.
 */
import type { Disposable } from '@/core/types';
import type { LifeEngine } from '@/core/engine';
import { bus } from '@/ui/bus';
import { readState } from '@/ui/store';
import { SoundscapeBrain } from './brain';
import { createAudioContext, ensureRunning } from './context';
import { TICK_INTERVAL_SECONDS } from './scheduler';
import { SynthGraph } from './synth';
import type { AudioEvent } from './events';
import { stop as stopCapture } from './capture';
import { midiController } from './midi';
import {
  bucketSecondsFromSettings, churnTimbreWeightsFromSettings, discoveryTimbresFromSettings,
  droneShapeFromSettings, scaleContextFromSettings, type AudioSettings,
} from './settings';
import { readAudioSettings, useAudioSettingsStore } from './settingsStore';

export type { AudioEvent };

/** The minimum a caller needs to supply for the drawing/erasing "instrument"
 * feedback — a structural (not nominal) subset of `@/interact/input`'s
 * `InputController`, so this module never needs a value-level import from
 * `@/interact/**` (owned by the render agent). */
export interface PendingEditSource {
  readonly pending: { cells: ReadonlyArray<{ x: number; y: number; alive: boolean }> } | null;
}

export interface SoundscapeDeps {
  /**
   * Optional, read-only access to the live engine. Never mutated — used only
   * to derive HONEST real values that were previously fabricated or simply
   * unavailable: a real population centroid (for drone/churn pan), and real
   * local density/activity sampling for the drawing-feedback and proximity-
   * weighting features. Without it, those features degrade exactly the way
   * the rest of this module already degrades without optional data (centred
   * pan, flat velocity) — never fabricated, never thrown.
   */
  engine?: LifeEngine;
  /**
   * Optional, read-only access to the in-progress draw/erase gesture's
   * pending cells, so drawing can sound like playing an instrument in real
   * time instead of only on commit. Never mutated, never used to influence
   * cell state — audio only ever reads this.
   */
  input?: PendingEditSource;
}

/** How many scheduler ticks (see `TICK_INTERVAL_SECONDS`) between real
 * population-centroid samples. Centroid computation is O(population) — cheap
 * even for a full board, but there's no reason to redo it every 100ms. */
const CENTROID_SAMPLE_TICKS = 5;

/** How long (seconds) a real edit keeps "reading more strongly" nearby
 * births/deaths before decaying back to nothing — see `setProximityBoost`. */
const PROXIMITY_WINDOW_SECONDS = 6;

/** Neighbourhood radius (cells) sampled for the drawing-feedback timbre's
 * local-density brightening. */
const DENSITY_SAMPLE_RADIUS = 1;

/** Neighbourhood radius (cells) sampled around a recent edit for the
 * proximity-weighting feature. Wider than the density sample — this is
 * asking "is anything actually happening near here", not "what's under the
 * cursor exactly." */
const PROXIMITY_SAMPLE_RADIUS = 5;

/** Real fraction of live neighbours (including the cell itself) around
 * `(x, y)`, for the drawing-feedback note's brightness. */
function sampleLocalDensity(engine: LifeEngine, x: number, y: number): number {
  let alive = 0;
  let total = 0;
  for (let dy = -DENSITY_SAMPLE_RADIUS; dy <= DENSITY_SAMPLE_RADIUS; dy++) {
    for (let dx = -DENSITY_SAMPLE_RADIUS; dx <= DENSITY_SAMPLE_RADIUS; dx++) {
      total++;
      if (engine.get(x + dx, y + dy)) alive++;
    }
  }
  return total > 0 ? alive / total : 0;
}

/** Real average recent-change heat (`LifeEngine.activityAt`, already
 * decaying per-generation in the engine itself) around `(x, y)` — an honest
 * "is anything actually happening near here" signal for proximity
 * weighting, never fabricated. */
function sampleLocalActivity(engine: LifeEngine, x: number, y: number): number {
  let sum = 0;
  let count = 0;
  for (let dy = -PROXIMITY_SAMPLE_RADIUS; dy <= PROXIMITY_SAMPLE_RADIUS; dy++) {
    for (let dx = -PROXIMITY_SAMPLE_RADIUS; dx <= PROXIMITY_SAMPLE_RADIUS; dx++) {
      sum += engine.activityAt(x + dx, y + dy);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Real population centroid over the whole world, or `undefined` for an
 * empty world (never fabricated as `{0,0}`). */
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

export interface Soundscape {
  /**
   * Create/resume the AudioContext. MUST be called from inside a user gesture
   * handler or browsers will refuse. Idempotent; resolves once running.
   */
  init(): Promise<void>;
  /** Suspends the context when true; resumes when false. Genuinely silent —
   * disconnects to zero gain immediately AND suspends the context, and stops
   * the scheduler tick entirely so no CPU is spent while muted. */
  setMuted(muted: boolean): void;
  /** Master gain, 0..1, applied with a short ramp to avoid clicks. */
  setVolume(volume: number): void;
  /**
   * Enable/disable the sparse, slower "audition" rendering played while
   * scrubbing the timeline. Off by default: scrubbing the timeline is
   * otherwise silent for event audio (the ambient drone still tracks
   * population, since that costs nothing extra and is never a barrage).
   */
  setAudition(on: boolean): void;
  /**
   * Feed a batch of events for the current frame. Called at most once per
   * animation frame — never once per cell. Supplementary to the soundscape's
   * own bus subscriptions (`gen:changed`, `discovery:made`, `playback:scrub`,
   * `audio:toggle`, `audio:volume`, all wired internally): use `feed()` only
   * for data the bus doesn't carry, i.e. explicit birth/death counts (more
   * precise than the population-delta fallback) and a population centroid
   * for pan (`{ kind: 'tick', gen, population, centroid: { x, y } }`).
   */
  feed(events: AudioEvent[]): void;
  /** Tear down the graph, unsubscribe from the bus, and close the context. */
  dispose(): void;
}

export function createSoundscape(deps: SoundscapeDeps = {}): Soundscape {
  const brain = new SoundscapeBrain();

  let ctx: AudioContext | null = null;
  let synth: SynthGraph | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let muted = readState().muted;
  let volume = readState().volume;
  let disposed = false;

  // ---- interaction-feedback sampling state (see `sampleInteraction`) ----
  let lastPendingCellCount = 0;
  let recentEditAt: { x: number; y: number; at: number } | null = null;
  let centroidSampleCounter = 0;

  function now(): number {
    return ctx?.currentTime ?? 0;
  }

  function applyMasterGain(): void {
    if (!synth || !ctx) return;
    synth.setMasterGain(muted ? 0 : volume, ctx.currentTime);
  }

  /** Push the panel's current settings into the brain (always — it has no
   * `AudioContext` dependency) and, if the graph already exists, into the
   * synth's reverb send. Called once at construction and on every
   * `settingsStore` change, so the panel's controls are the only source of
   * truth: nobody needs to call a setter by hand. */
  function applySettings(settings: AudioSettings): void {
    brain.setScale(scaleContextFromSettings(settings));
    brain.setBucketSeconds(bucketSecondsFromSettings(settings));
    brain.setVoiceCap(settings.voiceCap);
    brain.setDensity(settings.density);
    brain.setDroneShape(droneShapeFromSettings(settings));
    brain.setDecay(settings.decay);
    brain.setAudition(settings.auditionOnScrub);
    brain.setChurnTimbreWeights(churnTimbreWeightsFromSettings(settings));
    brain.setDiscoveryTimbres(discoveryTimbresFromSettings(settings));
    brain.setHarmonicMovement(settings.harmonicMovement);
    brain.setPercussion(settings.percussion);
    if (synth && ctx) {
      // Neutral at decay<=1 (the shipped default), so nobody who never
      // touches the slider gets an unrequested reverb tail.
      const wet = Math.max(0, (settings.decay - 1) / 1.5);
      synth.setReverbAmount(wet, ctx.currentTime);
    }
  }
  applySettings(readAudioSettings());
  const unsubscribeSettings = useAudioSettingsStore.subscribe(applySettings);

  /**
   * Real, honest interaction feedback sampled once per scheduler tick
   * (~100ms — cheap, off the render/interaction hot path, no per-frame
   * allocation): the in-progress draw/erase gesture's newest real cell (for
   * the "drawing is an instrument" note), a throttled real population
   * centroid (for pan), and real local activity near the last edit (for
   * proximity weighting of nearby births/deaths). Every value here either
   * comes straight from `LifeEngine`/`InputController` or is `undefined` —
   * never fabricated. No-ops entirely when `deps.engine`/`deps.input`
   * weren't supplied (e.g. in unit tests), exactly like every other optional
   * data path in this module.
   */
  function sampleInteraction(t: number): void {
    const { engine, input } = deps;

    if (input) {
      const pending = input.pending;
      const count = pending?.cells.length ?? 0;
      if (pending && count > lastPendingCellCount) {
        const cell = pending.cells[pending.cells.length - 1]!;
        const nx = engine ? cell.x / engine.spec.width : 0.5;
        const ny = engine ? cell.y / engine.spec.height : 0.5;
        const localDensity = engine ? sampleLocalDensity(engine, cell.x, cell.y) : undefined;
        brain.onEvent({ kind: 'paint', nx, ny, alive: cell.alive, localDensity }, t);
        recentEditAt = { x: cell.x, y: cell.y, at: t };
      }
      lastPendingCellCount = count;
    }

    if (!engine) return;

    centroidSampleCounter++;
    if (centroidSampleCounter >= CENTROID_SAMPLE_TICKS) {
      centroidSampleCounter = 0;
      const centroid = computeCentroid(engine);
      if (centroid) {
        brain.onEvent({ kind: 'tick', gen: engine.gen, population: engine.population, centroid }, t);
      }
    }

    if (recentEditAt && t - recentEditAt.at < PROXIMITY_WINDOW_SECONDS) {
      const ageFraction = (t - recentEditAt.at) / PROXIMITY_WINDOW_SECONDS;
      const activity = sampleLocalActivity(engine, recentEditAt.x, recentEditAt.y);
      brain.setProximityBoost(activity * (1 - ageFraction));
    } else {
      brain.setProximityBoost(0);
    }
  }

  function schedulerTick(): void {
    if (!ctx || !synth || muted) return;
    const t = ctx.currentTime;
    sampleInteraction(t);
    const { notes, drone } = brain.tick(t);
    synth.setDrone(drone, t);
    for (const note of notes) synth.playNote(note);
    midiController.sendNotes(notes, t);
  }

  function startScheduler(): void {
    if (intervalHandle !== null || muted) return;
    intervalHandle = setInterval(schedulerTick, TICK_INTERVAL_SECONDS * 1000);
  }

  function stopScheduler(): void {
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  // Bus wiring — the soundscape drives itself; nobody needs to call `feed()`
  // for the common cases. Subscriptions are set up immediately (not gated on
  // `init()`) so no activity is missed once the user turns sound on, but the
  // brain itself no-ops all of this while muted, so it costs nothing before
  // the user opts in.
  const subs: Disposable[] = [
    bus.on('gen:changed', ({ gen, population }) => {
      brain.onEvent({ kind: 'tick', gen, population }, now());
    }),
    bus.on('discovery:made', (discovery) => {
      brain.onEvent({ kind: 'discovery', discovery }, now());
    }),
    bus.on('playback:scrub', ({ gen, done }) => {
      brain.setScrubbing(!done);
      if (!done) brain.onEvent({ kind: 'scrub', gen }, now());
    }),
    bus.on('audio:toggle', ({ muted: nextMuted }) => {
      applySetMuted(nextMuted);
    }),
    bus.on('audio:volume', ({ volume: nextVolume }) => {
      applySetVolume(nextVolume);
    }),
  ];

  function applySetMuted(next: boolean): void {
    muted = next;
    brain.setMuted(next);
    applyMasterGain();
    // Muting must never leave a hardware synth holding a note — panic
    // immediately, the same guarantee `dispose()`/port-change/disable give.
    if (next) midiController.allNotesOff();
    if (!ctx) return;
    if (next) {
      stopScheduler();
      void ctx.suspend();
    } else {
      void ensureRunning(ctx);
      startScheduler();
    }
  }

  function applySetVolume(next: number): void {
    volume = Math.max(0, Math.min(1, next));
    applyMasterGain();
  }

  // Start fully quiescent if the persisted/default state is muted (it is, by
  // default) — no scheduling work happens until an explicit unmute.
  brain.setMuted(muted);

  return {
    async init() {
      if (disposed) return;
      if (!ctx) {
        ctx = createAudioContext();
        synth = new SynthGraph(ctx);
        applyMasterGain();
        applySettings(readAudioSettings()); // now that `synth` exists, pick up e.g. the decay/reverb send
      }
      await ensureRunning(ctx);
      if (!muted) startScheduler();
    },

    setMuted(next: boolean) {
      applySetMuted(next);
    },

    setVolume(next: number) {
      applySetVolume(next);
    },

    setAudition(on: boolean) {
      brain.setAudition(on);
    },

    feed(events: AudioEvent[]) {
      if (disposed) return;
      const t = now();
      for (const event of events) brain.onEvent(event, t);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopScheduler();
      for (const s of subs) s.dispose();
      unsubscribeSettings();
      midiController.dispose();
      stopCapture();
      brain.reset();
      synth?.dispose();
      synth = null;
      if (ctx) {
        void ctx.close();
        ctx = null;
      }
    },
  };
}
