import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  oklchToRgb, parseOklch, resolveCssColor, resolveToken, withAlpha,
} from '@/render/color';

// This test environment (jsdom) does not implement `HTMLCanvasElement`'s 2D
// context — see the "Not implemented" warning jsdom logs — so
// `resolveCssColor`/`resolveToken` exercise their pure-OKLCH-math fallback
// path here, not the canvas round-trip a real browser takes. That's exactly
// the right thing to cover in this test tier: every hardcoded fallback colour
// in this codebase IS a literal `oklch(...)` string, and this environment is
// the "no canvas available at all" case the fallback path exists for. The
// canvas round-trip itself (the actual BUG 1 fix — resolving `lab(...)`,
// `color(...)`, etc.) is covered by the real-browser Playwright project
// added against the production build (`e2e/prod-build.spec.ts`), since no
// unit-test environment here has a working canvas to exercise it against.
describe('resolveCssColor: never a silent wrong colour', () => {
  it('resolves a plain oklch() literal to the same bytes as the pure-math conversion', () => {
    const css = 'oklch(0.87 0.155 155)';
    const { l, c, h } = parseOklch(css);
    expect(resolveCssColor(css)).toEqual(oklchToRgb(l, c, h));
  });

  it('throws — loudly, not silently — on a string the platform rejects as an invalid colour', () => {
    expect(() => resolveCssColor('not-a-colour-at-all')).toThrow(/not a valid CSS colour/);
  });

  it('throws on empty input rather than returning a default', () => {
    expect(() => resolveCssColor('   ')).toThrow();
  });

  it('is never pure white ({255,255,255}) for the real design tokens — the exact failure mode BUG 1 shipped', () => {
    const life = resolveCssColor('oklch(0.87 0.155 155)');
    const age = resolveCssColor('oklch(0.79 0.130 78)');
    const activity = resolveCssColor('oklch(0.72 0.185 25)');
    for (const rgb of [life, age, activity]) {
      expect(rgb).not.toEqual({ r: 255, g: 255, b: 255 });
    }
  });
});

describe('resolveToken: loud failure, never a silent white fallback', () => {
  it('throws in "dev" mode when the resolved token value is not a valid colour', () => {
    // Simulate what shipped in production: a token whose CSS custom property
    // resolves to garbage this environment's canvas can't touch (no canvas
    // here at all) AND that isn't a parseable oklch() literal.
    expect(() => resolveToken('--nonexistent-token', 'this-is-not-a-colour', true))
      .toThrow(/failed to resolve design token/);
  });

  it('in production mode, logs loudly and recovers using the fallback colour instead of crashing or going white', () => {
    // Simulate the real BUG 1 shape: the CSS custom property itself resolves
    // to something this resolution pipeline can't turn into a colour (in a
    // real browser that would be a canvas-rejected string; here — no canvas
    // at all — it's simplest to reproduce with a value that's neither a
    // valid CSS colour nor plain oklch()), while the AUTHORED fallback
    // constant (always a literal oklch()) stays valid.
    document.documentElement.style.setProperty('--nonexistent-token', 'garbage-not-a-colour');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = resolveToken('--nonexistent-token', 'oklch(0.87 0.155 155)', false);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toMatch(/failed to resolve design token/);
    // Recovered using the real fallback colour, not a hardcoded white.
    expect(token.rgb).toEqual(oklchToRgb(0.87, 0.155, 155));
    expect(token.rgb).not.toEqual({ r: 255, g: 255, b: 255 });
    document.documentElement.style.removeProperty('--nonexistent-token');
    spy.mockRestore();
  });

  it('a token that already resolves to a literal oklch() (the dev-mode / this test env case) round-trips exactly', () => {
    const token = resolveToken('--nonexistent-token', 'oklch(0.87 0.155 155)', true);
    expect(token.css).toBe('oklch(0.87 0.155 155)');
    expect(token.rgb).toEqual(oklchToRgb(0.87, 0.155, 155));
  });
});

describe("colourful, richly differentiated lenses (the user's \"needs color to be colorful\")", () => {
  it('life / age / activity design tokens resolve to genuinely different, chromatic colours', () => {
    const life = resolveCssColor('oklch(0.87 0.155 155)');
    const age = resolveCssColor('oklch(0.79 0.130 78)');
    const activity = resolveCssColor('oklch(0.72 0.185 25)');

    // Not grey/white: real chroma, i.e. channels aren't all equal.
    for (const rgb of [life, age, activity]) {
      expect(new Set([rgb.r, rgb.g, rgb.b]).size).toBeGreaterThan(1);
    }
    // Genuinely distinguishable from one another, not just three shades of
    // the same hue.
    const dist = (a: typeof life, b: typeof life): number =>
      Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(dist(life, age)).toBeGreaterThan(40);
    expect(dist(life, activity)).toBeGreaterThan(40);
    expect(dist(age, activity)).toBeGreaterThan(40);
  });
});

describe('withAlpha: format-agnostic translucency', () => {
  it('builds a color-mix() expression against the resolved css string, not a re-derived oklch() literal', () => {
    const token = { css: 'lab(86.946% -49.1658 25.3166)', rgb: { r: 1, g: 2, b: 3 } };
    expect(withAlpha(token, 0.5)).toBe('color-mix(in oklab, lab(86.946% -49.1658 25.3166) 50%, transparent)');
  });

  it('clamps alpha to [0, 1]', () => {
    const token = { css: 'oklch(0.5 0.1 200)', rgb: { r: 1, g: 2, b: 3 } };
    expect(withAlpha(token, 5)).toContain('100%');
    expect(withAlpha(token, -5)).toContain('0%');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
