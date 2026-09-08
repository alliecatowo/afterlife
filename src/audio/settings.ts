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
import {
  DEFAULT_CHURN_TIMBRE_WEIGHTS, DEFAULT_DISCOVERY_TIMBRES, MAX_DENSITY, MIN_DENSITY,
  type DiscoveryTimbreMap, type DroneShape, type ScaleContext, type WeightedTimbre,
} from './mapper';
import { MAX_ROOT_MIDI, MIN_ROOT_MIDI, SCALES, SCALE_MODES, TONIC_MIDI, type ScaleMode } from './scale';

/**
 * A named palette of synthesised voices — what makes "Glass"/"Deep"/"Chime"
 * sound like different instruments, not just different scales/tempos. See
 * `mapper.ts`'s `WeightedTimbre`/`DiscoveryTimbreMap`.
 */
export type TimbreSetName = 'classic' | 'bright' | 'warm';

export const TIMBRE_SETS: Record<TimbreSetName, { churn: readonly WeightedTimbre[]; discovery: DiscoveryTimbreMap }> = {
  classic: {
    churn: DEFAULT_CHURN_TIMBRE_WEIGHTS,
    discovery: DEFAULT_DISCOVERY_TIMBRES,
  },
  bright: {
    churn: [['glass', 0.4], ['pluck', 0.35], ['bell', 0.25]],
    discovery: {
      extinction: 'breath', extinctionEcho: 'bell', explosion: 'bell', explosionImpact: 'accent',
      stability: 'bell', oscillator: 'pluck', stillLife: 'pluck',
    },
  },
  warm: {
    churn: [['pad', 0.4], ['bow', 0.35], ['breath', 0.25]],
    discovery: {
      extinction: 'bow', extinctionEcho: 'breath', explosion: 'pad', explosionImpact: 'accent',
      stability: 'bow', oscillator: 'breath', stillLife: 'breath',
    },
  },
};

/**
 * A preset is a real bundle of scale/timbre/tempo/density/drone/decay,
 * applied together via `useAudioSettingsStore.applyPreset`. `observatory`
 * reproduces `DEFAULT_AUDIO_SETTINGS`'s musical fields exactly — the shipped
 * default stays the default. Root note, voice cap, scrubbing/percussion/
 * harmonic-movement preferences and MIDI/reactivity settings are left alone:
 * presets are a mood bundle, not a full reset (`resetToDefaults` exists for
 * that already).
 */
export type PresetName = 'observatory' | 'glass' | 'deep' | 'chime';

export interface PresetBundle {
  label: string;
  description: string;
  scaleMode: ScaleMode;
  timbreSet: TimbreSetName;
  bpm: number;
  density: number;
  droneWeight: number;
  droneFilterMinHz: number;
  droneFilterMaxHz: number;
  decay: number;
}

export const AUDIO_PRESETS: Record<PresetName, PresetBundle> = {
  observatory: {
    label: 'Observatory',
    description: 'The restrained default: mallet + glass over a soft filtered drone.',
    scaleMode: 'pentatonic', timbreSet: 'classic',
    bpm: 72, density: 1, droneWeight: 1, droneFilterMinHz: 180, droneFilterMaxHz: 2380, decay: 1,
  },
  glass: {
    label: 'Glass',
    description: 'Bright and airy — pluck, bell and glass over a lifted, shimmering drone.',
    scaleMode: 'lydian', timbreSet: 'bright',
    bpm: 84, density: 1.2, droneWeight: 0.7, droneFilterMinHz: 400, droneFilterMaxHz: 4200, decay: 1.3,
  },
  deep: {
    label: 'Deep',
    description: 'Slow and dark — bowed pads and breath tones, sparse and long-tailed.',
    scaleMode: 'dorian', timbreSet: 'warm',
    bpm: 56, density: 0.6, droneWeight: 1.4, droneFilterMinHz: 80, droneFilterMaxHz: 900, decay: 1.8,
  },
  chime: {
    label: 'Chime',
    description: 'Quick and bell-like, an ambiguous whole-tone shimmer, more active than the rest.',
    scaleMode: 'wholetone', timbreSet: 'bright',
    bpm: 96, density: 1.4, droneWeight: 0.5, droneFilterMinHz: 600, droneFilterMaxHz: 5200, decay: 1.1,
  },
};

export const PRESET_NAMES = Object.keys(AUDIO_PRESETS) as PresetName[];

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
  /** Last preset applied via `applyPreset` — informational (individual
   * sliders remain independently adjustable afterwards) and drives which
   * `TIMBRE_SETS` palette churn/discovery notes are drawn from. */
  preset: PresetName;
  /** Slow, real-population-trend-driven register drift (`harmony.ts`). On by
   * default — off reproduces the original static-register instrument. */
  harmonicMovement: boolean;
  /** Generative percussion/texture derived from real, heavily rate-limited
   * event rates (`mapper.ts`'s `mapPercussion`). Off by default: opt-in
   * texture, not a change to the shipped soundscape's character. */
  percussion: boolean;
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
  preset: 'observatory',
  harmonicMovement: true,
  percussion: false,
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
  const preset = PRESET_NAMES.includes(merged.preset) ? merged.preset : DEFAULT_AUDIO_SETTINGS.preset;
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
    preset,
    harmonicMovement: typeof merged.harmonicMovement === 'boolean' ? merged.harmonicMovement : DEFAULT_AUDIO_SETTINGS.harmonicMovement,
    percussion: typeof merged.percussion === 'boolean' ? merged.percussion : DEFAULT_AUDIO_SETTINGS.percussion,
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

/** Which named timbre palette the last-applied preset selects. Falls back to
 * `classic` for an unrecognised preset name rather than throwing (mirrors
 * `sanitizeAudioSettings`'s "never throw" contract). */
function timbreSetNameFromSettings(settings: AudioSettings): TimbreSetName {
  return (AUDIO_PRESETS[settings.preset] ?? AUDIO_PRESETS.observatory).timbreSet;
}

/** Bridge from the last-applied preset to the pure mapper's churn timbre
 * palette. */
export function churnTimbreWeightsFromSettings(settings: AudioSettings): readonly WeightedTimbre[] {
  return TIMBRE_SETS[timbreSetNameFromSettings(settings)].churn;
}

/** Bridge from the last-applied preset to the pure mapper's discovery timbre
 * map. */
export function discoveryTimbresFromSettings(settings: AudioSettings): DiscoveryTimbreMap {
  return TIMBRE_SETS[timbreSetNameFromSettings(settings)].discovery;
}
