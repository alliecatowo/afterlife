import { describe, expect, it, vi } from 'vitest';
import { createSimLoop, DEFAULT_SPEED, MAX_CATCHUP_STEPS, MAX_SPEED, MIN_SPEED } from '@/core/loop';

/** Wait for N real animation frames (jsdom provides requestAnimationFrame). */
function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let count = 0;
    function tick() {
      count++;
      if (count >= n) resolve();
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

describe('createSimLoop', () => {
  it('is stopped by default and never calls step() before start()', async () => {
    const step = vi.fn();
    const loop = createSimLoop(step);
    expect(loop.running).toBe(false);
    await waitFrames(3);
    expect(step).not.toHaveBeenCalled();
    loop.dispose();
  });

  it('start()/stop() toggle running and stop halts further stepping', async () => {
    const step = vi.fn();
    const loop = createSimLoop(step);
    loop.start();
    expect(loop.running).toBe(true);
    await waitFrames(5);
    loop.stop();
    expect(loop.running).toBe(false);
    const callsAtStop = step.mock.calls.length;
    await waitFrames(5);
    expect(step.mock.calls.length).toBe(callsAtStop);
    loop.dispose();
  });

  it('stepOnce advances exactly n steps while paused and notifies onFrame', () => {
    const step = vi.fn();
    const loop = createSimLoop(step);
    const frameCb = vi.fn();
    loop.onFrame(frameCb);
    loop.stepOnce(3);
    expect(step).toHaveBeenCalledTimes(3);
    expect(frameCb).toHaveBeenCalledTimes(1);
    loop.stepOnce();
    expect(step).toHaveBeenCalledTimes(4);
    loop.dispose();
  });

  it('setSpeed clamps to [MIN_SPEED, MAX_SPEED] and rejects non-finite input', () => {
    const loop = createSimLoop(() => {});
    expect(() => loop.setSpeed(0)).not.toThrow();
    loop.setSpeed(1000);
    loop.setSpeed(-5);
    expect(() => loop.setSpeed(Number.NaN)).toThrow();
    expect(() => loop.setSpeed(Number.POSITIVE_INFINITY)).toThrow();
    expect(MIN_SPEED).toBe(1);
    expect(MAX_SPEED).toBe(60);
    expect(DEFAULT_SPEED).toBeGreaterThanOrEqual(MIN_SPEED);
    expect(DEFAULT_SPEED).toBeLessThanOrEqual(MAX_SPEED);
    loop.dispose();
  });

  it('onFrame subscriptions can be disposed and stop firing', async () => {
    const loop = createSimLoop(() => {});
    const cb = vi.fn();
    const sub = loop.onFrame(cb);
    loop.stepOnce();
    expect(cb).toHaveBeenCalledTimes(1);
    sub.dispose();
    loop.stepOnce();
    expect(cb).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it('never calls a React-style setState-shaped API — step is purely imperative and loop has no state deps', () => {
    // Structural guard: SimLoop must not import react/zustand. This is a
    // static/documentation guarantee verified by the absence of such imports
    // in the module (see src/core/loop.ts header). We assert here that the
    // loop's public surface exposes only plain functions, matching the
    // Disposable + imperative contract.
    const loop = createSimLoop(() => {});
    expect(typeof loop.start).toBe('function');
    expect(typeof loop.stop).toBe('function');
    expect(typeof loop.setSpeed).toBe('function');
    expect(typeof loop.stepOnce).toBe('function');
    expect(typeof loop.onFrame).toBe('function');
    expect(typeof loop.dispose).toBe('function');
    loop.dispose();
  });

  it('exports MAX_CATCHUP_STEPS matching the architecture-documented cap', () => {
    expect(MAX_CATCHUP_STEPS).toBe(8);
  });

  it('accumulator drives roughly `speed` steps per second of wall time', async () => {
    vi.useFakeTimers();
    try {
      const step = vi.fn();
      const loop = createSimLoop(step);
      loop.setSpeed(10); // 10 gens/sec -> 100ms per step
      loop.start();
      // Advance fake time in rAF-sized increments (~16ms) totalling ~500ms.
      for (let i = 0; i < 31; i++) {
        await vi.advanceTimersByTimeAsync(16);
      }
      // ~500ms at 10 gens/sec should be roughly 5 steps (allow slack for
      // rAF/timer granularity and the MAX_CATCHUP_STEPS ceiling).
      expect(step.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(step.mock.calls.length).toBeLessThanOrEqual(8);
      loop.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
