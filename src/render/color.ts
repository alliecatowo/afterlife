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

// ---------------------------------------------------------------------------
// The "lineage" family of lenses: multi-hue palettes and their maths.
//
// `RenderLens` (`@/core/types`) has since been widened to all 8 lens ids
// (`'life' | 'age' | 'activity' | 'lineage' | 'immigration' | 'quadlife' |
// 'velocity' | 'neighbors'`) — see `INTEGRATION-NOTES.md`'s "colourful
// lenses" entry for the history. `ColorLens` is kept as a separate, render-
// owned alias rather than importing `RenderLens` verbatim everywhere in this
// module: it's what lets this file's own vocabulary (`COLOR_LENSES`, the
// legend builders below) stay stable even if `RenderLens` ever changes shape
// again, without every call site here needing to know which type is
// authoritative. Currently an exact match, so this union is redundant by
// construction, not a divergent set of lenses.
// ---------------------------------------------------------------------------
import type { RenderLens } from '@/core/types';

export type ColorLens = RenderLens | 'lineage' | 'immigration' | 'quadlife' | 'velocity' | 'neighbors';

/** All lens ids, in the order they should appear in any picker/legend. */
export const COLOR_LENSES: readonly ColorLens[] = [
  'life', 'age', 'activity', 'lineage', 'immigration', 'quadlife', 'velocity', 'neighbors',
];

/**
 * Which palette the discrete species lenses (`immigration`/`quadlife`) draw
 * from. `'cvd'` is the colourblind-safe option required by the design brief
 * ("offer at least one colourblind-safe palette option") — see
 * `resolveQuadPalette`'s doc for why it deliberately does NOT derive from
 * `tokens.css` the way every other palette here does.
 */
export type PaletteMode = 'default' | 'cvd';

function hueRampRgb(hueDeg: number, l: number, c: number): RGB {
  return oklchToRgb(l, c, hueDeg);
}

/**
 * A precomputed, evenly-spaced lookup table of `steps` colours around the
 * full hue wheel at a fixed lightness/chroma. Built ONCE (at `attach()` or
 * on a palette change) and indexed per-pixel thereafter — never recomputed
 * inside a per-cell draw loop, matching the renderer's "no per-frame work"
 * discipline. Used by the `lineage` and `velocity` lenses, whose hue is a
 * continuous [0, 360) value rather than one of a handful of design tokens.
 */
export function buildHueRamp(steps = 180, l = 0.80, c = 0.15): RGB[] {
  const ramp: RGB[] = new Array(steps);
  for (let i = 0; i < steps; i++) ramp[i] = hueRampRgb((i / steps) * 360, l, c);
  return ramp;
}

/** Index a hue-wheel ramp built by `buildHueRamp` for an arbitrary degree value. */
export function sampleHueRamp(ramp: readonly RGB[], hueDeg: number): RGB {
  const h = ((hueDeg % 360) + 360) % 360;
  const i = Math.min(ramp.length - 1, Math.floor((h / 360) * ramp.length));
  return ramp[i]!;
}

/**
 * A piecewise-linear RGB ramp across evenly-spaced `stops` (already resolved
 * to concrete sRGB bytes — this never re-parses a CSS colour string, unlike
 * the OKLCH hue ramps above, so it's equally safe to anchor the END of the
 * ramp exactly on a design token's resolved colour, whatever wire format the
 * build pipeline emitted it in). Used to give `age`/`activity` a genuine
 * multi-hue spectral gradient (per the design brief) that still terminates
 * exactly on that lens's one fixed-meaning accent token at full intensity.
 */
export function buildRgbRamp(stops: readonly RGB[], steps = 64): RGB[] {
  if (stops.length === 0) throw new Error('buildRgbRamp: at least one stop required');
  if (stops.length === 1) return new Array(steps).fill(stops[0]);
  const ramp: RGB[] = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const seg = t * (stops.length - 1);
    const i0 = Math.min(stops.length - 2, Math.floor(seg));
    const localT = seg - i0;
    const a = stops[i0]!;
    const b = stops[i0 + 1]!;
    ramp[i] = {
      r: Math.round(a.r + (b.r - a.r) * localT),
      g: Math.round(a.g + (b.g - a.g) * localT),
      b: Math.round(a.b + (b.b - a.b) * localT),
    };
  }
  return ramp;
}

/** Index an RGB ramp built by `buildRgbRamp` at `t` in [0, 1] (clamped). */
export function sampleRgbRamp(ramp: readonly RGB[], t: number): RGB {
  const clamped = Math.min(1, Math.max(0, t));
  const i = Math.min(ramp.length - 1, Math.floor(clamped * ramp.length));
  return ramp[i]!;
}

/**
 * A 9-entry (0..8 live neighbours) spectral ramp for the `neighbors` lens —
 * "the rule itself visible": cool for sparse (0-1), the accent-life hue
 * right around the B3/S23 birth/survival band (2-3), warm/hot for crowded
 * (7-8, heading toward death by overpopulation). Deliberately a real hue
 * sweep, not a single-hue lightness fade, per the design brief.
 */
export function buildNeighborRamp(l = 0.80, c = 0.16): RGB[] {
  const ramp: RGB[] = new Array(9);
  for (let n = 0; n <= 8; n++) {
    // 235 (cool blue) at n=0 down to 5 (hot red) at n=8, sweeping through the
    // accent-life green (~155) right at the birth count of 3.
    const hue = 235 - (n / 8) * 230;
    ramp[n] = hueRampRgb(hue, l, c);
  }
  return ramp;
}

/**
 * Standard Okabe-Ito colourblind-safe swatches — a well-established,
 * independently verified palette (distinguishable under protanopia,
 * deuteranopia and tritanopia), used verbatim rather than derived from
 * `tokens.css`'s hand-picked accent hues: nothing in this app's existing
 * palette has been verified CVD-safe, and inventing a "safe" palette by eye
 * is exactly the mistake this option exists to avoid. This is the one
 * deliberate, documented exception to "all palettes derived from the design
 * tokens where possible."
 *
 * Authored as `oklch(...)` literals (converted from the canonical Okabe-Ito
 * hex values #E69F00/#56B4E9/#009E73/#D55E00 via the standard sRGB->OKLab
 * matrices) rather than hex strings, matching this module's existing
 * convention for every hardcoded fallback colour: it's what lets
 * `resolveCssColor`'s pure-OKLCH-math fallback resolve them in environments
 * with no canvas 2D context at all (SSR, jsdom unit tests) — a hex string
 * would only resolve via the canvas round-trip, i.e. only in a real browser.
 */
const CVD_ORANGE = 'oklch(0.753 0.158 76.8)';
const CVD_SKY_BLUE = 'oklch(0.735 0.117 236.2)';
const CVD_BLUISH_GREEN = 'oklch(0.620 0.130 165.5)';
const CVD_VERMILLION = 'oklch(0.621 0.170 47.5)';

/**
 * The 4 QuadLife species colours. Default palette reuses 4 existing design
 * tokens spread widely around the hue wheel (life/age/activity/branch-a —
 * ~155/78/25/300 degrees) rather than inventing new hues, per "all palettes
 * derived from the design tokens where possible." The CVD palette swaps in
 * Okabe-Ito instead (see above).
 *
 * These 4 tokens also spread across a real lightness range (life L0.87,
 * branch-a L0.80, age L0.79, activity L0.72) rather than sharing one
 * lightness — not a large spread, but enough that species stay somewhat
 * distinguishable even where hue alone would be ambiguous. This is a
 * best-effort property of REUSING existing tokens, not a guarantee the way
 * the dedicated `cvd` palette below is (verified against protanopia/
 * deuteranopia/tritanopia simulation) — callers who need a hard guarantee
 * should reach for `mode: 'cvd'`, which is the actual "never rely on hue
 * alone" answer for this palette.
 */
export function resolveQuadPalette(mode: PaletteMode = 'default'): RGB[] {
  if (mode === 'cvd') {
    return [CVD_ORANGE, CVD_SKY_BLUE, CVD_BLUISH_GREEN, CVD_VERMILLION].map((css) => resolveCssColor(css));
  }
  return [
    resolveToken('--color-accent-life', 'oklch(0.87 0.155 155)').rgb,
    resolveToken('--color-accent-age', 'oklch(0.79 0.130 78)').rgb,
    resolveToken('--color-accent-activity', 'oklch(0.72 0.185 25)').rgb,
    resolveToken('--color-accent-branch-a', 'oklch(0.80 0.115 300)').rgb,
  ];
}

/**
 * The 2 Immigration colours. Presented as a coarser 2-bucket VIEW of the
 * SAME species buffer QuadLife shows at full resolution (species {1,2} ->
 * colour A, {3,4} -> colour B) — see `@/core/lineage.ts`'s module doc for
 * why this is not a second simulation, just a second lens on one. Uses the
 * `branch-a`/`branch-b` tokens — already the app's existing vocabulary for
 * "two opposing populations" (branch comparison), which fits Immigration's
 * two-colour framing precisely.
 */
export function resolveImmigrationPalette(mode: PaletteMode = 'default'): [RGB, RGB] {
  if (mode === 'cvd') {
    return [resolveCssColor(CVD_ORANGE), resolveCssColor(CVD_SKY_BLUE)];
  }
  return [
    resolveToken('--color-accent-branch-a', 'oklch(0.80 0.115 300)').rgb,
    resolveToken('--color-accent-branch-b', 'oklch(0.83 0.130 195)').rgb,
  ];
}

/** Map a 1..4 species value to a palette entry (already-resolved 4-colour QuadLife palette). 0/out-of-range -> null. */
export function quadColorForSpecies(palette: readonly RGB[], species: number): RGB | null {
  if (species < 1 || species > 4) return null;
  return palette[species - 1] ?? null;
}

/** Map a 1..4 species value to the coarser 2-colour Immigration palette ({1,2} -> A, {3,4} -> B). 0/out-of-range -> null. */
export function immigrationColorForSpecies(palette: readonly [RGB, RGB], species: number): RGB | null {
  if (species < 1 || species > 4) return null;
  return species <= 2 ? palette[0] : palette[1];
}

/**
 * Weighted RGB blend of several colours by their fractional share — used by
 * the zoomed-out aggregation path so a screen pixel covering a mix of
 * species reads as a genuine blend (a magenta-ish mix of two colonies at
 * their border) rather than snapping to whichever species happens to be
 * sampled at one point. `weights` need not sum to 1; this normalises.
 */
export function blendRgbWeighted(colors: readonly RGB[], weights: readonly number[]): RGB {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < colors.length; i++) {
    const w = (weights[i] ?? 0) / total;
    r += colors[i]!.r * w;
    g += colors[i]!.g * w;
    b += colors[i]!.b * w;
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

/**
 * One legend row: a CSS swatch (solid colour, gradient, or conic-gradient)
 * and its meaning. `label` is the SHORT text shown inline (the HUD's lens
 * legend lives in a 48px-tall horizontal bar per DESIGN.md — a handful of
 * words per row, not a sentence); `title`, when present, is the fuller
 * explanation surfaced as a native tooltip on hover/focus so nothing said
 * about what a colour MEANS is lost, it's just not forced into the row's
 * width. See `Legend.tsx`.
 */
export interface LensLegendEntry {
  swatch: string;
  label: string;
  title?: string;
}

/**
 * Legend content for every lens, in the exact shape `@/ui/hud/Hud.tsx`'s
 * existing `LENS_LEGEND` record already uses (see that file — this mirrors
 * it deliberately so wiring the new lenses in is a copy-paste, documented in
 * `INTEGRATION-NOTES.md`). Colour must always be honest about simulation
 * state, never decorative — every entry names exactly what varying that
 * colour means.
 *
 * Labels are kept short on purpose: with all 8 lenses now in one `Toggle`,
 * a verbose label (the full "majority-of-3 wins; ties take the 4th colour"
 * explanation) made the HUD's single-line strip overflow past a 1440px
 * viewport with NO visible scroll affordance on most desktop OSes — the same
 * "control exists but isn't reachable" class of bug the mobile agent already
 * found and fixed for narrow widths (see INTEGRATION-NOTES.md), recurring on
 * desktop once 5 more lenses landed. The full explanation still exists, as
 * `title` (a native tooltip) and at length in the guide/wiki
 * (`site/guide/wiki/features/`) — nothing is actually lost, just not forced
 * into the row's width.
 */
export function buildLensLegends(mode: PaletteMode = 'default'): Record<ColorLens, LensLegendEntry[]> {
  const quad = mode === 'cvd'
    ? [CVD_ORANGE, CVD_SKY_BLUE, CVD_BLUISH_GREEN, CVD_VERMILLION]
    : ['var(--color-accent-life)', 'var(--color-accent-age)', 'var(--color-accent-activity)', 'var(--color-accent-branch-a)'];
  const [immA, immB] = mode === 'cvd'
    ? [CVD_ORANGE, CVD_SKY_BLUE]
    : ['var(--color-accent-branch-a)', 'var(--color-accent-branch-b)'];

  return {
    life: [{ swatch: 'var(--color-accent-life)', label: 'alive' }],
    age: [
      { swatch: 'linear-gradient(90deg, oklch(0.55 0.20 260), oklch(0.70 0.20 155), var(--color-accent-age))', label: 'young → long-lived', title: 'A spectral ramp: generations since birth, ending on the age accent colour for the longest-lived cells.' },
    ],
    activity: [
      { swatch: 'linear-gradient(90deg, oklch(0.55 0.20 260), oklch(0.75 0.20 100), var(--color-accent-activity))', label: 'quiet → active', title: 'A spectral ramp: recent-change heat, ending on the activity accent colour for cells that just changed.' },
    ],
    lineage: [
      { swatch: 'conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)', label: 'family hue', title: 'Heritage colour — a newborn blends its 3 parents’ hue, so visibly distinct colonies trace real lineages.' },
    ],
    immigration: [
      { swatch: immA, label: 'population A' },
      { swatch: immB, label: 'population B', title: 'The 2-colour Immigration variant: a majority-of-3 birth rule; interbreeding blends colours at the border between populations.' },
    ],
    quadlife: [
      { swatch: quad[0]!, label: 'species I' },
      { swatch: quad[1]!, label: 'species II' },
      { swatch: quad[2]!, label: 'species III' },
      { swatch: quad[3]!, label: 'species IV', title: 'The 4-colour QuadLife variant: majority-of-3 birth rule; a 3-way tie among parents takes the 4th, unused colour.' },
    ],
    velocity: [
      { swatch: 'conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)', label: 'direction of travel', title: 'Hue from each cell’s local directional bias — a proxy for which way a structure is advancing. Grey where undefined.' },
    ],
    neighbors: [
      { swatch: 'linear-gradient(90deg, oklch(0.80 0.16 235), oklch(0.80 0.16 155), oklch(0.80 0.16 5))', label: 'neighbour count 0 → 8', title: 'A 9-step spectral ramp over live-neighbour count — the B3/S23 birth/survival band reads as a distinct colour band.' },
    ],
  };
}

/**
 * Look up a lens's legend, falling back to `life`'s if `lens` isn't a
 * recognised key. `buildLensLegends()` covers every current `ColorLens`
 * value, so in normal operation this fallback never triggers — but a naive
 * `LENS_LEGEND[lens]` index crashed the ENTIRE app (React tree unmount,
 * including `#world-canvas`) the moment an unrecognised lens id reached the
 * store before `RenderLens` was widened to include the 5 new colour lenses
 * (see INTEGRATION-NOTES.md's "colourful lenses" entry for the full story).
 * Cheap, permanent insurance against the same class of bug recurring — e.g.
 * a future lens/legend drift, or a stale/corrupted persisted lens id from an
 * older save.
 */
export function safeLensLegend(
  legends: Record<ColorLens, LensLegendEntry[]>,
  lens: ColorLens,
): LensLegendEntry[] {
  return legends[lens] ?? legends.life;
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

// ---------------------------------------------------------------------------
// Art mode colour maths (`@/render/artConfig.ts`/`artStore.ts`/the glyph
// draw path in `renderer.ts`). Kept here rather than a new file since it's
// the same "pure RGB maths" vocabulary as the ramps above — hue rotation and
// a custom-palette-stop sampler, both plain-number in/out and independent of
// canvas/DOM, so they're directly unit-testable.
// ---------------------------------------------------------------------------

/** Rotate an already-resolved RGB colour's hue by `degrees` (via HSL),
 *  preserving its saturation/lightness. Used for Art mode's "hue rotation"
 *  and "palette cycling" controls — both are, mechanically, the same
 *  operation applied to a continuously increasing angle. `degrees % 360 ===
 *  0` short-circuits to the input unchanged (also handles negative/huge
 *  inputs correctly via modulo). */
export function rotateHueRgb(rgb: RGB, degrees: number): RGB {
  const deg = ((degrees % 360) + 360) % 360;
  if (deg === 0) return rgb;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + deg / 360) % 1;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, tIn: number): number => {
    let t = tIn;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/** An already-resolved custom palette stop — `t` in `[0, 1]`, `rgb` the
 *  resolved colour at that position. Callers resolve raw CSS stop strings
 *  through `resolveCssColor` ONCE (they change rarely, on user edit) and
 *  cache the result; `sampleStopsRgb` itself never touches CSS/DOM, so it's
 *  cheap to call per cell per frame. */
export interface RgbStop {
  t: number;
  rgb: RGB;
}

/** Piecewise-linear-interpolate a custom Art-mode palette (sorted ascending
 *  by `t`) at position `t`, clamping to the end stops outside `[0, 1]`. */
export function sampleStopsRgb(stops: readonly RgbStop[], t: number): RGB {
  if (stops.length === 0) return { r: 0, g: 0, b: 0 };
  if (stops.length === 1) return stops[0]!.rgb;
  const clamped = Math.min(1, Math.max(0, t));
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (clamped <= first.t) return first.rgb;
  if (clamped >= last.t) return last.rgb;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (clamped >= a.t && clamped <= b.t) {
      const span = b.t - a.t || 1;
      const localT = (clamped - a.t) / span;
      return {
        r: Math.round(a.rgb.r + (b.rgb.r - a.rgb.r) * localT),
        g: Math.round(a.rgb.g + (b.rgb.g - a.rgb.g) * localT),
        b: Math.round(a.rgb.b + (b.rgb.b - a.rgb.b) * localT),
      };
    }
  }
  return last.rgb;
}
