import { describe, expect, it } from 'vitest';
import {
  hash01, isInScale, midiToHz, quantizeToScale, stepToMidi, SCALE_INTERVALS, TONIC_MIDI,
} from '@/audio/scale';

describe('audio/scale', () => {
  it('stepToMidi always lands on the fixed pentatonic scale', () => {
    for (let step = -200; step <= 200; step++) {
      expect(isInScale(stepToMidi(step))).toBe(true);
    }
  });

  it('quantizeToScale always lands in-scale for arbitrary real-valued intent', () => {
    for (let i = -500; i <= 500; i++) {
      const raw = i * 0.37; // arbitrary, non-integral, unbounded
      const midi = quantizeToScale(raw);
      expect(isInScale(midi)).toBe(true);
    }
  });

  it('quantizeToScale respects the register window', () => {
    for (let i = -50; i <= 50; i++) {
      const midi = quantizeToScale(i, -2, 2);
      // -2..2 steps around the tonic, so within one octave either side plus slack
      expect(midi).toBeGreaterThanOrEqual(TONIC_MIDI - 12);
      expect(midi).toBeLessThanOrEqual(TONIC_MIDI + 12);
    }
  });

  it('isInScale rejects non-scale semitones', () => {
    // Tonic + 1 semitone is never a member of a major pentatonic built from
    // whole/major intervals [0,2,4,7,9].
    expect(isInScale(TONIC_MIDI + 1)).toBe(false);
    expect(isInScale(TONIC_MIDI + 3)).toBe(false);
  });

  it('every scale interval itself is in-scale at every octave', () => {
    for (const interval of SCALE_INTERVALS) {
      expect(isInScale(TONIC_MIDI + interval)).toBe(true);
      expect(isInScale(TONIC_MIDI + interval + 12)).toBe(true);
      expect(isInScale(TONIC_MIDI + interval - 12)).toBe(true);
    }
  });

  it('midiToHz is monotonic increasing', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 5);
    expect(midiToHz(81)).toBeCloseTo(880, 5);
    expect(midiToHz(57)).toBeLessThan(midiToHz(69));
  });

  it('hash01 is deterministic and bounded in [0, 1)', () => {
    for (let a = 0; a < 50; a++) {
      for (let b = 0; b < 5; b++) {
        const v1 = hash01(a, b);
        const v2 = hash01(a, b);
        expect(v1).toBe(v2);
        expect(v1).toBeGreaterThanOrEqual(0);
        expect(v1).toBeLessThan(1);
      }
    }
  });
});
