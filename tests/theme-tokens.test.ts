import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_THEME_TOKENS, CHROME_TOKENS, ACCENT_TOKENS } from '@/ui/theme/tokens';
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from '@/ui/theme/themes';
import { findMissingTokens } from '@/ui/theme/validate';

// Read straight off disk rather than a Vite `?raw` import: this suite's
// `vite.config.ts` sets `test.css: false` (skip CSS processing entirely for
// speed), which also empties out `?raw` CSS imports — a plain
// `fs.readFileSync` sidesteps that and gets the real file. `process.cwd()`
// is the repo root: `vitest run` (this project's `npm test`) is always
// invoked from there.
const tokensCssRaw = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

describe('shipped themes: token completeness', () => {
  it('ships exactly the 5 authored themes, Observatory first', () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toEqual([
      'observatory', 'ivory-plate', 'high-contrast', 'phosphor', 'cyanotype',
    ]);
    expect(BUILTIN_THEMES[0]!.id).toBe(DEFAULT_THEME_ID);
  });

  it('every theme defines every required token — no silent fallback', () => {
    for (const theme of BUILTIN_THEMES) {
      const missing = findMissingTokens(theme.tokens);
      expect(missing, `${theme.id} is missing: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('ALL_THEME_TOKENS is exactly chrome + accent tokens, no overlap, no gaps', () => {
    expect(ALL_THEME_TOKENS.length).toBe(CHROME_TOKENS.length + ACCENT_TOKENS.length);
    expect(new Set(ALL_THEME_TOKENS).size).toBe(ALL_THEME_TOKENS.length);
  });

  it('every token value is a well-formed oklch() triple', () => {
    for (const theme of BUILTIN_THEMES) {
      for (const token of ALL_THEME_TOKENS) {
        expect(theme.tokens[token], `${theme.id}.${token}`).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
      }
    }
  });

  it('Observatory is byte-identical to the frozen tokens.css defaults (pixel-identical default)', () => {
    const observatory = BUILTIN_THEMES.find((t) => t.id === 'observatory')!;
    for (const token of ALL_THEME_TOKENS) {
      // tokens.css declares e.g. `--color-ink-900: oklch(0.16 0.018 195);`
      const re = new RegExp(`${token}:\\s*(oklch\\([^;]+\\));`);
      const match = re.exec(tokensCssRaw);
      expect(match, `tokens.css should declare ${token}`).not.toBeNull();
      // Normalise whitespace only — tokens.css and themes.ts may format
      // spacing/zero-padding slightly differently around the same value.
      const cssValue = match![1]!.replace(/\s+/g, ' ').trim();
      const themeValue = observatory.tokens[token].replace(/\s+/g, ' ').trim();
      expect(themeValue).toBe(cssValue);
    }
  });
});
