import { describe, expect, it } from 'vitest';
import { chooseCloseScale, chooseWideScale, CLOSEUP_MAX_SCALE, CLOSEUP_MIN_SCALE } from '@/ui/cinematic/framing';

const viewport = { width: 1440, height: 900 };

describe('cinematic framing: chooseCloseScale', () => {
  it('stays within the cinematic close-up band for a typical subject span', () => {
    const scale = chooseCloseScale(16, viewport);
    expect(scale).toBeGreaterThanOrEqual(CLOSEUP_MIN_SCALE);
    expect(scale).toBeLessThanOrEqual(CLOSEUP_MAX_SCALE);
  });

  it('clamps to the tight end for a very small traveller instead of zooming in absurdly far', () => {
    const scale = chooseCloseScale(1, viewport);
    expect(scale).toBe(CLOSEUP_MAX_SCALE);
  });

  it('clamps to the wide end of the close-up band for a sprawling cluster, never going below it', () => {
    const scale = chooseCloseScale(500, viewport);
    expect(scale).toBe(CLOSEUP_MIN_SCALE);
  });

  it('never returns a non-finite or non-positive scale for a degenerate span', () => {
    expect(Number.isFinite(chooseCloseScale(0, viewport))).toBe(true);
    expect(chooseCloseScale(0, viewport)).toBeGreaterThan(0);
  });
});

describe('cinematic framing: chooseWideScale', () => {
  it('fits the whole world into the viewport, below the close-up band (the entire point of the contrast)', () => {
    const world = { width: 256, height: 160 };
    const scale = chooseWideScale(world, viewport);
    expect(scale).toBeLessThan(CLOSEUP_MIN_SCALE);
    // Sanity: the world at this scale should span no more than the viewport (with the padding factor).
    expect(world.width * scale).toBeLessThanOrEqual(viewport.width + 1);
    expect(world.height * scale).toBeLessThanOrEqual(viewport.height + 1);
  });

  it('is smaller for a larger world at the same viewport', () => {
    const small = chooseWideScale({ width: 100, height: 100 }, viewport);
    const large = chooseWideScale({ width: 1000, height: 1000 }, viewport);
    expect(large).toBeLessThan(small);
  });
});
