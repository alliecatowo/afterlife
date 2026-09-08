/**
 * Programmatic guarantees for every shipped AND custom theme — "measure,
 * don't eyeball" (see DESIGN.md §1's "meanings are immutable" rule and the
 * theming brief's non-negotiable: semantics survive theming).
 */
import { ACCENT_TOKENS, ALL_THEME_TOKENS, type ThemeTokens } from './tokens';
import { oklabDistance, parseOklch, contrastRatio, WCAG_AA_BODY } from './color';

/**
 * Minimum acceptable OKLab Euclidean distance between any two of the 8
 * semantic accents in a single theme. Calibrated against Observatory's own
 * shipped values: its closest real pair (age vs warn) measures ~0.0491, so
 * every theme — including custom ones a user builds — must be AT LEAST that
 * distinguishable, with a small safety margin. Every new theme in
 * `themes.ts` in fact clears this by a wide margin (0.06-0.10); this floor
 * exists to catch genuine collisions (e.g. a custom theme setting `--color-
 * accent-diff` to the same colour as `--color-accent-life`), not to demand
 * more separation than the design itself already ships.
 */
export const MIN_ACCENT_DISTANCE = 0.045;

export interface ThemeIssue {
  kind: 'missing-token' | 'bad-color' | 'accent-collision' | 'low-contrast';
  message: string;
}

/** Every required token must be present — no missing key silently falling
 *  back to `unset`/inherited browser default. */
export function findMissingTokens(tokens: Partial<ThemeTokens>): string[] {
  return ALL_THEME_TOKENS.filter((t) => !tokens[t]);
}

/** Pairwise OKLab distance between every one of the 8 accents. Returns the
 *  full matrix (as a flat list) so callers/tests can report every pair, not
 *  just the failing one. */
export function accentDistances(tokens: ThemeTokens): Array<{ a: string; b: string; distance: number }> {
  const out: Array<{ a: string; b: string; distance: number }> = [];
  for (let i = 0; i < ACCENT_TOKENS.length; i++) {
    for (let j = i + 1; j < ACCENT_TOKENS.length; j++) {
      const a = ACCENT_TOKENS[i];
      const b = ACCENT_TOKENS[j];
      const distance = oklabDistance(parseOklch(tokens[a]), parseOklch(tokens[b]));
      out.push({ a, b, distance });
    }
  }
  return out;
}

/**
 * Full validation pass for a theme: every token present, every token a
 * parseable `oklch()`, and every pair of the 8 immutable-meaning accents
 * mutually distinguishable. Does NOT enforce body-text contrast here (see
 * `contrastReport` below) — that's a reportable measurement, not a hard
 * gate, since a custom theme's chrome tokens are inherited from a shipped
 * base and only accents are user-editable (see `custom.ts`).
 */
export function validateTheme(tokens: Partial<ThemeTokens>): ThemeIssue[] {
  const issues: ThemeIssue[] = [];
  const missing = findMissingTokens(tokens);
  for (const t of missing) {
    issues.push({ kind: 'missing-token', message: `missing required token ${t}` });
  }
  if (missing.length > 0) return issues; // can't validate colours/distances until complete

  const full = tokens as ThemeTokens;
  for (const t of ALL_THEME_TOKENS) {
    try {
      parseOklch(full[t]);
    } catch {
      issues.push({ kind: 'bad-color', message: `${t}: "${full[t]}" is not a valid oklch() colour` });
    }
  }
  if (issues.length > 0) return issues;

  for (const { a, b, distance } of accentDistances(full)) {
    if (distance < MIN_ACCENT_DISTANCE) {
      issues.push({
        kind: 'accent-collision',
        message: `${a} and ${b} are too close to distinguish (distance ${distance.toFixed(4)} < ${MIN_ACCENT_DISTANCE})`,
      });
    }
  }
  return issues;
}

export function isThemeValid(tokens: Partial<ThemeTokens>): boolean {
  return validateTheme(tokens).length === 0;
}

export interface ContrastRow {
  label: string;
  ratio: number;
  target: number;
  pass: boolean;
}

/**
 * Real, measured WCAG contrast for the surfaces DESIGN.md calls out: body
 * text, control labels (both `--color-ivory-200` per DESIGN.md §1's table),
 * captions/units (`--color-ivory-300`), and the `life` accent as it's
 * actually used for live text (`Readout`'s `accent="life"` — see
 * `src/ui/primitives/Readout.tsx`). Disabled text (`--color-ink-500`) is
 * reported but not gated: WCAG 1.4.3 explicitly exempts disabled/inactive
 * UI component text from the contrast requirement, and AFTERLIFE's
 * "disabled looks disabled" affordance depends on it being visibly muted.
 */
export function contrastReport(tokens: ThemeTokens): ContrastRow[] {
  const bg = tokens['--color-surface'];
  const bgGround = tokens['--color-ink-900'];
  const rows: ContrastRow[] = [
    { label: 'body text / control labels (ivory-200 on surface)', ratio: contrastRatio(tokens['--color-ivory-200'], bg), target: WCAG_AA_BODY, pass: false },
    { label: 'primary text (ivory-100 on surface)', ratio: contrastRatio(tokens['--color-ivory-100'], bg), target: WCAG_AA_BODY, pass: false },
    { label: 'captions / units (ivory-300 on surface)', ratio: contrastRatio(tokens['--color-ivory-300'], bg), target: WCAG_AA_BODY, pass: false },
    { label: 'disabled text (ink-500 on surface) — reported, not AA-gated', ratio: contrastRatio(tokens['--color-ink-500'], bg), target: 0, pass: true },
    { label: 'life readout text (accent-life on surface)', ratio: contrastRatio(tokens['--color-accent-life'], bg), target: WCAG_AA_BODY, pass: false },
    { label: 'world ground legibility (ivory-200 on ink-900)', ratio: contrastRatio(tokens['--color-ivory-200'], bgGround), target: WCAG_AA_BODY, pass: false },
  ];
  return rows.map((r) => ({ ...r, pass: r.target === 0 || r.ratio >= r.target }));
}
