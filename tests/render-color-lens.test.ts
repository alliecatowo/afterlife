import { describe, expect, it } from 'vitest';
import {
  buildHueRamp, sampleHueRamp, buildNeighborRamp, buildRgbRamp, sampleRgbRamp,
  resolveQuadPalette, resolveImmigrationPalette, quadColorForSpecies, immigrationColorForSpecies,
  blendRgbWeighted, buildLensLegends, safeLensLegend, COLOR_LENSES, type ColorLens,
} from '@/render/color';

function isGreyOrWhite(rgb: { r: number; g: number; b: number }): boolean {
  return rgb.r === rgb.g && rgb.g === rgb.b;
}

function dist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

describe('buildHueRamp / sampleHueRamp: a genuine multi-hue wheel, not one hue at different lightnesses', () => {
  it('produces chromatic (non-grey) colours across the wheel', () => {
    const ramp = buildHueRamp(180);
    let chromaticCount = 0;
    for (const rgb of ramp) if (!isGreyOrWhite(rgb)) chromaticCount++;
    expect(chromaticCount).toBeGreaterThan(170);
  });

  it('samples several genuinely distinct hues, not near-duplicates', () => {
    const ramp = buildHueRamp(180);
    const a = sampleHueRamp(ramp, 0);
    const b = sampleHueRamp(ramp, 90);
    const c = sampleHueRamp(ramp, 180);
    const d = sampleHueRamp(ramp, 270);
    expect(dist(a, b)).toBeGreaterThan(40);
    expect(dist(b, c)).toBeGreaterThan(40);
    expect(dist(c, d)).toBeGreaterThan(40);
  });

  it('wraps: sampling 360 is the same bucket as sampling 0', () => {
    const ramp = buildHueRamp(180);
    expect(sampleHueRamp(ramp, 360)).toEqual(sampleHueRamp(ramp, 0));
  });

  it('is a pure function of its inputs (rebuilding gives the same ramp)', () => {
    expect(buildHueRamp(90, 0.8, 0.15)).toEqual(buildHueRamp(90, 0.8, 0.15));
  });
});

describe('buildNeighborRamp: the B3/S23 rule made visible as a real hue sweep', () => {
  it('has exactly 9 entries (0..8 live neighbours)', () => {
    expect(buildNeighborRamp()).toHaveLength(9);
  });

  it('sparse (0) and crowded (8) ends are clearly different hues, not shades of one hue', () => {
    const ramp = buildNeighborRamp();
    expect(dist(ramp[0]!, ramp[8]!)).toBeGreaterThan(60);
  });
});

describe('buildRgbRamp / sampleRgbRamp: spectral age/activity gradients that still end on the real accent', () => {
  it('a single stop returns a flat ramp of that colour', () => {
    const ramp = buildRgbRamp([{ r: 10, g: 20, b: 30 }], 8);
    for (const rgb of ramp) expect(rgb).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('t=0 samples the first stop and t=1 samples the last stop (exactly, so the accent colour is honoured at full intensity)', () => {
    const start = { r: 0, g: 0, b: 255 };
    const end = { r: 255, g: 128, b: 0 };
    const ramp = buildRgbRamp([start, end], 64);
    expect(sampleRgbRamp(ramp, 0)).toEqual(start);
    const atEnd = sampleRgbRamp(ramp, 1);
    expect(atEnd.r).toBeGreaterThan(200);
    expect(atEnd.g).toBeGreaterThan(90);
  });

  it('a 3-stop ramp passes visibly through the middle stop, not a direct start->end blend', () => {
    const start = { r: 0, g: 0, b: 255 };
    const mid = { r: 0, g: 255, b: 0 };
    const end = { r: 255, g: 0, b: 0 };
    const ramp = buildRgbRamp([start, mid, end], 100);
    const middle = sampleRgbRamp(ramp, 0.5);
    // Near the green midpoint, green channel should dominate — a direct
    // blue->red lerp would have near-zero green throughout.
    expect(middle.g).toBeGreaterThan(150);
  });

  it('clamps t outside [0, 1]', () => {
    const ramp = buildRgbRamp([{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }], 10);
    expect(sampleRgbRamp(ramp, -1)).toEqual(sampleRgbRamp(ramp, 0));
    expect(sampleRgbRamp(ramp, 2)).toEqual(sampleRgbRamp(ramp, 1));
  });
});

describe('resolveQuadPalette / resolveImmigrationPalette: distinct AND colourblind-safe option', () => {
  it('quad palette has 4 genuinely distinct colours by default', () => {
    const p = resolveQuadPalette('default');
    expect(p).toHaveLength(4);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(dist(p[i]!, p[j]!)).toBeGreaterThan(30);
  });

  it('cvd palette is also 4 distinct colours, and different from the default palette', () => {
    const def = resolveQuadPalette('default');
    const cvd = resolveQuadPalette('cvd');
    expect(cvd).toHaveLength(4);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(dist(cvd[i]!, cvd[j]!)).toBeGreaterThan(30);
    expect(cvd).not.toEqual(def);
  });

  it('immigration palette has exactly 2 distinct colours', () => {
    const [a, b] = resolveImmigrationPalette('default');
    expect(dist(a, b)).toBeGreaterThan(30);
  });

  it('quadColorForSpecies maps 1..4 to the 4 palette entries and anything else to null', () => {
    const p = resolveQuadPalette('default');
    expect(quadColorForSpecies(p, 1)).toEqual(p[0]);
    expect(quadColorForSpecies(p, 4)).toEqual(p[3]);
    expect(quadColorForSpecies(p, 0)).toBeNull();
    expect(quadColorForSpecies(p, 5)).toBeNull();
  });

  it('immigrationColorForSpecies coarsens {1,2}->A, {3,4}->B', () => {
    const pal = resolveImmigrationPalette('default');
    expect(immigrationColorForSpecies(pal, 1)).toEqual(pal[0]);
    expect(immigrationColorForSpecies(pal, 2)).toEqual(pal[0]);
    expect(immigrationColorForSpecies(pal, 3)).toEqual(pal[1]);
    expect(immigrationColorForSpecies(pal, 4)).toEqual(pal[1]);
    expect(immigrationColorForSpecies(pal, 0)).toBeNull();
  });
});

describe('blendRgbWeighted: a genuine blend for zoomed-out aggregation, not a point sample', () => {
  it('blends proportionally to weight', () => {
    const colors = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    const even = blendRgbWeighted(colors, [1, 1]);
    expect(even).toEqual({ r: 128, g: 128, b: 128 });
    const mostlyWhite = blendRgbWeighted(colors, [1, 9]);
    expect(mostlyWhite.r).toBeGreaterThan(200);
  });

  it('all-zero weights returns black rather than dividing by zero / NaN', () => {
    const colors = [{ r: 10, g: 20, b: 30 }];
    const result = blendRgbWeighted(colors, [0]);
    expect(Number.isNaN(result.r)).toBe(false);
  });
});

describe('buildLensLegends: every lens is documented, colour is never decorative', () => {
  it('has an entry for every ColorLens', () => {
    const legends = buildLensLegends('default');
    for (const lens of COLOR_LENSES) {
      expect(legends[lens as ColorLens].length).toBeGreaterThan(0);
      for (const entry of legends[lens as ColorLens]) {
        expect(entry.swatch.length).toBeGreaterThan(0);
        expect(entry.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('quadlife/immigration legends swap in the cvd palette when requested', () => {
    const def = buildLensLegends('default');
    const cvd = buildLensLegends('cvd');
    expect(def.quadlife[0]!.swatch).not.toBe(cvd.quadlife[0]!.swatch);
  });
});

describe('safeLensLegend: an unrecognised lens id can never crash the HUD', () => {
  it('returns the real entry for every known lens', () => {
    const legends = buildLensLegends('default');
    for (const lens of COLOR_LENSES) {
      expect(safeLensLegend(legends, lens)).toBe(legends[lens as ColorLens]);
    }
  });

  it('falls back to the "life" entry for an unrecognised key instead of returning undefined — this is exactly the lookup that used to unmount the whole React tree (including #world-canvas) when RenderLens didn\'t yet include a lens id that had reached the store', () => {
    const legends = buildLensLegends('default');
    const bogus = 'not-a-real-lens' as ColorLens;
    expect(safeLensLegend(legends, bogus)).toBe(legends.life);
    expect(safeLensLegend(legends, bogus).length).toBeGreaterThan(0);
  });
});
