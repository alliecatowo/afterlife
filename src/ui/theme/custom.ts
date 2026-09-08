/**
 * User-authored custom themes. Scoped deliberately: a custom theme is a
 * shipped BASE theme (for known-good chrome/contrast) plus overrides for
 * just the 8 semantic accent slots, per the brief's "a compact colour editor
 * for the semantic slots" — not a full 21-token free-for-all, which would
 * make it trivial to ship an inaccessible chrome combination by accident.
 */
import { ACCENT_TOKENS, type AccentToken, type ThemeTokens } from './tokens';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, getBuiltinTheme, type ThemeDefinition } from './themes';
import { validateTheme, type ThemeIssue } from './validate';

export interface CustomTheme {
  /** Stable id, generated once at creation (`custom:<uuid-ish>`). */
  id: string;
  name: string;
  /** Which shipped theme supplies every non-accent (chrome) token. */
  baseThemeId: string;
  /** Overrides for a subset (or all) of the 8 accent tokens. Anything not
   *  present here falls back to the base theme's own value. */
  accents: Partial<Record<AccentToken, string>>;
  createdAt: number;
}

export const CUSTOM_THEME_FORMAT_VERSION = 1;

/** The JSON shape produced by `exportCustomTheme` / accepted by `parseImportedTheme`. */
export interface ExportedTheme {
  version: number;
  name: string;
  baseThemeId: string;
  accents: Partial<Record<AccentToken, string>>;
}

let counter = 0;
export function makeCustomThemeId(): string {
  counter += 1;
  return `custom:${Date.now().toString(36)}:${counter}`;
}

export function createCustomTheme(name: string, baseThemeId: string = DEFAULT_THEME_ID): CustomTheme {
  return { id: makeCustomThemeId(), name, baseThemeId, accents: {}, createdAt: Date.now() };
}

/** Resolve a custom theme into a complete, valid `ThemeTokens` map by
 *  layering its accent overrides on top of its base theme. Falls back to the
 *  default theme's tokens if the referenced base was deleted/renamed — a
 *  custom theme must never resolve to a token that silently doesn't exist. */
export function resolveCustomTheme(custom: CustomTheme): ThemeTokens {
  const base = getBuiltinTheme(custom.baseThemeId) ?? getBuiltinTheme(DEFAULT_THEME_ID)!;
  return { ...base.tokens, ...custom.accents } as ThemeTokens;
}

export function customThemeAsDefinition(custom: CustomTheme): ThemeDefinition {
  const base = getBuiltinTheme(custom.baseThemeId) ?? getBuiltinTheme(DEFAULT_THEME_ID)!;
  return {
    id: custom.id,
    name: custom.name,
    description: `Custom — based on ${base.name}.`,
    scheme: base.scheme,
    tokens: resolveCustomTheme(custom),
  };
}

export function exportCustomTheme(custom: CustomTheme): ExportedTheme {
  return {
    version: CUSTOM_THEME_FORMAT_VERSION,
    name: custom.name,
    baseThemeId: custom.baseThemeId,
    accents: { ...custom.accents },
  };
}

export function exportCustomThemeJson(custom: CustomTheme): string {
  return JSON.stringify(exportCustomTheme(custom), null, 2);
}

export class ThemeImportError extends Error {
  constructor(message: string, public readonly issues: ThemeIssue[] = []) {
    super(message);
    this.name = 'ThemeImportError';
  }
}

function isAccentToken(k: string): k is AccentToken {
  return (ACCENT_TOKENS as readonly string[]).includes(k);
}

/** Parse + validate an imported theme JSON string (from `exportCustomThemeJson`,
 *  or hand-written). Throws `ThemeImportError` with the specific problem
 *  rather than silently coercing bad data into a broken theme. */
export function parseImportedTheme(json: string): CustomTheme {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new ThemeImportError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ThemeImportError('Theme file must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    throw new ThemeImportError('Theme file is missing a "name".');
  }
  if (typeof obj.baseThemeId !== 'string' || !getBuiltinTheme(obj.baseThemeId)) {
    throw new ThemeImportError(
      `Theme file's "baseThemeId" (${JSON.stringify(obj.baseThemeId)}) is not one of the ` +
        `shipped themes: ${BUILTIN_THEMES.map((t) => t.id).join(', ')}.`,
    );
  }
  const accentsRaw = obj.accents;
  if (typeof accentsRaw !== 'object' || accentsRaw === null || Array.isArray(accentsRaw)) {
    throw new ThemeImportError('Theme file\'s "accents" must be an object.');
  }
  const accents: Partial<Record<AccentToken, string>> = {};
  for (const [k, v] of Object.entries(accentsRaw as Record<string, unknown>)) {
    if (!isAccentToken(k)) {
      throw new ThemeImportError(`"${k}" is not a recognised accent token.`);
    }
    if (typeof v !== 'string') {
      throw new ThemeImportError(`"${k}" must be a colour string.`);
    }
    accents[k] = v;
  }

  const candidate: CustomTheme = {
    id: makeCustomThemeId(),
    name: obj.name,
    baseThemeId: obj.baseThemeId,
    accents,
    createdAt: Date.now(),
  };

  const issues = validateTheme(resolveCustomTheme(candidate));
  if (issues.length > 0) {
    throw new ThemeImportError(
      `Imported theme fails validation: ${issues.map((i) => i.message).join('; ')}`,
      issues,
    );
  }
  return candidate;
}
