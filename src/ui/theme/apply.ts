/**
 * Applies a theme's tokens to the live DOM. This is the ENTIRE mechanism —
 * no rebuild, no CSS file swap: every consumer (Tailwind utilities compiled
 * from `tokens.css`, inline `var(--color-*)` uses, and the render agent's
 * `resolveCssColor`/`resolveToken`, which reads `getComputedStyle` at draw
 * time) reads these same custom properties live, so overwriting them here
 * re-themes the chrome AND the canvas world instantly.
 */
import { ALL_THEME_TOKENS, type ThemeTokens } from './tokens';

/** Sets every theme token as an inline custom property on `root` (default:
 *  `document.documentElement`), overriding whatever `tokens.css` declared.
 *  A no-store pure DOM write — callers own persistence separately. */
export function applyThemeTokens(tokens: ThemeTokens, root: HTMLElement = document.documentElement): void {
  for (const key of ALL_THEME_TOKENS) {
    root.style.setProperty(key, tokens[key]);
  }
  root.setAttribute('data-color-scheme', root === document.documentElement ? colorSchemeOf(tokens) : root.getAttribute('data-color-scheme') ?? '');
}

/** Removes every inline override this module could have set, letting
 *  `tokens.css`'s real declarations show through again — used by "reset to
 *  Observatory" (which could also just apply the Observatory theme, but this
 *  is the literal, zero-drift version of "reset"). */
export function clearThemeTokens(root: HTMLElement = document.documentElement): void {
  for (const key of ALL_THEME_TOKENS) {
    root.style.removeProperty(key);
  }
  root.removeAttribute('data-color-scheme');
  root.removeAttribute('data-theme');
}

/** A light theme's `ink-900` (page ground) is, almost by construction, the
 *  lightest chrome token — cheap enough to just check the one value the
 *  theme itself declares (`scheme` on `ThemeDefinition`) instead of
 *  re-deriving it from luminance; kept here only as a fallback for tokens
 *  that arrive without a `ThemeDefinition` (e.g. a hand-built custom theme
 *  object). */
function colorSchemeOf(tokens: ThemeTokens): 'dark' | 'light' {
  const m = /oklch\(\s*([\d.]+)/.exec(tokens['--color-ink-900']);
  const l = m ? Number(m[1]) : 0;
  return l > 0.5 ? 'light' : 'dark';
}

export function setThemeAttribute(themeId: string, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', themeId);
}
