import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/ui/theme/persistence';
import { clearThemeTokens } from '@/ui/theme/apply';
import { ALL_THEME_TOKENS } from '@/ui/theme/tokens';
import { BUILTIN_THEMES } from '@/ui/theme/themes';

/**
 * `@/ui/theme/store.ts` applies its resolved initial theme as a MODULE-LEVEL
 * side effect (`initTheme()` at the bottom of the file) so there's no flash
 * of the wrong theme on load — see that file's doc. That means every test
 * needing a specific starting condition (fresh localStorage, a particular
 * `matchMedia` result) must reset the module registry and re-import, same
 * pattern as `tests/achievements-store.test.ts`.
 */
function mockMatchMedia(prefersLight: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('light') ? prefersLight : !prefersLight,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

async function freshStore() {
  vi.resetModules();
  const mod = await import('@/ui/theme/store');
  return mod;
}

describe('theme store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearThemeTokens();
    mockMatchMedia(false); // default: prefers dark
  });
  afterEach(() => {
    window.localStorage.clear();
    clearThemeTokens();
  });

  it('first run with no persisted choice + dark system preference -> Observatory, applied to the DOM', async () => {
    mockMatchMedia(false);
    const { useThemeStore } = await freshStore();
    expect(useThemeStore.getState().themeId).toBe('observatory');
    expect(useThemeStore.getState().explicit).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--color-ink-900').trim())
      .toBe(BUILTIN_THEMES.find((t) => t.id === 'observatory')!.tokens['--color-ink-900']);
  });

  it('first run with no persisted choice + light system preference -> Ivory Plate', async () => {
    mockMatchMedia(true);
    const { useThemeStore } = await freshStore();
    expect(useThemeStore.getState().themeId).toBe('ivory-plate');
  });

  it('an explicit persisted choice always wins over system preference', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: 'phosphor', explicit: true, customThemes: [] }));
    mockMatchMedia(true); // system says light, but the user already chose phosphor
    const { useThemeStore } = await freshStore();
    expect(useThemeStore.getState().themeId).toBe('phosphor');
  });

  it('setTheme applies every token to the DOM and persists an explicit choice', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().setTheme('high-contrast');
    expect(useThemeStore.getState().themeId).toBe('high-contrast');
    expect(useThemeStore.getState().explicit).toBe(true);

    const theme = BUILTIN_THEMES.find((t) => t.id === 'high-contrast')!;
    for (const token of ALL_THEME_TOKENS) {
      expect(document.documentElement.style.getPropertyValue(token).trim()).toBe(theme.tokens[token]);
    }

    const persisted = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!);
    expect(persisted.themeId).toBe('high-contrast');
    expect(persisted.explicit).toBe(true);
  });

  it('persists across a simulated reload (fresh module import reads the same localStorage)', async () => {
    const first = await freshStore();
    first.useThemeStore.getState().setTheme('cyanotype');

    const second = await freshStore();
    expect(second.useThemeStore.getState().themeId).toBe('cyanotype');
    expect(document.documentElement.getAttribute('data-theme')).toBe('cyanotype');
  });

  it('a system preference change no longer moves the theme once a choice is explicit', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().setTheme('phosphor');
    useThemeStore.getState().applySystemPreferenceIfImplicit();
    expect(useThemeStore.getState().themeId).toBe('phosphor');
  });

  it('editing draft: live-previews accent changes without persisting or changing the active theme', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().setTheme('observatory');
    useThemeStore.getState().startEditing({ baseThemeId: 'observatory' });
    useThemeStore.getState().setDraftAccent('--color-accent-life', 'oklch(0.5 0.2 10)');

    // Preview applied to the DOM...
    expect(document.documentElement.style.getPropertyValue('--color-accent-life').trim()).toBe('oklch(0.5 0.2 10)');
    // ...but the active/persisted theme selection hasn't changed — still
    // "observatory", not a new custom theme id, and no custom theme exists yet.
    expect(useThemeStore.getState().themeId).toBe('observatory');
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
    const persisted = JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!);
    expect(persisted.themeId).toBe('observatory');
    expect(persisted.customThemes).toEqual([]);
  });

  it('cancelEditing restores the previously active theme to the DOM', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().setTheme('phosphor');
    useThemeStore.getState().startEditing({ baseThemeId: 'phosphor' });
    useThemeStore.getState().setDraftAccent('--color-accent-life', 'oklch(0.5 0.2 10)');
    useThemeStore.getState().cancelEditing();

    const phosphor = BUILTIN_THEMES.find((t) => t.id === 'phosphor')!;
    expect(document.documentElement.style.getPropertyValue('--color-accent-life').trim()).toBe(phosphor.tokens['--color-accent-life']);
    expect(useThemeStore.getState().draft).toBeNull();
  });

  it('saveDraft rejects a draft whose accents collide, without saving it', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().startEditing({ baseThemeId: 'observatory' });
    const base = BUILTIN_THEMES.find((t) => t.id === 'observatory')!;
    useThemeStore.getState().setDraftAccent('--color-accent-diff', base.tokens['--color-accent-life']);
    const result = useThemeStore.getState().saveDraft();
    expect(result.ok).toBe(false);
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
  });

  it('saveDraft with valid accents creates and selects a new custom theme', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().startEditing({ baseThemeId: 'observatory' });
    useThemeStore.getState().setDraftName('My Reef');
    const result = useThemeStore.getState().saveDraft();
    expect(result.ok).toBe(true);
    expect(useThemeStore.getState().customThemes).toHaveLength(1);
    expect(useThemeStore.getState().themeId).toBe(useThemeStore.getState().customThemes[0]!.id);
    expect(useThemeStore.getState().explicit).toBe(true);
  });

  it('deleteCustomTheme falls back to Observatory if the active theme was deleted', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().startEditing({ baseThemeId: 'observatory' });
    useThemeStore.getState().saveDraft();
    const id = useThemeStore.getState().customThemes[0]!.id;

    useThemeStore.getState().deleteCustomTheme(id);
    expect(useThemeStore.getState().themeId).toBe('observatory');
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
  });

  it('resetToDefault returns to Observatory and clears the explicit flag', async () => {
    const { useThemeStore } = await freshStore();
    useThemeStore.getState().setTheme('cyanotype');
    useThemeStore.getState().resetToDefault();
    expect(useThemeStore.getState().themeId).toBe('observatory');
    expect(useThemeStore.getState().explicit).toBe(false);
  });

  it('importTheme adds and selects a valid theme; a bad one leaves state untouched', async () => {
    const { useThemeStore } = await freshStore();
    const good = JSON.stringify({ version: 1, name: 'Imported', baseThemeId: 'ivory-plate', accents: {} });
    const okResult = useThemeStore.getState().importTheme(good);
    expect(okResult.ok).toBe(true);
    expect(useThemeStore.getState().customThemes).toHaveLength(1);

    const before = useThemeStore.getState().themeId;
    const bad = useThemeStore.getState().importTheme('{not json');
    expect(bad.ok).toBe(false);
    expect(useThemeStore.getState().themeId).toBe(before);
    expect(useThemeStore.getState().customThemes).toHaveLength(1);
  });
});
