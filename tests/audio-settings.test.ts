import { describe, expect, it } from 'vitest';
import {
  clampAudioSettings, DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings,
  scaleContextFromSettings, droneShapeFromSettings, bucketSecondsFromSettings,
  MAX_DECAY, MIN_DECAY, MAX_DRONE_WEIGHT, MIN_DRONE_WEIGHT,
} from '@/audio/settings';
import { MAX_BPM, MAX_VOICES, MIN_BPM, bucketSecondsForBpm } from '@/audio/scheduler';
import { MAX_DENSITY, MIN_DENSITY } from '@/audio/mapper';
import { isInScale, MAX_ROOT_MIDI, MIN_ROOT_MIDI, SCALES } from '@/audio/scale';

describe('audio/settings — clampAudioSettings', () => {
  it('the shipped defaults are already valid (clamping them is a no-op)', () => {
    expect(clampAudioSettings({}, DEFAULT_AUDIO_SETTINGS)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('clamps every numeric field into its documented range', () => {
    const clamped = clampAudioSettings({
      rootMidi: 9999,
      bpm: -50,
      voiceCap: 999,
      density: 999,
      droneWeight: -5,
      droneFilterMinHz: -100,
      droneFilterMaxHz: 999999,
      decay: 999,
    });
    expect(clamped.rootMidi).toBeLessThanOrEqual(MAX_ROOT_MIDI);
    expect(clamped.rootMidi).toBeGreaterThanOrEqual(MIN_ROOT_MIDI);
    expect(clamped.bpm).toBeGreaterThanOrEqual(MIN_BPM);
    expect(clamped.bpm).toBeLessThanOrEqual(MAX_BPM);
    expect(clamped.voiceCap).toBeLessThanOrEqual(MAX_VOICES);
    expect(clamped.voiceCap).toBeGreaterThanOrEqual(1);
    expect(clamped.density).toBeLessThanOrEqual(MAX_DENSITY);
    expect(clamped.density).toBeGreaterThanOrEqual(MIN_DENSITY);
    expect(clamped.droneWeight).toBeLessThanOrEqual(MAX_DRONE_WEIGHT);
    expect(clamped.droneWeight).toBeGreaterThanOrEqual(MIN_DRONE_WEIGHT);
    expect(clamped.decay).toBeLessThanOrEqual(MAX_DECAY);
    expect(clamped.decay).toBeGreaterThanOrEqual(MIN_DECAY);
  });

  it('never lets the drone filter "low" exceed "high", swapping if given backwards', () => {
    const clamped = clampAudioSettings({ droneFilterMinHz: 5000, droneFilterMaxHz: 100 });
    expect(clamped.droneFilterMinHz).toBeLessThanOrEqual(clamped.droneFilterMaxHz);
  });

  it('falls back to the default scale mode for an unknown value', () => {
    const clamped = clampAudioSettings({ scaleMode: 'atonal-noise' as never });
    expect(clamped.scaleMode).toBe(DEFAULT_AUDIO_SETTINGS.scaleMode);
  });

  it('sanitizeAudioSettings never throws on garbage input and always returns valid settings', () => {
    for (const raw of [null, undefined, 42, 'nonsense', [], { rootMidi: 'not a number' }, { bpm: NaN }]) {
      const settings = sanitizeAudioSettings(raw);
      expect(() => clampAudioSettings({}, settings)).not.toThrow();
      expect(settings).toEqual(clampAudioSettings({}, settings));
    }
  });
});

describe('audio/settings — bridges into the pure mapper/scheduler types', () => {
  it('scaleContextFromSettings always produces an in-scale root and matching interval table', () => {
    for (const mode of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      const settings = clampAudioSettings({ scaleMode: mode, rootMidi: 61 });
      const ctx = scaleContextFromSettings(settings);
      expect(ctx.tonic).toBe(61);
      expect(ctx.intervals).toBe(SCALES[mode]);
      expect(isInScale(ctx.tonic, ctx.tonic, ctx.intervals)).toBe(true);
    }
  });

  it('droneShapeFromSettings carries the weight/filter fields through unchanged', () => {
    const settings = clampAudioSettings({ droneWeight: 1.4, droneFilterMinHz: 200, droneFilterMaxHz: 3000 });
    const shape = droneShapeFromSettings(settings);
    expect(shape).toEqual({ weight: 1.4, filterMinHz: 200, filterMaxHz: 3000 });
  });

  it('bucketSecondsFromSettings matches bucketSecondsForBpm for the same bpm', () => {
    const settings = clampAudioSettings({ bpm: 100 });
    expect(bucketSecondsFromSettings(settings)).toBeCloseTo(bucketSecondsForBpm(100), 10);
  });
});
