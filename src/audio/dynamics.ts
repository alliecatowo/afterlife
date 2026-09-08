/**
 * Smoothed, decaying "how alive is the board right now" dynamics for the
 * sustained drone layer. Pure and timer-free (same discipline as
 * `harmony.ts`) — the caller (`brain.ts`) supplies real elapsed time
 * explicitly every bucket, so this is deterministic and unit-testable.
 *
 * Two independent 0..1 exponential moving averages:
 *  - `activity`: a normalised CHURN RATE (births+deaths per second, from
 *    `mapper.ts`'s `resolveChurn`) — "the speed of shit moving around."
 *  - `motion`: a normalised population-CENTROID DRIFT SPEED — real travel of
 *    the world's mass (a glider swarm reads as "moving" even with modest
 *    churn; a static cluster of oscillators churns without moving at all).
 *
 * Both are driven ONLY by real per-bucket measurements fed in by the caller.
 * Critically, neither can be sustained by anything except a live, changing
 * board: a paused simulation stops producing `gen:changed`, so churn/centroid
 * deltas go to zero and both EMAs decay toward 0 on their own within a few
 * time constants — this is what makes "paused/static/extinct -> silence" an
 * emergent property of real measurement rather than a special-cased flag.
 */

export interface DroneDynamics {
  /** 0..1 EMA of normalised churn rate. */
  activity: number;
  /** 0..1 EMA of normalised centroid-drift speed. */
  motion: number;
}

export const INITIAL_DRONE_DYNAMICS: DroneDynamics = { activity: 0, motion: 0 };

/** Churn rate (churn units/second) that reads as "fully active" (1.0) before
 * clamping — tuned so ordinary background churn sits well under it and only
 * real bursts/high simulation speeds approach the ceiling. */
export const ACTIVITY_REFERENCE_RATE = 25;

/** Centroid-drift magnitude (world cells) per bucket that reads as "fully
 * moving" (1.0) before clamping — calibrated against a single travelling
 * pattern (e.g. a glider) producing a few cells of drift per update. */
export const MOTION_REFERENCE_DRIFT = 3;

/** Time constant (seconds) for both EMAs — long enough that ordinary
 * bucket-to-bucket noise doesn't flicker the drone, short enough that pausing
 * or extinction reads as genuine silence within a handful of seconds. */
export const DYNAMICS_TAU_SECONDS = 2.5;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Advance the dynamics by one bucket. `churnRatePerSecond` and
 * `centroidDriftMagnitude` are real, already-computed measurements for the
 * bucket that just closed (0 when nothing happened — never fabricated);
 * `dtSeconds` is that bucket's real length. Pure — returns a new state,
 * never mutates `state`. A non-positive `dtSeconds` is a no-op (guards
 * against a degenerate/zero bucket length).
 */
export function updateDroneDynamics(
  state: DroneDynamics,
  churnRatePerSecond: number,
  centroidDriftMagnitude: number,
  dtSeconds: number,
): DroneDynamics {
  if (!(dtSeconds > 0)) return state;
  const alpha = 1 - Math.exp(-dtSeconds / DYNAMICS_TAU_SECONDS);
  const targetActivity = clamp01(churnRatePerSecond / ACTIVITY_REFERENCE_RATE);
  const targetMotion = clamp01(centroidDriftMagnitude / MOTION_REFERENCE_DRIFT);
  return {
    activity: state.activity + alpha * (targetActivity - state.activity),
    motion: state.motion + alpha * (targetMotion - state.motion),
  };
}
