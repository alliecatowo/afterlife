/**
 * Seeded, deterministic PRNGs. Fully implemented — do not stub.
 *
 * Determinism is load-bearing: `LifeEngine.seed()` and branch replay must
 * reproduce the exact same universe from the same seed, forever.
 */

/** A pure function returning the next float in [0, 1). */
export type Rng = () => number;

/** Hash an arbitrary string into a 32-bit unsigned seed (xfnv1a). */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, good enough for visual/simulation seeding. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sfc32 — 128-bit state, longer period; used for long replay streams. */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  return function next(): number {
    const t = (((s0 + s1) >>> 0) + s3) >>> 0;
    s3 = (s3 + 1) >>> 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) >>> 0;
    s2 = ((s2 << 21) | (s2 >>> 11)) >>> 0;
    s2 = (s2 + t) >>> 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Build an sfc32 stream from a string or numeric seed. */
export function makeRng(seed: number | string): Rng {
  const s = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const warm = mulberry32(s);
  const a = (warm() * 4294967296) >>> 0;
  const b = (warm() * 4294967296) >>> 0;
  const c = (warm() * 4294967296) >>> 0;
  const d = (warm() * 4294967296) >>> 0;
  const rng = sfc32(a, b, c, d);
  for (let i = 0; i < 12; i++) rng();
  return rng;
}

/** Uniform integer in [min, max] inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick a uniformly random element. Throws on an empty array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: empty array');
  return items[Math.floor(rng() * items.length)]!;
}

/** In-place Fisher-Yates shuffle. Returns the same array. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}
