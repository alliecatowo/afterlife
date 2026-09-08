import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES } from '@/ui/theme/themes';
import { ALL_THEME_TOKENS } from '@/ui/theme/tokens';
import { validateTheme, isThemeValid, accentDistances, contrastReport, MIN_ACCENT_DISTANCE, WCAG_AA_BODY } from '@/ui/theme/validate';

describe('semantic-distinctness validator', () => {
  it('every shipped theme passes full validation', () => {
    for (const theme of BUILTIN_THEMES) {
      const issues = validateTheme(theme.tokens);
      expect(issues, `${theme.id}: ${JSON.stringify(issues)}`).toEqual([]);
      expect(isThemeValid(theme.tokens)).toBe(true);
    }
  });

  it('every pair of the 8 accents clears MIN_ACCENT_DISTANCE in every shipped theme', () => {
    for (const theme of BUILTIN_THEMES) {
      const distances = accentDistances(theme.tokens);
      expect(distances.length).toBe((8 * 7) / 2); // C(8,2)
      for (const { a, b, distance } of distances) {
        expect(distance, `${theme.id}: ${a} vs ${b}`).toBeGreaterThanOrEqual(MIN_ACCENT_DISTANCE);
      }
    }
  });

  it('flags a missing token instead of silently validating an incomplete theme', () => {
    const { ['--color-accent-warn']: _omit, ...partial } = BUILTIN_THEMES[0]!.tokens;
    const issues = validateTheme(partial);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('missing-token');
  });

  it('flags a bad colour string', () => {
    const tokens = { ...BUILTIN_THEMES[0]!.tokens, '--color-accent-warn': '#ff0000' };
    const issues = validateTheme(tokens);
    expect(issues.some((i) => i.kind === 'bad-color')).toBe(true);
  });

  it('flags two accents collapsed onto the same colour (the non-negotiable rule)', () => {
    const base = BUILTIN_THEMES[0]!.tokens;
    const tokens = { ...base, '--color-accent-diff': base['--color-accent-life'] };
    const issues = validateTheme(tokens);
    expect(issues.some((i) => i.kind === 'accent-collision')).toBe(true);
  });

  it('every required token is covered by findMissingTokens\' universe', () => {
    // Sanity: a theme with every token present but one is genuinely empty.
    const base = BUILTIN_THEMES[0]!.tokens;
    for (const token of ALL_THEME_TOKENS) {
      const { [token]: _drop, ...rest } = base;
      const issues = validateTheme(rest);
      expect(issues.some((i) => i.message.includes(token))).toBe(true);
    }
  });
});

describe('measured WCAG contrast per shipped theme', () => {
  for (const theme of BUILTIN_THEMES) {
    it(`${theme.name}: body text, control labels, and the life readout meet AA (${WCAG_AA_BODY}:1)`, () => {
      const rows = contrastReport(theme.tokens);
      const failing = rows.filter((r) => !r.pass);
      expect(failing, `${theme.id} failing rows: ${JSON.stringify(failing)}`).toEqual([]);
      // Report real numbers in the test output for visibility, not just pass/fail.
      // eslint-disable-next-line no-console
      console.log(`[contrast] ${theme.name}:`, rows.map((r) => `${r.label}=${r.ratio.toFixed(2)}:1`).join(' | '));
    });
  }
});
