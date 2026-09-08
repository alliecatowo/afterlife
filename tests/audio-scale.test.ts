import { describe, expect, it } from 'vitest';
import {
  hash01, isInScale, midiToHz, noteName, quantizeToScale, stepToMidi, MAX_ROOT_MIDI,
  MIN_ROOT_MIDI, SCALE_INTERVALS, SCALE_MODES, SCALES, TONIC_MIDI,
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

describe('audio/scale — alternate scale modes (the panel\'s scale picker)', () => {
  it('every scale mode "can\'t sound wrong": every step lands in that mode\'s own scale, at any root', () => {
    for (const mode of SCALE_MODES) {
      const intervals = SCALES[mode];
      const root = 50;
      for (let step = -60; step <= 60; step++) {
        expect(isInScale(stepToMidi(step, root, intervals), root, intervals)).toBe(true);
      }
    }
  });

  it('pentatonic and whole-tone have no internal semitones at all (any two of their notes are mutually consonant)', () => {
    for (const mode of ['pentatonic', 'wholetone'] as const) {
      const intervals = [...SCALES[mode]].sort((a, b) => a - b);
      for (let i = 1; i < intervals.length; i++) expect(intervals[i]! - intervals[i - 1]!).toBeGreaterThanOrEqual(2);
      // ...including wrapping from the top degree back up to the octave.
      expect(12 - intervals[intervals.length - 1]!).toBeGreaterThanOrEqual(2);
    }
  });

  it('none of the four scales ever produces a semitone (interval 1) directly against the tonic', () => {
    // The harsh minor-second-against-a-sustained-drone clash is exactly what
    // the original pentatonic was built to avoid; lydian's major-7th (11) is
    // a deliberate, standard color tone a full octave up, not this clash.
    for (const mode of SCALE_MODES) {
      expect((SCALES[mode] as readonly number[]).includes(1)).toBe(false);
    }
  });

  it('quantizeToScale respects an alternate scale/tonic pair passed explicitly', () => {
    const intervals = SCALES.dorian;
    for (let i = -80; i <= 80; i++) {
      const midi = quantizeToScale(i * 0.53, -10, 10, 62, intervals);
      expect(isInScale(midi, 62, intervals)).toBe(true);
    }
  });
});

describe('audio/scale — noteName + root-note bounds', () => {
  it('renders the fixed tonic as A3', () => {
    expect(noteName(TONIC_MIDI)).toBe('A3');
  });

  it('is exactly periodic by octave (adding 12 always bumps the octave digit by one)', () => {
    for (let midi = 40; midi < 90; midi++) {
      const a = noteName(midi);
      const b = noteName(midi + 12);
      expect(a.replace(/-?\d+$/, '')).toBe(b.replace(/-?\d+$/, ''));
    }
  });

  it('the root-note bounds are centred on the tonic and stay well clear of extreme registers', () => {
    expect(MIN_ROOT_MIDI).toBeLessThan(TONIC_MIDI);
    expect(MAX_ROOT_MIDI).toBeGreaterThan(TONIC_MIDI);
    expect(MAX_ROOT_MIDI - MIN_ROOT_MIDI).toBe(48); // two octaves either side
  });
});
