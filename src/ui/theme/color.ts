/**
 * Standalone OKLCH colour math for the theming system: WCAG contrast ratios
 * and a perceptual distance metric, computable in plain Node/Vitest with no
 * DOM, canvas, or browser at all — so themes can be validated at TEST time,
 * not just eyeballed in a browser.
 *
 * IMPORTANT — this is NOT `src/render/color.ts`'s `resolveCssColor`, and must
 * never be used as a substitute for it at render time: `resolveCssColor`
 * exists specifically because you cannot robustly regex-parse arbitrary CSS
 * colours (hex, named colours, `color-mix()`, arbitrary future syntax) and
 * must round-trip through a real canvas instead. This module solves a
 * narrower, self-imposed problem: every AFTERLIFE theme token is AUTHORED by
 * us, always in the exact form `oklch(L C H)` (see `tokens.css`'s own
 * convention), so parsing that one specific, fully-controlled format with a
 * strict pattern is safe. A theme token that isn't in this form is a bug in
 * the theme definition, not a colour this module needs to render — validation
 * (`validate.ts`) throws on it rather than guessing.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** Parse a theme-authored `oklch(L C H)` string. Throws on anything else —
 *  a theme token must never silently fall back to a wrong colour. */
export function parseOklch(css: string): Oklch {
  const m = OKLCH_RE.exec(css.trim());
  if (!m) {
    throw new Error(
      `theme token colours must be authored as "oklch(L C H)", got: "${css}"`,
    );
  }
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${round(l, 4)} ${round(c, 4)} ${round(h, 2)})`;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** OKLab (L, a, b) from OKLCH — trivial polar-to-rectangular conversion,
 *  used for the perceptual-distance check between accents. */
export function oklchToOklab({ l, c, h }: Oklch): { l: number; a: number; b: number } {
  const hr = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(hr), b: c * Math.sin(hr) };
}

/** Euclidean distance in OKLab. OKLab is designed so that equal Euclidean
 *  steps correspond to roughly equal perceived colour differences, so this
 *  is a good, cheap stand-in for a full CIEDE2000 delta for our purposes
 *  (checking that 8 accent colours remain mutually distinguishable). */
export function oklabDistance(a: Oklch, b: Oklch): number {
  const A = oklchToOklab(a);
  const B = oklchToOklab(b);
  return Math.sqrt((A.l - B.l) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2);
}

/** Linear sRGB from OKLab, via Björn Ottosson's published matrices. Returns
 *  values that may be outside [0, 1] for colours outside the sRGB gamut —
 *  callers that need real gamut mapping should clamp; for luminance/contrast
 *  purposes (this module's only use) clamping to [0, 1] is correct and
 *  matches how a browser would ultimately display an out-of-gamut oklch(). */
function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const ll = l_ ** 3;
  const mm = m_ ** 3;
  const ss = s_ ** 3;

  const r = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss;
  const g = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss;
  const bl = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss;

  return [clamp01(r), clamp01(g), clamp01(bl)];
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * WCAG relative luminance. `oklabToLinearSrgb` already yields *linear* sRGB
 * primaries (the cubing step is the OKLab->LMS gamma undo), which is exactly
 * what the WCAG formula wants — no further sRGB EOTF decode needed.
 */
export function relativeLuminance(color: Oklch): number {
  const { l, a, b } = oklchToOklab(color);
  const [r, g, bl] = oklabToLinearSrgb(l, a, b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** WCAG contrast ratio between two theme colours, 1:1 (identical) to 21:1
 *  (black on white). Order-independent. */
export function contrastRatio(a: string | Oklch, b: string | Oklch): number {
  const oa = typeof a === 'string' ? parseOklch(a) : a;
  const ob = typeof b === 'string' ? parseOklch(b) : b;
  const la = relativeLuminance(oa);
  const lb = relativeLuminance(ob);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA body-text threshold (4.5:1). */
export const WCAG_AA_BODY = 4.5;
/** WCAG AA large-text / UI-component threshold (3:1). */
export const WCAG_AA_LARGE = 3;
