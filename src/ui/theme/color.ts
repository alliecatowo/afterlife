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

// ---- oklch <-> hex, for the custom-theme colour-picker editor -------------
//
// Theme tokens are always STORED/authored as `oklch()` (see this module's
// doc), but a native `<input type="color">` only speaks hex sRGB. These two
// conversions exist solely to bridge that one UI control — never used by
// validation or contrast maths above, which stay in OKLCH/OKLab throughout.

function srgbGammaToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbGamma(c: number): number {
  const cl = clamp01(c);
  return cl <= 0.0031308 ? cl * 12.92 : 1.055 * cl ** (1 / 2.4) - 0.055;
}

function linearSrgbToOklab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

function oklabToOklch(l: number, a: number, b: number): Oklch {
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l, c, h };
}

/** `oklch(L C H)` -> `#rrggbb`, gamut-clamped (matches how a browser
 *  actually paints an out-of-gamut oklch() value). */
export function oklchToHex(o: Oklch): string {
  const { l, a, b } = oklchToOklab(o);
  const [r, g, bl] = oklabToLinearSrgbPublic(l, a, b);
  const toByte = (c: number) => Math.round(linearToSrgbGamma(c) * 255);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(toByte(r))}${hex(toByte(g))}${hex(toByte(bl))}`;
}

/** `#rrggbb`/`#rgb` -> `oklch(L C H)`, formatted the same way `formatOklch` does. */
export function hexToOklchString(hex: string): string {
  const norm = hex.trim().replace(/^#/, '');
  const full = norm.length === 3 ? norm.split('').map((c) => c + c).join('') : norm;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`hexToOklchString: not a hex colour: "${hex}"`);
  const r = srgbGammaToLinear(parseInt(full.slice(0, 2), 16) / 255);
  const g = srgbGammaToLinear(parseInt(full.slice(2, 4), 16) / 255);
  const b = srgbGammaToLinear(parseInt(full.slice(4, 6), 16) / 255);
  const lab = linearSrgbToOklab(r, g, b);
  return formatOklch(oklabToOklch(lab.l, lab.a, lab.b));
}

// `oklabToLinearSrgb` above is intentionally module-private (contrast maths
// only needs [0,1]-clamped linear values); this thin wrapper just gives the
// hex conversion the same clamping without duplicating the matrices.
function oklabToLinearSrgbPublic(l: number, a: number, b: number): [number, number, number] {
  return oklabToLinearSrgb(l, a, b);
}
