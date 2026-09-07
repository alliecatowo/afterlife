import { describe, expect, it } from 'vitest';
import { AUDITION_MIN_INTERVAL_SECONDS, SoundscapeBrain } from '@/audio/brain';
import { isInScale } from '@/audio/scale';
import { MAX_VOICES, type ScheduledNote } from '@/audio/scheduler';
import type { DiscoveryEvent } from '@/core/types';

const TICK_STEP = 0.1; // mirrors audio.ts's ~100ms scheduler cadence
const LOOKAHEAD = 0.2;

/** Drive `brain.tick()` the way `audio.ts` really does — small, regular
 * wall-clock steps with a lookahead window — for `totalSeconds`, collecting
 * every note and the running max concurrent-voice count observed. */
function runTicks(
  brain: SoundscapeBrain,
  totalSeconds: number,
  startAt = 0,
): { notes: ScheduledNote[]; maxVoices: number } {
  const notes: ScheduledNote[] = [];
  let maxVoices = 0;
  let now = startAt;
  const end = startAt + totalSeconds;
  while (now <= end) {
    const out = brain.tick(now, LOOKAHEAD);
    notes.push(...out.notes);
    maxVoices = Math.max(maxVoices, brain.activeVoiceCount(now));
    now += TICK_STEP;
  }
  return { notes, maxVoices };
}

describe('audio/brain — bucketing under a flood of synthetic births', () => {
  it('aggregates hundreds of births into a handful of notes per bucket, not one per birth', () => {
    const brain = new SoundscapeBrain();
    // A 256x160 world producing hundreds of births in a single generation,
    // fed as many small events, all before any bucket has closed.
    for (let i = 0; i < 400; i++) brain.onEvent({ kind: 'birth', count: 3 }, 0);
    const { notes } = runTicks(brain, 1.5);
    const churnNotes = notes.filter((n) => n.source === 'churn');
    expect(churnNotes.length).toBeGreaterThan(0);
    // Never anywhere close to 400 births -> 400 notes; the mapper caps
    // density at 3 voices per bucket regardless of how large churn gets.
    expect(churnNotes.length).toBeLessThanOrEqual(3);
  });

  it('never exceeds the concurrent-voice cap across a long flood at high generation rates', () => {
    const brain = new SoundscapeBrain(MAX_VOICES);
    let now = 0;
    let maxObserved = 0;
    const allNotes: ScheduledNote[] = [];
    for (let i = 0; i < 400; i++) {
      // Simulate a torrent of births/deaths far exceeding what any bucket
      // could reasonably voice 1:1 (e.g. 60gen/s on a dense world).
      brain.onEvent({ kind: 'birth', count: 200 }, now);
      brain.onEvent({ kind: 'death', count: 150 }, now);
      now += TICK_STEP;
      const { notes } = brain.tick(now, LOOKAHEAD);
      allNotes.push(...notes);
      maxObserved = Math.max(maxObserved, brain.activeVoiceCount(now));
    }
    expect(maxObserved).toBeLessThanOrEqual(MAX_VOICES);
    for (const n of allNotes) expect(isInScale(n.pitch)).toBe(true);
  });

  it('produces only in-scale pitches under sustained asymmetric growth/decline', () => {
    const brain = new SoundscapeBrain();
    let now = 0;
    const allNotes: ScheduledNote[] = [];
    for (let i = 0; i < 80; i++) {
      brain.onEvent({ kind: 'tick', gen: i, population: i % 2 === 0 ? 10000 : 0 }, now);
      now += TICK_STEP;
      allNotes.push(...brain.tick(now, LOOKAHEAD).notes);
    }
    expect(allNotes.length).toBeGreaterThan(0);
    for (const n of allNotes) expect(isInScale(n.pitch)).toBe(true);
  });
});

describe('audio/brain — scrubbing suppression', () => {
  it('suppresses churn notes entirely while scrubbing without audition mode', () => {
    const brain = new SoundscapeBrain();
    brain.setScrubbing(true);
    for (let i = 0; i < 200; i++) brain.onEvent({ kind: 'birth', count: 500 }, 0);
    const { notes } = runTicks(brain, 1.5);
    expect(notes.filter((n) => n.source === 'churn')).toHaveLength(0);
  });

  it('resumes churn notes once scrubbing ends', () => {
    const brain = new SoundscapeBrain();
    brain.setScrubbing(true);
    for (let i = 0; i < 200; i++) brain.onEvent({ kind: 'birth', count: 500 }, 0);
    runTicks(brain, 1.5); // discard whatever accumulated while scrubbing
    brain.setScrubbing(false);
    for (let i = 0; i < 200; i++) brain.onEvent({ kind: 'birth', count: 500 }, 2);
    const { notes } = runTicks(brain, 1.5, 2);
    expect(notes.filter((n) => n.source === 'churn').length).toBeGreaterThan(0);
  });

  it('audition mode plays a sparse, rate-limited rendering while scrubbing', () => {
    const brain = new SoundscapeBrain();
    brain.setScrubbing(true);
    brain.setAudition(true);
    let now = 0;
    let admitted = 0;
    // Drag the scrubber fast: many scrub events packed close together, well
    // beyond what a naive 1:1 mapping could get away with.
    for (let i = 0; i < 60; i++) {
      brain.onEvent({ kind: 'scrub', gen: i }, now);
      now += 0.02;
      admitted += brain.tick(now, LOOKAHEAD).notes.filter((n) => n.source === 'audition').length;
    }
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThan(10); // 1.2s of dragging, ~1.25s min spacing
    expect(AUDITION_MIN_INTERVAL_SECONDS).toBeGreaterThan(0.02);
  });

  it('discoveries made mid-scrub are dropped, not queued for later', () => {
    const brain = new SoundscapeBrain();
    brain.setScrubbing(true);
    const discovery: DiscoveryEvent = {
      id: 'd1', kind: 'oscillator', gen: 1, rect: { x: 0, y: 0, w: 4, h: 4 }, label: 'blinker',
    };
    brain.onEvent({ kind: 'discovery', discovery }, 0);
    const duringScrub = runTicks(brain, 1.5);
    expect(duringScrub.notes.filter((n) => n.source === 'discovery')).toHaveLength(0);
    brain.setScrubbing(false);
    const afterScrub = runTicks(brain, 1.5, 2);
    expect(afterScrub.notes.filter((n) => n.source === 'discovery')).toHaveLength(0);
  });
});

describe('audio/brain — mute stops all scheduling', () => {
  it('emits no notes and drops drone gain while muted, even under a flood', () => {
    const brain = new SoundscapeBrain();
    brain.setMuted(true);
    for (let i = 0; i < 500; i++) brain.onEvent({ kind: 'birth', count: 1000 }, 0);
    const discovery: DiscoveryEvent = {
      id: 'd1', kind: 'explosion', gen: 1, rect: { x: 0, y: 0, w: 4, h: 4 }, label: 'boom',
    };
    brain.onEvent({ kind: 'discovery', discovery }, 0);
    const { notes, maxVoices } = runTicks(brain, 2);
    expect(notes).toHaveLength(0);
    expect(maxVoices).toBe(0);
  });

  it('does not burst a backlog of muted-period events after unmuting', () => {
    const brain = new SoundscapeBrain();
    brain.setMuted(true);
    for (let i = 0; i < 500; i++) brain.onEvent({ kind: 'birth', count: 1000 }, 0);
    brain.setMuted(false);
    const { maxVoices } = runTicks(brain, 2);
    expect(maxVoices).toBeLessThanOrEqual(MAX_VOICES);
  });
});
