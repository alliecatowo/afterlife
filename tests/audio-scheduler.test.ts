import { describe, expect, it } from 'vitest';
import {
  BUCKET_SECONDS, MAX_BPM, MAX_VOICES, MIN_BPM, VoicePool, bucketFloor, bucketSecondsForBpm,
  nextBucketBoundary, type NoteRequest,
} from '@/audio/scheduler';

function makeRequest(priority = 1): NoteRequest {
  return {
    pitch: 60, velocity: 0.2, pan: 0, duration: 1, timbre: 'mallet', source: 'churn', priority,
  };
}

describe('audio/scheduler grid', () => {
  it('bucketFloor and nextBucketBoundary are consistent with BUCKET_SECONDS', () => {
    const t = 10.73;
    const floor = bucketFloor(t);
    const next = nextBucketBoundary(floor);
    expect(next - floor).toBeCloseTo(BUCKET_SECONDS, 10);
    expect(floor).toBeLessThanOrEqual(t);
    expect(floor + BUCKET_SECONDS).toBeGreaterThan(t);
  });

  it('nextBucketBoundary is always strictly ahead of its input', () => {
    for (let t = 0; t < 20; t += 0.13) {
      expect(nextBucketBoundary(t)).toBeGreaterThan(t);
    }
  });
});

describe('audio/scheduler VoicePool concurrency cap', () => {
  it('never exceeds the configured max under a flood of requests', () => {
    const pool = new VoicePool(MAX_VOICES);
    const now = 0;
    let admitted = 0;
    for (let i = 0; i < 5000; i++) {
      const req = makeRequest(1);
      const scheduled = pool.tryAllocate(req, now, now);
      if (scheduled) admitted++;
      expect(pool.activeCount(now)).toBeLessThanOrEqual(MAX_VOICES);
    }
    // A flood of same-priority, non-expiring (duration 1s at t=0) requests
    // should only ever admit up to the cap, never more.
    expect(admitted).toBeLessThanOrEqual(MAX_VOICES);
  });

  it('respects a custom max voice count', () => {
    const pool = new VoicePool(3);
    const now = 0;
    for (let i = 0; i < 100; i++) pool.tryAllocate(makeRequest(1), now, now);
    expect(pool.activeCount(now)).toBeLessThanOrEqual(3);
  });

  it('expired voices free up slots over time', () => {
    const pool = new VoicePool(2);
    pool.tryAllocate({ ...makeRequest(1), duration: 0.5 }, 0, 0);
    pool.tryAllocate({ ...makeRequest(1), duration: 0.5 }, 0, 0);
    expect(pool.activeCount(0)).toBe(2);
    // both voices should have expired by t=1
    expect(pool.activeCount(1)).toBe(0);
    const scheduled = pool.tryAllocate(makeRequest(1), 1, 1);
    expect(scheduled).not.toBeNull();
  });

  it('higher-priority requests can steal a slot from a lower-priority voice', () => {
    const pool = new VoicePool(1);
    const low = pool.tryAllocate(makeRequest(1), 0, 0);
    expect(low).not.toBeNull();
    // Pool is full (1/1); a higher-priority request should steal the slot.
    const high = pool.tryAllocate(makeRequest(5), 0, 0);
    expect(high).not.toBeNull();
    expect(pool.activeCount(0)).toBe(1);
  });

  it('does not steal from an equal-or-higher priority voice', () => {
    const pool = new VoicePool(1);
    pool.tryAllocate(makeRequest(5), 0, 0);
    const rejected = pool.tryAllocate(makeRequest(5), 0, 0);
    expect(rejected).toBeNull();
    const rejectedLower = pool.tryAllocate(makeRequest(1), 0, 0);
    expect(rejectedLower).toBeNull();
    expect(pool.activeCount(0)).toBe(1);
  });

  it('reset() clears all active voices', () => {
    const pool = new VoicePool(2);
    pool.tryAllocate(makeRequest(1), 0, 0);
    pool.tryAllocate(makeRequest(1), 0, 0);
    expect(pool.activeCount(0)).toBe(2);
    pool.reset();
    expect(pool.activeCount(0)).toBe(0);
  });

  it('setMaxVoices live-adjusts the cap (the panel\'s "voice cap" control)', () => {
    const pool = new VoicePool(8);
    for (let i = 0; i < 8; i++) pool.tryAllocate(makeRequest(1), 0, 0);
    expect(pool.activeCount(0)).toBe(8);
    pool.setMaxVoices(3);
    expect(pool.maxVoices).toBe(3);
    // Tightening the cap doesn't retroactively cut already-sounding voices...
    expect(pool.activeCount(0)).toBe(8);
    // ...but new admissions are now held to the lower cap.
    const admitted = pool.tryAllocate(makeRequest(1), 0, 0);
    expect(admitted).toBeNull();
  });

  it('setMaxVoices never drops below 1 even if asked to', () => {
    const pool = new VoicePool(4);
    pool.setMaxVoices(0);
    expect(pool.maxVoices).toBe(1);
    pool.setMaxVoices(-5);
    expect(pool.maxVoices).toBe(1);
  });
});

describe('audio/scheduler — tempo-tunable bucket length', () => {
  it('bucketSecondsForBpm is a strictly decreasing function of bpm', () => {
    expect(bucketSecondsForBpm(MIN_BPM)).toBeGreaterThan(bucketSecondsForBpm(MAX_BPM));
  });

  it('clamps out-of-range bpm to [MIN_BPM, MAX_BPM]', () => {
    expect(bucketSecondsForBpm(0)).toBeCloseTo(bucketSecondsForBpm(MIN_BPM), 10);
    expect(bucketSecondsForBpm(10000)).toBeCloseTo(bucketSecondsForBpm(MAX_BPM), 10);
  });

  it('reproduces the fixed BUCKET_SECONDS constant at the original 72bpm', () => {
    expect(bucketSecondsForBpm(72)).toBeCloseTo(BUCKET_SECONDS, 10);
  });
});
