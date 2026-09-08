/**
 * Web Audio node graph. Impure by necessity (it IS the audio nodes) — kept
 * deliberately dumb: it renders `ScheduledNote`s and `DroneParams` produced
 * by the pure `brain.ts`/`mapper.ts`, and does no musical decision-making of
 * its own. All timing uses `AudioContext.currentTime` + absolute times
 * handed in by the caller; nothing here uses `setTimeout`.
 */
import { midiToHz } from './scale';
import type { DroneParams } from './mapper';
import type { ScheduledNote, Timbre } from './scheduler';

const DRONE_RAMP_SECONDS = 0.6;
const MASTER_RAMP_SECONDS = 0.25;
const REVERB_RAMP_SECONDS = 0.4;
/** Feedback delay network standing in for a convolution reverb — per the
 * module's "no samples" rule, there is no impulse-response file to load.
 * Two short, prime-ish delay times summed give a diffuse-ish tail without
 * the metallic ping of a single delay line, at negligible CPU cost. */
const REVERB_DELAY_A_SECONDS = 0.041;
const REVERB_DELAY_B_SECONDS = 0.067;
/** Hard ceiling on feedback gain — this is a decay control, never a howl. */
const MAX_REVERB_FEEDBACK = 0.55;

/** Build a short (2s) buffer of white noise, looped, shared by every timbre
 * that needs one (the drone's own faint "breath" layer, plus the `breath`/
 * `perc` per-note timbres). Generated at runtime; never a loaded sample file. */
function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 2;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export class SynthGraph {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  // The sustained drone: two gently detuned low root oscillators (their
  // spread widens/narrows with measured MOTION, so a travelling world
  // audibly beats/shimmers and a still one holds a pure unison), a soft
  // octave shimmer, and a scale-consonant fifth partial that fades in with
  // measured POPULATION (a fuller world gets a fuller chord). Replaces the
  // old always-on filtered-white-noise bed — see `mapper.ts`'s `mapDrone`.
  private readonly droneRootA: OscillatorNode;
  private readonly droneRootB: OscillatorNode;
  private readonly droneOctave: OscillatorNode;
  private readonly droneFifth: OscillatorNode;
  private readonly droneRootGain: GainNode;
  private readonly droneOctaveGain: GainNode;
  private readonly droneFifthGain: GainNode;
  /** A very quiet, heavily filtered noise "breath" layer under the pitched
   * drone, gated by measured ACTIVITY and hard-capped low (`MAX_DRONE_NOISE`
   * in `mapper.ts`) — real texture, never the loudest thing in the mix. */
  private readonly droneNoiseSource: AudioBufferSourceNode;
  private readonly droneNoiseFilter: BiquadFilterNode;
  private readonly droneNoiseGain: GainNode;
  private readonly droneFilter: BiquadFilterNode;
  private readonly droneGain: GainNode;
  private readonly dronePanner: StereoPannerNode;
  private readonly reverbSend: GainNode;
  private readonly reverbWet: GainNode;
  private readonly reverbDelayA: DelayNode;
  private readonly reverbDelayB: DelayNode;
  private readonly reverbFeedbackA: GainNode;
  private readonly reverbFeedbackB: GainNode;
  private readonly reverbDamp: BiquadFilterNode;
  /** One shared white-noise buffer, reused (never re-allocated) by both the
   * ambient drone and any per-note timbre that needs noise (`breath`/`perc`)
   * — many `AudioBufferSourceNode`s may reference the same `AudioBuffer`
   * simultaneously; only the lightweight source node is per-note. */
  private readonly noiseBuffer: AudioBuffer;
  private disposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);

    this.noiseBuffer = buildNoiseBuffer(ctx);

    // Sustained pitched drone — oscillators run continuously once the
    // context exists (cheap, click-free to modulate), gated to genuine
    // silence by `droneGain` (== `DroneParams.weight`, itself 0 whenever
    // `mapDrone`'s measured activity/motion inputs are 0 — see that
    // function's header) until there's real, measured life to describe.
    this.droneRootA = ctx.createOscillator();
    this.droneRootA.type = 'sine';
    this.droneRootA.frequency.value = 110;
    this.droneRootB = ctx.createOscillator();
    this.droneRootB.type = 'sine';
    this.droneRootB.frequency.value = 110;
    this.droneOctave = ctx.createOscillator();
    this.droneOctave.type = 'triangle';
    this.droneOctave.frequency.value = 220;
    this.droneFifth = ctx.createOscillator();
    this.droneFifth.type = 'sine';
    this.droneFifth.frequency.value = 164.81;

    this.droneRootGain = ctx.createGain();
    this.droneRootGain.gain.value = 0.28;
    this.droneOctaveGain = ctx.createGain();
    this.droneOctaveGain.gain.value = 0.07;
    this.droneFifthGain = ctx.createGain();
    this.droneFifthGain.gain.value = 0;

    this.droneNoiseSource = ctx.createBufferSource();
    this.droneNoiseSource.buffer = this.noiseBuffer;
    this.droneNoiseSource.loop = true;
    this.droneNoiseFilter = ctx.createBiquadFilter();
    this.droneNoiseFilter.type = 'bandpass';
    this.droneNoiseFilter.frequency.value = 900;
    this.droneNoiseFilter.Q.value = 0.9;
    this.droneNoiseGain = ctx.createGain();
    this.droneNoiseGain.gain.value = 0;

    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.Q.value = 0.4;
    this.droneFilter.frequency.value = 180;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.dronePanner = ctx.createStereoPanner();

    this.droneRootA.connect(this.droneRootGain);
    this.droneRootB.connect(this.droneRootGain);
    this.droneOctave.connect(this.droneOctaveGain);
    this.droneFifth.connect(this.droneFifthGain);
    this.droneNoiseSource.connect(this.droneNoiseFilter);
    this.droneNoiseFilter.connect(this.droneNoiseGain);

    this.droneRootGain.connect(this.droneFilter);
    this.droneOctaveGain.connect(this.droneFilter);
    this.droneFifthGain.connect(this.droneFilter);
    this.droneNoiseGain.connect(this.droneFilter);
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.dronePanner);
    this.dronePanner.connect(this.master);

    this.droneRootA.start();
    this.droneRootB.start();
    this.droneOctave.start();
    this.droneFifth.start();
    this.droneNoiseSource.start();

    // A cheap algorithmic "reverb/decay" send — a small feedback-delay
    // network, not a convolution reverb (no impulse-response sample to load,
    // per this module's "no samples" rule). `playNote` sends a copy of each
    // voice's envelope output here; `setReverbAmount` (driven by the panel's
    // decay control) is the only thing that changes over time. Silent (wet
    // gain 0) until a user turns the decay knob past its neutral default, so
    // it costs nothing extra for anyone who never touches it.
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;
    this.reverbDamp = ctx.createBiquadFilter();
    this.reverbDamp.type = 'lowpass';
    this.reverbDamp.frequency.value = 2600;
    this.reverbDelayA = ctx.createDelay(1);
    this.reverbDelayA.delayTime.value = REVERB_DELAY_A_SECONDS;
    this.reverbDelayB = ctx.createDelay(1);
    this.reverbDelayB.delayTime.value = REVERB_DELAY_B_SECONDS;
    this.reverbFeedbackA = ctx.createGain();
    this.reverbFeedbackA.gain.value = 0;
    this.reverbFeedbackB = ctx.createGain();
    this.reverbFeedbackB.gain.value = 0;

    this.reverbSend.connect(this.reverbDelayA);
    this.reverbSend.connect(this.reverbDelayB);
    this.reverbDelayA.connect(this.reverbFeedbackA);
    this.reverbFeedbackA.connect(this.reverbDamp);
    this.reverbDelayB.connect(this.reverbFeedbackB);
    this.reverbFeedbackB.connect(this.reverbDamp);
    this.reverbDamp.connect(this.reverbDelayA);
    this.reverbDamp.connect(this.reverbDelayB);
    this.reverbDamp.connect(this.reverbWet);
    this.reverbWet.connect(this.master);
  }

  /**
   * 0 (dry, the original fixed sound) .. 1 (long, washy tail). Ramped, never
   * stepped, so turning the panel's decay slider never clicks. Feedback is
   * hard-capped at `MAX_REVERB_FEEDBACK` regardless of `amount` so this can
   * never runaway into a howl.
   */
  setReverbAmount(amount: number, atTime: number): void {
    const a = Math.max(0, Math.min(1, amount));
    this.reverbSend.gain.setTargetAtTime(a * 0.5, atTime, REVERB_RAMP_SECONDS / 3);
    this.reverbWet.gain.setTargetAtTime(a * 0.4, atTime, REVERB_RAMP_SECONDS / 3);
    const feedback = a * MAX_REVERB_FEEDBACK;
    this.reverbFeedbackA.gain.setTargetAtTime(feedback, atTime, REVERB_RAMP_SECONDS / 3);
    this.reverbFeedbackB.gain.setTargetAtTime(feedback * 0.85, atTime, REVERB_RAMP_SECONDS / 3);
  }

  /** Master gain, 0..1, with a short ramp to avoid clicks. */
  setMasterGain(gain: number, atTime: number): void {
    const g = this.master.gain;
    g.cancelScheduledValues(atTime);
    g.setTargetAtTime(Math.max(0.0001, gain), atTime, MASTER_RAMP_SECONDS / 3);
  }

  setDrone(params: DroneParams, atTime: number): void {
    const ramp = DRONE_RAMP_SECONDS / 3;
    this.droneFilter.frequency.setTargetAtTime(params.cutoffHz, atTime, ramp);
    this.droneGain.gain.setTargetAtTime(params.weight, atTime, ramp);
    this.dronePanner.pan.setTargetAtTime(params.pan, atTime, ramp);
    this.droneRootA.frequency.setTargetAtTime(params.rootHz, atTime, ramp);
    this.droneRootB.frequency.setTargetAtTime(params.rootHz, atTime, ramp);
    this.droneOctave.frequency.setTargetAtTime(params.rootHz * 2, atTime, ramp);
    this.droneFifth.frequency.setTargetAtTime(params.fifthHz, atTime, ramp);
    this.droneRootA.detune.setTargetAtTime(-params.spreadCents / 2, atTime, ramp);
    this.droneRootB.detune.setTargetAtTime(params.spreadCents / 2, atTime, ramp);
    this.droneFifthGain.gain.setTargetAtTime(params.fifthLevel * 0.4, atTime, ramp);
    this.droneNoiseGain.gain.setTargetAtTime(params.noiseLevel, atTime, ramp);
  }

  /** Render one scheduled note as a short-lived voice. Self-disposing via
   * `onended` — callers never need to track or free these nodes. The actual
   * oscillator/noise graph varies per timbre (see `buildVoice`); this method
   * only owns the shared envelope/pan/reverb-send plumbing every timbre goes
   * through identically. */
  playNote(note: ScheduledNote): void {
    const { ctx } = this;
    const hz = midiToHz(note.pitch);
    const start = note.time;
    const env = ctx.createGain();
    env.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, note.pan));

    const attack = timbreAttack(note.timbre);
    const release = note.duration;
    const peak = Math.max(0.001, Math.min(0.6, note.velocity));

    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.setTargetAtTime(0, start + attack, release / 3);

    env.connect(panner);
    panner.connect(this.master);
    // A parallel send to the reverb bus — silent (see `setReverbAmount`)
    // unless the panel's decay control has been turned up.
    panner.connect(this.reverbSend);

    const stopAt = start + attack + release + release; // let the tail ring out
    const { primary, cleanup } = buildVoice(ctx, note.timbre, hz, start, stopAt, env, this.noiseBuffer);
    primary.start(start);
    primary.stop(stopAt);
    primary.onended = () => {
      primary.disconnect();
      cleanup?.();
      env.disconnect();
      panner.disconnect();
    };
  }

  /** Tear down the whole graph. Safe to call once; idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const osc of [this.droneRootA, this.droneRootB, this.droneOctave, this.droneFifth]) {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    }
    try { this.droneNoiseSource.stop(); } catch { /* already stopped */ }
    this.droneNoiseSource.disconnect();
    this.droneNoiseFilter.disconnect();
    this.droneNoiseGain.disconnect();
    this.droneRootGain.disconnect();
    this.droneOctaveGain.disconnect();
    this.droneFifthGain.disconnect();
    this.droneFilter.disconnect();
    this.droneGain.disconnect();
    this.dronePanner.disconnect();
    this.reverbSend.disconnect();
    this.reverbDelayA.disconnect();
    this.reverbDelayB.disconnect();
    this.reverbFeedbackA.disconnect();
    this.reverbFeedbackB.disconnect();
    this.reverbDamp.disconnect();
    this.reverbWet.disconnect();
    this.master.disconnect();
  }
}

function timbreWaveform(timbre: Timbre): OscillatorType {
  switch (timbre) {
    case 'glass': return 'triangle';
    case 'pad': return 'sine';
    case 'accent': return 'square';
    case 'mallet':
    default: return 'sine';
  }
}

function timbreAttack(timbre: Timbre): number {
  switch (timbre) {
    case 'pad': return 0.4;
    case 'glass': return 0.01;
    case 'accent': return 0.005;
    case 'pluck': return 0.002;
    case 'bell': return 0.008;
    case 'bow': return 0.35;
    case 'breath': return 0.15;
    case 'perc': return 0.001;
    case 'mallet':
    default: return 0.005;
  }
}

interface Voice {
  /** The node `playNote` calls `.start()`/`.stop()` on and sets `.onended`
   * on — that single callback drives the whole voice's teardown. */
  primary: AudioScheduledSourceNode;
  /** Extra disconnect work for auxiliary nodes chained directly off
   * `primary` (a filter, for instance) that aren't independently
   * started/stopped nodes of their own. Called from `primary.onended`. */
  cleanup?: () => void;
}

/**
 * Build the oscillator/noise graph for one timbre, connected into `env`
 * (the shared envelope `playNote` already built). Any secondary nodes a
 * timbre needs of their OWN lifetime (a vibrato LFO, extra bell partials, a
 * blended noise layer) are started/stopped here and given their own
 * `onended` for self-disconnection — only the returned `primary` is the
 * caller's responsibility. `stopAt` is an absolute time so every node in a
 * multi-node timbre shares exactly the same stop point — nothing here ever
 * uses `setTimeout`; all timing is `AudioContext` scheduling.
 */
function buildVoice(
  ctx: AudioContext,
  timbre: Timbre,
  hz: number,
  start: number,
  stopAt: number,
  env: GainNode,
  noiseBuffer: AudioBuffer,
): Voice {
  switch (timbre) {
    case 'bell': {
      // A few slightly-inharmonic sine partials, upper ones fainter and
      // shorter — the classic cheap-but-convincing bell trick. The
      // fundamental is the primary voice (started/stopped by the caller);
      // the upper partials are secondary, self-cleaning voices of their own.
      const primary = ctx.createOscillator();
      primary.type = 'sine';
      primary.frequency.value = hz;
      primary.connect(env);
      const upperPartials: Array<[number, number, number]> = [[2.01, 0.35, 0.6], [3.99, 0.18, 0.35]];
      for (const [ratio, gain, lengthScale] of upperPartials) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz * ratio;
        const g = ctx.createGain();
        g.gain.value = gain;
        osc.connect(g);
        g.connect(env);
        osc.start(start);
        osc.stop(start + (stopAt - start) * lengthScale);
        osc.onended = () => { osc.disconnect(); g.disconnect(); };
      }
      return { primary };
    }
    case 'bow': {
      // Slow-attack sawtooth through a gentle lowpass, with a slight
      // vibrato — a bowed-pad quality, deliberately distinct from the
      // plucked/mallet family.
      const primary = ctx.createOscillator();
      primary.type = 'sawtooth';
      primary.frequency.value = hz;
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.Q.value = 0.5;
      lpf.frequency.value = Math.min(12000, hz * 3);
      const vibrato = ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.value = 5;
      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = hz * 0.006;
      vibrato.connect(vibratoGain);
      vibratoGain.connect(primary.frequency);
      primary.connect(lpf);
      lpf.connect(env);
      vibrato.start(start);
      vibrato.stop(stopAt);
      vibrato.onended = () => { vibrato.disconnect(); vibratoGain.disconnect(); };
      return { primary, cleanup: () => lpf.disconnect() };
    }
    case 'pluck': {
      // Sawtooth through a lowpass whose cutoff sweeps sharply downward —
      // the filter envelope IS the "pluck", not the amplitude envelope.
      const primary = ctx.createOscillator();
      primary.type = 'sawtooth';
      primary.frequency.value = hz;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.Q.value = 0.4;
      filt.frequency.setValueAtTime(Math.min(16000, hz * 8), start);
      filt.frequency.exponentialRampToValueAtTime(Math.max(120, hz * 1.2), Math.max(start + 0.02, stopAt - (stopAt - start) * 0.3));
      primary.connect(filt);
      filt.connect(env);
      return { primary, cleanup: () => filt.disconnect() };
    }
    case 'breath': {
      // A soft sine blended with a bandpassed noise layer — "breathy sine".
      const primary = ctx.createOscillator();
      primary.type = 'sine';
      primary.frequency.value = hz;
      primary.connect(env);
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(9000, hz * 1.5);
      bp.Q.value = 1.2;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.3;
      noise.connect(bp);
      bp.connect(noiseGain);
      noiseGain.connect(env);
      noise.start(start);
      noise.stop(stopAt);
      noise.onended = () => { noise.disconnect(); bp.disconnect(); noiseGain.disconnect(); };
      return { primary };
    }
    case 'perc': {
      // A short, highpassed noise burst — generative percussion/texture.
      // The noise source itself is the primary voice here.
      const primary = ctx.createBufferSource();
      primary.buffer = noiseBuffer;
      primary.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.Q.value = 0.7;
      hp.frequency.value = Math.max(200, Math.min(9000, hz * 2));
      primary.connect(hp);
      hp.connect(env);
      return { primary, cleanup: () => hp.disconnect() };
    }
    case 'mallet':
    case 'glass':
    case 'pad':
    case 'accent':
    default: {
      const primary = ctx.createOscillator();
      primary.frequency.value = hz;
      primary.type = timbreWaveform(timbre);
      primary.connect(env);
      return { primary };
    }
  }
}
