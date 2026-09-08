/**
 * Design-token colour resolution for the Canvas2D renderer. Owned by the
 * `render` agent (`src/render/**`).
 *
 * `tokens.css` defines every accent as `oklch(L C H)`. In `npm run dev`,
 * Vite serves that source CSS verbatim, so `getComputedStyle` returns
 * `oklch(...)` strings. In the PRODUCTION build, Tailwind v4 + Lightning CSS
 * downlevel those tokens to whatever wire format the target browserslist
 * needs — verified: the built `dist/assets/index-*.css` contains zero
 * `oklch(` occurrences; `--color-accent-life` resolves to
 * `lab(86.946% -49.1658 25.3166)` instead. A hand-rolled regex parser tied to
 * one syntax (the previous `parseOklch`-only approach) breaks the instant the
 * toolchain's downlevel target changes, and — worse — it broke SILENTLY: the
 * old `resolveToken` caught the parse failure and returned a hardcoded
 * `{rgb:{r:255,g:255,b:255}, l:1, c:0, h:0}` (pure white, zero chroma) for
 * every token, so the whole production build rendered every lens as flat
 * white with no visible failure anywhere.
 *
 * Fix: never hand-parse the token string. Ask the BROWSER to resolve it —
 * any string a real `<canvas>` 2D context accepts as `fillStyle` (oklch, lab,
 * lch, color(), hex, named, `color-mix()`, anything the CSS Color spec ever
 * grows) round-trips through a 1x1 offscreen canvas to concrete sRGB bytes.
 * This is what `ImageData` pixel paths (life/age/activity/diff/warn/line)
 * need, and it is correct by construction because it's literally what the
 * browser would have painted.
 *
 * Failure is now loud, never silent: `resolveCssColor` throws on a colour
 * the platform itself rejects (checked via `CSS.supports`, so there is no
 * dependence on canvas failure semantics — an invalid `fillStyle` assignment
 * is a silent no-op per spec, not a throw). `resolveToken` lets that
 * exception propagate as a thrown error in dev (fail fast, impossible to
 * miss), and in production logs it loudly via `console.error` and recovers
 * using the hardcoded per-token fallback colour — still a real, correct,
 * on-brand colour, never a silent wrong one.
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

/**
 * OKLCH (L in [0,1], C chroma, H in degrees) -> sRGB bytes in [0,255].
 * Pure math (Björn Ottosson's published OKLab matrices) — no DOM, always
 * available. Used as the last-resort fallback path when no canvas 2D context
 * exists at all (SSR, or a headless/test DOM like jsdom that doesn't
 * implement `HTMLCanvasElement.getContext`). Every hardcoded fallback colour
 * in this module is authored as a literal `oklch(...)` string specifically so
 * this path always succeeds for them.
 */
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

function tryParseOklch(cssValue: string): { l: number; c: number; h: number } | null {
  try {
    return parseOklch(cssValue);
  } catch {
    return null;
  }
}

/** Read a CSS custom property from computed root styles (a design token). */
export function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// A single shared 1x1 offscreen canvas, lazily created and reused across
// every `resolveCssColor` call — cheap, and avoids allocating a canvas per
// token resolution (resolution happens a handful of times per renderer
// `attach()`, but keeping this reusable costs nothing and rules out any
// per-call allocation cost entirely).
let sharedCtx: CanvasRenderingContext2D | null | undefined;

function getSharedCtx(): CanvasRenderingContext2D | null {
  if (sharedCtx !== undefined) return sharedCtx;
  if (typeof document === 'undefined') {
    sharedCtx = null;
    return sharedCtx;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  // `willReadFrequently` hints this context is used for `getImageData`, not
  // for compositing to screen — the right hint for a pure colour-resolution
  // scratch canvas.
  sharedCtx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  return sharedCtx;
}

/**
 * Resolve ANY valid CSS `<color>` string to concrete sRGB bytes, exactly as
 * the browser would paint it — robust to whatever wire format the CSS
 * pipeline emits (oklch, lab, lch, color(), hex, named, …), not just one
 * hand-parsed syntax. Throws loudly if the platform itself rejects the
 * string as an invalid colour, or (only when no canvas 2D context exists at
 * all, e.g. SSR/jsdom) if it isn't a plain `oklch(...)` literal the pure-math
 * path can still handle.
 */
export function resolveCssColor(cssValue: string): RGB {
  const css = cssValue.trim();
  if (!css) throw new Error('resolveCssColor: empty colour string');

  // `CSS.supports('color', …)` is the platform-native, side-effect-free way
  // to validate ANY CSS colour syntax — real browsers and jsdom both
  // implement it correctly (unlike canvas 2D, which jsdom doesn't implement
  // at all, and which silently no-ops on an invalid `fillStyle` per spec
  // rather than signalling failure).
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('color', css)) {
    throw new Error(`resolveCssColor: "${css}" is not a valid CSS colour`);
  }

  const ctx = getSharedCtx();
  if (ctx) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0]!, g: data[1]!, b: data[2]! };
  }

  // No canvas 2D available at all (SSR, or a test DOM like jsdom that
  // doesn't implement `HTMLCanvasElement.getContext`). Fall back to exact
  // OKLCH math — every fallback constant this codebase resolves through here
  // is a literal `oklch(...)` token, so this always succeeds for them.
  const oklch = tryParseOklch(css);
  if (oklch) return oklchToRgb(oklch.l, oklch.c, oklch.h);
  throw new Error(`resolveCssColor: no canvas available to resolve non-OKLCH colour "${css}"`);
}

/** A cached token: the raw CSS string (for stroke/fill) plus decoded sRGB (for ImageData). */
export interface TokenColor {
  css: string;
  rgb: RGB;
}

/**
 * Resolve a design token to both its raw CSS string (for `ctx.fillStyle`,
 * which accepts the string directly) and concrete sRGB bytes (for
 * `ImageData` pixel writes, which need real numbers).
 *
 * Never silently substitutes white. `dev` (default: `import.meta.env.DEV`)
 * controls how a resolution failure surfaces:
 *  - dev: throws — a broken token must be impossible to miss while working
 *    on this codebase.
 *  - production: logs loudly via `console.error` and recovers using the
 *    hardcoded `fallback` colour (resolved the same way, so it's a real,
 *    correct, on-brand colour) rather than crashing the whole renderer over
 *    one bad token.
 */
export function resolveToken(
  name: string,
  fallback: string,
  dev: boolean = Boolean(import.meta.env?.DEV),
): TokenColor {
  const css = readToken(name, fallback);
  try {
    return { css, rgb: resolveCssColor(css) };
  } catch (err) {
    const message = `resolveToken: failed to resolve design token "${name}" (value "${css}"): ${(err as Error).message}`;
    if (dev) throw new Error(message);
    // eslint-disable-next-line no-console -- intentionally loud: this must never fail silently.
    console.error(message);
    return { css: fallback, rgb: resolveCssColor(fallback) };
  }
}

/**
 * Build a translucent variant of ANY resolved token colour at a new alpha,
 * usable directly as a canvas `fillStyle`/`strokeStyle`. Uses `color-mix()`
 * against the token's own CSS string rather than reconstructing an
 * `oklch(...)` literal from decomposed L/C/H — format-agnostic, so it works
 * whether the resolved token is `oklch(...)`, `lab(...)`, or anything else.
 */
export function withAlpha(token: TokenColor, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return `color-mix(in oklab, ${token.css} ${Math.round(a * 100)}%, transparent)`;
}
