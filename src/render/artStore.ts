/**
 * Zustand store for Art mode's whole configurable surface. Owned by the
 * `render` agent (`src/render/**`). Low-frequency (written a few times per
 * second at most, only in response to a user dragging a slider/toggling a
 * control in `ArtPanel`) — same discipline as `@/ui/store`/`@/ui/uiState`.
 *
 * Persistence deliberately does NOT touch `@/persist/**` (that module's own
 * versioned-document format is for the simulation's saved worlds, not a
 * cosmetic preference). It reuses the exact pattern `@/audio/settingsStore`
 * and `@/ui/tutorial/tourStore` already established for this situation:
 * import only the public `STORAGE_PREFIX` constant and read/write
 * `localStorage` directly under the same `afterlife:v1:*` namespace.
 */
import { create } from 'zustand';
import { STORAGE_PREFIX } from '@/persist/store';
import {
  ART_PRESETS, applyReducedMotion, classicAsciiPreset, defaultArtConfig, randomArtConfig,
  sanitizeArtConfig, type ArtConfig, type ArtColorConfig, type ArtFieldConfig, type ArtGlyphConfig,
  type LfoConfig, MAX_LFOS,
} from './artConfig';

export const ART_CONFIG_KEY = `${STORAGE_PREFIX}art-config`;

function loadPersisted(): ArtConfig {
  try {
    const raw = globalThis.localStorage?.getItem(ART_CONFIG_KEY);
    if (!raw) return defaultArtConfig();
    return sanitizeArtConfig(JSON.parse(raw));
  } catch {
    return defaultArtConfig();
  }
}

function persist(config: ArtConfig): void {
  try {
    globalThis.localStorage?.setItem(ART_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage full/disabled — Art mode still works for the session, it just
    // won't survive a reload. Never blocks or throws into the caller.
  }
}

interface ArtStoreState {
  config: ArtConfig;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
  updateGlyphs: (patch: Partial<ArtGlyphConfig>) => void;
  updateField: (patch: Partial<ArtFieldConfig>) => void;
  setLfos: (lfos: LfoConfig[]) => void;
  addLfo: () => void;
  updateLfo: (id: string, patch: Partial<LfoConfig>) => void;
  removeLfo: (id: string) => void;
  updateColor: (patch: Partial<ArtColorConfig>) => void;
  applyPreset: (id: string, reducedMotion?: boolean) => void;
  applyClassicAscii: () => void;
  randomize: (reducedMotion?: boolean) => void;
  reset: () => void;
  importConfig: (json: string) => boolean;
  exportConfig: () => string;
}

export const useArtStore = create<ArtStoreState>((set, get) => ({
  config: loadPersisted(),

  setEnabled: (enabled) => set((s) => {
    const config = { ...s.config, enabled };
    persist(config);
    return { config };
  }),

  toggleEnabled: () => {
    const s = get();
    // First-ever enable with a completely untouched (still-default) config
    // gets the classic ASCII preset rather than an "on" state with no
    // glyphs/field/lfos configured — matches the brief's "flip the whole
    // world into ASCII in one action" for a first-time user.
    const isUntouched = JSON.stringify(s.config) === JSON.stringify(defaultArtConfig());
    if (!s.config.enabled && isUntouched) {
      const config = classicAsciiPreset();
      persist(config);
      set({ config });
      return;
    }
    s.setEnabled(!s.config.enabled);
  },

  updateGlyphs: (patch) => set((s) => {
    const config = { ...s.config, glyphs: { ...s.config.glyphs, ...patch } };
    persist(config);
    return { config };
  }),

  updateField: (patch) => set((s) => {
    const config = { ...s.config, field: { ...s.config.field, ...patch } };
    persist(config);
    return { config };
  }),

  setLfos: (lfos) => set((s) => {
    const config = { ...s.config, lfos: lfos.slice(0, MAX_LFOS) };
    persist(config);
    return { config };
  }),

  addLfo: () => {
    const s = get();
    if (s.config.lfos.length >= MAX_LFOS) return;
    const lfo: LfoConfig = {
      id: `lfo-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      shape: 'sine',
      rateHz: 0.1,
      depth: 0.5,
      phase: 0,
      target: 'hueRotate',
    };
    s.setLfos([...s.config.lfos, lfo]);
  },

  updateLfo: (id, patch) => {
    const s = get();
    s.setLfos(s.config.lfos.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  },

  removeLfo: (id) => {
    const s = get();
    s.setLfos(s.config.lfos.filter((l) => l.id !== id));
  },

  updateColor: (patch) => set((s) => {
    const config = { ...s.config, color: { ...s.config.color, ...patch } };
    persist(config);
    return { config };
  }),

  applyPreset: (id, reducedMotion = false) => {
    const preset = ART_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    let config = preset.build();
    if (reducedMotion) config = applyReducedMotion(config);
    persist(config);
    set({ config });
  },

  applyClassicAscii: () => {
    const config = classicAsciiPreset();
    persist(config);
    set({ config });
  },

  randomize: (reducedMotion = false) => {
    let config = randomArtConfig(Date.now() >>> 0);
    if (reducedMotion) config = applyReducedMotion(config);
    persist(config);
    set({ config });
  },

  reset: () => {
    const config = defaultArtConfig();
    persist(config);
    set({ config });
  },

  importConfig: (json) => {
    try {
      const parsed = JSON.parse(json);
      const config = sanitizeArtConfig(parsed);
      persist(config);
      set({ config });
      return true;
    } catch {
      return false;
    }
  },

  exportConfig: () => JSON.stringify(get().config, null, 2),
}));
