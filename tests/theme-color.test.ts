import { describe, expect, it } from 'vitest';
import {
  parseOklch, formatOklch, contrastRatio, oklabDistance, relativeLuminance,
  oklchToHex, hexToOklchString,
} from '@/ui/theme/color';

describe('theme colour math', () => {
  it('parses and round-trips oklch()', () => {
    expect(parseOklch('oklch(0.5 0.1 200)')).toEqual({ l: 0.5, c: 0.1, h: 200 });
    expect(formatOklch({ l: 0.5, c: 0.1, h: 200 })).toBe('oklch(0.5 0.1 200)');
  });

  it('throws on a non-oklch string rather than guessing', () => {
    expect(() => parseOklch('#ff0000')).toThrow();
    expect(() => parseOklch('rgb(255, 0, 0)')).toThrow();
  });

  it('contrast ratio of a colour against itself is 1', () => {
    expect(contrastRatio('oklch(0.5 0.1 200)', 'oklch(0.5 0.1 200)')).toBeCloseTo(1, 5);
  });

  it('contrast ratio is order-independent', () => {
    const a = 'oklch(0.9 0.05 90)';
    const b = 'oklch(0.2 0.02 200)';
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('black-on-white style extremes approach the theoretical max (21:1)', () => {
    const white = relativeLuminance(parseOklch('oklch(1 0 0)'));
    const black = relativeLuminance(parseOklch('oklch(0 0 0)'));
    expect(white).toBeGreaterThan(black);
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeGreaterThan(19);
  });

  it('OKLab distance of a colour from itself is 0', () => {
    expect(oklabDistance(parseOklch('oklch(0.7 0.15 100)'), parseOklch('oklch(0.7 0.15 100)'))).toBe(0);
  });

  it('OKLab distance grows with hue separation at fixed L/C', () => {
    const base = parseOklch('oklch(0.8 0.15 0)');
    const near = oklabDistance(base, parseOklch('oklch(0.8 0.15 10)'));
    const far = oklabDistance(base, parseOklch('oklch(0.8 0.15 180)'));
    expect(far).toBeGreaterThan(near);
  });

  it('oklch <-> hex round-trips within a tiny tolerance', () => {
    const original = parseOklch('oklch(0.87 0.155 155)');
    const hex = oklchToHex(original);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const back = parseOklch(hexToOklchString(hex));
    expect(oklabDistance(original, back)).toBeLessThan(0.01);
  });

  it('hexToOklchString accepts 3-digit hex and is case-insensitive', () => {
    expect(() => hexToOklchString('#fff')).not.toThrow();
    expect(hexToOklchString('#ABCDEF')).toBe(hexToOklchString('#abcdef'));
  });
});
