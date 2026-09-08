/**
 * The shipped AFTERLIFE themes. Five, deliberately — not fifty mediocre
 * ones. Every theme defines every token in `ALL_THEME_TOKENS` (enforced by
 * `validate.ts`, tested in `tests/theme-*.test.ts`) and keeps the 8
 * immutable-meaning accents mutually distinguishable (see `validate.ts`'s
 * `MIN_ACCENT_DISTANCE`, calibrated against Observatory's own real values so
 * the bar is "at least as distinguishable as the shipped default", not an
 * arbitrary number).
 *
 * `observatory` is copied byte-for-byte from `src/styles/tokens.css` (the
 * frozen, architect-owned default) — applying it is a strict no-op against a
 * page that never touched the theme system, which is how the default stays
 * pixel-identical.
 */
import type { ThemeTokens } from './tokens';

export type ColorScheme = 'dark' | 'light';

export interface ThemeDefinition {
  id: string;
  name: string;
  /** One line, in the product's natural-history-plate voice. */
  description: string;
  scheme: ColorScheme;
  tokens: ThemeTokens;
}

const observatory: ThemeDefinition = {
  id: 'observatory',
  name: 'Observatory',
  description: 'The deep-ink default: a dusk-lit instrument room built to watch small universes for hours.',
  scheme: 'dark',
  tokens: {
    '--color-ink-900': 'oklch(0.16 0.018 195)',
    '--color-ink-800': 'oklch(0.21 0.019 196)',
    '--color-ink-700': 'oklch(0.26 0.020 197)',
    '--color-ink-600': 'oklch(0.33 0.021 198)',
    '--color-ink-500': 'oklch(0.44 0.020 199)',
    '--color-ivory-100': 'oklch(0.96 0.014 92)',
    '--color-ivory-200': 'oklch(0.88 0.017 90)',
    '--color-ivory-300': 'oklch(0.74 0.016 90)',
    '--color-surface': 'oklch(0.19 0.018 196)',
    '--color-surface-raised': 'oklch(0.23 0.019 197)',
    '--color-line': 'oklch(0.32 0.018 198)',
    '--color-line-strong': 'oklch(0.44 0.020 199)',
    '--color-focus': 'oklch(0.86 0.100 200)',
    '--color-accent-life': 'oklch(0.87 0.155 155)',
    '--color-accent-age': 'oklch(0.79 0.130 78)',
    '--color-accent-activity': 'oklch(0.72 0.185 25)',
    '--color-accent-time': 'oklch(0.78 0.120 235)',
    '--color-accent-branch-a': 'oklch(0.80 0.115 300)',
    '--color-accent-branch-b': 'oklch(0.83 0.130 195)',
    '--color-accent-diff': 'oklch(0.85 0.170 330)',
    '--color-accent-warn': 'oklch(0.80 0.150 60)',
  },
};

const ivoryPlate: ThemeDefinition = {
  id: 'ivory-plate',
  name: 'Ivory Plate',
  description: 'A natural-history plate on paper: warm cream ground, engraved ink figures, daylight legibility.',
  scheme: 'light',
  tokens: {
    '--color-ink-900': 'oklch(0.97 0.012 90)',
    '--color-ink-800': 'oklch(0.93 0.013 88)',
    '--color-ink-700': 'oklch(0.89 0.014 87)',
    '--color-ink-600': 'oklch(0.80 0.016 85)',
    '--color-ink-500': 'oklch(0.58 0.014 80)',
    '--color-ivory-100': 'oklch(0.22 0.020 50)',
    '--color-ivory-200': 'oklch(0.32 0.018 50)',
    '--color-ivory-300': 'oklch(0.45 0.016 55)',
    '--color-surface': 'oklch(0.93 0.013 88)',
    '--color-surface-raised': 'oklch(0.89 0.014 87)',
    '--color-line': 'oklch(0.78 0.014 82)',
    '--color-line-strong': 'oklch(0.55 0.020 78)',
    '--color-focus': 'oklch(0.50 0.180 265)',
    '--color-accent-life': 'oklch(0.46 0.170 150)',
    '--color-accent-age': 'oklch(0.50 0.150 75)',
    '--color-accent-activity': 'oklch(0.50 0.190 25)',
    '--color-accent-time': 'oklch(0.46 0.150 250)',
    '--color-accent-branch-a': 'oklch(0.46 0.160 300)',
    '--color-accent-branch-b': 'oklch(0.44 0.140 200)',
    '--color-accent-diff': 'oklch(0.48 0.200 345)',
    '--color-accent-warn': 'oklch(0.47 0.180 55)',
  },
};

const highContrast: ThemeDefinition = {
  id: 'high-contrast',
  name: 'High Contrast',
  description: 'Maximum legibility: near-black ground, near-white figure, every accent pushed to its most distinct.',
  scheme: 'dark',
  tokens: {
    '--color-ink-900': 'oklch(0.08 0.005 200)',
    '--color-ink-800': 'oklch(0.13 0.006 200)',
    '--color-ink-700': 'oklch(0.18 0.007 200)',
    '--color-ink-600': 'oklch(0.26 0.008 200)',
    '--color-ink-500': 'oklch(0.50 0.010 200)',
    '--color-ivory-100': 'oklch(0.99 0.005 90)',
    '--color-ivory-200': 'oklch(0.93 0.006 90)',
    '--color-ivory-300': 'oklch(0.82 0.008 90)',
    '--color-surface': 'oklch(0.13 0.006 200)',
    '--color-surface-raised': 'oklch(0.18 0.007 200)',
    '--color-line': 'oklch(0.30 0.010 200)',
    '--color-line-strong': 'oklch(0.55 0.020 200)',
    '--color-focus': 'oklch(0.92 0.120 200)',
    '--color-accent-life': 'oklch(0.85 0.190 155)',
    '--color-accent-age': 'oklch(0.88 0.170 90)',
    '--color-accent-activity': 'oklch(0.78 0.220 30)',
    '--color-accent-time': 'oklch(0.82 0.150 235)',
    '--color-accent-branch-a': 'oklch(0.82 0.170 295)',
    '--color-accent-branch-b': 'oklch(0.86 0.160 195)',
    '--color-accent-diff': 'oklch(0.83 0.210 340)',
    '--color-accent-warn': 'oklch(0.80 0.190 55)',
  },
};

const phosphor: ThemeDefinition = {
  id: 'phosphor',
  name: 'Phosphor',
  description: 'An amber CRT observatory, the instrument room lit only by its own display; life is the one thing that burns green.',
  scheme: 'dark',
  tokens: {
    '--color-ink-900': 'oklch(0.09 0.020 75)',
    '--color-ink-800': 'oklch(0.14 0.025 75)',
    '--color-ink-700': 'oklch(0.19 0.030 75)',
    '--color-ink-600': 'oklch(0.27 0.035 75)',
    '--color-ink-500': 'oklch(0.45 0.030 75)',
    '--color-ivory-100': 'oklch(0.90 0.140 80)',
    '--color-ivory-200': 'oklch(0.80 0.120 78)',
    '--color-ivory-300': 'oklch(0.63 0.100 76)',
    '--color-surface': 'oklch(0.14 0.025 75)',
    '--color-surface-raised': 'oklch(0.19 0.030 75)',
    '--color-line': 'oklch(0.28 0.030 75)',
    '--color-line-strong': 'oklch(0.45 0.050 75)',
    '--color-focus': 'oklch(0.94 0.090 80)',
    '--color-accent-life': 'oklch(0.85 0.200 150)',
    '--color-accent-age': 'oklch(0.80 0.150 90)',
    '--color-accent-activity': 'oklch(0.75 0.220 40)',
    '--color-accent-time': 'oklch(0.80 0.130 230)',
    '--color-accent-branch-a': 'oklch(0.80 0.140 290)',
    '--color-accent-branch-b': 'oklch(0.83 0.130 190)',
    '--color-accent-diff': 'oklch(0.82 0.190 340)',
    '--color-accent-warn': 'oklch(0.78 0.180 60)',
  },
};

const cyanotype: ThemeDefinition = {
  id: 'cyanotype',
  name: 'Cyanotype',
  description: 'A blueprint exposure: deep Prussian-blue ground, pale linework, warm accents for the things that need to be seen first.',
  scheme: 'dark',
  tokens: {
    '--color-ink-900': 'oklch(0.24 0.080 250)',
    '--color-ink-800': 'oklch(0.29 0.085 252)',
    '--color-ink-700': 'oklch(0.34 0.090 253)',
    '--color-ink-600': 'oklch(0.42 0.095 254)',
    '--color-ink-500': 'oklch(0.55 0.060 250)',
    '--color-ivory-100': 'oklch(0.97 0.020 240)',
    '--color-ivory-200': 'oklch(0.90 0.025 238)',
    '--color-ivory-300': 'oklch(0.78 0.030 236)',
    '--color-surface': 'oklch(0.29 0.085 252)',
    '--color-surface-raised': 'oklch(0.34 0.090 253)',
    '--color-line': 'oklch(0.40 0.070 250)',
    '--color-line-strong': 'oklch(0.55 0.080 248)',
    '--color-focus': 'oklch(0.82 0.160 55)',
    '--color-accent-life': 'oklch(0.90 0.100 95)',
    '--color-accent-age': 'oklch(0.85 0.090 150)',
    '--color-accent-activity': 'oklch(0.75 0.210 25)',
    '--color-accent-time': 'oklch(0.85 0.120 220)',
    '--color-accent-branch-a': 'oklch(0.82 0.140 300)',
    '--color-accent-branch-b': 'oklch(0.83 0.150 190)',
    '--color-accent-diff': 'oklch(0.83 0.180 340)',
    '--color-accent-warn': 'oklch(0.78 0.190 65)',
  },
};

/** Shipped, built-in themes in display order. `observatory` MUST stay first
 *  (it's the default) and MUST stay byte-identical to `tokens.css`. */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = [
  observatory,
  ivoryPlate,
  highContrast,
  phosphor,
  cyanotype,
];

export const DEFAULT_THEME_ID = observatory.id;
/** The theme `prefers-color-scheme: light` maps to when the user hasn't made
 *  an explicit choice yet. */
export const DEFAULT_LIGHT_THEME_ID = ivoryPlate.id;

export function getBuiltinTheme(id: string): ThemeDefinition | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}
