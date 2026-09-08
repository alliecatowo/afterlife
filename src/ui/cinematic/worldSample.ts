/**
 * The impure half of interest-finding: reads the REAL engine into the
 * `RegionSample`s that `@/ui/cinematic/interest` scores, and confirms
 * travellers via `@/content/recognition`'s real `scan()`. Nothing here is
 * faked or randomly generated — every number comes from `activityAt`/`get`
 * on the live engine, or from a real recognition pass over it.
 *
 * Cost: one full pass over the world's cells per call (`activityAt` + `get`
 * per cell) — for the app's 256x160 world that's ~41k cheap typed-array
 * reads, well under a millisecond. Callers (the director) run this on a
 * throttled schedule (once per subject transition, every several seconds),
 * never per frame/generation.
 */
import type { LifeEngine } from '@/core/engine';
import { wrap } from '@/core/engine';
import { scan } from '@/content/recognition';
import type { RegionSample } from './interest';

/** Coarse grid cell size, in world cells, for the interest-scoring sweep. */
export const GRID_BLOCK_SIZE = 16;

/** Margin added around a candidate block before it's handed to `scan()`, so a
 *  traveller straddling a block edge is still fully inside the scanned rect. */
const SCAN_MARGIN = 10;

/** How many of the top-scoring candidates get the (more expensive) real recognition scan. */
export const TRAVELLER_CHECK_TOP_N = 4;

/** Sample the whole world on a coarse grid. Real `activityAt`/`get` reads, nothing synthetic. */
export function sampleWorldGrid(engine: LifeEngine, blockSize = GRID_BLOCK_SIZE): RegionSample[] {
  const { width, height } = engine.spec;
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const samples: RegionSample[] = [];
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x = bx * blockSize;
      const y = by * blockSize;
      const w = Math.min(blockSize, width - x);
      const h = Math.min(blockSize, height - y);
      let activitySum = 0;
      let population = 0;
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          activitySum += engine.activityAt(xx, yy);
          if (engine.get(xx, yy)) population++;
        }
      }
      samples.push({ x, y, w, h, population, activity: activitySum / (w * h) });
    }
  }
  return samples;
}

/** A real, identified moving structure found by `scan()` — enough to drive `follow()`. */
export interface TravellerLock {
  /** World-cell center of the structure at `atGen`. */
  center: { x: number; y: number };
  translation: { dx: number; dy: number };
  period: number;
  atGen: number;
  /** Longer side of its bounding box, for `framing.chooseCloseScale`. */
  spanCells: number;
  /** The curated specimen name, when `scan()` could name it (e.g. "glider"). */
  name?: string;
}

/** Grid-key for a sample's top-left corner — stable identity for matching a
 *  confirmed traveller back to the full sample list the director keeps. */
export function sampleKey(s: { x: number; y: number }): string {
  return `${s.x},${s.y}`;
}

/**
 * Runs the real recognition scan on the top few candidates and flags any
 * whose scan found a moving (named or characterized) cluster — mutates
 * nothing; returns a new array plus a map of confirmed traveller locks
 * keyed by `sampleKey()`, for the director to follow.
 */
export function confirmTravellers(
  engine: LifeEngine,
  ranked: readonly RegionSample[],
  topN = TRAVELLER_CHECK_TOP_N,
): { samples: RegionSample[]; travellers: Map<string, TravellerLock> } {
  const { width, height } = engine.spec;
  const samples = ranked.map((s) => ({ ...s }));
  const travellers = new Map<string, TravellerLock>();
  const gen = engine.gen;

  for (let i = 0; i < samples.length && i < topN; i++) {
    const s = samples[i]!;
    if (s.population <= 0) continue;
    const rect = {
      x: s.x - SCAN_MARGIN,
      y: s.y - SCAN_MARGIN,
      w: s.w + SCAN_MARGIN * 2,
      h: s.h + SCAN_MARGIN * 2,
    };
    let result;
    try {
      result = scan(engine, rect);
    } catch {
      continue; // recognition is best-effort here — never let it break the camera
    }
    const moving = result.clusters.find((c) => c.translation && (c.status === 'named' || c.status === 'characterized'));
    if (!moving?.translation || !moving.period) continue;
    s.hasTraveller = true;
    travellers.set(sampleKey(s), {
      center: {
        x: wrap(moving.bbox.x + moving.bbox.w / 2, width),
        y: wrap(moving.bbox.y + moving.bbox.h / 2, height),
      },
      translation: moving.translation,
      period: moving.period,
      atGen: gen,
      spanCells: Math.max(moving.bbox.w, moving.bbox.h),
      name: moving.name,
    });
  }
  return { samples, travellers };
}

/** Predicted current center of a locked traveller, from its last confirmed
 *  observation, wrapped toroidally. Deterministic — the same lock always
 *  predicts the same point for the same `nowGen`, since a spaceship's
 *  translation-per-period is exact (see `@/content/recognition`'s doc). */
export function predictTravellerCenter(
  lock: TravellerLock,
  nowGen: number,
  world: { width: number; height: number },
): { x: number; y: number } {
  const cycles = (nowGen - lock.atGen) / lock.period;
  return {
    x: wrap(lock.center.x + lock.translation.dx * cycles, world.width),
    y: wrap(lock.center.y + lock.translation.dy * cycles, world.height),
  };
}

/**
 * Cheaply check whether a traveller is still alive near its predicted spot —
 * used to decide "still travelling" vs. "collided/died, hold on the
 * aftermath". Real population read, not a guess.
 */
export function travellerStillAlive(engine: LifeEngine, center: { x: number; y: number }, radius = 6): boolean {
  const { width, height } = engine.spec;
  const rect = { x: center.x - radius, y: center.y - radius, w: radius * 2, h: radius * 2 };
  const region = engine.region({ x: wrap(rect.x, width), y: wrap(rect.y, height), w: rect.w, h: rect.h });
  for (const v of region) if (v) return true;
  return false;
}
