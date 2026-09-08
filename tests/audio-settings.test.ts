import { describe, expect, it } from 'vitest';
import {
  AUDIO_PRESETS, clampAudioSettings, DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings,
  scaleContextFromSettings, droneShapeFromSettings, bucketSecondsFromSettings,
  churnTimbreWeightsFromSettings, discoveryTimbresFromSettings, PRESET_NAMES,
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

describe('audio/settings — the shipped default reproduces the Observatory preset exactly', () => {
  it('every musical field DEFAULT_AUDIO_SETTINGS carries matches the observatory preset bundle', () => {
    const observatory = AUDIO_PRESETS.observatory;
    expect(DEFAULT_AUDIO_SETTINGS.scaleMode).toBe(observatory.scaleMode);
    expect(DEFAULT_AUDIO_SETTINGS.bpm).toBe(observatory.bpm);
    expect(DEFAULT_AUDIO_SETTINGS.density).toBe(observatory.density);
    expect(DEFAULT_AUDIO_SETTINGS.droneWeight).toBe(observatory.droneWeight);
    expect(DEFAULT_AUDIO_SETTINGS.droneFilterMinHz).toBe(observatory.droneFilterMinHz);
    expect(DEFAULT_AUDIO_SETTINGS.droneFilterMaxHz).toBe(observatory.droneFilterMaxHz);
    expect(DEFAULT_AUDIO_SETTINGS.decay).toBe(observatory.decay);
    expect(DEFAULT_AUDIO_SETTINGS.preset).toBe('observatory');
  });

  it('the observatory timbre bundle reproduces the original churn/discovery palette', () => {
    expect(churnTimbreWeightsFromSettings(DEFAULT_AUDIO_SETTINGS)).toEqual([['mallet', 0.65], ['glass', 0.35]]);
    expect(discoveryTimbresFromSettings(DEFAULT_AUDIO_SETTINGS).stillLife).toBe('mallet');
  });
});

describe('audio/settings — presets are real, distinct parameter bundles', () => {
  it('every preset name resolves to a bundle with a label/description and valid scale mode', () => {
    for (const name of PRESET_NAMES) {
      const bundle = AUDIO_PRESETS[name];
      expect(bundle.label.length).toBeGreaterThan(0);
      expect(bundle.description.length).toBeGreaterThan(0);
      expect(clampAudioSettings({ scaleMode: bundle.scaleMode }).scaleMode).toBe(bundle.scaleMode);
    }
  });

  it('non-observatory presets differ from the default in at least one musical field', () => {
    for (const name of PRESET_NAMES) {
      if (name === 'observatory') continue;
      const bundle = AUDIO_PRESETS[name];
      const differs = bundle.scaleMode !== DEFAULT_AUDIO_SETTINGS.scaleMode
        || bundle.bpm !== DEFAULT_AUDIO_SETTINGS.bpm
        || bundle.density !== DEFAULT_AUDIO_SETTINGS.density
        || bundle.droneWeight !== DEFAULT_AUDIO_SETTINGS.droneWeight
        || bundle.decay !== DEFAULT_AUDIO_SETTINGS.decay;
      expect(differs).toBe(true);
    }
  });

  it('churnTimbreWeightsFromSettings/discoveryTimbresFromSettings fall back to classic for a corrupt preset name', () => {
    const corrupt = { ...DEFAULT_AUDIO_SETTINGS, preset: 'nonsense' as never };
    expect(churnTimbreWeightsFromSettings(corrupt)).toEqual(churnTimbreWeightsFromSettings(DEFAULT_AUDIO_SETTINGS));
    expect(discoveryTimbresFromSettings(corrupt)).toEqual(discoveryTimbresFromSettings(DEFAULT_AUDIO_SETTINGS));
  });

  it('clampAudioSettings falls back to observatory for an unrecognised preset name', () => {
    const clamped = clampAudioSettings({ preset: 'nonsense' as never });
    expect(clamped.preset).toBe('observatory');
  });
});

describe('audio/settings — harmonicMovement/percussion clamp to booleans', () => {
  it('defaults are harmonicMovement=true, percussion=false', () => {
    expect(DEFAULT_AUDIO_SETTINGS.harmonicMovement).toBe(true);
    expect(DEFAULT_AUDIO_SETTINGS.percussion).toBe(false);
  });

  it('non-boolean input falls back to the default rather than throwing', () => {
    const clamped = clampAudioSettings({ harmonicMovement: 'yes' as never, percussion: 1 as never });
    expect(clamped.harmonicMovement).toBe(DEFAULT_AUDIO_SETTINGS.harmonicMovement);
    expect(clamped.percussion).toBe(DEFAULT_AUDIO_SETTINGS.percussion);
  });

  it('valid booleans pass through unchanged', () => {
    const clamped = clampAudioSettings({ harmonicMovement: false, percussion: true });
    expect(clamped.harmonicMovement).toBe(false);
    expect(clamped.percussion).toBe(true);
  });
});
