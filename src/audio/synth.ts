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
