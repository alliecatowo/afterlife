/**
 * Design-token colour resolution for the Canvas2D renderer. Owned by the
 * `render` agent (`src/render/**`).
 *
 * `tokens.css` defines every accent as `oklch(L C H)`. Canvas fillStyle /
 * strokeStyle accept CSS colour strings (including oklch) directly in
 * evergreen Chromium, so overlay strokes/fills use the raw token string.
 * `ImageData` pixel buffers need real sRGB bytes, so this module also
 * converts OKLCH -> sRGB using Björn Ottosson's published OKLab matrices.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

function srgbGamma(c: number): number {
  const cl = Math.min(1, Math.max(0, c));
  return cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055;
}

/** OKLCH (L in [0,1], C chroma, H in degrees) -> sRGB bytes in [0,255]. */
export function oklchToRgb(l: number, c: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  return {
    r: Math.round(srgbGamma(r) * 255),
    g: Math.round(srgbGamma(g) * 255),
    b: Math.round(srgbGamma(bl) * 255),
  };
}

const OKLCH_RE = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i;

/** Parse `oklch(L C H[ / A])` into its raw components. Throws on a bad string. */
export function parseOklch(cssValue: string): { l: number; c: number; h: number } {
  const m = OKLCH_RE.exec(cssValue.trim());
  if (!m) throw new Error(`parseOklch: could not parse "${cssValue}"`);
  return { l: parseFloat(m[1]!), c: parseFloat(m[2]!), h: parseFloat(m[3]!) };
}

/** Read a CSS custom property from computed root styles (a design token). */
export function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** A cached token: the raw CSS string (for stroke/fill) plus decoded sRGB (for ImageData). */
export interface TokenColor {
  css: string;
  rgb: RGB;
  l: number;
  c: number;
  h: number;
}

export function resolveToken(name: string, fallback: string): TokenColor {
  const css = readToken(name, fallback);
  try {
    const { l, c, h } = parseOklch(css);
    return { css, rgb: oklchToRgb(l, c, h), l, c, h };
  } catch {
    return { css, rgb: { r: 255, g: 255, b: 255 }, l: 1, c: 0, h: 0 };
  }
}

/** Build an `oklch(L C H / A)` string from a resolved token at a new alpha. */
export function withAlpha(token: TokenColor, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `oklch(${token.l} ${token.c} ${token.h} / ${a})`;
}
