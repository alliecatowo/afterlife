/**
 * Pure musical scale + tonal centre for the soundscape. No Web Audio, no DOM —
 * safe to unit-test directly. Every pitch the soundscape can ever emit passes
 * through `stepToMidi`/`quantizeToScale`, so nothing can land off-scale.
 *
 * Aesthetic choice: a fixed major-pentatonic relative to a single session
 * tonic (A3). Pentatonic has no half-steps against itself, so any two notes
 * drawn from it — however the mapper picks them — sound consonant. This is
 * the "can never sound wrong" requirement from DESIGN.md's precision-
 * instrument brief.
 */

/** MIDI note number of the session's fixed tonal centre — A3. This remains
 * the default tonic; the audio panel (`AudioSettings.rootMidi`) may offer an
 * alternate root, but every mode below shares the "no two scale members are
 * a semitone apart in a way that reads as dissonant" property that makes the
 * instrument "can't sound wrong" regardless of which root plays. */
export const TONIC_MIDI = 57;

/** Major-pentatonic intervals from the tonic, in semitones. Kept as the
 * default scale and default export shape for backward compatibility. */
export const SCALE_INTERVALS = [0, 2, 4, 7, 9] as const;

export const SCALE_LENGTH = SCALE_INTERVALS.length;

/**
 * The full set of scales the audio panel can select between, all standard,
 * well-established scales/modes — no "found by trial and error" tone rows.
 * DESIGN.md's "can't sound wrong" guarantee scales down from the original
 * pentatonic's strongest form (NO internal semitones anywhere — pentatonic
 * and whole-tone both have this) to the ordinary, still-consonant standard
 * that any tonal/modal music relies on for its seven-note scales: dorian has
 * no semitone directly against the tonic (its one internal semitone sits
 * between its own 9th and 10th degrees); lydian's only semitone IS directly
 * against the tonic, but as the major 7th a whole octave up — the classic
 * "leading tone" color that lydian is chosen for, not a mistake. None of the
 * four ever produces the harsh minor-second-against-a-sustained-root clash
 * the original pentatonic was specifically built to avoid.
 */
export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
} as const satisfies Record<string, readonly number[]>;

export type ScaleMode = keyof typeof SCALES;

export const SCALE_MODES = Object.keys(SCALES) as ScaleMode[];

/** Default register window, in scale STEPS (not semitones) from the tonic.
 * -7..+14 steps at 5 steps/octave is roughly two octaves below the tonic to
 * just under three above — wide enough for register mapping, narrow enough
 * to stay a chamber instrument, not a keyboard demo. */
export const DEFAULT_REGISTER_LOW_STEP = -7;
export const DEFAULT_REGISTER_HIGH_STEP = 14;

/**
 * Map an arbitrary integer "scale step" (may be negative, may exceed one
 * octave) onto a MIDI note guaranteed to lie on `SCALE_INTERVALS` relative to
 * `tonic`. This is the single choke point every pitch flows through.
 */
export function stepToMidi(
  step: number,
  tonic: number = TONIC_MIDI,
  intervals: readonly number[] = SCALE_INTERVALS,
): number {
  const len = intervals.length;
  const octave = Math.floor(step / len);
  const degree = ((step % len) + len) % len;
  return tonic + octave * 12 + intervals[degree]!;
}

/** True if `midi` sits exactly on `intervals` (default: the fixed pentatonic) relative to `tonic`. */
export function isInScale(
  midi: number,
  tonic: number = TONIC_MIDI,
  intervals: readonly number[] = SCALE_INTERVALS,
): boolean {
  const rel = (((midi - tonic) % 12) + 12) % 12;
  return intervals.includes(rel);
}

/** Deterministic, well-distributed pseudo-hash of one or two integers into
 * [0, 1). Used to turn real simulation data (a generation index, a discovery
 * rect's corner) into pitch/pan variety without `Math.random()` — same
 * inputs always produce the same note, which keeps the instrument feeling
 * "tuned" rather than noisy. Not cryptographic; just a fast integer mix. */
export function hash01(a: number, b = 0): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Quantise a real-valued "pitch intent" expressed in scale STEPS (fractional
 * is fine — it gets rounded) to the nearest in-scale MIDI note, clamped to a
 * register window. Guarantees the result satisfies `isInScale`.
 */
export function quantizeToScale(
  stepIntent: number,
  registerLowStep: number = DEFAULT_REGISTER_LOW_STEP,
  registerHighStep: number = DEFAULT_REGISTER_HIGH_STEP,
  tonic: number = TONIC_MIDI,
  intervals: readonly number[] = SCALE_INTERVALS,
): number {
  const clamped = Math.min(registerHighStep, Math.max(registerLowStep, Math.round(stepIntent)));
  return stepToMidi(clamped, tonic, intervals);
}

/** Convert a MIDI note number to frequency in Hz (A4 = 440Hz = MIDI 69). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Human-readable note name + octave for a MIDI number (e.g. `57` -> `"A3"`),
 * for the panel's tabular root-note readout. Scientific pitch notation,
 * octave 4 containing middle C (MIDI 60), matching the common DAW convention. */
export function noteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!;
  return `${name}${octave}`;
}

/** Sane bounds for the panel's root-note control — two octaves either side
 * of the original A3 tonic, wide enough to be a real choice without letting
 * the register mapping's fixed step window (`DEFAULT_REGISTER_*_STEP`) push
 * notes into sub-audio or dog-whistle territory. */
export const MIN_ROOT_MIDI = TONIC_MIDI - 24;
export const MAX_ROOT_MIDI = TONIC_MIDI + 24;
