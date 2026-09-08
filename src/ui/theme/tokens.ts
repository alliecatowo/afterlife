/**
 * AFTERLIFE theming — the complete set of design tokens a theme must define.
 *
 * A "theme" is nothing more than a value for every one of these CSS custom
 * properties (see DESIGN.md §1 for what each one MEANS — that meaning never
 * changes, only the colour bound to it). Chrome tokens paint the interface;
 * accent tokens paint the canvas world (via `resolveCssColor`'s runtime
 * round-trip through the DOM, see `src/render/color.ts`) AND the interface
 * wherever a control represents that concept.
 *
 * Deliberately NOT touching `src/styles/tokens.css` (frozen/architect-owned):
 * that file remains the literal, static Observatory default, so the default
 * theme is pixel-identical to what shipped before theming existed. Every
 * other theme is applied at runtime by overwriting these same custom
 * property names on `documentElement` — see `apply.ts`.
 */

export const CHROME_TOKENS = [
  '--color-ink-900',
  '--color-ink-800',
  '--color-ink-700',
  '--color-ink-600',
  '--color-ink-500',
  '--color-ivory-100',
  '--color-ivory-200',
  '--color-ivory-300',
  '--color-surface',
  '--color-surface-raised',
  '--color-line',
  '--color-line-strong',
  '--color-focus',
] as const;

/** The 8 immutable-meaning accents from DESIGN.md §1. Order matters for the
 *  semantic-distinctness validator (every pair is checked). */
export const ACCENT_TOKENS = [
  '--color-accent-life',
  '--color-accent-age',
  '--color-accent-activity',
  '--color-accent-time',
  '--color-accent-branch-a',
  '--color-accent-branch-b',
  '--color-accent-diff',
  '--color-accent-warn',
] as const;

export const ALL_THEME_TOKENS = [...CHROME_TOKENS, ...ACCENT_TOKENS] as const;

export type ChromeToken = (typeof CHROME_TOKENS)[number];
export type AccentToken = (typeof ACCENT_TOKENS)[number];
export type ThemeToken = (typeof ALL_THEME_TOKENS)[number];

/** A complete theme: every token bound to an `oklch(L C H)` string. Themes
 *  are authored exclusively in `oklch()`, matching `tokens.css`'s own
 *  convention, so the same colour math (`color.ts`) can validate them without
 *  needing a browser or canvas. */
export type ThemeTokens = Record<ThemeToken, string>;

/** Human-readable label for a token, used by the editor and reports. */
export const ACCENT_LABELS: Record<AccentToken, string> = {
  '--color-accent-life': 'Life',
  '--color-accent-age': 'Age',
  '--color-accent-activity': 'Activity',
  '--color-accent-time': 'Time',
  '--color-accent-branch-a': 'Branch A',
  '--color-accent-branch-b': 'Branch B',
  '--color-accent-diff': 'Diff',
  '--color-accent-warn': 'Warn',
};

export const ACCENT_DESCRIPTIONS: Record<AccentToken, string> = {
  '--color-accent-life': 'A living cell; healthy population.',
  '--color-accent-age': 'Persistence — how long a cell has lived.',
  '--color-accent-activity': 'Recent change, churn, heat.',
  '--color-accent-time': 'Time itself: scrubbing, history, the sculpture.',
  '--color-accent-branch-a': 'Branch A in any comparison.',
  '--color-accent-branch-b': 'Branch B in any comparison.',
  '--color-accent-diff': 'Cells that differ between branches.',
  '--color-accent-warn': 'Destructive or attention-needing.',
};
