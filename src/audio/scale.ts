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

/** MIDI note number of the session's fixed tonal centre — A3. Never changes
 * at runtime; one tonal centre per session per DESIGN.md. */
export const TONIC_MIDI = 57;

/** Major-pentatonic intervals from the tonic, in semitones. */
export const SCALE_INTERVALS = [0, 2, 4, 7, 9] as const;

export const SCALE_LENGTH = SCALE_INTERVALS.length;

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
export function stepToMidi(step: number, tonic: number = TONIC_MIDI): number {
  const octave = Math.floor(step / SCALE_LENGTH);
  const degree = ((step % SCALE_LENGTH) + SCALE_LENGTH) % SCALE_LENGTH;
  return tonic + octave * 12 + SCALE_INTERVALS[degree]!;
}

/** True if `midi` sits exactly on the fixed scale relative to `tonic`. */
export function isInScale(midi: number, tonic: number = TONIC_MIDI): boolean {
  const rel = (((midi - tonic) % 12) + 12) % 12;
  return (SCALE_INTERVALS as readonly number[]).includes(rel);
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
): number {
  const clamped = Math.min(registerHighStep, Math.max(registerLowStep, Math.round(stepIntent)));
  return stepToMidi(clamped, tonic);
}

/** Convert a MIDI note number to frequency in Hz (A4 = 440Hz = MIDI 69). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
