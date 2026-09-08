import { beforeEach, describe, expect, it } from 'vitest';
import { useAudioSettingsStore, AUDIO_SETTINGS_KEY } from '@/audio/settingsStore';
import { AUDIO_PRESETS, DEFAULT_AUDIO_SETTINGS } from '@/audio/settings';

beforeEach(() => {
  useAudioSettingsStore.getState().resetToDefaults();
  globalThis.localStorage?.removeItem(AUDIO_SETTINGS_KEY);
});

describe('audio/settingsStore — applyPreset', () => {
  it('applies every musical field of the named bundle', () => {
    useAudioSettingsStore.getState().applyPreset('deep');
    const state = useAudioSettingsStore.getState();
    const bundle = AUDIO_PRESETS.deep;
    expect(state.preset).toBe('deep');
    expect(state.scaleMode).toBe(bundle.scaleMode);
    expect(state.bpm).toBe(bundle.bpm);
    expect(state.density).toBe(bundle.density);
    expect(state.droneWeight).toBe(bundle.droneWeight);
    expect(state.droneFilterMinHz).toBe(bundle.droneFilterMinHz);
    expect(state.droneFilterMaxHz).toBe(bundle.droneFilterMaxHz);
    expect(state.decay).toBe(bundle.decay);
  });

  it('leaves root note, voice cap and the scrubbing/percussion/harmonic toggles untouched', () => {
    useAudioSettingsStore.getState().update({ rootMidi: 60, voiceCap: 3, auditionOnScrub: true, percussion: true, harmonicMovement: false });
    useAudioSettingsStore.getState().applyPreset('glass');
    const state = useAudioSettingsStore.getState();
    expect(state.rootMidi).toBe(60);
    expect(state.voiceCap).toBe(3);
    expect(state.auditionOnScrub).toBe(true);
    expect(state.percussion).toBe(true);
    expect(state.harmonicMovement).toBe(false);
  });

  it('applying "observatory" reproduces the shipped defaults\' musical fields', () => {
    useAudioSettingsStore.getState().applyPreset('chime');
    useAudioSettingsStore.getState().applyPreset('observatory');
    const state = useAudioSettingsStore.getState();
    expect(state.scaleMode).toBe(DEFAULT_AUDIO_SETTINGS.scaleMode);
    expect(state.bpm).toBe(DEFAULT_AUDIO_SETTINGS.bpm);
    expect(state.decay).toBe(DEFAULT_AUDIO_SETTINGS.decay);
  });

  it('resetToDefaults clears back to the observatory preset', () => {
    useAudioSettingsStore.getState().applyPreset('chime');
    useAudioSettingsStore.getState().resetToDefaults();
    expect(useAudioSettingsStore.getState().preset).toBe('observatory');
  });
});
