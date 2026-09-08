import { describe, expect, it } from 'vitest';
import {
  INITIAL_HARMONIC_STATE, MAX_SHIFT_STEPS, MIN_CHANGE_INTERVAL_SECONDS,
  updateHarmonicState,
} from '@/audio/harmony';

/** Drive `updateHarmonicState` for `steps` buckets of `dt` seconds each,
 * feeding the same `population` every time — mirrors how `brain.tick()`
 * really calls it, once per closed bucket. */
function run(population: number, steps: number, dt = 1, start = INITIAL_HARMONIC_STATE) {
  let state = start;
  let now = 0;
  for (let i = 0; i < steps; i++) {
    now += dt;
    state = updateHarmonicState(state, population, now, dt);
  }
  return state;
}

describe('audio/harmony — updateHarmonicState', () => {
  it('the first call just initialises both EMAs to the current population, with no shift', () => {
    const state = updateHarmonicState(INITIAL_HARMONIC_STATE, 500, 10, 10);
    expect(state.initialized).toBe(true);
    expect(state.emaShort).toBe(500);
    expect(state.emaLong).toBe(500);
    expect(state.shiftSteps).toBe(0);
  });

  it('a non-positive dt is a no-op once initialised', () => {
    const seeded = updateHarmonicState(INITIAL_HARMONIC_STATE, 500, 0, 0);
    const unchanged = updateHarmonicState(seeded, 5000, 10, 0);
    expect(unchanged).toEqual(seeded);
  });

  it('sustained real growth shifts upward within a few minutes, bounded at MAX_SHIFT_STEPS', () => {
    // Seed a low baseline, then sustain a much higher population. Checked
    // mid-growth (a few minutes in) — comfortably inside the window where
    // the short EMA has caught up but the long EMA hasn't yet, which is
    // exactly what "trend" means. (Given enough more time it correctly
    // relaxes back to 0 once the long EMA catches up too — see the
    // dedicated "relaxes back to 0" test below; that isn't a static chord
    // change, it's a transient nudge while things are actively changing.)
    let state = run(50, 30, 1);
    state = run(5000, 300, 1, state);
    expect(state.shiftSteps).toBeGreaterThan(0);
    expect(state.shiftSteps).toBeLessThanOrEqual(MAX_SHIFT_STEPS);
  });

  it('sustained real decline shifts downward within a few minutes, bounded at -MAX_SHIFT_STEPS', () => {
    let state = run(5000, 30, 1);
    state = run(50, 300, 1, state);
    expect(state.shiftSteps).toBeLessThan(0);
    expect(state.shiftSteps).toBeGreaterThanOrEqual(-MAX_SHIFT_STEPS);
  });

  it('relaxes the shift back to 0 once a new level has been held long enough to stop being a "trend"', () => {
    let state = run(50, 30, 1);
    state = run(5000, 300, 1, state); // mid-growth: shifted up
    expect(state.shiftSteps).toBeGreaterThan(0);
    // Keep holding the SAME constant population for a long time — once the
    // long EMA fully catches up, there's no more real trend left to track,
    // and a permanently-displaced register would defeat the point ("slow
    // movement", not "a new permanent key").
    state = run(5000, 3000, 1, state);
    expect(state.shiftSteps).toBe(0);
  });

  it('never changes more than once within MIN_CHANGE_INTERVAL_SECONDS of real time', () => {
    let state = run(50, 60, 1);
    const changeTimes: number[] = [];
    let now = 60;
    for (let i = 0; i < 500; i++) {
      const prevShift = state.shiftSteps;
      now += 1;
      state = updateHarmonicState(state, 5000, now, 1);
      if (state.shiftSteps !== prevShift) changeTimes.push(now);
    }
    for (let i = 1; i < changeTimes.length; i++) {
      expect(changeTimes[i]! - changeTimes[i - 1]!).toBeGreaterThanOrEqual(MIN_CHANGE_INTERVAL_SECONDS);
    }
  });

  it('is a pure function: identical inputs always produce identical output', () => {
    const a = updateHarmonicState({ emaShort: 100, emaLong: 80, shiftSteps: 1, lastChangeAt: 10, initialized: true }, 200, 50, 5);
    const b = updateHarmonicState({ emaShort: 100, emaLong: 80, shiftSteps: 1, lastChangeAt: 10, initialized: true }, 200, 50, 5);
    expect(a).toEqual(b);
  });
});
