/**
 * The soundscape's tweakable parameters — pure data + validation, no Web
 * Audio, no zustand, no localStorage. `settingsStore.ts` wraps this in a
 * persisted zustand store for the UI; `audio.ts` subscribes to that store and
 * feeds these values into `SoundscapeBrain`/`SynthGraph`.
 *
 * Every field here maps to a REAL control in `@/ui/panels/AudioPanel` and a
 * REAL parameter somewhere in `brain.ts`/`mapper.ts`/`synth.ts` — nothing
 * decorative. Bounds are deliberately conservative: DESIGN.md's "can't sound
 * wrong" guarantee has to survive every combination of these sliders, so
 * every setter clamps rather than trusting the caller.
 */
import { MAX_BPM, MAX_VOICES, MIN_BPM, bucketSecondsForBpm } from './scheduler';
import { MAX_DENSITY, MIN_DENSITY, type DroneShape, type ScaleContext } from './mapper';
import { MAX_ROOT_MIDI, MIN_ROOT_MIDI, SCALES, SCALE_MODES, TONIC_MIDI, type ScaleMode } from './scale';

export interface AudioSettings {
  scaleMode: ScaleMode;
  /** MIDI note number of the tonal centre. */
  rootMidi: number;
  /** Tempo of the musical grid, in BPM. */
  bpm: number;
  /** Max simultaneously-sounding voices, 1..`MAX_VOICES`. */
  voiceCap: number;
  /** Multiplier on how readily churn produces notes, 0.25..2.5. */
  density: number;
  /** Multiplier on the ambient drone's gain, 0..2. */
  droneWeight: number;
  /** Drone low-pass sweep floor, Hz. */
  droneFilterMinHz: number;
  /** Drone low-pass sweep ceiling, Hz. */
  droneFilterMaxHz: number;
  /** Multiplier on note release length / reverb send, 0.25..2.5. */
  decay: number;
  /** Play a sparse preview note while dragging the timeline scrubber. */
  auditionOnScrub: boolean;
}

export const MIN_DRONE_WEIGHT = 0;
export const MAX_DRONE_WEIGHT = 2;
export const MIN_DRONE_FILTER_HZ = 40;
export const MAX_DRONE_FILTER_HZ = 8000;
export const MIN_DECAY = 0.25;
export const MAX_DECAY = 2.5;
export const MIN_VOICE_CAP = 1;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  scaleMode: 'pentatonic',
  rootMidi: TONIC_MIDI,
  bpm: 72,
  voiceCap: MAX_VOICES,
  density: 1,
  droneWeight: 1,
  droneFilterMinHz: 180,
  droneFilterMaxHz: 2380,
  decay: 1,
  auditionOnScrub: false,
};

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Merge `patch` onto `base` (defaulting to the shipped defaults) and clamp
 * every field to its valid range. Used both by the settings store's setters
 * (so a single out-of-range write can't corrupt state) and by
 * `sanitizeAudioSettings` (so a hand-edited or stale localStorage payload
 * degrades to sane values instead of throwing).
 */
export function clampAudioSettings(patch: Partial<AudioSettings>, base: AudioSettings = DEFAULT_AUDIO_SETTINGS): AudioSettings {
  const merged = { ...base, ...patch };
  const scaleMode = SCALE_MODES.includes(merged.scaleMode) ? merged.scaleMode : DEFAULT_AUDIO_SETTINGS.scaleMode;
  const droneFilterMinHz = clampNum(merged.droneFilterMinHz, MIN_DRONE_FILTER_HZ, MAX_DRONE_FILTER_HZ, DEFAULT_AUDIO_SETTINGS.droneFilterMinHz);
  const droneFilterMaxHzRaw = clampNum(merged.droneFilterMaxHz, MIN_DRONE_FILTER_HZ, MAX_DRONE_FILTER_HZ, DEFAULT_AUDIO_SETTINGS.droneFilterMaxHz);
  return {
    scaleMode,
    rootMidi: Math.round(clampNum(merged.rootMidi, MIN_ROOT_MIDI, MAX_ROOT_MIDI, DEFAULT_AUDIO_SETTINGS.rootMidi)),
    bpm: Math.round(clampNum(merged.bpm, MIN_BPM, MAX_BPM, DEFAULT_AUDIO_SETTINGS.bpm)),
    voiceCap: Math.round(clampNum(merged.voiceCap, MIN_VOICE_CAP, MAX_VOICES, DEFAULT_AUDIO_SETTINGS.voiceCap)),
    density: clampNum(merged.density, MIN_DENSITY, MAX_DENSITY, DEFAULT_AUDIO_SETTINGS.density),
    droneWeight: clampNum(merged.droneWeight, MIN_DRONE_WEIGHT, MAX_DRONE_WEIGHT, DEFAULT_AUDIO_SETTINGS.droneWeight),
    droneFilterMinHz: Math.min(droneFilterMinHz, droneFilterMaxHzRaw),
    droneFilterMaxHz: Math.max(droneFilterMinHz, droneFilterMaxHzRaw),
    decay: clampNum(merged.decay, MIN_DECAY, MAX_DECAY, DEFAULT_AUDIO_SETTINGS.decay),
    auditionOnScrub: typeof merged.auditionOnScrub === 'boolean' ? merged.auditionOnScrub : DEFAULT_AUDIO_SETTINGS.auditionOnScrub,
  };
}

/** Parse+validate an arbitrary JSON value (e.g. from localStorage) into a
 * fully-valid `AudioSettings`, never throwing — unknown/missing/corrupt
 * fields fall back to defaults field-by-field rather than discarding the
 * whole record. */
export function sanitizeAudioSettings(raw: unknown): AudioSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_AUDIO_SETTINGS };
  return clampAudioSettings(raw as Partial<AudioSettings>);
}

/** Bridge from panel settings to the pure mapper's `ScaleContext`. */
export function scaleContextFromSettings(settings: AudioSettings): ScaleContext {
  return { tonic: settings.rootMidi, intervals: SCALES[settings.scaleMode] };
}

/** Bridge from panel settings to the pure mapper's `DroneShape`. */
export function droneShapeFromSettings(settings: AudioSettings): DroneShape {
  return { weight: settings.droneWeight, filterMinHz: settings.droneFilterMinHz, filterMaxHz: settings.droneFilterMaxHz };
}

/** Bridge from the panel's BPM control to the brain's bucket-length parameter. */
export function bucketSecondsFromSettings(settings: AudioSettings): number {
  return bucketSecondsForBpm(settings.bpm);
}
