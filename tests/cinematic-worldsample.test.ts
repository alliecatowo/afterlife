import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { SPECIMENS, toStampPattern } from '@/content/specimens';
import { IDENTITY_TRANSFORM } from '@/core/types';
import { rankRegions } from '@/ui/cinematic/interest';
import {
  confirmTravellers, predictTravellerCenter, sampleWorldGrid, travellerStillAlive,
} from '@/ui/cinematic/worldSample';

const GLIDER = SPECIMENS.find((s) => s.name === 'glider')!;

describe('cinematic worldSample: sampleWorldGrid (real engine data)', () => {
  it('reports a busy block where a glider lives and zero-activity blocks where nothing does', () => {
    const engine = createEngine({ width: 64, height: 64 });
    engine.stamp(toStampPattern(GLIDER), 20, 20, IDENTITY_TRANSFORM);
    engine.step(); // give `activityAt` something to report — a fresh stamp alone already sets it, but a step exercises the real B3/S23 path too
    const samples = sampleWorldGrid(engine, 16);
    const ranked = rankRegions(samples);
    // The top-ranked block should be the one containing the glider (block (16,16)-(32,32) at blockSize 16).
    expect(ranked[0]!.x).toBe(16);
    expect(ranked[0]!.y).toBe(16);
    expect(ranked[0]!.population).toBeGreaterThan(0);
    expect(ranked[0]!.activity).toBeGreaterThan(0);
    // A block far from any cell has zero population and zero activity.
    const farBlock = samples.find((s) => s.x === 48 && s.y === 48)!;
    expect(farBlock.population).toBe(0);
    expect(farBlock.activity).toBe(0);
  });
});

describe('cinematic worldSample: confirmTravellers (real recognition.scan)', () => {
  it('confirms a real, isolated glider as a traveller with its true translation/period', () => {
    const engine = createEngine({ width: 64, height: 64 });
    engine.stamp(toStampPattern(GLIDER), 20, 20, IDENTITY_TRANSFORM);
    const samples = sampleWorldGrid(engine, 16);
    const ranked = rankRegions(samples).filter((r) => r.score > 0);
    const { samples: checked, travellers } = confirmTravellers(engine, ranked);
    expect(checked.some((s) => s.hasTraveller)).toBe(true);
    const lock = [...travellers.values()][0]!;
    expect(lock.translation).toEqual({ dx: 1, dy: 1 });
    expect(lock.period).toBe(4);
    expect(lock.name).toBe('glider');
  });

  it('does not flag a plain still life (a block) as a traveller', () => {
    const block = SPECIMENS.find((s) => s.name === 'block')!;
    const engine = createEngine({ width: 64, height: 64 });
    engine.stamp(toStampPattern(block), 20, 20, IDENTITY_TRANSFORM);
    const samples = sampleWorldGrid(engine, 16);
    const ranked = rankRegions(samples).filter((r) => r.score > 0);
    const { samples: checked, travellers } = confirmTravellers(engine, ranked);
    expect(checked.some((s) => s.hasTraveller)).toBe(false);
    expect(travellers.size).toBe(0);
  });
});

describe('cinematic worldSample: predictTravellerCenter / travellerStillAlive', () => {
  it('predicts the exact wrapped position after N full periods of real glider motion', () => {
    const world = { width: 64, height: 64 };
    const lock = { center: { x: 20, y: 20 }, translation: { dx: 1, dy: 1 }, period: 4, atGen: 0, spanCells: 3 };
    // After exactly 3 periods (12 generations) a NE-moving glider has shifted by (3, 3).
    expect(predictTravellerCenter(lock, 12, world)).toEqual({ x: 23, y: 23 });
  });

  it('wraps toroidally past the world edge', () => {
    const world = { width: 64, height: 64 };
    const lock = { center: { x: 62, y: 62 }, translation: { dx: 1, dy: 1 }, period: 4, atGen: 0, spanCells: 3 };
    expect(predictTravellerCenter(lock, 8, world)).toEqual({ x: 0, y: 0 });
  });

  it('travellerStillAlive is true near a real live glider and false in empty space', () => {
    const engine = createEngine({ width: 64, height: 64 });
    engine.stamp(toStampPattern(GLIDER), 20, 20, IDENTITY_TRANSFORM);
    expect(travellerStillAlive(engine, { x: 21, y: 21 })).toBe(true);
    expect(travellerStillAlive(engine, { x: 50, y: 50 })).toBe(false);
  });
});
