/**
 * Slow harmonic movement, driven by a REAL sustained population trend — the
 * "so a 20-minute session doesn't sit on one static chord" feature. Pure and
 * timer-free: the caller (`brain.ts`) supplies wall/bucket time explicitly,
 * same discipline as `scheduler.ts`.
 *
 * Design: two exponential moving averages of population, one short (~45s
 * time constant) and one long (~5min). When the short EMA sits sustainably
 * above the long one, life is genuinely growing over a meaningful window —
 * nudge a small integer `shiftSteps` (in SCALE STEPS, not semitones) upward;
 * sustained decline nudges it down; a settled world drifts it back to 0.
 * Changes are hysteresis-gated (a minimum real-time interval between changes)
 * so this is a slow modulation, never a note-to-note wobble. `shiftSteps` is
 * added to the churn mapper's pitch calculation — it never changes the scale
 * or mode, so "can't sound wrong" is untouched; it just lets the register the
 * churn plays in drift with the world's real fortunes.
 */

/** Time constant (seconds) of the fast-reacting EMA. */
export const SHORT_TAU_SECONDS = 45;
/** Time constant (seconds) of the slow, "long-run normal" EMA. */
export const LONG_TAU_SECONDS = 300;
/** Minimum real time between successive shifts — this is what keeps the
 * movement "slow and subtle" rather than chasing every wiggle. */
export const MIN_CHANGE_INTERVAL_SECONDS = 60;
/** Relative deviation of short-EMA from long-EMA required to count as a real
 * trend (as a fraction of the long EMA). */
export const TREND_THRESHOLD = 0.12;
/** Deviation below which the trend counts as "settled" and shift relaxes
 * back toward 0 (a third of the trigger threshold — near, not exact, zero). */
export const SETTLE_THRESHOLD = TREND_THRESHOLD / 3;
/** Hard bound, in scale steps either direction — always gentle. */
export const MAX_SHIFT_STEPS = 2;

export interface HarmonicState {
  emaShort: number;
  emaLong: number;
  shiftSteps: number;
  lastChangeAt: number;
  initialized: boolean;
}

export const INITIAL_HARMONIC_STATE: HarmonicState = {
  emaShort: 0,
  emaLong: 0,
  shiftSteps: 0,
  lastChangeAt: -Infinity,
  initialized: false,
};

/**
 * Advance the harmonic state by one bucket. `population` and `nowSeconds`
 * are real simulation/session values (population, and bucket-boundary time);
 * `dtSeconds` is the elapsed time since the previous call (the bucket
 * length). Pure — returns a new state, never mutates `state`.
 */
export function updateHarmonicState(
  state: HarmonicState,
  population: number,
  nowSeconds: number,
  dtSeconds: number,
): HarmonicState {
  if (!state.initialized) {
    return { emaShort: population, emaLong: population, shiftSteps: 0, lastChangeAt: nowSeconds, initialized: true };
  }
  if (!(dtSeconds > 0)) return state;

  const aShort = 1 - Math.exp(-dtSeconds / SHORT_TAU_SECONDS);
  const aLong = 1 - Math.exp(-dtSeconds / LONG_TAU_SECONDS);
  const emaShort = state.emaShort + aShort * (population - state.emaShort);
  const emaLong = state.emaLong + aLong * (population - state.emaLong);

  let shiftSteps = state.shiftSteps;
  let lastChangeAt = state.lastChangeAt;
  const base = Math.max(1, emaLong);
  const trend = (emaShort - emaLong) / base;

  if (nowSeconds - lastChangeAt >= MIN_CHANGE_INTERVAL_SECONDS) {
    if (trend > TREND_THRESHOLD && shiftSteps < MAX_SHIFT_STEPS) {
      shiftSteps += 1;
      lastChangeAt = nowSeconds;
    } else if (trend < -TREND_THRESHOLD && shiftSteps > -MAX_SHIFT_STEPS) {
      shiftSteps -= 1;
      lastChangeAt = nowSeconds;
    } else if (Math.abs(trend) < SETTLE_THRESHOLD && shiftSteps !== 0) {
      shiftSteps += shiftSteps > 0 ? -1 : 1;
      lastChangeAt = nowSeconds;
    }
  }

  return { emaShort, emaLong, shiftSteps, lastChangeAt, initialized: true };
}
