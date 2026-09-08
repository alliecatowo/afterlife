import { describe, expect, it, afterEach } from 'vitest';
import { applyThemeTokens, clearThemeTokens, setThemeAttribute } from '@/ui/theme/apply';
import { ALL_THEME_TOKENS } from '@/ui/theme/tokens';
import { BUILTIN_THEMES } from '@/ui/theme/themes';

describe('applyThemeTokens', () => {
  afterEach(() => {
    clearThemeTokens();
  });

  it('sets every theme token as an inline custom property on the root element', () => {
    const theme = BUILTIN_THEMES.find((t) => t.id === 'phosphor')!;
    applyThemeTokens(theme.tokens);
    for (const token of ALL_THEME_TOKENS) {
      expect(document.documentElement.style.getPropertyValue(token).trim()).toBe(theme.tokens[token]);
    }
  });

  it('switching themes overwrites every previous value, none left stale', () => {
    applyThemeTokens(BUILTIN_THEMES.find((t) => t.id === 'phosphor')!.tokens);
    const ivory = BUILTIN_THEMES.find((t) => t.id === 'ivory-plate')!;
    applyThemeTokens(ivory.tokens);
    for (const token of ALL_THEME_TOKENS) {
      expect(document.documentElement.style.getPropertyValue(token).trim()).toBe(ivory.tokens[token]);
    }
  });

  it('applies to an arbitrary root element, not just documentElement', () => {
    const el = document.createElement('div');
    const theme = BUILTIN_THEMES.find((t) => t.id === 'cyanotype')!;
    applyThemeTokens(theme.tokens, el);
    expect(el.style.getPropertyValue('--color-accent-life').trim()).toBe(theme.tokens['--color-accent-life']);
    // documentElement is untouched by an element-scoped apply.
    expect(document.documentElement.style.getPropertyValue('--color-accent-life').trim()).toBe('');
  });

  it('clearThemeTokens removes every override, letting tokens.css show through again', () => {
    applyThemeTokens(BUILTIN_THEMES.find((t) => t.id === 'high-contrast')!.tokens);
    clearThemeTokens();
    for (const token of ALL_THEME_TOKENS) {
      expect(document.documentElement.style.getPropertyValue(token)).toBe('');
    }
  });

  it('setThemeAttribute records the active theme id on the root for CSS/testing hooks', () => {
    setThemeAttribute('phosphor');
    expect(document.documentElement.getAttribute('data-theme')).toBe('phosphor');
  });
});
