import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { createTimelineStore, type TimelineStore } from '@/core/history';
import { DEFAULT_AUDIO_SETTINGS } from '@/audio/settings';
import { computeAudioPlan } from '@/export/audio/plan';

const SIZE = 64;

function emptyHistory(): TimelineStore {
  const engine = createEngine({ width: SIZE, height: SIZE });
  return createTimelineStore({ engine });
}

/** Steps `history`'s underlying engine forward `n` plain generations (no edits). */
function stepPlain(history: TimelineStore, n: number): void {
  const { engine } = history;
  for (let i = 0; i < n; i++) {
    engine.step();
    history.advance(engine.gen);
  }
}

/** Builds a history that is silent for `beforeGens`, then gets a burst of
 *  isolated single live cells (each guaranteed to die of underpopulation on
 *  the very next step under B3/S23 — no mutual interaction), then silent
 *  again for `afterGens`. Deterministic, controllable "activity happened
 *  once" fixture, independent of any actual chaotic CA evolution. */
function buildActivityBurstHistory(beforeGens: number, afterGens: number): TimelineStore {
  const engine = createEngine({ width: SIZE, height: SIZE });
  const history = createTimelineStore({ engine });
  stepPlain(history, beforeGens);

  const cells: Array<{ x: number; y: number; alive: boolean }> = [];
  for (let i = 0; i < 40; i++) {
    cells.push({ x: (i % 8) * 6 + 1, y: Math.floor(i / 8) * 6 + 1, alive: true });
  }
  for (const c of cells) engine.set(c.x, c.y, c.alive);
  history.record(engine.gen, [{ kind: 'set', cells }]);

  stepPlain(history, afterGens); // the burst cells all die next step; nothing after
  return history;
}

describe('computeAudioPlan: silence and activity', () => {
  it('a world that never has any cells stays silent (drone weight ~0) throughout', async () => {
    const history = emptyHistory();
    stepPlain(history, 20);
    const plan = await computeAudioPlan({
      history, fromGen: 0, toGen: 20, gensPerSecond: 10, settings: DEFAULT_AUDIO_SETTINGS,
    });
    expect(plan.cues.length).toBeGreaterThan(0);
    for (const cue of plan.cues) {
      expect(cue.drone.weight).toBeLessThan(0.01);
      expect(cue.notes).toHaveLength(0);
    }
  });

  it('an activity burst raises the drone above silence, and it decays back down afterward', async () => {
    const beforeGens = 10;
    const afterGens = 40;
    // Slow enough (< 1 generation per musical bucket — see `BUCKET_SECONDS`)
    // that the burst's birth (gen 10) and its guaranteed die-off (gen 11,
    // underpopulation) land in DIFFERENT buckets rather than cancelling out
    // within the same one — this is testing dynamics, not bucket aggregation.
    const gensPerSecond = 2;
    const history = buildActivityBurstHistory(beforeGens, afterGens);
    const plan = await computeAudioPlan({
      history, fromGen: 0, toGen: beforeGens + afterGens, gensPerSecond, settings: DEFAULT_AUDIO_SETTINGS,
    });

    const beforeBurstCues = plan.cues.filter((c) => c.atTime < beforeGens / gensPerSecond);
    const peakWeight = Math.max(...plan.cues.map((c) => c.drone.weight));
    const lastCues = plan.cues.slice(-5);

    for (const cue of beforeBurstCues) expect(cue.drone.weight).toBeLessThan(0.01);
    expect(peakWeight).toBeGreaterThan(0.01);
    for (const cue of lastCues) expect(cue.drone.weight).toBeLessThan(peakWeight);
  });

  it('is deterministic: identical setup produces bit-identical cues', async () => {
    const historyA = buildActivityBurstHistory(5, 15);
    const historyB = buildActivityBurstHistory(5, 15);
    const opts = { fromGen: 0, toGen: 20, gensPerSecond: 15, settings: DEFAULT_AUDIO_SETTINGS };
    const planA = await computeAudioPlan({ history: historyA, ...opts });
    const planB = await computeAudioPlan({ history: historyB, ...opts });
    expect(planA).toEqual(planB);
  });

  it('duration matches (toGen - fromGen) / gensPerSecond', async () => {
    const history = emptyHistory();
    stepPlain(history, 40);
    const plan = await computeAudioPlan({
      history, fromGen: 0, toGen: 40, gensPerSecond: 8, settings: DEFAULT_AUDIO_SETTINGS,
    });
    expect(plan.durationSeconds).toBeCloseTo(5, 10);
  });

  it('rejects a non-positive gensPerSecond', async () => {
    const history = emptyHistory();
    await expect(computeAudioPlan({
      history, fromGen: 0, toGen: 10, gensPerSecond: 0, settings: DEFAULT_AUDIO_SETTINGS,
    })).rejects.toThrow();
  });

  it('rejects toGen < fromGen', async () => {
    const history = emptyHistory();
    stepPlain(history, 5);
    await expect(computeAudioPlan({
      history, fromGen: 5, toGen: 0, gensPerSecond: 10, settings: DEFAULT_AUDIO_SETTINGS,
    })).rejects.toThrow();
  });

  it('propagates cancellation via AbortSignal', async () => {
    const history = emptyHistory();
    stepPlain(history, 50);
    const controller = new AbortController();
    controller.abort();
    await expect(computeAudioPlan({
      history, fromGen: 0, toGen: 50, gensPerSecond: 10, settings: DEFAULT_AUDIO_SETTINGS, signal: controller.signal,
    })).rejects.toThrow();
  });
});
