import { describe, expect, it } from 'vitest';
import {
  AUDIO_PRESETS, clampAudioSettings, DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings,
  scaleContextFromSettings, droneShapeFromSettings, bucketSecondsFromSettings,
  churnTimbreWeightsFromSettings, discoveryTimbresFromSettings, PRESET_NAMES,
  MAX_DECAY, MIN_DECAY, MAX_DRONE_WEIGHT, MIN_DRONE_WEIGHT,
} from '@/audio/settings';
import { MAX_BPM, MAX_VOICES, MIN_BPM, bucketSecondsForBpm } from '@/audio/scheduler';
import { mapDrone, MAX_DENSITY, MIN_DENSITY } from '@/audio/mapper';
import { isInScale, MAX_ROOT_MIDI, MIN_ROOT_MIDI, SCALES } from '@/audio/scale';
import { SoundscapeBrain } from '@/audio/brain';

const TICK_STEP = 0.1;
const LOOKAHEAD = 0.2;

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

/**
 * Fix 3 ("every control must produce an obvious, audible change") verified
 * end-to-end through the SAME bridge functions `audio.ts` uses to wire the
 * panel into the live instrument — not just asserting a store value changed,
 * but driving `SoundscapeBrain`/`mapDrone` with the mapped settings and
 * counting the actual scheduled output over a fixed window.
 */
describe('audio/settings — panel controls produce real, measurable output differences', () => {
  function feedIdenticalChurnStream(brain: SoundscapeBrain, seconds: number, bucketSeconds: number): number {
    let now = 0;
    let churnNotes = 0;
    const end = seconds;
    // A steady, moderate real churn rate — enough to land solidly in the
    // "sparse" classification band at the default density/tempo so density
    // and tempo changes have visible room to move it in either direction.
    while (now <= end) {
      brain.onEvent({ kind: 'birth', count: 6 }, now);
      brain.onEvent({ kind: 'death', count: 4 }, now);
      now += TICK_STEP;
      const { notes } = brain.tick(now, LOOKAHEAD);
      churnNotes += notes.filter((n) => n.source === 'churn').length;
    }
    void bucketSeconds;
    return churnNotes;
  }

  it('tempo (bpm): a faster tempo schedules more churn events over the same fixed real-time window', () => {
    const slow = new SoundscapeBrain();
    slow.setBucketSeconds(bucketSecondsFromSettings(clampAudioSettings({ bpm: MIN_BPM })));
    const fast = new SoundscapeBrain();
    fast.setBucketSeconds(bucketSecondsFromSettings(clampAudioSettings({ bpm: MAX_BPM })));

    const slowCount = feedIdenticalChurnStream(slow, 8, bucketSecondsForBpm(MIN_BPM));
    const fastCount = feedIdenticalChurnStream(fast, 8, bucketSecondsForBpm(MAX_BPM));

    expect(fastCount).toBeGreaterThan(slowCount);
  });

  it('density: MAX_DENSITY produces meaningfully more churn notes than MIN_DENSITY over the same window', () => {
    const sparse = new SoundscapeBrain();
    sparse.setDensity(clampAudioSettings({ density: MIN_DENSITY }).density);
    const dense = new SoundscapeBrain();
    dense.setDensity(clampAudioSettings({ density: MAX_DENSITY }).density);

    const sparseCount = feedIdenticalChurnStream(sparse, 8, bucketSecondsForBpm(DEFAULT_AUDIO_SETTINGS.bpm));
    const denseCount = feedIdenticalChurnStream(dense, 8, bucketSecondsForBpm(DEFAULT_AUDIO_SETTINGS.bpm));

    expect(denseCount).toBeGreaterThan(sparseCount);
  });

  it('voice cap: lowering it measurably lowers the max concurrent voices admitted under the same flood', () => {
    const capped = new SoundscapeBrain(MAX_VOICES);
    capped.setVoiceCap(clampAudioSettings({ voiceCap: 1 }).voiceCap);
    const uncapped = new SoundscapeBrain(MAX_VOICES);
    uncapped.setVoiceCap(clampAudioSettings({ voiceCap: MAX_VOICES }).voiceCap);

    let now = 0;
    let cappedMax = 0;
    let uncappedMax = 0;
    for (let i = 0; i < 60; i++) {
      capped.onEvent({ kind: 'birth', count: 200 }, now);
      uncapped.onEvent({ kind: 'birth', count: 200 }, now);
      now += TICK_STEP;
      capped.tick(now, LOOKAHEAD);
      uncapped.tick(now, LOOKAHEAD);
      cappedMax = Math.max(cappedMax, capped.activeVoiceCount(now));
      uncappedMax = Math.max(uncappedMax, uncapped.activeVoiceCount(now));
    }
    expect(cappedMax).toBeLessThan(uncappedMax);
    expect(cappedMax).toBeLessThanOrEqual(1);
  });

  it('drone weight: the panel bounds map to a real, wide gain range through droneShapeFromSettings + mapDrone', () => {
    const inputs = { activity: 0.7, motion: 0.3, population: 1000 };
    const min = mapDrone(inputs, 0, droneShapeFromSettings(clampAudioSettings({ droneWeight: MIN_DRONE_WEIGHT })));
    const neutral = mapDrone(inputs, 0, droneShapeFromSettings(clampAudioSettings({ droneWeight: 1 })));
    const max = mapDrone(inputs, 0, droneShapeFromSettings(clampAudioSettings({ droneWeight: MAX_DRONE_WEIGHT })));
    expect(min.weight).toBe(0);
    expect(neutral.weight).toBeGreaterThan(0);
    expect(max.weight).toBeCloseTo(neutral.weight * MAX_DRONE_WEIGHT, 5); // MAX_DRONE_WEIGHT is 2x neutral
  });

  it('drone filter range: min/max panel bounds produce a wide, distinct brightness sweep', () => {
    const narrowInputs = { activity: 0, motion: 0, population: 0 };
    const brightInputs = { activity: 1, motion: 0, population: 2000 };
    const shape = droneShapeFromSettings(clampAudioSettings({}));
    const dark = mapDrone(narrowInputs, 0, shape);
    const bright = mapDrone(brightInputs, 0, shape);
    expect(bright.cutoffHz - dark.cutoffHz).toBeGreaterThan(1000); // a real, obvious sweep
  });

  it('decay: doubling it doubles churn note release length', () => {
    function churnNotesAt(decay: number): ReturnType<SoundscapeBrain['tick']>['notes'] {
      const brain = new SoundscapeBrain();
      brain.setDecay(clampAudioSettings({ decay }).decay);
      let now = 0;
      let notes: ReturnType<SoundscapeBrain['tick']>['notes'] = [];
      for (let i = 0; i < 10; i++) {
        brain.onEvent({ kind: 'birth', count: 50 }, now);
        now += TICK_STEP;
        notes = notes.concat(brain.tick(now, LOOKAHEAD).notes.filter((n) => n.source === 'churn'));
      }
      return notes;
    }
    const base = churnNotesAt(1);
    const doubled = churnNotesAt(2);
    expect(base.length).toBeGreaterThan(0);
    expect(doubled.length).toBe(base.length);
    for (let i = 0; i < base.length; i++) {
      expect(doubled[i]!.duration).toBeCloseTo(base[i]!.duration * 2, 5);
    }
  });

  it('scale/root: changing the root MIDI shifts every produced pitch, never leaving the new scale', () => {
    function notesAt(rootMidi: number): ReturnType<SoundscapeBrain['tick']>['notes'] {
      const brain = new SoundscapeBrain();
      brain.setScale(scaleContextFromSettings(clampAudioSettings({ rootMidi, scaleMode: 'dorian' })));
      let now = 0;
      let notes: ReturnType<SoundscapeBrain['tick']>['notes'] = [];
      for (let i = 0; i < 40; i++) {
        brain.onEvent({ kind: 'birth', count: 200 }, now);
        now += TICK_STEP;
        notes = notes.concat(brain.tick(now, LOOKAHEAD).notes);
      }
      return notes;
    }
    const lowNotes = notesAt(MIN_ROOT_MIDI);
    const highNotes = notesAt(MAX_ROOT_MIDI);
    expect(lowNotes.length).toBeGreaterThan(0);
    expect(highNotes.length).toBeGreaterThan(0);
    for (const n of lowNotes) expect(isInScale(n.pitch, MIN_ROOT_MIDI, SCALES.dorian)).toBe(true);
    for (const n of highNotes) expect(isInScale(n.pitch, MAX_ROOT_MIDI, SCALES.dorian)).toBe(true);
    expect(highNotes[0]!.pitch - lowNotes[0]!.pitch).toBeGreaterThan((MAX_ROOT_MIDI - MIN_ROOT_MIDI) - 12);
  });
});
