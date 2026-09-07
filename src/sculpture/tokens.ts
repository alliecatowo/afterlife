/**
 * Read REAL design tokens from `src/styles/tokens.css` at runtime, instead of
 * hardcoding hex/oklch values here. Tokens are declared as `oklch(...)`,
 * which three.js's `Color` cannot parse directly.
 *
 * Two indirect tricks were tried and rejected before this one:
 *  - A hidden DOM element's `getComputedStyle().color`: modern Chromium
 *    (wide-gamut CSS Color 4 support) echoes `oklch(...)` colours back in
 *    their ORIGINAL notation instead of downgrading to `rgb(...)`.
 *  - A `<canvas>` 2D context's `fillStyle` GETTER: same problem — as of
 *    recent Chromium, reading `ctx.fillStyle` back after setting it to an
 *    oklch string also echoes `oklch(...)` unchanged, confirmed against the
 *    exact Chromium this repo's Playwright pins.
 * Both cases still log three.js's "Unknown color model oklch(...)" warning
 * and silently render black.
 *
 * What DOES work regardless of string-serialisation behaviour: actually
 * RASTERISING the colour. A 2D canvas's pixel buffer is (by default) sRGB
 * 8-bit, so painting one pixel with the colour and reading it back via
 * `getImageData` forces the browser to do the real oklch -> sRGB conversion
 * and hand back concrete bytes — no CSS string round-trip involved at all.
 */
import * as THREE from 'three';

let ctx: CanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx;
}

/** Read a `--color-*` custom property, resolved to a `rgb()`/`rgba()` string via rasterisation. */
export function resolveCssColorString(varName: string, fallback: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return fallback;
    const c = getCtx();
    if (!c) return fallback;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = raw;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  } catch {
    return fallback;
  }
}

/** Read `--color-*` custom property and resolve it into a `THREE.Color`. */
export function readCssColor(varName: string, fallback: string): THREE.Color {
  try {
    return new THREE.Color().setStyle(resolveCssColorString(varName, fallback));
  } catch {
    return new THREE.Color(fallback);
  }
}

/** Read a `--duration-*`/`--size-*` custom property as a number (ms or px, unit stripped). */
export function readCssNumber(varName: string, fallback: number): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Test/teardown only — the probe canvas is never attached to the document, so this just drops the cached context. */
export function disposeTokenProbe(): void {
  ctx = null;
}
