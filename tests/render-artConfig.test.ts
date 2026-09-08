import { describe, expect, it } from 'vitest';
import {
  ART_PRESETS, applyReducedMotion, classicAsciiPreset, defaultArtConfig, isArtConfigAnimated,
  randomArtConfig, sanitizeArtConfig,
} from '@/render/artConfig';

describe('Art mode config: honesty defaults, sanitising, and animation detection', () => {
  it('the default config is Art mode OFF — the shipped app looks unchanged until a user opts in', () => {
    expect(defaultArtConfig().enabled).toBe(false);
  });

  it('classicAsciiPreset is a real, ready-to-use ASCII config with zero further setup', () => {
    const cfg = classicAsciiPreset();
    expect(cfg.enabled).toBe(true);
    expect(cfg.glyphs.setId).toBe('ascii');
    expect(cfg.glyphs.driver).toBe('age');
  });

  it('every built-in preset builds a valid, enabled config', () => {
    for (const preset of ART_PRESETS) {
      const cfg = preset.build();
      expect(cfg.enabled).toBe(true);
      expect(sanitizeArtConfig(cfg)).toEqual(cfg); // already well-formed
    }
  });

  it('sanitizeArtConfig falls back to defaults for garbage input without throwing', () => {
    expect(() => sanitizeArtConfig(null)).not.toThrow();
    expect(() => sanitizeArtConfig(undefined)).not.toThrow();
    expect(() => sanitizeArtConfig(42)).not.toThrow();
    expect(() => sanitizeArtConfig('not an object')).not.toThrow();
    expect(sanitizeArtConfig(null)).toEqual(defaultArtConfig());
  });

  it('sanitizeArtConfig repairs a partially-corrupt document field by field', () => {
    const corrupt = {
      enabled: true,
      glyphs: { setId: 'not-a-real-set', customChars: 'ok', driver: 'nonsense' },
      field: { source: 'bogus', scale: Number.NaN, rotationDeg: 9999 },
      lfos: [{ shape: 'square', rateHz: 999, depth: -5, target: 'not-a-target' }, 'garbage'],
      color: { stops: 'not an array', hueRotateDeg: 10 },
    };
    const cfg = sanitizeArtConfig(corrupt);
    expect(cfg.enabled).toBe(true); // valid field kept
    expect(cfg.glyphs.setId).toBe('ascii'); // invalid -> default
    expect(cfg.field.source).toBe('none'); // invalid -> default
    expect(Number.isFinite(cfg.field.scale)).toBe(true);
    expect(cfg.field.rotationDeg).toBeGreaterThanOrEqual(0);
    expect(cfg.field.rotationDeg).toBeLessThan(360);
    expect(cfg.lfos.length).toBe(1); // the string entry is dropped, the object survives sanitised
    expect(cfg.lfos[0]!.rateHz).toBeLessThanOrEqual(4);
    expect(cfg.lfos[0]!.depth).toBeGreaterThanOrEqual(0);
    expect(cfg.color.hueRotateDeg).toBe(10);
    expect(cfg.color.stops.length).toBeGreaterThanOrEqual(2); // fell back to default stops
  });

  it('sanitizeArtConfig caps an oversized lfos array at MAX_LFOS', () => {
    const many = { lfos: Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, shape: 'sine', target: 'hueRotate' })) };
    const cfg = sanitizeArtConfig(many);
    expect(cfg.lfos.length).toBeLessThanOrEqual(4);
  });

  it('isArtConfigAnimated is false when Art mode is off, regardless of LFOs configured', () => {
    const cfg = { ...classicAsciiPreset(), enabled: false, lfos: [{ id: 'a', shape: 'sine' as const, rateHz: 1, depth: 1, phase: 0, target: 'hueRotate' as const }] };
    expect(isArtConfigAnimated(cfg, () => true)).toBe(false);
  });

  it('isArtConfigAnimated is true with any LFO, trails, palette cycling, or an animated field', () => {
    const base = classicAsciiPreset();
    expect(isArtConfigAnimated(base, () => false)).toBe(false); // static by default
    expect(isArtConfigAnimated(
      { ...base, lfos: [{ id: 'x', shape: 'sine' as const, rateHz: 0.1, depth: 0.5, phase: 0, target: 'hueRotate' as const }] },
      () => false,
    )).toBe(true);
    expect(isArtConfigAnimated({ ...base, color: { ...base.color, trails: { enabled: true, decay: 0.1 } } }, () => false)).toBe(true);
    expect(isArtConfigAnimated({ ...base, color: { ...base.color, cycleSpeedHz: 0.2 } }, () => false)).toBe(true);
    expect(isArtConfigAnimated(base, () => true)).toBe(true); // field reports itself animated
  });

  it('randomArtConfig is deterministic for a given seed and enabled', () => {
    const a = randomArtConfig(1234);
    const b = randomArtConfig(1234);
    expect(a).toEqual(b);
    expect(a.enabled).toBe(true);
    const c = randomArtConfig(5678);
    expect(c).not.toEqual(a);
  });

  it('applyReducedMotion slows LFOs and disables trails/cycling', () => {
    const base = ART_PRESETS.find((p) => p.id === 'monolith')!.build();
    const reduced = applyReducedMotion({ ...base, lfos: [{ id: 'x', shape: 'sine' as const, rateHz: 1, depth: 1, phase: 0, target: 'hueRotate' as const }] });
    expect(reduced.lfos[0]!.rateHz).toBeLessThan(1);
    expect(reduced.color.trails.enabled).toBe(false);
    expect(reduced.color.cycleSpeedHz).toBe(0);
  });
});
