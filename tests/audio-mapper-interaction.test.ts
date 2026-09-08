import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHURN_TIMBRE_WEIGHTS, DEFAULT_DISCOVERY_TIMBRES, emptyAggregate, mapBranchToNotes,
  mapChurnToNotes, mapDiscoveryToNotes, mapPaintToNote, mapPercussion, mapStampToNotes,
  pickWeightedTimbre, type BucketAggregate,
} from '@/audio/mapper';
import { isInScale, SCALES } from '@/audio/scale';
import type { DiscoveryEvent } from '@/core/types';

function aggWithChurn(explicitChurn: number, gen = 1): BucketAggregate {
  return { ...emptyAggregate(gen, 100), explicitChurn, populationDelta: 5 };
}

describe('audio/mapper — pickWeightedTimbre', () => {
  it('always returns a member of the supplied palette', () => {
    const weights: [import('@/audio/scheduler').Timbre, number][] = [['mallet', 1], ['glass', 2], ['bell', 3]];
    for (let i = 0; i < 100; i++) {
      const h = i / 100;
      expect(['mallet', 'glass', 'bell']).toContain(pickWeightedTimbre(h, weights));
    }
  });

  it('degrades honestly to mallet for an empty palette rather than throwing', () => {
    expect(pickWeightedTimbre(0.5, [])).toBe('mallet');
  });

  it('a single-entry palette always returns that entry', () => {
    expect(pickWeightedTimbre(0.9, [['bell', 1]])).toBe('bell');
  });
});

describe('audio/mapper — churn timbre weighting and harmonic shift', () => {
  it('the default palette only ever produces mallet or glass, matching the original instrument', () => {
    for (let gen = 0; gen < 100; gen++) {
      const notes = mapChurnToNotes(aggWithChurn(50, gen), { timbreWeights: DEFAULT_CHURN_TIMBRE_WEIGHTS });
      for (const n of notes) expect(['mallet', 'glass']).toContain(n.timbre);
    }
  });

  it('a custom palette is honoured', () => {
    let sawBell = false;
    for (let gen = 0; gen < 100; gen++) {
      const notes = mapChurnToNotes(aggWithChurn(50, gen), { timbreWeights: [['bell', 1]] });
      for (const n of notes) {
        expect(n.timbre).toBe('bell');
        sawBell = true;
      }
    }
    expect(sawBell).toBe(true);
  });

  it('harmonicShift stays fully in-scale and defaults to a no-op (0)', () => {
    const base = mapChurnToNotes(aggWithChurn(50, 3));
    const zeroShift = mapChurnToNotes(aggWithChurn(50, 3), { harmonicShift: 0 });
    expect(zeroShift).toEqual(base);
    for (const shift of [-2, -1, 1, 2]) {
      const notes = mapChurnToNotes(aggWithChurn(80, 9), { harmonicShift: shift });
      for (const n of notes) expect(isInScale(n.pitch)).toBe(true);
    }
  });

  it('proximityBoost raises velocity and pulls pan toward centre without ever exceeding sane bounds', () => {
    const near = mapChurnToNotes(aggWithChurn(80, 12), { proximityBoost: 1 });
    const far = mapChurnToNotes(aggWithChurn(80, 12), { proximityBoost: 0 });
    expect(near.length).toBe(far.length);
    for (let i = 0; i < near.length; i++) {
      expect(near[i]!.velocity).toBeGreaterThanOrEqual(far[i]!.velocity);
      expect(Math.abs(near[i]!.pan)).toBeLessThanOrEqual(Math.abs(far[i]!.pan) + 1e-9);
      expect(near[i]!.velocity).toBeLessThanOrEqual(1);
    }
  });

  it('out-of-range proximityBoost is clamped rather than misbehaving', () => {
    const tooHigh = mapChurnToNotes(aggWithChurn(80, 5), { proximityBoost: 99 });
    const atMax = mapChurnToNotes(aggWithChurn(80, 5), { proximityBoost: 1 });
    expect(tooHigh).toEqual(atMax);
  });
});

describe('audio/mapper — discovery timbre overrides and reinforced landings', () => {
  it('defaults reproduce the original per-kind timbres', () => {
    const stillLife: DiscoveryEvent = { id: 's', kind: 'still-life', gen: 1, rect: { x: 0, y: 0, w: 2, h: 2 }, label: 'x' };
    const notes = mapDiscoveryToNotes(stillLife);
    expect(notes[0]!.timbre).toBe(DEFAULT_DISCOVERY_TIMBRES.stillLife);
  });

  it('extinction is a genuine two-note dyad, both at the highest discovery priority', () => {
    const extinction: DiscoveryEvent = { id: 'e', kind: 'extinction', gen: 5, rect: { x: 0, y: 0, w: 1, h: 1 }, label: 'end' };
    const notes = mapDiscoveryToNotes(extinction);
    expect(notes.length).toBe(2);
    for (const n of notes) {
      expect(n.priority).toBe(6);
      expect(isInScale(n.pitch)).toBe(true);
    }
    // Quiet: never louder than an ordinary discovery accent.
    for (const n of notes) expect(n.velocity).toBeLessThanOrEqual(0.3);
  });

  it('explosion adds a low, punchy impact note beyond the original 3-note flurry', () => {
    const explosion: DiscoveryEvent = { id: 'x', kind: 'explosion', gen: 5, rect: { x: 0, y: 0, w: 4, h: 4 }, label: 'boom' };
    const notes = mapDiscoveryToNotes(explosion);
    expect(notes.length).toBe(4);
    const impact = notes[3]!;
    expect(impact.timbre).toBe(DEFAULT_DISCOVERY_TIMBRES.explosionImpact);
    expect(impact.priority).toBeGreaterThan(notes[0]!.priority);
    for (const n of notes) expect(isInScale(n.pitch)).toBe(true);
  });

  it('a preset discovery timbre map is honoured end to end', () => {
    const explosion: DiscoveryEvent = { id: 'x', kind: 'explosion', gen: 5, rect: { x: 0, y: 0, w: 4, h: 4 }, label: 'boom' };
    const custom = { ...DEFAULT_DISCOVERY_TIMBRES, explosion: 'bell' as const };
    const notes = mapDiscoveryToNotes(explosion, undefined, 1, custom);
    expect(notes[0]!.timbre).toBe('bell');
  });

  it('every discovery kind stays in-scale across every standard scale', () => {
    const kinds: DiscoveryEvent['kind'][] = ['still-life', 'oscillator', 'spaceship', 'extinction', 'explosion', 'stability'];
    for (const [, intervals] of Object.entries(SCALES)) {
      const scale = { tonic: 60, intervals };
      for (const kind of kinds) {
        const discovery: DiscoveryEvent = { id: kind, kind, gen: 1, rect: { x: 0, y: 0, w: 2, h: 2 }, label: kind };
        for (const n of mapDiscoveryToNotes(discovery, scale)) expect(isInScale(n.pitch, 60, intervals)).toBe(true);
      }
    }
  });
});

describe('audio/mapper — mapStampToNotes (specimen confirmation)', () => {
  it('scales the number of notes with real cell count', () => {
    expect(mapStampToNotes(1).length).toBe(1);
    expect(mapStampToNotes(10).length).toBe(2);
    expect(mapStampToNotes(30).length).toBe(3);
    expect(mapStampToNotes(200).length).toBe(4);
  });

  it('is deterministic in cellCount alone — a recognisable confirmation, not randomised', () => {
    expect(mapStampToNotes(25)).toEqual(mapStampToNotes(25));
  });

  it('stays in-scale and uses the bell voice', () => {
    for (const n of mapStampToNotes(50)) {
      expect(isInScale(n.pitch)).toBe(true);
      expect(n.timbre).toBe('bell');
      expect(n.source).toBe('stamp');
    }
  });
});

describe('audio/mapper — mapBranchToNotes (forking a future)', () => {
  it('always returns exactly two notes, panned oppositely', () => {
    const notes = mapBranchToNotes(12);
    expect(notes.length).toBe(2);
    expect(notes[0]!.pan).toBeLessThan(0);
    expect(notes[1]!.pan).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n.source).toBe('branch');
      expect(isInScale(n.pitch)).toBe(true);
    }
  });

  it('is deterministic in fromGen', () => {
    expect(mapBranchToNotes(41)).toEqual(mapBranchToNotes(41));
  });
});

describe('audio/mapper — mapPaintToNote (drawing/erasing as an instrument)', () => {
  it('is a pure function of position: the same cell always plays the same note', () => {
    expect(mapPaintToNote(0.3, 0.7, true, 0.5)).toEqual(mapPaintToNote(0.3, 0.7, true, 0.5));
  });

  it('always stays in-scale and within sane pan/velocity bounds', () => {
    for (let i = 0; i <= 10; i++) {
      const note = mapPaintToNote(i / 10, i / 10, i % 2 === 0, i / 10);
      expect(isInScale(note.pitch)).toBe(true);
      expect(Math.abs(note.pan)).toBeLessThanOrEqual(1);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThan(0.3);
    }
  });

  it('distinguishes planting from clearing by timbre', () => {
    expect(mapPaintToNote(0.5, 0.5, true, 0.5).timbre).toBe('pluck');
    expect(mapPaintToNote(0.5, 0.5, false, 0.5).timbre).toBe('breath');
  });

  it('is always the lowest-priority note class — never displaces churn/discovery', () => {
    const paint = mapPaintToNote(0.5, 0.5, true, undefined);
    expect(paint.priority).toBeLessThan(1);
  });

  it('degrades honestly (a flat mid velocity) without local density data', () => {
    const withDensity = mapPaintToNote(0.5, 0.5, true, 1);
    const without = mapPaintToNote(0.5, 0.5, true, undefined);
    expect(without.velocity).toBeGreaterThan(0);
    expect(withDensity.velocity).toBeGreaterThanOrEqual(without.velocity);
  });
});

describe('audio/mapper — mapPercussion (generative texture)', () => {
  it('never fires below the rate threshold', () => {
    for (let gen = 0; gen < 50; gen++) {
      const agg = aggWithChurn(2, gen); // low churn -> low rate
      expect(mapPercussion(agg, 0.1)).toHaveLength(0);
    }
  });

  it('is heavily rate-limited even under a sustained flood above threshold', () => {
    let fired = 0;
    for (let gen = 0; gen < 400; gen++) {
      const agg = aggWithChurn(1000, gen); // far above threshold every bucket
      fired += mapPercussion(agg, 0.1).length;
    }
    // 1-in-4 gate: nowhere close to firing every qualifying bucket.
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(200);
  });

  it('every emitted percussion note is in-scale and lowest priority', () => {
    for (let gen = 0; gen < 400; gen++) {
      const notes = mapPercussion(aggWithChurn(1000, gen), 0.1);
      for (const n of notes) {
        expect(isInScale(n.pitch)).toBe(true);
        expect(n.priority).toBeLessThan(1);
        expect(n.source).toBe('percussion');
      }
    }
  });

  it('degrades to silence for a non-positive bucket length rather than dividing by zero', () => {
    expect(mapPercussion(aggWithChurn(1000, 1), 0)).toHaveLength(0);
  });
});
