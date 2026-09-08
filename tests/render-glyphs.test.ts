import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_GLYPHS, GLYPH_SETS, MAX_CUSTOM_GLYPHS, MIN_CUSTOM_GLYPHS,
  glyphIndexForValue, normalizeActivity, normalizeAge, normalizeDensity, normalizeField,
  normalizeLineage, normalizeNeighbors, resolveGlyphChars, selectGlyph,
} from '@/render/glyphs';

describe('glyph selection is pure logic driven by real state', () => {
  it('ascii is a proper 10-step density ramp from space to solid ink', () => {
    expect(GLYPH_SETS.ascii).toEqual([' ', '.', ':', '-', '=', '+', '*', '#', '%', '@']);
  });

  it('glyphIndexForValue is monotonic non-decreasing and covers the full range', () => {
    const count = 10;
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const idx = glyphIndexForValue(i / 100, count);
      expect(idx).toBeGreaterThanOrEqual(last);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(count);
      last = idx;
    }
    expect(glyphIndexForValue(0, count)).toBe(0);
    expect(glyphIndexForValue(1, count)).toBe(count - 1);
    expect(glyphIndexForValue(0.999, count)).toBe(count - 1);
  });

  it('glyphIndexForValue clamps out-of-range input rather than throwing', () => {
    expect(glyphIndexForValue(-5, 10)).toBe(0);
    expect(glyphIndexForValue(5, 10)).toBe(9);
    expect(glyphIndexForValue(0.5, 0)).toBe(0);
  });

  it('selectGlyph returns an actual character from the given set, low to high', () => {
    const chars = GLYPH_SETS.ascii;
    expect(selectGlyph(chars, 0)).toBe(' ');
    expect(selectGlyph(chars, 1)).toBe('@');
    expect(selectGlyph(chars, 0.55)).toBe(chars[glyphIndexForValue(0.55, chars.length)]);
  });

  it('resolveGlyphChars falls back to ascii for an empty/too-short custom string', () => {
    expect(resolveGlyphChars('custom', '')).toEqual(GLYPH_SETS.ascii);
    expect(resolveGlyphChars('custom', 'x')).toEqual(GLYPH_SETS.ascii); // shorter than MIN_CUSTOM_GLYPHS
  });

  it('resolveGlyphChars honours a valid custom string, capped at MAX_CUSTOM_GLYPHS', () => {
    expect(resolveGlyphChars('custom', DEFAULT_CUSTOM_GLYPHS)).toEqual(Array.from(DEFAULT_CUSTOM_GLYPHS));
    const long = 'abcdefghijklmnopqrstuvwxyz';
    const resolved = resolveGlyphChars('custom', long);
    expect(resolved.length).toBe(MAX_CUSTOM_GLYPHS);
    expect(MIN_CUSTOM_GLYPHS).toBeGreaterThan(0);
  });

  it('resolveGlyphChars returns the exact built-in list for a non-custom id', () => {
    expect(resolveGlyphChars('blocks', 'ignored')).toBe(GLYPH_SETS.blocks);
  });

  it('normalizeAge saturates at maxAge and is monotonic', () => {
    expect(normalizeAge(0)).toBe(0);
    expect(normalizeAge(32, 32)).toBe(1);
    expect(normalizeAge(1000, 32)).toBe(1); // saturates, never > 1
    expect(normalizeAge(-5)).toBe(0); // never < 0
    expect(normalizeAge(16, 32)).toBeCloseTo(0.5, 5);
  });

  it('normalizeActivity/normalizeDensity/normalizeField clamp to [0, 1]', () => {
    expect(normalizeActivity(-1)).toBe(0);
    expect(normalizeActivity(2)).toBe(1);
    expect(normalizeDensity(0.3)).toBe(0.3);
    expect(normalizeField(1.5)).toBe(1);
  });

  it('normalizeNeighbors maps the full 0..8 live-neighbour range onto [0, 1]', () => {
    expect(normalizeNeighbors(0)).toBe(0);
    expect(normalizeNeighbors(8)).toBe(1);
    expect(normalizeNeighbors(4)).toBeCloseTo(0.5, 5);
  });

  it('normalizeLineage wraps hue degrees into [0, 1) regardless of sign/range', () => {
    expect(normalizeLineage(0)).toBe(0);
    expect(normalizeLineage(360)).toBe(0);
    expect(normalizeLineage(180)).toBeCloseTo(0.5, 5);
    expect(normalizeLineage(-90)).toBeCloseTo(0.75, 5);
    expect(normalizeLineage(720 + 90)).toBeCloseTo(0.25, 5);
  });

  it('every built-in driver produces a value that survives a full glyph-index round trip', () => {
    const raw = [0, 4, 8, 16, 32, 64];
    for (const v of raw) {
      const idx = glyphIndexForValue(normalizeAge(v, 32), GLYPH_SETS.ascii.length);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(GLYPH_SETS.ascii.length);
    }
  });
});
