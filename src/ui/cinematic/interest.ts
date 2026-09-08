/**
 * Cinematic mode's "what's worth looking at" scoring — pure, deterministic,
 * unit-testable logic with no engine/DOM dependency. `@/ui/cinematic/director`
 * is the impure side: it samples the real engine into `RegionSample`s (via
 * `activityAt`/`get`, see `@/core/engine`'s doc) and optionally runs
 * `@/content/recognition`'s `scan()` on the best few candidates to detect a
 * real, identified travelling structure — this module only ranks whatever
 * samples it's handed.
 *
 * The rule, in one sentence: activity (real recent change) dominates the
 * score, a moving/identified traveller dominates activity, empty regions are
 * excluded outright, and a region visited too recently is skipped in favour
 * of the next-best one so the camera doesn't oscillate between two spots.
 */
import type { CellCoord } from '@/core/types';

/** A coarse grid cell's measurement, taken from the live engine. */
export interface RegionSample {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Live-cell count inside the region right now. */
  population: number;
  /** Mean `activityAt` (recent-change heat, [0, 1]) over every cell in the region — not just live ones, since a cell that just died is exactly the kind of event this mode wants to catch. */
  activity: number;
  /**
   * Set by the director when a top candidate's rect was confirmed, via a
   * real `@/content/recognition` scan, to contain a moving structure (a
   * `RecognizedCluster` with a `translation`). Absent/false for every sample
   * that wasn't checked (checking is expensive, so only the best few are).
   */
  hasTraveller?: boolean;
}

export interface ScoredRegion extends RegionSample {
  score: number;
  center: CellCoord;
}

export interface VisitedMemoryEntry {
  x: number;
  y: number;
  /** `performance.now()`/`Date.now()`-style timestamp of the visit. */
  visitedAtMs: number;
}

/** World cells within this radius of a remembered visit still count as "just been there". */
export const DEFAULT_MEMORY_RADIUS = 28;
/** How long a visit is remembered before the spot is fair game again. */
export const DEFAULT_MEMORY_TTL_MS = 45_000;

/** Flat bonus that puts a confirmed traveller ahead of ordinary activity —
 *  large enough that no plausible activity/density combination outranks it,
 *  small enough that TWO travellers still rank by their own activity. */
const TRAVELLER_BONUS = 5;
/** Density saturates quickly: a wide field of still lifes (high population,
 *  ~zero activity) must not be able to outscore a small genuinely busy
 *  patch just by covering more cells. */
const DENSITY_SATURATION = 0.35;

/**
 * Score one region. Higher is more cinematically interesting. Pure function
 * of the sample — no memory/recency here, see `pickSubject`.
 */
export function regionScore(sample: RegionSample): number {
  if (sample.population <= 0) return 0; // dead empty space is never interesting, full stop
  const area = Math.max(1, sample.w * sample.h);
  const density = Math.min(sample.population / area, DENSITY_SATURATION);
  const activityTerm = sample.activity * 3;
  const densityTerm = density * 1;
  const travellerTerm = sample.hasTraveller ? TRAVELLER_BONUS : 0;
  return activityTerm + densityTerm + travellerTerm;
}

function regionCenter(sample: RegionSample): CellCoord {
  return { x: sample.x + sample.w / 2, y: sample.y + sample.h / 2 };
}

/** Shortest distance between two points, wrapping toroidally if `world` is given. */
function distance(a: CellCoord, b: CellCoord, world?: { width: number; height: number }): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (world) {
    dx = Math.min(dx, world.width - dx);
    dy = Math.min(dy, world.height - dy);
  }
  return Math.hypot(dx, dy);
}

export interface PickOptions {
  nowMs: number;
  memory: readonly VisitedMemoryEntry[];
  /** World shape, for toroidal-aware "is this the same spot" distance. Omit for a flat (non-wrapping) comparison — fine for tests. */
  world?: { width: number; height: number };
  memoryRadius?: number;
  memoryTtlMs?: number;
}

/** True if `center` is within a remembered, still-fresh visit's radius. */
export function isRecentlyVisited(center: CellCoord, opts: PickOptions): boolean {
  const radius = opts.memoryRadius ?? DEFAULT_MEMORY_RADIUS;
  const ttl = opts.memoryTtlMs ?? DEFAULT_MEMORY_TTL_MS;
  return opts.memory.some((m) => {
    if (opts.nowMs - m.visitedAtMs >= ttl) return false;
    return distance(center, m, opts.world) <= radius;
  });
}

/** Rank every sample, highest first. Includes zero-score (empty) samples — use `pickSubject` to actually choose one, which excludes them. */
export function rankRegions(samples: readonly RegionSample[]): ScoredRegion[] {
  return samples
    .map((s) => ({ ...s, score: regionScore(s), center: regionCenter(s) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Choose the next subject: the highest-scoring non-empty region that hasn't
 * been visited recently. If literally everything scoreable has been visited
 * recently (a small or currently-quiet world), falls back to the overall top
 * scorer rather than refusing to move at all — a camera that never moves is
 * a worse failure than a rare early revisit.
 */
export function pickSubject(samples: readonly RegionSample[], opts: PickOptions): ScoredRegion | null {
  const ranked = rankRegions(samples).filter((r) => r.score > 0);
  if (ranked.length === 0) return null;
  for (const candidate of ranked) {
    if (!isRecentlyVisited(candidate.center, opts)) return candidate;
  }
  return ranked[0]!;
}
