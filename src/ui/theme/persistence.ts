/**
 * Theme persistence. Uses the SAME storage prefix/namespace as
 * `src/persist/localStorage.ts` (imported read-only — that file is owned by
 * the `persist` agent and is not touched here) so a theme choice lives
 * alongside every other AFTERLIFE local-storage key, and the identical key
 * name is reused by `site/shared/theme.ts` so a choice made in the app
 * carries over to the guide site and vice versa.
 */
import { STORAGE_PREFIX } from '@/persist/localStorage';
import type { CustomTheme } from './custom';

export const THEME_STORAGE_KEY = `${STORAGE_PREFIX}theme`;

export interface PersistedThemeState {
  /** A builtin theme id (`themes.ts`) or a custom theme id (`custom:...`). */
  themeId: string;
  /** True once the user has made an explicit choice — from then on,
   *  `prefers-color-scheme` changes no longer move the active theme. */
  explicit: boolean;
  customThemes: CustomTheme[];
}

const EMPTY: PersistedThemeState = { themeId: '', explicit: false, customThemes: [] };

function isCustomTheme(v: unknown): v is CustomTheme {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as CustomTheme).id === 'string' &&
    typeof (v as CustomTheme).name === 'string' &&
    typeof (v as CustomTheme).baseThemeId === 'string' &&
    typeof (v as CustomTheme).accents === 'object'
  );
}

export function loadThemeState(): PersistedThemeState {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY };
    const p = parsed as Partial<PersistedThemeState>;
    return {
      themeId: typeof p.themeId === 'string' ? p.themeId : '',
      explicit: p.explicit === true,
      customThemes: Array.isArray(p.customThemes) ? p.customThemes.filter(isCustomTheme) : [],
    };
  } catch {
    // Storage unavailable/corrupt — fall back to system-derived default,
    // exactly like a first run. Never throw from a read.
    return { ...EMPTY };
  }
}

export function saveThemeState(state: PersistedThemeState): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort: a failed theme-preference write should never break the
    // app (private browsing, full storage, etc.) — the in-memory choice
    // still applies for this session.
  }
}
