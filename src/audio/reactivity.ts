/**
 * Pure feature-extraction + mapping math for system/mic audio reactivity. No
 * Web Audio, no DOM, no timers — takes plain typed-array snapshots and
 * numbers, so it's unit-testable exactly like `brain.ts`/`mapper.ts`. The
 * impure half (`capture.ts`) owns the `MediaStream`/`AnalyserNode`/interval
 * and just calls these functions with real analyser output.
 *
 * Everything here produces PRESENTATION/TEMPO numbers only (a density
 * multiplier, a filter range, a speed multiplier) — nothing in this module
 * or its caller ever touches simulation cell state. See `capture.ts`'s
 * header for where that boundary is enforced.
 */

/** Exponential moving average: `alpha` in (0, 1], higher = more responsive
 * (less smoothing). Used to keep the level/centroid readouts stable rather
 * than jittering with every analyser frame. */
export function smooth(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha;
}

/** RMS level of a time-domain byte buffer (as returned by
 * `AnalyserNode.getByteTimeDomainData`), normalised to 0..1. Silence (all
 * bytes at the 128 midpoint) reads exactly 0. */
export function computeLevel(timeDomain: Uint8Array): number {
  if (timeDomain.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const centered = (timeDomain[i]! - 128) / 128;
    sumSquares += centered * centered;
  }
  return Math.sqrt(sumSquares / timeDomain.length);
}

export interface Bands {
  bass: number;
  mid: number;
  treble: number;
}

/** Coarse three-band split of a frequency-domain byte buffer (as returned by
 * `AnalyserNode.getByteFrequencyData`), each 0..1. A cheap stand-in for a
 * real filterbank — three contiguous thirds of the bin range — which is
 * plenty of resolution for "nudge a filter cutoff", not intended for pitch
 * detection. */
export function computeBands(freq: Uint8Array): Bands {
  const n = freq.length;
  if (n === 0) return { bass: 0, mid: 0, treble: 0 };
  const third = Math.max(1, Math.floor(n / 3));
  const avg = (from: number, to: number): number => {
    let sum = 0;
    let count = 0;
    for (let i = from; i < to && i < n; i++) { sum += freq[i]!; count++; }
    return count > 0 ? sum / count / 255 : 0;
  };
  return { bass: avg(0, third), mid: avg(third, third * 2), treble: avg(third * 2, n) };
}

/** Spectral centroid (the "brightness" of the sound) as a 0..1 fraction of
 * the analyser's bin range — a magnitude-weighted mean bin index, not
 * converted to Hz since the caller only ever needs a relative "brighter /
 * darker" signal. Returns 0.5 (neutral) for pure silence to avoid a
 * meaningless divide-by-zero snapping the reading to an edge. */
export function computeCentroid(freq: Uint8Array): number {
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < freq.length; i++) {
    weighted += i * freq[i]!;
    total += freq[i]!;
  }
  if (total <= 0 || freq.length <= 1) return 0.5;
  return weighted / total / (freq.length - 1);
}

/**
 * Onset (transient/beat) detector: pure, driven by explicit calls rather
 * than timers. Flags an onset when `level` spikes well above its own recent
 * rolling average, debounced so a single sustained loud passage doesn't
 * register as a rapid-fire drum roll of onsets.
 */
export class OnsetDetector {
  #rollingAverage = 0;
  #lastOnsetAt = -Infinity;

  constructor(
    private readonly thresholdMultiplier = 1.5,
    private readonly minIntervalSeconds = 0.15,
    private readonly averageAlpha = 0.08,
  ) {}

  /** Feed one smoothed level reading at time `nowSeconds`. Returns true on
   * ticks where an onset is detected. */
  update(level: number, nowSeconds: number): boolean {
    const isOnset =
      level > 0.02 &&
      level > this.#rollingAverage * this.thresholdMultiplier &&
      nowSeconds - this.#lastOnsetAt >= this.minIntervalSeconds;
    // Update the rolling average with the pre-onset baseline weighting
    // regardless, so a sustained loud section raises the bar for what counts
    // as a "new" onset rather than firing on every tick.
    this.#rollingAverage = smooth(this.#rollingAverage, level, this.averageAlpha);
    if (isOnset) this.#lastOnsetAt = nowSeconds;
    return isOnset;
  }

  reset(): void {
    this.#rollingAverage = 0;
    this.#lastOnsetAt = -Infinity;
  }
}

/** `amount` 0..1: how strongly `level` should push the density multiplier
 * away from `baseline`. Clamped to the mapper's own density bounds by the
 * caller (`settingsStore.update` already clamps). */
export function reactiveDensity(baseline: number, level: number, amount: number): number {
  return baseline + level * amount * 1.5;
}

/** Shifts the drone's filter window up/down around its baseline by the
 * (0..1) spectral centroid, scaled by `amount` (0..1). Preserves the
 * baseline window's width. */
export function reactiveFilterRange(
  baselineMinHz: number,
  baselineMaxHz: number,
  centroid: number,
  amount: number,
): { minHz: number; maxHz: number } {
  const width = baselineMaxHz - baselineMinHz;
  const shift = (centroid - 0.5) * 2 * amount * width * 0.5;
  return { minHz: Math.max(20, baselineMinHz + shift), maxHz: Math.max(40, baselineMaxHz + shift) };
}

/** A bounded speed multiplier around 1.0, nudged by onsets: `amount` 0..1
 * controls how far a detected onset can momentarily push playback speed.
 * Always within [1 - amount*0.5, 1 + amount*0.5] so it can never stop or
 * runaway the simulation regardless of how audio-reactive it's set. */
export function reactiveSpeedMultiplier(onsetActive: boolean, amount: number): number {
  const bound = Math.max(0, Math.min(1, amount)) * 0.5;
  return onsetActive ? 1 + bound : 1 - bound * 0.3;
}
