/**
 * Deterministic offline audio render: the impure half of the audio-export
 * pipeline (`plan.ts` is the pure half — see its doc). Renders a real
 * `SynthGraph` (owned by the `audio` agent, `@/audio/synth.ts`) against an
 * `OfflineAudioContext` instead of a live `AudioContext`, so the whole clip
 * renders in one deterministic pass with no realtime pacing.
 *
 * `SynthGraph`'s constructor is typed `(ctx: AudioContext)`, but reading it
 * in full confirms every call it makes — `createGain`/`createOscillator`/
 * `createBiquadFilter`/`createBufferSource`/`createStereoPanner`/
 * `createDelay`/`createBuffer`/`.connect`/`.destination` plus `AudioParam`
 * scheduling methods, ALL on `BaseAudioContext`, the interface `AudioContext`
 * and `OfflineAudioContext` both implement — and never touches an
 * `AudioContext`-only member (`resume`/`suspend`/`close`/`state`/
 * `baseLatency`/media-element or media-stream sources). Every timestamp it
 * uses is a caller-supplied absolute time, never `ctx.currentTime` read
 * internally. That makes the cast below (`as unknown as AudioContext`)
 * genuinely safe at runtime, not just a type-checker workaround — this file
 * never edits `synth.ts` itself (outside this module's ownership), only
 * borrows the class it already exports.
 *
 * The ONE source of non-determinism in that graph is `synth.ts`'s private
 * `buildNoiseBuffer`, which calls `Math.random()` to fill the drone's
 * "breath" noise layer. `withDeterministicRandom` below swaps in a fixed-seed
 * PRNG for the synchronous window `new SynthGraph(...)` runs in (the buffer
 * is built once, inline, in the constructor — no async gap for anything else
 * to observe the swapped `Math.random`) and restores the real one
 * immediately after. That's a deliberately narrow, self-contained fix scoped
 * to `src/export/**` — it does not require editing `@/audio/synth.ts` to get
 * a real determinism guarantee out of code that file already owns.
 */
import type { TimelineStore } from '@/core/history';
import { SynthGraph } from '@/audio/synth';
import type { AudioSettings } from '@/audio/settings';
import { ExportUnsupportedError } from '../errors';
import { capAudioDuration, MAX_AUDIO_SECONDS } from '../limits';
import { computeAudioPlan } from './plan';

export interface OfflineAudioRenderOptions {
  history: TimelineStore;
  fromGen: number;
  toGen: number;
  /** Simulated generations advanced per second of output — same semantic as
   *  the video pipeline. */
  gensPerSecond: number;
  settings: AudioSettings;
  /** 0..1 master volume baked into the render (independent of the live
   *  session's mute state — exporting audio is an explicit action, so an
   *  export started while the live soundscape happens to be muted still
   *  renders audibly at this volume; default 1). */
  volume?: number;
  sampleRate?: number;
  signal?: AbortSignal;
}

export interface OfflineAudioRenderResult {
  buffer: AudioBuffer;
  durationSeconds: number;
  /** Honest notes about any budget-driven reduction (currently just the
   *  `MAX_AUDIO_SECONDS` duration cap — see `limits.ts`). */
  reductionNotes: string[];
}

type OfflineAudioContextCtor = new (numberOfChannels: number, length: number, sampleRate: number) => OfflineAudioContext;

function getOfflineAudioContextCtor(): OfflineAudioContextCtor {
  const Ctor = (globalThis as { OfflineAudioContext?: OfflineAudioContextCtor }).OfflineAudioContext;
  if (!Ctor) {
    throw new ExportUnsupportedError('This browser has no OfflineAudioContext — offline audio export is unavailable here.');
  }
  return Ctor;
}

/** Deterministic xorshift-style PRNG (mulberry32), fixed-seeded — replaces
 *  `Math.random` for the synchronous duration of `fn`, then restores the
 *  real one. Used ONLY to make `SynthGraph`'s one `Math.random()` call site
 *  (the drone's shared white-noise buffer) reproducible across two renders
 *  of the same export. */
function withDeterministicRandom<T>(fn: () => T): T {
  const original = Math.random;
  let state = 0x9e3779b9;
  Math.random = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/**
 * Render `[fromGen, toGen]`'s soundscape to a real `AudioBuffer`, fully
 * offline: every note/drone parameter is scheduled onto the
 * `OfflineAudioContext` up front (see `plan.ts`'s cues), then
 * `startRendering()` computes the whole buffer in one deterministic pass —
 * no realtime pacing, no wall-clock dependency. Two calls with identical
 * arguments produce bit-identical output (verified in
 * `e2e/audio-export.spec.ts` against a REAL `OfflineAudioContext`, not a
 * self-authored stand-in).
 */
export async function renderOfflineAudio(opts: OfflineAudioRenderOptions): Promise<OfflineAudioRenderResult> {
  const reductionNotes: string[] = [];
  const totalGens = opts.toGen - opts.fromGen;
  const requestedDuration = totalGens > 0 ? totalGens / opts.gensPerSecond : 0;
  const durationCap = capAudioDuration(requestedDuration, MAX_AUDIO_SECONDS);
  if (durationCap.note) reductionNotes.push(durationCap.note);
  const toGen = durationCap.reduced
    ? opts.fromGen + Math.round(durationCap.value * opts.gensPerSecond)
    : opts.toGen;

  const plan = await computeAudioPlan({
    history: opts.history,
    fromGen: opts.fromGen,
    toGen,
    gensPerSecond: opts.gensPerSecond,
    settings: opts.settings,
    signal: opts.signal,
  });

  const sampleRate = opts.sampleRate ?? 44100;
  const durationSeconds = Math.max(plan.durationSeconds, 1 / sampleRate);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const OfflineCtor = getOfflineAudioContextCtor();
  const ctx = new OfflineCtor(2, frameCount, sampleRate);

  const synth = withDeterministicRandom(() => new SynthGraph(ctx as unknown as AudioContext));
  synth.setMasterGain(Math.max(0, Math.min(1, opts.volume ?? 1)), 0);
  const wet = Math.max(0, (opts.settings.decay - 1) / 1.5);
  synth.setReverbAmount(wet, 0);

  for (const cue of plan.cues) {
    synth.setDrone(cue.drone, cue.atTime);
    for (const note of cue.notes) synth.playNote(note);
  }

  if (opts.signal?.aborted) throw new DOMException('export cancelled', 'AbortError');
  const buffer = await ctx.startRendering();

  return { buffer, durationSeconds: plan.durationSeconds, reductionNotes };
}
