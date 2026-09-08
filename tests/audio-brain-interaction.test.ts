import { describe, expect, it } from 'vitest';
import { SoundscapeBrain } from '@/audio/brain';
import { isInScale } from '@/audio/scale';
import { MAX_VOICES, type ScheduledNote } from '@/audio/scheduler';

const TICK_STEP = 0.1;
const LOOKAHEAD = 0.2;

function runTicks(brain: SoundscapeBrain, totalSeconds: number, startAt = 0): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  let now = startAt;
  const end = startAt + totalSeconds;
  while (now <= end) {
    notes.push(...brain.tick(now, LOOKAHEAD).notes);
    now += TICK_STEP;
  }
  return notes;
}

describe('audio/brain — drawing/erasing feedback ("paint" events)', () => {
  it('a single paint event produces exactly one paint note, on the correct voice source', () => {
    const brain = new SoundscapeBrain();
    brain.onEvent({ kind: 'paint', nx: 0.5, ny: 0.5, alive: true }, 0);
    const notes = runTicks(brain, 1);
    const paintNotes = notes.filter((n) => n.source === 'paint');
    expect(paintNotes.length).toBe(1);
    expect(isInScale(paintNotes[0]!.pitch)).toBe(true);
  });

  it('rapid painting within one bucket only sounds the latest cell, never a burst', () => {
    const brain = new SoundscapeBrain();
    for (let i = 0; i < 50; i++) {
      brain.onEvent({ kind: 'paint', nx: i / 50, ny: 0.5, alive: true }, 0);
    }
    const notes = runTicks(brain, 1);
    expect(notes.filter((n) => n.source === 'paint').length).toBeLessThanOrEqual(1);
  });

  it('is suppressed entirely while scrubbing', () => {
    const brain = new SoundscapeBrain();
    brain.setScrubbing(true);
    brain.onEvent({ kind: 'paint', nx: 0.5, ny: 0.5, alive: true }, 0);
    const notes = runTicks(brain, 1);
    expect(notes.filter((n) => n.source === 'paint')).toHaveLength(0);
  });

  it('is silent entirely while muted', () => {
    const brain = new SoundscapeBrain();
    brain.setMuted(true);
    brain.onEvent({ kind: 'paint', nx: 0.5, ny: 0.5, alive: true }, 0);
    const notes = runTicks(brain, 1);
    expect(notes).toHaveLength(0);
  });
});

describe('audio/brain — stamp confirmation', () => {
  it('a stamp event produces notes scaled by the real cell count', () => {
    const brain = new SoundscapeBrain();
    brain.onEvent({ kind: 'stamp', cellCount: 200 }, 0);
    const notes = runTicks(brain, 1).filter((n) => n.source === 'stamp');
    expect(notes.length).toBe(4);
    for (const n of notes) expect(isInScale(n.pitch)).toBe(true);
  });

  it('is dropped, not queued, while scrubbing', () => {
    const brain = new SoundscapeBrain();
    brain.setScrubbing(true);
    brain.onEvent({ kind: 'stamp', cellCount: 50 }, 0);
    const duringScrub = runTicks(brain, 1);
    expect(duringScrub.filter((n) => n.source === 'stamp')).toHaveLength(0);
    brain.setScrubbing(false);
    const afterScrub = runTicks(brain, 1, 2);
    expect(afterScrub.filter((n) => n.source === 'stamp')).toHaveLength(0);
  });
});

describe('audio/brain — branch signature (forking a future)', () => {
  it('a branch event produces its own distinct two-note signature', () => {
    const brain = new SoundscapeBrain();
    brain.onEvent({ kind: 'branch', fromGen: 40 }, 0);
    const notes = runTicks(brain, 1).filter((n) => n.source === 'branch');
    expect(notes.length).toBe(2);
    for (const n of notes) expect(isInScale(n.pitch)).toBe(true);
  });

  it('never fires while muted', () => {
    const brain = new SoundscapeBrain();
    brain.setMuted(true);
    brain.onEvent({ kind: 'branch', fromGen: 40 }, 0);
    expect(runTicks(brain, 1)).toHaveLength(0);
  });
});

describe('audio/brain — proximity boost wiring', () => {
  it('setProximityBoost raises churn velocity relative to no boost, for the same activity', () => {
    const quiet = new SoundscapeBrain();
    quiet.setProximityBoost(0);
    for (let i = 0; i < 50; i++) quiet.onEvent({ kind: 'birth', count: 30 }, 0);
    const quietNotes = runTicks(quiet, 1).filter((n) => n.source === 'churn');

    const boosted = new SoundscapeBrain();
    boosted.setProximityBoost(1);
    for (let i = 0; i < 50; i++) boosted.onEvent({ kind: 'birth', count: 30 }, 0);
    const boostedNotes = runTicks(boosted, 1).filter((n) => n.source === 'churn');

    expect(boostedNotes.length).toBeGreaterThan(0);
    expect(quietNotes.length).toBeGreaterThan(0);
    // Same deterministic gen sequence on both, so directly comparable.
    expect(boostedNotes[0]!.velocity).toBeGreaterThanOrEqual(quietNotes[0]!.velocity);
  });

  it('clamps out-of-range values', () => {
    const brain = new SoundscapeBrain();
    brain.setProximityBoost(99);
    brain.onEvent({ kind: 'birth', count: 500 }, 0);
    // Should not throw and should stay a sane, bounded soundscape.
    expect(() => runTicks(brain, 1)).not.toThrow();
  });
});

describe('audio/brain — harmonic movement toggle', () => {
  /** Seed a low real-population baseline so a later switch to a much higher
   * one reads as genuine growth (an EMA that starts AT the new level has no
   * trend to detect — this mirrors a session that's actually been running,
   * not one that spawns already at 5000). */
  function seedLowBaseline(brain: SoundscapeBrain, now: number): number {
    for (let i = 0; i < 20; i++) {
      brain.onEvent({ kind: 'tick', gen: i, population: 50 }, now);
      now += TICK_STEP;
      brain.tick(now, LOOKAHEAD);
    }
    return now;
  }

  it('is on by default and reflects a live shift after sustained real growth', () => {
    const brain = new SoundscapeBrain();
    let now = seedLowBaseline(brain, 0);
    for (let i = 0; i < 3000; i++) {
      brain.onEvent({ kind: 'tick', gen: 1000 + i, population: 5000 }, now);
      now += TICK_STEP;
      brain.tick(now, LOOKAHEAD);
    }
    expect(brain.harmonicShiftSteps).toBeGreaterThan(0);
  });

  it('disabling it pins the shift at 0 even after the same sustained growth', () => {
    const brain = new SoundscapeBrain();
    brain.setHarmonicMovement(false);
    let now = seedLowBaseline(brain, 0);
    for (let i = 0; i < 3000; i++) {
      brain.onEvent({ kind: 'tick', gen: 1000 + i, population: 5000 }, now);
      now += TICK_STEP;
      brain.tick(now, LOOKAHEAD);
    }
    expect(brain.harmonicShiftSteps).toBe(0);
  });

  it('every note stays in-scale regardless of harmonic drift', () => {
    const brain = new SoundscapeBrain();
    let now = 0;
    const all: ScheduledNote[] = [];
    for (let i = 0; i < 2000; i++) {
      brain.onEvent({ kind: 'tick', gen: i, population: i % 2 === 0 ? 8000 : 10 }, now);
      if (i % 7 === 0) brain.onEvent({ kind: 'birth', count: 40 }, now);
      now += TICK_STEP;
      all.push(...brain.tick(now, LOOKAHEAD).notes);
    }
    for (const n of all) expect(isInScale(n.pitch)).toBe(true);
  });
});

describe('audio/brain — generative percussion respects the shared voice cap', () => {
  it('off by default: no percussion notes even under a flood', () => {
    const brain = new SoundscapeBrain(MAX_VOICES);
    for (let i = 0; i < 300; i++) brain.onEvent({ kind: 'birth', count: 1000 }, 0);
    const notes = runTicks(brain, 2);
    expect(notes.filter((n) => n.source === 'percussion')).toHaveLength(0);
  });

  it('when enabled, never pushes the concurrent-voice count past the cap', () => {
    const brain = new SoundscapeBrain(MAX_VOICES);
    brain.setPercussion(true);
    let now = 0;
    let maxObserved = 0;
    for (let i = 0; i < 300; i++) {
      brain.onEvent({ kind: 'birth', count: 1000 }, now);
      now += TICK_STEP;
      brain.tick(now, LOOKAHEAD);
      maxObserved = Math.max(maxObserved, brain.activeVoiceCount(now));
    }
    expect(maxObserved).toBeLessThanOrEqual(MAX_VOICES);
  });
});
