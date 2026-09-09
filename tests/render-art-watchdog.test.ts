import { describe, expect, it } from 'vitest';
import {
  ART_FRAME_BUDGET_MS, ART_FRAME_HARD_CEILING_MS, ART_WATCHDOG_WINDOW, watchdogShouldTrip,
} from '@/render/renderer';

/**
 * The Art-mode frame-time watchdog's decision logic (see `watchdogShouldTrip`'s
 * doc in `renderer.ts`) — the primary defence against the real "Art mode
 * hard-crashed a Mac" production report, since a static cell-count ceiling
 * can't predict how expensive the same cell count is on different hardware.
 * Pure and canvas-free, so the actual trip decision is directly testable
 * here; the end-to-end "does a genuinely slow session actually get degraded"
 * proof lives in `e2e/art-perf.spec.ts`, which needs a real browser to
 * produce real frame costs.
 */
describe('watchdogShouldTrip (pure decision logic)', () => {
  it('never trips before the rolling window has enough samples, no matter how expensive they are', () => {
    const samples = Array(ART_WATCHDOG_WINDOW - 1).fill(ART_FRAME_BUDGET_MS * 10);
    expect(watchdogShouldTrip(samples, ART_FRAME_BUDGET_MS, ART_WATCHDOG_WINDOW)).toBe(false);
  });

  it('does not trip when the sustained average is comfortably under budget', () => {
    const samples = Array(ART_WATCHDOG_WINDOW).fill(ART_FRAME_BUDGET_MS * 0.3);
    expect(watchdogShouldTrip(samples, ART_FRAME_BUDGET_MS, ART_WATCHDOG_WINDOW)).toBe(false);
  });

  it('trips once the sustained average exceeds budget, even with no single catastrophic frame', () => {
    // Every individual sample is only modestly over budget — this is the
    // "every frame is a BIT too expensive, forever" shape the real crash
    // report actually looked like, not one dramatic stall.
    const samples = Array(ART_WATCHDOG_WINDOW).fill(ART_FRAME_BUDGET_MS * 1.5);
    expect(watchdogShouldTrip(samples, ART_FRAME_BUDGET_MS, ART_WATCHDOG_WINDOW)).toBe(true);
  });

  it('a single brief spike inside an otherwise-cheap window does not trip the average check', () => {
    const samples = Array(ART_WATCHDOG_WINDOW).fill(1);
    samples[3] = ART_FRAME_HARD_CEILING_MS - 1; // caller checks the hard ceiling separately, not via this function
    expect(watchdogShouldTrip(samples, ART_FRAME_BUDGET_MS, ART_WATCHDOG_WINDOW)).toBe(false);
  });

  it('an empty sample set never trips (no data yet, nothing to judge)', () => {
    expect(watchdogShouldTrip([], ART_FRAME_BUDGET_MS, ART_WATCHDOG_WINDOW)).toBe(false);
  });
});
