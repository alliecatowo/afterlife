import { describe, expect, it } from 'vitest';
import {
  createCustomTheme, resolveCustomTheme, customThemeAsDefinition,
  exportCustomThemeJson, parseImportedTheme, ThemeImportError,
} from '@/ui/theme/custom';
import { validateTheme } from '@/ui/theme/validate';
import { BUILTIN_THEMES } from '@/ui/theme/themes';

describe('custom themes: base + accent-override model', () => {
  it('a fresh custom theme with no overrides resolves to exactly its base theme\'s tokens', () => {
    const custom = createCustomTheme('My theme', 'observatory');
    const resolved = resolveCustomTheme(custom);
    expect(resolved).toEqual(BUILTIN_THEMES.find((t) => t.id === 'observatory')!.tokens);
  });

  it('accent overrides layer on top of the base, chrome tokens untouched', () => {
    const custom = createCustomTheme('My theme', 'observatory');
    custom.accents['--color-accent-life'] = 'oklch(0.5 0.2 10)';
    const resolved = resolveCustomTheme(custom);
    expect(resolved['--color-accent-life']).toBe('oklch(0.5 0.2 10)');
    expect(resolved['--color-ink-900']).toBe(BUILTIN_THEMES.find((t) => t.id === 'observatory')!.tokens['--color-ink-900']);
  });

  it('falls back to the default theme if the base was deleted/renamed', () => {
    const custom = createCustomTheme('Orphaned', 'no-such-theme');
    const resolved = resolveCustomTheme(custom);
    expect(resolved).toEqual(BUILTIN_THEMES.find((t) => t.id === 'observatory')!.tokens);
  });

  it('customThemeAsDefinition produces a fully valid ThemeDefinition', () => {
    const custom = createCustomTheme('Sunset', 'ivory-plate');
    const def = customThemeAsDefinition(custom);
    expect(validateTheme(def.tokens)).toEqual([]);
    expect(def.scheme).toBe('light');
  });

  it('export -> import round-trips a custom theme exactly', () => {
    const custom = createCustomTheme('Round Trip', 'phosphor');
    custom.accents['--color-accent-warn'] = 'oklch(0.7 0.2 40)';
    custom.accents['--color-accent-time'] = 'oklch(0.6 0.1 260)';

    const json = exportCustomThemeJson(custom);
    const imported = parseImportedTheme(json);

    expect(imported.name).toBe(custom.name);
    expect(imported.baseThemeId).toBe(custom.baseThemeId);
    expect(imported.accents).toEqual(custom.accents);
    // Resolved tokens are identical even though the imported theme gets a new id.
    expect(resolveCustomTheme(imported)).toEqual(resolveCustomTheme(custom));
  });

  it('rejects malformed JSON', () => {
    expect(() => parseImportedTheme('{not json')).toThrow(ThemeImportError);
  });

  it('rejects a theme file with an unknown base theme', () => {
    const json = JSON.stringify({ version: 1, name: 'Bad', baseThemeId: 'nonexistent', accents: {} });
    expect(() => parseImportedTheme(json)).toThrow(ThemeImportError);
  });

  it('rejects a theme file with an unrecognised accent key', () => {
    const json = JSON.stringify({ version: 1, name: 'Bad', baseThemeId: 'observatory', accents: { '--color-ink-900': 'oklch(0.5 0.1 10)' } });
    expect(() => parseImportedTheme(json)).toThrow(/not a recognised accent token/);
  });

  it('rejects an import whose merged tokens collapse two accents together', () => {
    const base = BUILTIN_THEMES.find((t) => t.id === 'observatory')!;
    const json = JSON.stringify({
      version: 1,
      name: 'Collision',
      baseThemeId: 'observatory',
      accents: { '--color-accent-diff': base.tokens['--color-accent-life'] },
    });
    expect(() => parseImportedTheme(json)).toThrow(/fails validation/);
  });

  it('generates unique ids for successive custom themes', () => {
    const a = createCustomTheme('A');
    const b = createCustomTheme('B');
    expect(a.id).not.toBe(b.id);
  });
});
