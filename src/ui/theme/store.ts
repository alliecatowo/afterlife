/**
 * The theme store: which theme is active, the user's saved custom themes,
 * and the live-preview editor draft. A zustand store (same library/pattern
 * as `@/ui/uiState`), but deliberately its own module — theming needs to
 * apply itself to the DOM the instant this module is imported (see
 * `initTheme()` at the bottom), before the rest of the app even renders, to
 * avoid a flash of the wrong theme on reload.
 */
import { create } from 'zustand';
import { ACCENT_TOKENS, type AccentToken, type ThemeTokens } from './tokens';
import { BUILTIN_THEMES, DEFAULT_LIGHT_THEME_ID, DEFAULT_THEME_ID, getBuiltinTheme, type ThemeDefinition } from './themes';
import { applyThemeTokens, setThemeAttribute } from './apply';
import { loadThemeState, saveThemeState } from './persistence';
import {
  createCustomTheme,
  customThemeAsDefinition,
  exportCustomThemeJson,
  parseImportedTheme,
  ThemeImportError,
  type CustomTheme,
} from './custom';
import { validateTheme } from './validate';

function prefersLight(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true;
  } catch {
    return false;
  }
}

function systemDefaultThemeId(): string {
  return prefersLight() ? DEFAULT_LIGHT_THEME_ID : DEFAULT_THEME_ID;
}

export interface ThemeEditorDraft {
  /** Undefined while creating a brand-new custom theme (not yet saved). */
  editingExistingId: string | null;
  name: string;
  baseThemeId: string;
  accents: Partial<Record<AccentToken, string>>;
}

interface ThemeState {
  themeId: string;
  explicit: boolean;
  customThemes: CustomTheme[];
  draft: ThemeEditorDraft | null;

  setTheme: (id: string) => void;
  applySystemPreferenceIfImplicit: () => void;

  startEditing: (opts?: { existing?: CustomTheme; baseThemeId?: string }) => void;
  setDraftName: (name: string) => void;
  setDraftBase: (baseThemeId: string) => void;
  setDraftAccent: (token: AccentToken, value: string) => void;
  cancelEditing: () => void;
  saveDraft: () => { ok: true; theme: CustomTheme } | { ok: false; issues: string[] };

  deleteCustomTheme: (id: string) => void;
  resetToDefault: () => void;

  exportTheme: (id: string) => string | null;
  importTheme: (json: string) => { ok: true; theme: CustomTheme } | { ok: false; error: string };
}

function findDefinition(id: string, customThemes: CustomTheme[]): ThemeDefinition {
  const builtin = getBuiltinTheme(id);
  if (builtin) return builtin;
  const custom = customThemes.find((c) => c.id === id);
  if (custom) return customThemeAsDefinition(custom);
  return getBuiltinTheme(DEFAULT_THEME_ID)!;
}

function persist(state: Pick<ThemeState, 'themeId' | 'explicit' | 'customThemes'>): void {
  saveThemeState({ themeId: state.themeId, explicit: state.explicit, customThemes: state.customThemes });
}

function applyAndTagTheme(def: ThemeDefinition): void {
  applyThemeTokens(def.tokens);
  setThemeAttribute(def.id);
}

const persisted = loadThemeState();
const initialThemeId = persisted.explicit && persisted.themeId ? persisted.themeId : (persisted.themeId || systemDefaultThemeId());

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: initialThemeId,
  explicit: persisted.explicit,
  customThemes: persisted.customThemes,
  draft: null,

  setTheme: (id) => {
    const def = findDefinition(id, get().customThemes);
    applyAndTagTheme(def);
    set({ themeId: def.id, explicit: true });
    persist({ themeId: def.id, explicit: true, customThemes: get().customThemes });
  },

  /** Wired to a `matchMedia('(prefers-color-scheme: light)')` listener by
   *  whatever mounts the theme system (see `ThemePanel`'s effect). A no-op
   *  once the user has made an explicit choice — that choice always wins. */
  applySystemPreferenceIfImplicit: () => {
    if (get().explicit) return;
    const id = systemDefaultThemeId();
    const def = findDefinition(id, get().customThemes);
    applyAndTagTheme(def);
    set({ themeId: def.id });
    persist({ themeId: def.id, explicit: false, customThemes: get().customThemes });
  },

  startEditing: (opts) => {
    if (opts?.existing) {
      const e = opts.existing;
      set({ draft: { editingExistingId: e.id, name: e.name, baseThemeId: e.baseThemeId, accents: { ...e.accents } } });
    } else {
      const base = opts?.baseThemeId ?? get().themeId;
      const baseId = getBuiltinTheme(base) ? base : DEFAULT_THEME_ID;
      set({ draft: { editingExistingId: null, name: 'My theme', baseThemeId: baseId, accents: {} } });
    }
  },

  setDraftName: (name) => set((s) => (s.draft ? { draft: { ...s.draft, name } } : s)),

  setDraftBase: (baseThemeId) =>
    set((s) => (s.draft ? { draft: { ...s.draft, baseThemeId } } : s)),

  setDraftAccent: (token, value) => {
    set((s) => (s.draft ? { draft: { ...s.draft, accents: { ...s.draft.accents, [token]: value } } } : s));
    // Live preview: apply immediately, without touching the persisted/active
    // theme selection, so the world and chrome update as the user types.
    const draft = get().draft;
    if (!draft) return;
    const base = getBuiltinTheme(draft.baseThemeId) ?? getBuiltinTheme(DEFAULT_THEME_ID)!;
    applyThemeTokens({ ...base.tokens, ...draft.accents } as ThemeTokens);
  },

  cancelEditing: () => {
    set({ draft: null });
    // Restore whatever theme was actually active before the preview.
    const def = findDefinition(get().themeId, get().customThemes);
    applyAndTagTheme(def);
  },

  saveDraft: () => {
    const draft = get().draft;
    if (!draft) return { ok: false, issues: ['nothing being edited'] };
    const base = getBuiltinTheme(draft.baseThemeId) ?? getBuiltinTheme(DEFAULT_THEME_ID)!;
    const tokens = { ...base.tokens, ...draft.accents };
    const issues = validateTheme(tokens);
    if (issues.length > 0) return { ok: false, issues: issues.map((i) => i.message) };

    const existing = get().customThemes.find((c) => c.id === draft.editingExistingId);
    const theme: CustomTheme = existing
      ? { ...existing, name: draft.name, baseThemeId: draft.baseThemeId, accents: draft.accents }
      : { ...createCustomTheme(draft.name, draft.baseThemeId), accents: draft.accents };

    const customThemes = existing
      ? get().customThemes.map((c) => (c.id === theme.id ? theme : c))
      : [...get().customThemes, theme];

    applyAndTagTheme(customThemeAsDefinition(theme));
    set({ customThemes, draft: null, themeId: theme.id, explicit: true });
    persist({ themeId: theme.id, explicit: true, customThemes });
    return { ok: true, theme };
  },

  deleteCustomTheme: (id) => {
    const customThemes = get().customThemes.filter((c) => c.id !== id);
    let { themeId, explicit } = get();
    if (themeId === id) {
      themeId = DEFAULT_THEME_ID;
      explicit = true;
      applyAndTagTheme(getBuiltinTheme(DEFAULT_THEME_ID)!);
    }
    set({ customThemes, themeId, explicit });
    persist({ themeId, explicit, customThemes });
  },

  resetToDefault: () => {
    const def = getBuiltinTheme(DEFAULT_THEME_ID)!;
    applyAndTagTheme(def);
    set({ themeId: def.id, explicit: false });
    persist({ themeId: def.id, explicit: false, customThemes: get().customThemes });
  },

  exportTheme: (id) => {
    const custom = get().customThemes.find((c) => c.id === id);
    if (custom) return exportCustomThemeJson(custom);
    const builtin = getBuiltinTheme(id);
    if (!builtin) return null;
    // A shipped theme can still be exported (e.g. as a starting point) —
    // represented as a custom theme with no overrides of its own base.
    return exportCustomThemeJson({ id: builtin.id, name: builtin.name, baseThemeId: builtin.id, accents: {}, createdAt: Date.now() });
  },

  importTheme: (json) => {
    try {
      const theme = parseImportedTheme(json);
      const customThemes = [...get().customThemes, theme];
      applyAndTagTheme(customThemeAsDefinition(theme));
      set({ customThemes, themeId: theme.id, explicit: true });
      persist({ themeId: theme.id, explicit: true, customThemes });
      return { ok: true, theme };
    } catch (err) {
      const message = err instanceof ThemeImportError ? err.message : `Could not import theme: ${(err as Error).message}`;
      return { ok: false, error: message };
    }
  },
}));

export function activeThemeDefinition(): ThemeDefinition {
  const s = useThemeStore.getState();
  return findDefinition(s.themeId, s.customThemes);
}

export function allThemeDefinitions(): ThemeDefinition[] {
  const s = useThemeStore.getState();
  return [...BUILTIN_THEMES, ...s.customThemes.map(customThemeAsDefinition)];
}

/**
 * Applies the resolved initial theme to the DOM as a side effect of
 * importing this module. Any module that needs theming to be live (right
 * now: `ThemePanel.tsx`, transitively imported by `PanelRight.tsx`, which
 * `App.tsx` mounts unconditionally) importing this file is enough — ES
 * module evaluation order guarantees this runs before `main.tsx` calls
 * `render()`, so there is no flash of the wrong theme.
 */
export function initTheme(): void {
  const s = useThemeStore.getState();
  applyAndTagTheme(findDefinition(s.themeId, s.customThemes));
  if (typeof window !== 'undefined' && window.matchMedia) {
    try {
      const mql = window.matchMedia('(prefers-color-scheme: light)');
      const onChange = () => useThemeStore.getState().applySystemPreferenceIfImplicit();
      mql.addEventListener?.('change', onChange);
    } catch {
      // matchMedia unavailable (very old browser / non-browser test env) —
      // the persisted/system-derived initial theme above still applies.
    }
  }
}

initTheme();

// Re-exported for convenience so consumers don't need two import paths for
// "the tokens a theme covers" alongside "the store that manages one".
export { ACCENT_TOKENS };
export type { AccentToken };
