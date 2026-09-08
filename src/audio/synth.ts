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

/** Build a short (2s) buffer of white noise, looped, for the filtered-noise
 * drone — "gentle filtered noise for population movement" per DESIGN.md.
 * Generated at runtime; never a loaded sample file. */
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
  private readonly droneSource: AudioBufferSourceNode;
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
  private disposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);

    // Filtered-noise drone: always running once the context exists, gated to
    // near-silence by `droneGain` until `setDrone` is told there's a world
    // worth hearing.
    this.droneSource = ctx.createBufferSource();
    this.droneSource.buffer = buildNoiseBuffer(ctx);
    this.droneSource.loop = true;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.Q.value = 0.3;
    this.droneFilter.frequency.value = 180;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.dronePanner = ctx.createStereoPanner();

    this.droneSource.connect(this.droneFilter);
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.dronePanner);
    this.dronePanner.connect(this.master);
    this.droneSource.start();

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
    this.droneFilter.frequency.setTargetAtTime(params.cutoffHz, atTime, DRONE_RAMP_SECONDS / 3);
    this.droneGain.gain.setTargetAtTime(params.weight, atTime, DRONE_RAMP_SECONDS / 3);
    this.dronePanner.pan.setTargetAtTime(params.pan, atTime, DRONE_RAMP_SECONDS / 3);
  }

  /** Render one scheduled note as a short-lived voice. Self-disposing via
   * `onended` — callers never need to track or free these nodes. */
  playNote(note: ScheduledNote): void {
    const { ctx } = this;
    const hz = midiToHz(note.pitch);
    const start = note.time;
    const env = ctx.createGain();
    env.gain.value = 0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, note.pan));

    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    osc.type = timbreWaveform(note.timbre);

    const attack = timbreAttack(note.timbre);
    const release = note.duration;
    const peak = Math.max(0.001, Math.min(0.6, note.velocity));

    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.setTargetAtTime(0, start + attack, release / 3);

    osc.connect(env);
    env.connect(panner);
    panner.connect(this.master);
    // A parallel send to the reverb bus — silent (see `setReverbAmount`)
    // unless the panel's decay control has been turned up.
    panner.connect(this.reverbSend);

    const stopAt = start + attack + release + release; // let the tail ring out
    osc.start(start);
    osc.stop(stopAt);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      panner.disconnect();
    };
  }

  /** Tear down the whole graph. Safe to call once; idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.droneSource.stop(); } catch { /* already stopped */ }
    this.droneSource.disconnect();
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
    case 'mallet':
    default: return 0.005;
  }
}
