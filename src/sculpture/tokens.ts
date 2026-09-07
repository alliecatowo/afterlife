/**
 * Read REAL design tokens from `src/styles/tokens.css` at runtime, instead of
 * hardcoding hex/oklch values here. Tokens are declared as `oklch(...)`,
 * which three.js's `Color` cannot parse directly — so we hand the raw CSS
 * string to a throwaway DOM element and let the browser's own CSS engine
 * resolve it to `rgb(...)`, which `Color.setStyle` understands natively.
 */
import * as THREE from 'three';

let probe: HTMLDivElement | null = null;

function getProbe(): HTMLDivElement {
  if (probe && probe.isConnected) return probe;
  probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.overflow = 'hidden';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  return probe;
}

/** Read a `--color-*` custom property, resolved by the browser to `rgb(...)`. */
export function resolveCssColorString(varName: string, fallback: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return fallback;
    const el = getProbe();
    el.style.color = raw;
    const resolved = getComputedStyle(el).color;
    return resolved || fallback;
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

/** Test/teardown only. */
export function disposeTokenProbe(): void {
  probe?.remove();
  probe = null;
}
