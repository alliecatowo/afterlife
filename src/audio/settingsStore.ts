/**
 * Persisted zustand store for the soundscape's tweakable parameters (the
 * `AudioPanel`'s real state — every control there reads/writes this store,
 * nothing decorative). `audio.ts` subscribes to it and pushes changes into
 * the live `SoundscapeBrain`/`SynthGraph`; this module never touches Web
 * Audio itself, so it's safe to import from tests and from React.
 *
 * Persistence reuses `@/persist`'s storage namespace (`STORAGE_PREFIX`) so
 * every AFTERLIFE key lives under one prefix, but keeps its own key —
 * `PersistStore` (`@/persist/store`) is shaped around `ExperimentDoc`
 * documents (world saves), not arbitrary settings, so this is a small
 * sibling read/write, wrapped in try/catch exactly like `session.ts`'s
 * existing mute/volume preference and `persist/localStorage.ts`'s writes:
 * storage can be full or disabled and that must never throw.
 */
import { create } from 'zustand';
import { STORAGE_PREFIX } from '@/persist/store';
import { clampAudioSettings, DEFAULT_AUDIO_SETTINGS, sanitizeAudioSettings, type AudioSettings } from './settings';

export const AUDIO_SETTINGS_KEY = `${STORAGE_PREFIX}audio-settings`;

function loadPersisted(): AudioSettings {
  try {
    const raw = globalThis.localStorage?.getItem(AUDIO_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    return sanitizeAudioSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function persist(settings: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort only — storage full/disabled must never break the panel.
  }
}

export interface AudioSettingsState extends AudioSettings {
  /** Patch one or more fields, clamped to valid ranges, and persist. */
  update(patch: Partial<AudioSettings>): void;
  resetToDefaults(): void;
}

export const useAudioSettingsStore = create<AudioSettingsState>((set, get) => ({
  ...loadPersisted(),
  update(patch) {
    const next = clampAudioSettings(patch, get());
    persist(next);
    set(next);
  },
  resetToDefaults() {
    persist(DEFAULT_AUDIO_SETTINGS);
    set({ ...DEFAULT_AUDIO_SETTINGS });
  },
}));

/** Non-reactive read, for the imperative `audio.ts` wiring. */
export const readAudioSettings = (): AudioSettings => useAudioSettingsStore.getState();
