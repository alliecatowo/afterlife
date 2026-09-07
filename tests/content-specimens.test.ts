import { describe, expect, it } from 'vitest';
import { createEngine, transformPattern } from '@/core/engine';
import { SPECIMENS, fromRLE, toStampPattern } from '@/content/specimens';

/**
 * Every specimen's claimed period/displacement is checked by actually
 * stepping the real engine — never by trusting the authored metadata. Seeds
 * (methuselahs) are excluded from the periodicity checks: their verified
 * figures are long-run transients on an UNBOUNDED grid, explicitly not
 * reproducible on our bounded 256x160 torus (see `gridCaveat`).
 */
describe('content: specimens', () => {
  it('every specimen parses from RLE to exactly its declared population', () => {
    for (const s of SPECIMENS) {
      const pop = s.cells.reduce((a, b) => a + b, 0);
      expect(pop, s.name).toBe(s.population);
      expect(s.cells.length, s.name).toBe(s.width * s.height);
    }
  });

  it('fromRLE is deterministic and matches the specimen-provided cells', () => {
    for (const s of SPECIMENS) {
      const parsed = fromRLE(s.rle, s.width, s.height);
      expect(Array.from(parsed), s.name).toEqual(Array.from(s.cells));
    }
  });

  function isolatedEngine(s: (typeof SPECIMENS)[number], pad: number) {
    const engine = createEngine({ width: s.width + pad * 2, height: s.height + pad * 2 });
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        if (s.cells[y * s.width + x]) engine.set(x + pad, y + pad, true);
      }
    }
    return engine;
  }

  it('every still life is unchanged after one generation', () => {
    for (const s of SPECIMENS.filter((s) => s.verified.kind === 'still')) {
      const engine = isolatedEngine(s, 4);
      const before = engine.region({ x: 0, y: 0, w: engine.spec.width, h: engine.spec.height });
      engine.step();
      const after = engine.region({ x: 0, y: 0, w: engine.spec.width, h: engine.spec.height });
      expect(Array.from(after), s.name).toEqual(Array.from(before));
    }
  });

  it('every oscillator returns to its exact starting bits after its claimed period, and not before', () => {
    for (const s of SPECIMENS.filter((s) => s.verified.kind === 'oscillator')) {
      const period = s.verified.kind === 'oscillator' ? s.verified.period : 0;
      const engine = isolatedEngine(s, period + 4);
      const rect = { x: 0, y: 0, w: engine.spec.width, h: engine.spec.height };
      const before = engine.region(rect);
      for (let g = 1; g < period; g++) {
        engine.step();
        const mid = engine.region(rect);
        expect(Array.from(mid), `${s.name} at generation ${g} (should not yet match)`).not.toEqual(Array.from(before));
      }
      engine.step();
      const after = engine.region(rect);
      expect(Array.from(after), `${s.name} at its claimed period`).toEqual(Array.from(before));
    }
  });

  it('every spaceship returns to its exact starting shape, translated by its claimed vector, after its claimed period', () => {
    for (const s of SPECIMENS.filter((s) => s.verified.kind === 'spaceship')) {
      if (s.verified.kind !== 'spaceship') continue;
      const { period, dx, dy } = s.verified;
      const pad = period + Math.abs(dx) + Math.abs(dy) + 6;
      const engine = isolatedEngine(s, pad);

      function tightBbox(rect: { x: number; y: number; w: number; h: number }) {
        const bits = engine.region(rect);
        let minX = rect.w, minY = rect.h, maxX = -1, maxY = -1;
        for (let y = 0; y < rect.h; y++) {
          for (let x = 0; x < rect.w; x++) {
            if (bits[y * rect.w + x]) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      }

      const full = { x: 0, y: 0, w: engine.spec.width, h: engine.spec.height };
      const startBox = tightBbox(full);
      const startShape = engine.region({ x: startBox.x, y: startBox.y, w: startBox.w, h: startBox.h });

      for (let g = 0; g < period; g++) engine.step();

      const endBox = tightBbox(full);
      expect(endBox.w, s.name).toBe(startBox.w);
      expect(endBox.h, s.name).toBe(startBox.h);
      const endShape = engine.region({ x: endBox.x, y: endBox.y, w: endBox.w, h: endBox.h });
      expect(Array.from(endShape), `${s.name} shape after one period`).toEqual(Array.from(startShape));
      expect(endBox.x - startBox.x, `${s.name} dx`).toBe(dx);
      expect(endBox.y - startBox.y, `${s.name} dy`).toBe(dy);
    }
  });

  it('every emitter gains exactly one glider (5 cells) of population per period, inside its own footprint window', () => {
    for (const s of SPECIMENS.filter((s) => s.verified.kind === 'emitter')) {
      if (s.verified.kind !== 'emitter') continue;
      const period = s.verified.period;
      const pad = Math.max(16, Math.ceil(period / 4) + 8);
      const engine = isolatedEngine(s, pad);
      const window = { x: pad, y: pad, w: s.width, h: s.height };

      const before = engine.region(window);
      const popBefore = before.reduce((a, b) => a + b, 0);
      for (let g = 0; g < period; g++) engine.step();
      const after = engine.region(window);
      const popAfter = after.reduce((a, b) => a + b, 0);

      // The gun's own fixed footprint is exactly periodic (its emitted
      // gliders are meant to have left it by the time the period completes).
      expect(Array.from(after), `${s.name} footprint after one period`).toEqual(Array.from(before));
      expect(popAfter, `${s.name} footprint population is unchanged (gliders leave before the period completes)`).toBe(popBefore);

      // A glider (5 live cells) really did leave: total world population grew by 5.
      const worldPop = (() => {
        let n = 0;
        engine.forEachLive({ x: 0, y: 0, w: engine.spec.width, h: engine.spec.height }, () => { n++; });
        return n;
      })();
      expect(worldPop, `${s.name} total population after one period`).toBe(s.population + s.verified.popGainPerPeriod);
    }
  });

  it('seed transients are excluded from periodicity claims and carry the unbounded-grid caveat', () => {
    const seeds = SPECIMENS.filter((s) => s.verified.kind === 'seed');
    expect(seeds.length).toBeGreaterThan(0);
    for (const s of seeds) {
      expect(s.verified.kind === 'seed' && s.verified.gridCaveat).toBe('unbounded (sparse) grid');
    }
  });

  it('toStampPattern round-trips a specimen into a valid StampPattern usable by LifeEngine.stamp', () => {
    const s = SPECIMENS.find((s) => s.name === 'glider')!;
    const pattern = toStampPattern(s);
    const rotated = transformPattern(pattern, { rotate: 1, flipX: false, flipY: false });
    expect(rotated.w).toBe(s.height);
    expect(rotated.h).toBe(s.width);

    const engine = createEngine({ width: 32, height: 32 });
    engine.stamp(pattern, 10, 10, { rotate: 0, flipX: false, flipY: false });
    expect(engine.population).toBe(s.population);
  });

  it('has 24 specimens and deliberately no puffer', () => {
    expect(SPECIMENS.length).toBe(24);
    expect(SPECIMENS.some((s) => s.name.toLowerCase().includes('puffer'))).toBe(false);
  });
});
